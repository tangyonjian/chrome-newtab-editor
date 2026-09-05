// background.js - 持久化方案 v2.2
//
// 规则（用户最新要求）：
// - 持久化：max_seq + note_<N> → chrome.storage.local
// - 浏览器关闭后再开 Chrome：之前未关闭的编辑标签页要保留（由 Chrome 自带 session restore）
// - 编号永远递增（max_seq + 1），关掉的编号不回收
// - **全部 × 关闭后（storage 里没有任何 note_<N>），max_seq 复位到 0**
//   下次新建从 txt1 开始（用户最新需求）
// - 接受 session restore 时的"一闪"（不再做防闪烁）
// - chrome.storage.session 不再使用
//
// seq 注入策略（4 重保险）：
//   1) chrome.tabs.onUpdated —— tab URL 变化到 newtab.html 时检查
//      - URL 无 ?seq= → 分配 seq 并重定向 URL
//      - URL 已带 ?seq=（session restore 回来的）→ 记录 seq 到 tabSeqMap 用于 × 关闭清理
//   2) chrome.tabs.onActivated —— tab 激活时再检查一次
//   3) chrome.runtime.onStartup —— 启动时遍历所有 newtab tabs 兜底注入
//   4) chrome.runtime.onMessage getMySeq —— newtab.js 主动询问兜底
//
// 重要：tab 注入的 URL 会保留到下次 session restore；session restore 后
// tabs 的 URL 仍然是 chrome-extension://.../newtab.html?seq=N，newtab.js
// 直接从 URL 拿 seq，无须再注入。
//
// v2.2 复位双保险（应对 SW idle 被 kill 后 tabSeqMap 失效）：
//   - onStartup：扫所有 live tab seqs → 清 stale notes → 无 live 时 max_seq 复位到 0
//   - onRemoved：tabSeqMap 没记录时，diff 兜底（用剩余 live tabs 的 URL seqs
//     作为权威源，不在里面的 note_<N> 全删）

// 本次浏览器运行期间的 tabId → seq 映射
const tabSeqMap = new Map();

// 串行化链：保证 max_seq 的 read-modify-write 原子性
let allocateChain = Promise.resolve();

// === 分配下一个 seq（max_seq + 1），写回 storage.local ===
// 智能复位：分配前扫一遍 storage，没有任何 note_<N>（用户全部 × 关闭）时
// 把 max_seq 复位到 0，下个 tab 从 1 开始（用户最新需求）
//
// 关键：分配后立刻写占位 note_<seq>=''
//   否则并发开多个 tab 时，后续 tab 检查 hasNotes=false 会错误复位 max_seq，
//   导致多个 tab 都拿到 seq=1。占位让 hasNotes 能区分"真的没有"vs"已分配但还没输入"
async function getNextSeq() {
  const result = allocateChain.then(async () => {
    // 1. 检查是否还有任何笔记内容（含占位）
    const all = await chrome.storage.local.get(null);
    const hasNotes = Object.keys(all).some(k => k.startsWith('note_'));

    if (!hasNotes) {
      // 全部 × 关闭后 → 复位 max_seq 到 0，下次分配从 1 开始
      await chrome.storage.local.set({ max_seq: 0 });
    }

    // 2. 正常递增
    const r = await chrome.storage.local.get(['max_seq']);
    let m = typeof r.max_seq === 'number' ? r.max_seq : 0;
    m += 1;
    await chrome.storage.local.set({ max_seq: m });

    // 3. 占位：标记该 seq 已被分配（× 关闭时 onRemoved 会清掉）
    await chrome.storage.local.set({ ['note_' + m]: '' });

    return m;
  });
  allocateChain = result.catch(() => {});
  return result;
}

// === 给指定 tab 注入 seq 参数（URL 改写） ===
async function injectSeq(tabId, currentUrl) {
  try {
    const seq = await getNextSeq();
    const newUrl = currentUrl.split('?')[0] + '?seq=' + seq;
    await chrome.tabs.update(tabId, { url: newUrl });
    tabSeqMap.set(tabId, seq);
  } catch (e) {
    // tab 可能已不存在（被用户主动 × 关掉），静默失败
  }
}

// === 检查一个 tab 是否需要注入 seq；需要就注入 ===
async function tryInjectSeq(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const newtabUrl = chrome.runtime.getURL('newtab.html');
    if (!tab.url || !tab.url.startsWith(newtabUrl)) return;
    if (tab.url.includes('?seq=')) return;
    if (tabSeqMap.has(tabId)) return;  // 本次 session 内已注入过
    await injectSeq(tabId, tab.url);
  } catch (e) {}
}

