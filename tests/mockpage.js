// Mock AI chat page. flavor: 'chatgpt' | 'claude'
module.exports = function mockPage(flavor, { streamStepMs = 500 } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Mock ${flavor}</title>
<style>
  body{font-family:sans-serif;margin:0}
  #log{max-width:760px;margin:20px auto 140px;padding:0 12px}
  .msg{margin:14px 0}
  #composer{position:fixed;left:0;right:0;bottom:0;background:#fff;max-width:760px;margin:0 auto;display:flex;gap:8px;padding:12px}
  #composer > [contenteditable]{flex:1;border:1px solid #888;min-height:44px;padding:8px;white-space:pre-wrap}
  pre{background:#eee;padding:8px;white-space:pre;overflow:auto}
  pre .hdr{display:flex;justify-content:space-between;font-size:12px}
  .whitespace-pre-wrap{white-space:pre-wrap}
  table td,table th{border:1px solid #999;padding:2px 6px}
</style></head><body>
<div id="log"></div>
<div id="composer">
  ${flavor === 'claude'
      ? '<div id="input" class="ProseMirror" contenteditable="true"></div>'
      : flavor === 'copilot'
      ? '<textarea id="plain-text-input" placeholder="Ask me anything..."></textarea>'
      : '<div id="input" contenteditable="true"></div>'}
  <button id="sendbtn" ${flavor === 'claude' ? 'aria-label="Send message"' : flavor === 'copilot' ? 'aria-label="Submit message" data-testid="submit-button"' : 'data-testid="send-button"'}>Send</button>
  <button id="stopbtn" style="display:none" ${flavor === 'claude' ? 'aria-label="Stop response"' : flavor === 'copilot' ? 'aria-label="Stop generating"' : 'data-testid="stop-button"'}>Stop</button>
</div>
<script>
(function(){
  const FLAVOR = ${JSON.stringify(flavor)};
  const STEP = ${streamStepMs};
  const STORE = 'mock-conv:' + FLAVOR;
  const input = document.getElementById(FLAVOR === 'copilot' ? 'plain-text-input' : 'input');
  if (FLAVOR === 'chatgpt') input.id = 'prompt-textarea';   // adapter looks for #prompt-textarea
  const log = document.getElementById('log');
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;');

  // conversation persisted per chat path so reloads re-render it
  let conv = JSON.parse(localStorage.getItem(STORE) || '{}');
  const chatKey = () => location.pathname;
  const save = () => localStorage.setItem(STORE, JSON.stringify(conv));

  function blocks(prompt) {
    const tag = esc(prompt.split('\\n')[1] || prompt).slice(0, 40);
    return [
      '<p>Here is <strong>the answer</strong> for: <em>' + tag + '</em></p>',
      '<ul><li>First point</li><li>Second with <a href="https://example.com/doc">a link</a></li></ul>',
      '<pre><div class="hdr">python<button>Copy code</button></div><code class="language-python">def hello():\\n    print("hi")\\n\\n\\nhello()</code></pre>',
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
      '<p>Inline <code>code()</code> and math <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x²</span></span></p>',
      '<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAIklEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAA8G4wQAABiwCo9wAAAABJRU5ErkJggg==" alt="Sample generated diagram" width="64" height="64"></p>',
      '<p><a href="blob:https://x/abc" download="report.csv">report.csv</a></p>'
    ];
  }

  function userEl(text) {
    const d = document.createElement('div'); d.className = 'msg';
    if (FLAVOR === 'claude') {
      d.setAttribute('data-testid', 'user-message'); d.classList.add('whitespace-pre-wrap');
      d.textContent = text;
    } else if (FLAVOR === 'copilot') {
      d.setAttribute('data-content', 'user-message');
      d.innerHTML = '<div class="whitespace-pre-wrap">' + esc(text) + '</div>';
    } else {
      d.setAttribute('data-message-author-role', 'user');
      d.innerHTML = '<div class="whitespace-pre-wrap">' + esc(text) + '</div>';
    }
    return d;
  }
  function assistantWrap() {
    const d = document.createElement('div'); d.className = 'msg';
    if (FLAVOR === 'claude') return { root: d, body: d };
    if (FLAVOR === 'copilot') {
      d.setAttribute('data-content', 'ai-message');
      const b = document.createElement('div'); b.className = 'ac-textBlock'; d.appendChild(b);
      return { root: d, body: b };
    }
    d.setAttribute('data-message-author-role', 'assistant');
    const b = document.createElement('div'); b.className = 'markdown'; d.appendChild(b);
    return { root: d, body: b };
  }
  // Claude flavour splits one reply into two sibling blocks with a tool chip between.
  function renderAssistant(htmlBlocks, container) {
    if (FLAVOR !== 'claude') { container.body.innerHTML = htmlBlocks.join(''); return; }
    container.root.innerHTML = '';
    const a = document.createElement('div'); a.className = 'font-claude-response';
    a.innerHTML = htmlBlocks.slice(0, 2).join('');
    container.root.appendChild(a);
    if (htmlBlocks.length > 2) {
      const chip = document.createElement('button'); chip.textContent = 'Searched the web for dogs';
      container.root.appendChild(chip);
      const b = document.createElement('div'); b.className = 'font-claude-response';
      b.innerHTML = htmlBlocks.slice(2).join('');
      container.root.appendChild(b);
    }
  }

  function renderAll() {
    log.innerHTML = '';
    (conv[chatKey()] || []).forEach(m => {
      if (m.role === 'user') log.appendChild(userEl(m.text));
      else { const w = assistantWrap(); log.appendChild(w.root); renderAssistant(m.blocks, w);
             if (FLAVOR !== 'claude') { const chip = document.createElement('button'); chip.textContent = 'Searched the web for dogs'; w.body.insertBefore(chip, w.body.firstChild); } }
    });
  }
  renderAll();

  function send() {
    const text = (input.tagName === 'TEXTAREA' ? input.value : input.innerText).replace(/\\n$/, '');
    if (!text.trim()) return;
    if (input.tagName === 'TEXTAREA') input.value = ''; else input.textContent = '';
    if (location.pathname === '/' ) {
      history.pushState({}, '', FLAVOR === 'claude' ? '/chat/11111111-2222-3333-4444-555555555555' : FLAVOR === 'copilot' ? '/chats/copilot-mock-chat-1' : '/c/mock-chat-1');
    }
    const k = chatKey();
    conv[k] = conv[k] || [];
    conv[k].push({ role: 'user', text });
    log.appendChild(userEl(text));
    const all = blocks(text);
    const w = assistantWrap(); log.appendChild(w.root);
    document.getElementById('stopbtn').style.display = '';
    document.getElementById('sendbtn').style.display = 'none';
    let n = 0;
    const iv = setInterval(() => {
      n++;
      renderAssistant(all.slice(0, n), w);
      if (FLAVOR !== 'claude' && n >= 1) { /* chip rendered once */ }
      if (n >= all.length) {
        clearInterval(iv);
        document.getElementById('stopbtn').style.display = 'none';
        document.getElementById('sendbtn').style.display = '';
        conv[k].push({ role: 'assistant', blocks: all }); save();
        if (FLAVOR !== 'claude') { const chip = document.createElement('button'); chip.textContent = 'Searched the web for dogs'; w.body.insertBefore(chip, w.body.firstChild); }
      }
    }, STEP);
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  document.getElementById('sendbtn').addEventListener('click', send);
  window.addEventListener('popstate', renderAll);
  window.__mockNavigate = (p) => { history.pushState({}, '', p); renderAll(); };
})();
</script></body></html>`;
};
