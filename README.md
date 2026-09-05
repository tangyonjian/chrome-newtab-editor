# 新标签页编辑器（Chrome 扩展）

把 Chrome 的新标签页变成一个本地文本编辑器：即开即写、自动保存、可导出，零依赖、无需联网。每个新标签页自动按 `txt1`、`txt2`、`txt3`... 编号。

**核心特性：把每个标签页当一张草稿纸**

| 场景 | 行为 |
|------|------|
| 新开标签页 | 分配新编号（已用过的最大编号 + 1），永远递增，关掉的编号不会复用 |
| 主动点 × 关闭某个标签页 | 只清除该编号的 note 内容；编号本身不回收 |
| 关闭浏览器/退出 Chrome | **不再清空**——持久化到 `chrome.storage.local`，重启后能看到 |
| 重启 Chrome | **保留之前未关闭的编辑标签页**——由 Chrome 自带 session restore 自动恢复，URL 已带 `?seq=N` 参数，新标签页直接拿回原编号和内容 |

## 文件结构

```
chrome-newtab-editor/
├── icons/              # 扩展图标（16/32/48/128 PNG）
├── manifest.json       # 扩展清单：声明接管 newtab 页面 + 后台脚本 + 权限
├── background.js       # 后台脚本：编号递增分配、URL 注入、× 关闭时清内容
├── newtab.html         # 编辑器界面（textarea + 顶栏）
├── newtab.js           # 从 URL 拿 seq、加载/保存/导出
└── generate-icons.py   # 生成图标的脚本（可改颜色/图案后重新运行）
```

## 安装步骤

1. 打开 Chrome，地址栏输入 `chrome://extensions/` 并回车。
2. 打开右上角的 **「开发者模式」** 开关。
3. 点击 **「加载已解压的扩展程序」**。
4. 选择本文件夹（`chrome-newtab-editor/`）。
5. 新建一个标签页（`Ctrl+T`），即可看到编辑器，标题为 `txt1`。

## 工作原理

**存储全用 `chrome.storage.local`**：持久化到磁盘，浏览器关闭后保留。

**编号分配 + URL 注入**（`background.js`）：

- 后台持久化 `max_seq: number`（已用过的最大编号）
- 新标签页加载后由后台分配 `max_seq + 1`，**注入到 tab URL**（变为 `newtab.html?seq=N`）
- `?seq=` 参数是关键：它让 session restore 后的 tab 立刻知道自己是谁，newtab.js 直接从 URL 读，无须再问后台
- 用 `allocateChain`（promise chain）**串行化**"读 → +1 → 写回"的原子性，避免多个 tab 同时拿到相同编号
- **URL 注入的 4 重保险**：
  1. `chrome.tabs.onUpdated` —— tab URL 变化时检查并注入
  2. `chrome.tabs.onActivated` —— tab 激活时再检查一次
  3. `chrome.runtime.onStartup` —— 启动时遍历所有 newtab tabs 兜底
  4. `chrome.runtime.onMessage` getMySeq —— newtab.js 主动询问兜底（拿到后用 `history.replaceState` 重写 URL）

**× 关闭**（`chrome.tabs.onRemoved`）：

- 主动 × 关闭（`isWindowClosing === false`）→ 调 `chrome.storage.local.remove('note_' + seq)` 把 `note_<N>` 删掉
- 关闭浏览器（`isWindowClosing === true`）→ **不做任何清理**，让 Chrome session restore 自然恢复 tabs 和笔记
- **注意：编号永不回收**，即使关掉下次再开仍是 `max_seq + 1`

**Session restore 流程**：

- 浏览器重启 → Chrome 自动恢复上次打开的 tabs
- 这些 tabs 的 URL 已经是 `chrome-extension://...newtab.html?seq=N`（之前注入过）
- newtab.js 从 URL 直接拿 `seq`，渲染编辑器
- 内容从 `chrome.storage.local` 的 `note_<N>` 拿回
- **接受短暂的"恢复再出现"视觉**——不再尝试防闪烁

**数据存储 key 汇总**：

| Key | 类型 | 含义 |
|-----|------|------|
| `max_seq` | `number` | 已用过的最大编号；下次分配 `max_seq + 1` |
| `note_<N>` | `string` | 第 N 号笔记的当前内容（防抖保存） |

## 常见问题

| 问题 | 说明 |
|------|------|
| 新标签页没变化 | 确认「开发者模式」已开，且加载的是包含 `manifest.json` 的文件夹（不是它的上一级目录） |
| 关闭浏览器后内容没了 | 这个 bug 现在已经修了——内容会持久化到 storage.local |
| 多个标签页几乎同时打开会拿到相同编号吗 | 不会。`getNextSeq` 用 promise chain 串行化 read-modify-write |
| 关闭后编号会复用吗 | **不会**。编号永远递增（已用过的最大 + 1），关掉后下次开是新号 |
| 旧版本残留的数据怎么办 | 在扩展的 service worker 控制台跑 `chrome.storage.local.clear()` 清空旧数据，再重新加载扩展 |
| 重启浏览器时 tab 会闪一下 | 这是预期行为（用户接受）。Chrome session restore 恢复 tabs 时有 ~100ms 视觉感 |
| 还能显示 Google 搜索框吗 | 不能，`newtab` 被完全替换 |

## 图标自定义

扩展图标已接入 `manifest.json` 的 `icons` 字段，并同步配置了 `action.default_icon`（工具栏图标）。

- 当前样式：暗色圆角方形底 `#2B2B2B` + 白色字母 `T`（Georgia 衬线）。
  - 大图标（48/128）：regular 细体，衬线优雅。
  - 小图标（16/32）：bold——小尺寸下细体笔画不足 1px，抗锯齿会被稀释成灰色，加粗才能保证纯白清晰。
- 重新生成图标需要 Pillow：`pip install Pillow`
- 想改颜色/字体/字母：编辑 `generate-icons.py` 顶部的 `BG`、`FG`、`FONT_CANDIDATES`、`TEXT` 变量，然后 `python generate-icons.py`。

## 可选增强方向

- 导出/导入全部笔记（.zip）
- 编辑器：Markdown 实时预览（引入 `marked.js`）
- 编辑器：行号 / 代码高亮（接入 `CodeMirror` / `Monaco`）
