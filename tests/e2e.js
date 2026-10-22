const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mockPage = require('./mockpage');
const startBackend = require('./stub-backend');
const JSZip = require('jszip');

const EXT = require('./prepare-ext')(); // copy of ../extension with the shadow root opened for Playwright
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra).slice(0, 400) : ''); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const backend = await startBackend(3000);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    acceptDownloads: true
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  console.log('extension id', extId);
  await sw.evaluate(() => chrome.storage.local.set({ backendUrl: 'http://127.0.0.1:3000' }));

  await ctx.route('https://chatgpt.com/**', (r) => r.fulfill({ contentType: 'text/html', body: mockPage('chatgpt') }));
  await ctx.route('https://claude.ai/**', (r) => r.fulfill({ contentType: 'text/html', body: mockPage('claude') }));
  await ctx.route('https://example.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>hi</h1>' }));

  // ---- helpers ----------------------------------------------------------
  async function tabIdFor(prefix) {
    return sw.evaluate(async (p) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(p)).id, prefix);
  }

  // Opens the popup; chrome.tabs.query is stubbed so it "sees" the chat tab as the active tab.
  async function openPopup(stub) {
    const popup = await ctx.newPage();
    await popup.addInitScript((s) => {
      chrome.tabs.query = (q, cb) => cb([s]);
    }, stub);
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    return popup;
  }

  async function runMigration(stub, buttonId = '#migrate-session') {
    const popup = await openPopup(stub);
    let download = null;
    popup.on('download', (d) => { download = d; });
    await popup.click(buttonId);
    await popup.waitForFunction(() => /success|error/.test(document.getElementById('export-status').className), null, { timeout: 15000 });
    await sleep(300);
    const status = await popup.$eval('#export-status', (e) => ({ text: e.textContent, cls: e.className }));
    const disabled = await popup.$eval(buttonId, (e) => e.disabled);
    let json = null, filename = null, buffer = null, zip = null;
    if (download) {
      filename = download.suggestedFilename();
      buffer = fs.readFileSync(await download.path());
      zip = await JSZip.loadAsync(buffer);
      if (zip.file('session_continuation.json')) {
        json = JSON.parse(await zip.file('session_continuation.json').async('text'));
      }
    }
    await popup.close();
    return { status, json, filename, buffer, zip, disabled };
  }

  async function sendEnhanced(page, text, { undo = false, pickCategory = false } = {}) {
    await page.click('#input, #prompt-textarea');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');                         // 1st Enter → PromptIQ intercepts
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
    if (undo) {
      await page.click('.btn:has-text("Undo")');
      await sleep(200);
    }
    const inputText = await page.$eval('#input, #prompt-textarea', (e) => e.innerText);
    await page.keyboard.press('Enter');                         // 2nd Enter → send
    return inputText;
  }
  async function waitReplyDone(page) {
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="stop-button"], [aria-label="Stop response"]');
      return s && getComputedStyle(s).display === 'none';
    }, null, { timeout: 15000 });
    await sleep(3800); // let the 3s stability window elapse
  }

  // ======================================================================
  console.log('\n=== ChatGPT-style site ===');
  const gpt = await ctx.newPage();
  gpt.on('console', (m) => { if (process.env.DEBUG || m.type()==='error') console.log('   [page:'+m.type()+']', m.text().slice(0,300)); });
  gpt.on('pageerror', (e) => console.log('   [pageerror]', e.message));
  await gpt.goto('https://chatgpt.com/');
  await sleep(1500);
  let stub = { id: await tabIdFor('https://chatgpt.com'), url: 'https://chatgpt.com/' };

  console.log('\n-- empty states on blank new chat');
  let r = await runMigration(stub);
  check('Blank chat migration → error message', r.status.cls === 'error' && /No messages or pending draft/.test(r.status.text), r.status);
  check('Blank chat migration → no file downloaded', r.buffer === null);
  check('Buttons re-enabled after error', r.disabled === false);

  console.log('\n-- send 3 prompts (enhanced, background tab, and unenhanced/undone)');
  const in1 = await sendEnhanced(gpt, 'write about dogs', { pickCategory: true });
  check('enhanced text was placed in input', /Task: write about dogs/.test(in1), in1);
  await waitReplyDone(gpt);
  check('URL got chat id', /\/c\/mock-chat-1/.test(gpt.url()), gpt.url());
  stub.url = gpt.url();

  // prompt 2
  await sendEnhanced(gpt, 'explain cats');
  const other = await ctx.newPage(); await other.goto('https://example.com/'); await other.bringToFront();
  await sleep(5000);
  await gpt.bringToFront(); await other.close();
  await sleep(3800);

  // prompt 3: user presses Undo → UNENHANCED original text goes out
  await sendEnhanced(gpt, 'plain third prompt', { undo: true });
  await waitReplyDone(gpt);

  console.log('\n-- Session Migration (ZIP Export)');
  r = await runMigration(stub);
  fs.writeFileSync(path.join(OUT, 'continuation_chatgpt.json'), JSON.stringify(r.json, null, 2));
  check('Migration status', r.status.cls === 'success' && /package downloaded \(ZIP\)/.test(r.status.text), r.status);
  check('Migration filename pattern', /^promptiq_migration_chatgpt_mock-chat-1_\d{8}-\d{6}\.zip$/.test(r.filename), r.filename);
  const C = r.json;
  check('Schema check', C && C.schema === 'promptiq.session_continuation' && C.version === 2);
  check('Chat info check', C && C.chat.id === 'mock-chat-1' && /chatgpt\.com\/c\/mock-chat-1/.test(C.chat.url), C ? C.chat : null);
  check('Stats capture total and exported turns', C && C.stats && C.stats.exported_turns === 3);
  check('Exchanges list has 3 pairs', C && Array.isArray(C.exchanges) && C.exchanges.length === 3);
  check('Unenhanced undone prompt included in exchanges', C && C.exchanges.some((e) => /plain third prompt/.test(e.prompt)), C ? C.exchanges : null);
  check('Latest code state captured in exchange response', C && C.exchanges.some((e) => /hello\(\)/.test(e.response)), C ? C.exchanges : null);
  check('Redundant legacy keys stripped', C && C.messages === undefined && C.session_continuation === undefined && C.continuation_prompt === undefined);

  console.log('\n-- Switching to a different empty chat must show empty error');
  await gpt.evaluate(() => window.__mockNavigate('/c/other-chat')); await sleep(2500);
  stub.url = 'https://chatgpt.com/c/other-chat';
  r = await runMigration(stub);
  check('Empty chat shows error', r.status.cls === 'error' && /No messages or pending draft/.test(r.status.text), r.status);

  console.log('\n-- Popup error paths');
  r = await runMigration({ id: stub.id, url: 'https://example.com/' });
  check('Unsupported site → clear message', r.status.cls === 'error' && /Open a supported AI chat/.test(r.status.text), r.status);
  r = await runMigration({ id: 999999, url: 'https://chatgpt.com/c/x' });
  check('Content script unreachable → clear message', r.status.cls === 'error' && /not active on this page/.test(r.status.text), r.status);

  console.log('\n=== Claude-style site ===');
  const cl = await ctx.newPage();
  await cl.goto('https://claude.ai/'); await sleep(1500);
  const cstub = { id: await tabIdFor('https://claude.ai'), url: 'https://claude.ai/' };
  await sendEnhanced(cl, 'build a landing page', { pickCategory: true });
  await waitReplyDone(cl);
  cstub.url = cl.url();
  r = await runMigration(cstub);
  fs.writeFileSync(path.join(OUT, 'continuation_claude.json'), JSON.stringify(r.json, null, 2));
  check('Claude migration succeeds', r.status.cls === 'success' && r.json && r.json.schema === 'promptiq.session_continuation' && r.json.version === 2);
  check('Claude code captured in exchanges', r.json && Array.isArray(r.json.exchanges) && r.json.exchanges.some((e) => /hello\(\)/.test(e.response)));
  check('Claude ZIP has session_summary.md', r.zip && r.zip.file('session_summary.md') !== null);

  console.log(`\n${pass} passed, ${fail} failed`);
  await ctx.close(); backend.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('RUNNER ERROR', e); process.exit(2); });
