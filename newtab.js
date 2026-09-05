initEditor();

function initEditor() {
  const editor = document.getElementById('editor');
  const count = document.getElementById('count');
  const titleEl = document.getElementById('title');

  // 1. 分配当前标签页的编号：读取会话计数器并 +1
  // 用 chrome.storage.session（内存级）：浏览器完全退出后自动清空，
  // 因此重启浏览器后编号从 txt1 重新开始；只有不关闭浏览器时才累加。
  chrome.storage.session.get(['noteSeq'], (res) => {
    const seq = (res.noteSeq || 0) + 1;

    // 立即写回计数器，尽量缩短并发竞争窗口
    chrome.storage.session.set({ noteSeq: seq }, () => {
      // 2. 设置标题为 txtN（顶栏 + 浏览器标签页标题）
      titleEl.textContent = 'txt' + seq;
      document.title = 'txt' + seq;

      // 3. 每个标签页使用独立的 key，因此新标签页内容初始为空（修复共享内容 bug）
      const key = 'note_' + seq;

      chrome.storage.session.get([key], (r) => {
        editor.value = r[key] || '';
        updateCount();

        // 4. 输入时防抖自动保存到当前标签页自己的 key
        let timer;
        editor.addEventListener('input', () => {
          updateCount();
          clearTimeout(timer);
          timer = setTimeout(() => {
            const data = {};
            data[key] = editor.value;
            chrome.storage.session.set(data);
          }, 300);
        });
      });
    });
  });

  // 5. 字数统计
  function updateCount() {
    count.textContent = editor.value.length + ' 字';
  }

  // 6. 导出为 .txt
  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = titleEl.textContent + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