// === 监听 tab URL 变化 ===
// 主注入点：tab 加载 newtab.html（无论新建还是恢复）一定触发
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    if (!changeInfo.url) return;
    const newtabUrl = chrome.runtime.getURL('newtab.html');
    if (!changeInfo.url.startsWith(newtabUrl)) return;

    if (changeInfo.url.includes('?seq=')) {
      // session restore 回来的 tab：URL 已带 seq，记录到 tabSeqMap
      // 这样 × 关闭时 onRemoved 能找到 seq → 清 note_<seq>
      try {
        const query = changeInfo.url.split('?')[1] || '';
        const params = new URLSearchParams(query);
        const seq = parseInt(params.get('seq'), 10);
        if (seq && seq > 0 && !tabSeqMap.has(tabId)) {
          tabSeqMap.set(tabId, seq);
        }
      } catch (e) {}
      return;
    }

    await injectSeq(tabId, changeInfo.url);
  } catch (e) {}
});

// === 兜底：tab 激活时再检查一次 ===
chrome.tabs.onActivated.addListener((activeInfo) => {
  tryInjectSeq(activeInfo.tabId);
});

// === 兜底：浏览器冷启动时遍历所有 newtab tabs 注入 ===
// 同时清理 stale notes（之前测试遗留的 / SW kill 留下的死数据），
// 并在「无任何 live tab」时把 max_seq 复位到 0，确保下次新建从 txt1 开始。
chrome.runtime.onStartup.addListener(async () => {
  try {
    const newtabUrl = chrome.runtime.getURL('newtab.html');
    const tabs = await chrome.tabs.query({ url: newtabUrl + '*' });

    // 1. 收集所有 live tabs 的 seq（从 URL 里解析）
    const liveSeqs = new Set();
    for (const t of tabs) {
      try {
        const s = parseInt(new URLSearchParams(t.url.split('?')[1] || '').get('seq'), 10);
        if (s > 0) liveSeqs.add(s);
      } catch (e) {}
      // 给没 seq 的 tab 兜底注入（用 fire-and-forget，不互相阻塞）
      tryInjectSeq(t.id);
    }

    // 2. 清 stale notes（note_<N> 在 live 列表里没有 → 删掉）
    const all = await chrome.storage.local.get(null);
    const toRemove = Object.keys(all)
      .filter(k => /^note_\d+$/.test(k) && !liveSeqs.has(parseInt(k.slice(5), 10)));
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove).catch(() => {});
    }

    // 3. 一个 live tab 都没 → max_seq 复位到 0（下次新建从 txt1 开始）
    if (liveSeqs.size === 0) {
      await chrome.storage.local.set({ max_seq: 0 }).catch(() => {});
    }
  } catch (e) {}
});

// === tab 关闭：× 关闭清 note；关浏览器保留所有 ===
//
// MV3 关键问题：tabSeqMap 是内存 Map，SW 在 ~30s 无活动后会被 Chrome kill，
// kill 后 Map 被清空。下次 onRemoved 触发时 SW wake up，tabSeqMap 已空，
// 找不到 seq 就 return → note_<N> 留在 storage → 干扰后续「全关→复位」判断。
//
// 兜底方案：tabSeqMap 没记录时，用「剩余 live tabs 的 URL seqs」作为权威来源，
// 不在剩余里的 note_<N> 全删（包括当前关掉的那个）。
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // 关浏览器 / 关 window → 全部保留，让 session restore 恢复
  if (removeInfo.isWindowClosing) {
    tabSeqMap.delete(tabId);
    return;
  }

  // 主动 × 关闭：清 note_<seq>
  let seq = tabSeqMap.get(tabId);

  if (seq != null) {
    // 常规路径：tabSeqMap 有记录
    chrome.storage.local.remove('note_' + seq).catch(() => {});
    tabSeqMap.delete(tabId);
    return;
  }

  // 兜底：tabSeqMap 空（SW 被 kill 后刚 wake up）
  try {
    const newtabUrl = chrome.runtime.getURL('newtab.html');
    const remaining = await chrome.tabs.query({ url: newtabUrl + '*' });
    const remainingSeqs = new Set();
    for (const t of remaining) {
      try {
        const s = parseInt(new URLSearchParams(t.url.split('?')[1] || '').get('seq'), 10);
        if (s > 0) remainingSeqs.add(s);
      } catch (e) {}
    }
    const all = await chrome.storage.local.get(null);
    const toRemove = Object.keys(all)
      .filter(k => /^note_\d+$/.test(k) && !remainingSeqs.has(parseInt(k.slice(5), 10)));
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove).catch(() => {});
    }
  } catch (e) {}
});

// === newtab.js 询问 "我是谁"（URL 没 seq 时的最终兜底） ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return false;

  if (msg.type === 'getMySeq') {
    // 先看 memory map
    const known = tabSeqMap.get(tabId);
    if (known) {
      sendResponse({ seq: known });
      return true;
    }
    // 没记录 → 分配一个新的
    (async () => {
      try {
        const seq = await getNextSeq();
        tabSeqMap.set(tabId, seq);
        sendResponse({ seq });
      } catch (e) {
        sendResponse({ seq: null });
      }
    })();
    return true;
  }
});
