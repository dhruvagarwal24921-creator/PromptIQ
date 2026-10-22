const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mockPage = require('./mockpage');
const startBackend = require('./stub-backend');
const JSZip = require('jszip');

const EXT = require('./prepare-ext')(); // copy of ../extension with the shadow root opened for Playwright
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra).slice(0, 500) : ''); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const backend = await startBackend(3000);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], acceptDownloads: true
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  await sw.evaluate(() => chrome.storage.local.set({ backendUrl: 'http://127.0.0.1:3000' }));
  await ctx.route('https://chatgpt.com/**', (r) => r.fulfill({ contentType: 'text/html', body: mockPage('chatgpt', { streamStepMs: 700 }) }));

  const tabIdFor = (prefix) => sw.evaluate(async (p) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(p)).id, prefix);
  async function runMigration(stub, buttonId = '#migrate-session') {
    const popup = await ctx.newPage();
    await popup.addInitScript((s) => { chrome.tabs.query = (q, cb) => cb([s]); }, stub);
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    let download = null; popup.on('download', (d) => { download = d; });
    await popup.click(buttonId);
    await popup.waitForFunction(() => /success|error/.test(document.getElementById('export-status').className), null, { timeout: 15000 });
    await sleep(300);
    const status = await popup.$eval('#export-status', (e) => ({ text: e.textContent, cls: e.className }));
    let json = null, zip = null;
    if (download) {
      const buf = fs.readFileSync(await download.path());
      zip = await JSZip.loadAsync(buf);
      if (zip.file('session_continuation.json')) {
        json = JSON.parse(await zip.file('session_continuation.json').async('text'));
      }
    }
    await popup.close();
    return { status, json, zip };
  }
  async function enhance(page, text) {
    await page.click('#prompt-textarea');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    const first = await Promise.race([
      page.waitForSelector('.cat-btn[data-cat="coding"]', { timeout: 8000 }).then(() => 'picker'),
      page.waitForSelector('text=Prompt enhanced', { timeout: 8000 }).then(() => 'chip')
    ]);
    if (first === 'picker') {
      await page.click('.cat-btn[data-cat="coding"]');
      const p = await page.$('.purpose-btn[data-purpose="default"]');
      if (p) await p.click();
    }
    await page.waitForSelector('text=Prompt enhanced', { timeout: 8000 });
  }
  const waitDone = async (page, extra = 3800) => {
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="stop-button"]')).display === 'none', null, { timeout: 20000 });
    await sleep(extra);
  };

  console.log('\n=== edge cases on ChatGPT-style site ===');
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message));
  await page.goto('https://chatgpt.com/'); await sleep(1500);
  const stub = { id: await tabIdFor('https://chatgpt.com'), url: 'https://chatgpt.com/' };

  console.log('\n-- 1. edited after enhancement, sent via the Send BUTTON (not Enter)');
  await enhance(page, 'first topic');
  await page.keyboard.press('End');
  await page.keyboard.type(' PLUS-MY-EDIT');
  await page.click('#sendbtn');
  await waitDone(page);
  stub.url = page.url();

  console.log('-- 2. two identical prompts in the same chat');
  for (let i = 0; i < 2; i++) { await enhance(page, 'same words'); await page.keyboard.press('Enter'); await waitDone(page); }

  console.log('-- 3. export in the middle of a reply');
  await enhance(page, 'long one'); await page.keyboard.press('Enter');
  await sleep(1800); // mid-stream (6 blocks × 700ms)
  let r = await runMigration(stub);
  check('mid-stream: still exports migration (success)', r.status.cls === 'success', r.status);
  check('mid-stream: schema session_continuation', r.json && r.json.schema === 'promptiq.session_continuation');
  await waitDone(page);

  console.log('-- 4. final migration export for this chat');
  r = await runMigration(stub);
  const C = r.json;
  check('Session migration produced', C && C.schema === 'promptiq.session_continuation' && C.version === 2);
  check('Exchanges captured', C && Array.isArray(C.exchanges) && C.exchanges.length >= 3, C ? C.exchanges : null);
  check('Exchanges contain prompts and responses', C && C.exchanges.every((e) => e.prompt !== undefined && e.response !== undefined));

  console.log('\n-- 5. reload while a reply is streaming, then migration');
  await enhance(page, 'will be interrupted'); await page.keyboard.press('Enter');
  await sleep(1500);
  await page.reload(); await sleep(2500);
  stub.url = page.url();
  r = await runMigration(stub);
  check('interrupted: export succeeds without crashing', r.status.cls === 'success' && r.json && r.json.schema === 'promptiq.session_continuation', r.status);

  console.log('\n-- 6. blank page → clear error');
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await sleep(2500);
  r = await runMigration(stub);
  check('empty page → clear error', r.status.cls === 'error' && /No messages or pending draft/.test(r.status.text), r.status);

  // ======================================================================
  console.log('\n=== selector mechanics for the other sites (DOM fixtures, main-world) ===');
  const files = ['adapters/index.js', 'adapters/chatgpt.js', 'adapters/claude.js', 'adapters/gemini.js', 'adapters/perplexity.js', 'adapters/copilot.js'].map((f) => path.join(EXT, 'content', f));
  files.push(path.join(EXT, 'content', 'chatDom.js'));

  async function fixture(url, html) {
    await ctx.route(url, (rt) => rt.fulfill({ contentType: 'text/html', body: `<!doctype html><body>${html}</body>` }));
    const p = await ctx.newPage();
    await p.goto(url);
    for (const f of files) await p.addScriptTag({ path: f });
    return p;
  }
  const summarize = (p) => p.evaluate(() => {
    const a = window.__ATE__.getAdapter();
    const msgs = window.__ATE__.dom.getMessages(a);
    return { adapter: a && a.name, id: window.__ATE__.dom.getChatId(a),
      msgs: msgs.map((m) => [m.role, window.__ATE__.dom.extractContent(m.els).text]) };
  });

  let p = await fixture('https://gemini.google.com/app/abc123def', `
    <user-query><div class="query-text"><p class="query-text-line">What is 2+2?</p></div></user-query>
    <model-response><message-content><div class="markdown"><p>It is <b>4</b>.</p></div></message-content></model-response>`);
  let s = await summarize(p);
  check('gemini: chat id + roles + text', s.id === 'abc123def' && JSON.stringify(s.msgs) === JSON.stringify([['user', 'What is 2+2?'], ['assistant', 'It is **4**.']]), s);

  p = await fixture('https://www.perplexity.ai/search/best-pizza-in-rome-AbC123', `
    <div class="group/query"><h1>best pizza in rome</h1></div>
    <div id="markdown-content-0"><p>Try <a href="https://example.com/pizza">Pizzarium</a>.</p></div>`);
  s = await summarize(p);
  check('perplexity: chat id + roles + text', s.id === 'best-pizza-in-rome-AbC123' && s.msgs.length === 2 && s.msgs[1][1] === 'Try [Pizzarium](https://example.com/pizza).', s);

  p = await fixture('https://copilot.microsoft.com/chats/xYz789', `<div id="host"></div>
    <script>const r=document.getElementById('host').attachShadow({mode:'open'});
    r.innerHTML='<div data-content="user-message">hello copilot</div><div data-content="ai-message"><p>hi there</p></div>';</script>`);
  s = await summarize(p);
  check('copilot: shadow-DOM messages + chat id', s.id === 'xYz789' && JSON.stringify(s.msgs) === JSON.stringify([['user', 'hello copilot'], ['assistant', 'hi there']]), s);

  p = await fixture('https://claude.ai/', `<div data-testid="user-message">hi</div><div class="font-claude-response"><p>yo</p></div>`);
  s = await summarize(p);
  check('claude: blank page → chat id null (new chat)', s.id === null && s.msgs.length === 2, s);

  p = await fixture('https://chatgpt.com/g/g-abc123-my-gpt', `<div></div>`);
  s = await summarize(p);
  check('chatgpt: custom-GPT landing page is NOT a chat (id null)', s.id === null, s);
  await ctx.unroute('https://chatgpt.com/**');
  p = await fixture('https://chatgpt.com/g/g-abc123-my-gpt/c/chat-777', `<div></div>`);
  s = await summarize(p);
  check('chatgpt: custom-GPT chat id parsed', s.id === 'chat-777', s);

  console.log(`\n${pass} passed, ${fail} failed`);
  await ctx.close(); backend.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('RUNNER ERROR', e); process.exit(2); });
