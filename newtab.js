// newtab.js - 持久化方案 v2
//
// 规则：
// - URL 带 ?seq=N 时直接用 N（最常见路径：后台已注入）
// - URL 没 seq 时问后台 getMySeq 兜底（处理后台注入漏掉的极端情况）
// - 拿到 seq 后重定向 URL（history.replaceState）让刷新/重开都能从 URL 拿
// - 笔记存 chrome.storage.local（key=note_<N>）
// - × 关闭由后台统一处理；这里不负责清理
// - 浏览器关闭再开，由 Chrome 自带 session restore 恢复所有 newtab tabs
//   （URL 已带 seq 参数，newtab.html 直接拿），内容自动从 storage.local 取回

const ROOT_ID = 'root';
const NOTE_KEY = (seq) => 'note_' + seq;

// 从 URL 拿 ?seq=N，没有时问后台
async function getMySeq() {
  // 路径 1：URL 有 ?seq=
  try {
    const params = new URLSearchParams(location.search);
    const seq = parseInt(params.get('seq'), 10);
    if (seq && seq > 0) return seq;
  } catch (e) {}

  // 路径 2：问后台（10 次重试 × 100ms）
  for (let i = 0; i < 10; i++) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'getMySeq' });
      if (r && r.seq) {
        // 重定向 URL 让刷新/重开都能直接拿 seq，无需再问后台
        try {
          const newUrl = location.pathname + '?seq=' + r.seq;
          window.history.replaceState(null, '', newUrl);
        } catch (e) {}
        return r.seq;
      }
    } catch (e) {}
    await new Promise((res) => setTimeout(res, 100));
  }
  return null;
}

// 构建编辑器 UI（基于 #root）
function buildEditorUI(root, seq) {
  document.title = 'txt' + seq;

  root.innerHTML =
    '<div class="bar">' +
      '<span class="title" id="title">txt' + seq + '</span>' +
      '<div class="meta">' +
        '<span id="count">0 字</span>' +
        '<button id="export" type="button">导出 .txt</button>' +
      '</div>' +
    '</div>' +
    '<textarea id="editor" placeholder="在这里输入内容，自动保存到本地……" spellcheck="false"></textarea>';

  const editor = document.getElementById('editor');
  const count = document.getElementById('count');

  function updateCount() {
    count.textContent = editor.value.length + ' 字';
  }

  updateCount();

  // 异步加载之前保存的内容
  const key = NOTE_KEY(seq);
  chrome.storage.local
    .get([key])
    .then((r) => {
      if (editor && r && typeof r[key] === 'string') {
        editor.value = r[key];
        updateCount();
      }
    })
    .catch(() => {});

  // 输入防抖自动保存（300ms）
  let saveTimer;
  editor.addEventListener('input', () => {
    updateCount();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [key]: editor.value }).catch(() => {});
    }, 300);
  });

  // 导出 .txt
  document.getElementById('export').addEventListener('click', () => {
    try {
      const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'txt' + seq + '.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {}
  });
}

function showError(msg) {
  const root = document.getElementById(ROOT_ID);
  if (root) {
    root.innerHTML = '<div id="err">' + msg + '</div>';
  }
}

async function init() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  const seq = await getMySeq();
  if (!seq) {
    showError('初始化失败：未能分配编号。请刷新页面重试。');
    return;
  }

  buildEditorUI(root, seq);
}

init();
