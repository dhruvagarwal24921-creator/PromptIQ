const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const mockPage = require('./mockpage');
const startBackend = require('./stub-backend');

const EXT = require('./prepare-ext')();
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS', name);
  } else {
    fail++;
    console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra).slice(0, 400) : '');
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('Starting Test Suite: Session Migration ZIP & Artifacts');
  const backend = await startBackend(3000);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-zip-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    acceptDownloads: true
  });

  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  console.log('Extension ID loaded:', extId);
  await sw.evaluate(() => chrome.storage.local.set({ backendUrl: 'http://127.0.0.1:3000' }));

  await ctx.route('https://chatgpt.com/**', (r) => r.fulfill({ contentType: 'text/html', body: mockPage('chatgpt') }));
  await ctx.route('https://claude.ai/**', (r) => r.fulfill({ contentType: 'text/html', body: mockPage('claude') }));

  async function tabIdFor(prefix) {
    return sw.evaluate(async (p) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(p)).id, prefix);
  }

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
    await sleep(400);
    const status = await popup.$eval('#export-status', (e) => ({ text: e.textContent, cls: e.className }));
    const disabled = await popup.$eval(buttonId, (e) => e.disabled);
    let filename = null, buffer = null;
    if (download) {
      filename = download.suggestedFilename();
      const p = await download.path();
      buffer = fs.readFileSync(p);
    }
    await popup.close();
    return { status, filename, buffer, disabled };
  }

  async function sendEnhanced(page, text) {
    await page.click('#prompt-textarea, #input');
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
    const inputText = await page.$eval('#prompt-textarea, #input', (e) => e.innerText);
    await page.keyboard.press('Enter');
    return inputText;
  }

  async function waitReplyDone(page) {
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="stop-button"], [aria-label="Stop response"]');
      return s && getComputedStyle(s).display === 'none';
    }, null, { timeout: 15000 });
    await sleep(3800);
  }

  // -------------------------------------------------------------
  console.log('\n=== Test 1: Empty state error handling ===');
  const gpt = await ctx.newPage();
  gpt.on('console', (m) => console.log('   [gpt:' + m.type() + ']', m.text()));
  gpt.on('pageerror', (e) => console.log('   [gpt:pageerror]', e.message));
  await gpt.goto('https://chatgpt.com/');
  await sleep(1500);
  let stub = { id: await tabIdFor('https://chatgpt.com'), url: 'https://chatgpt.com/' };

  let r = await runMigration(stub, '#migrate-session');
  check('Blank chat shows error on ZIP migration', r.status.cls === 'error' && /No messages or pending draft/.test(r.status.text), r.status);
  check('No file downloaded on blank chat', r.buffer === null);
  check('Button re-enabled after error', r.disabled === false);

  // -------------------------------------------------------------
  console.log('\n=== Test 2: Active chat session migration with ZIP download ===');
  await sendEnhanced(gpt, 'Build a complete Python FastAPI backend with image processing');
  await waitReplyDone(gpt);
  stub.url = gpt.url();

  r = await runMigration(stub, '#migrate-session');
  check('Migration status shows success', r.status.cls === 'success' && /package downloaded \(ZIP\)/.test(r.status.text), r.status);
  check('Filename matches pattern', /^promptiq_migration_chatgpt_mock-chat-1_\d{8}-\d{6}\.zip$/.test(r.filename), r.filename);
  check('ZIP buffer is non-empty', r.buffer && r.buffer.length > 500, r.buffer ? r.buffer.length : 0);

  // Inspect ZIP contents
  const zip = await JSZip.loadAsync(r.buffer);
  const filesInZip = Object.keys(zip.files);
  console.log('Files present inside downloaded ZIP:', filesInZip);

  check('ZIP contains session_summary.md', filesInZip.includes('session_summary.md'));
  check('ZIP contains session_continuation.json', filesInZip.includes('session_continuation.json'));
  check('ZIP contains strictly 2 files (NO artifacts folder)', filesInZip.length === 2 && !filesInZip.some(f => f.startsWith('artifacts/')));

  // Verify session_summary.md content
  const summaryText = await zip.file('session_summary.md').async('text');
  check('session_summary.md starts with handoff line', summaryText.includes('This is a summary of a previous conversation. Use it as context and continue from where we left off.'));
  check('session_summary.md contains 7-part handoff sections', /Goal/.test(summaryText) && /Current state/.test(summaryText));
  console.log('\n--- Excerpt of session_summary.md ---\n' + summaryText.slice(0, 300) + '\n--- End Excerpt ---\n');

  // Verify session_continuation.json content
  const continuationText = await zip.file('session_continuation.json').async('text');
  const continuationJson = JSON.parse(continuationText);
  check('continuation JSON schema matches', continuationJson.schema === 'promptiq.session_continuation' && continuationJson.version === 2);
  check('continuation JSON has exchanges array', Array.isArray(continuationJson.exchanges) && continuationJson.exchanges.length > 0);
  check('exchange item has prompt, response, index, and timestamp', continuationJson.exchanges[0].prompt !== undefined && continuationJson.exchanges[0].response !== undefined && continuationJson.exchanges[0].index !== undefined && continuationJson.exchanges[0].timestamp !== undefined);
  check('continuation JSON eliminates duplicate keys', continuationJson.messages === undefined && continuationJson.session_continuation === undefined && continuationJson.continuation_prompt === undefined);

  // -------------------------------------------------------------
  console.log('\n=== Test 3: Claude-style session migration ===');
  const cl = await ctx.newPage();
  await cl.goto('https://claude.ai/');
  await sleep(1500);
  const cstub = { id: await tabIdFor('https://claude.ai'), url: 'https://claude.ai/' };
  await sendEnhanced(cl, 'Create an interactive analytics dashboard');
  await waitReplyDone(cl);
  cstub.url = cl.url();

  const rCl = await runMigration(cstub, '#migrate-session');
  check('Claude migration succeeds', rCl.status.cls === 'success');
  check('Claude filename pattern', /^promptiq_migration_claude_11111111-222_\d{8}-\d{6}\.zip$/.test(rCl.filename), rCl.filename);

  const zipCl = await JSZip.loadAsync(rCl.buffer);
  const clFiles = Object.keys(zipCl.files);
  check('Claude ZIP has session_summary.md', clFiles.includes('session_summary.md'));
  check('Claude ZIP has session_continuation.json', clFiles.includes('session_continuation.json'));
  check('Claude ZIP contains strictly 2 files (NO artifacts)', clFiles.length === 2 && !clFiles.some(f => f.startsWith('artifacts/')));



  console.log(`\n========================================`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log(`========================================`);

  await ctx.close();
  backend.close();
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('RUNNER ERROR:', err);
  process.exit(2);
});
