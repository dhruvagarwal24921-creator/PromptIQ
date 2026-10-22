const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const mockPage = require('./mockpage');
const startBackend = require('./stub-backend');

const EXT = require('./prepare-ext')();

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
  console.log('Starting Test Suite: Microsoft Copilot (copilot.com & copilot.microsoft.com)');
  const backend = await startBackend(3000);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-copilot-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    acceptDownloads: true
  });

  try {
    let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];
    console.log('Extension ID loaded:', extId);
    await sw.evaluate(() => chrome.storage.local.set({ backendUrl: 'http://127.0.0.1:3000' }));

    // Intercept both copilot.com and copilot.microsoft.com
    await ctx.route('https://copilot.com/**', (r) => r.fulfill({ contentType: 'text/html', body: mockPage('copilot') }));
    await ctx.route('https://copilot.microsoft.com/**', (r) => r.fulfill({ contentType: 'text/html', body: mockPage('copilot') }));

    async function tabIdFor(prefix) {
      return sw.evaluate(async (p) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(p)).id, prefix);
    }

    const testUrl = 'https://copilot.com/chat?fromcode=cmmwuwpzorz&es=Click&redirfrom=cosmicRingCookie';
    const page = await ctx.newPage();
    page.on('console', (m) => { if (process.env.DEBUG) console.log('   [page:'+m.type()+']', m.text().slice(0,300)); });
    await page.goto(testUrl);
    await sleep(2000); // Allow content script init() to complete

    const tabId = await tabIdFor('https://copilot.com');
    check('Copilot tab identified by extension', !!tabId);

    // 1. Test Popup on copilot.com: must report Supported / Active
    const popup = await ctx.newPage();
    await popup.addInitScript((stub) => {
      chrome.tabs.query = (q, cb) => cb([stub]);
    }, { id: tabId, url: testUrl });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(600);

    const statusText = await popup.textContent('#status-text');
    check('Popup detects copilot.com as supported/active', statusText.includes('Active on this site') || statusText.includes('Supported on this site'), statusText);
    await popup.close();

    // 2. Test Enhancement on copilot.com:
    await page.click('#plain-text-input');
    await page.keyboard.type('write a python function to add two numbers');
    await page.keyboard.press('Enter'); // 1st Enter → PromptIQ intercepts
    await sleep(800);

    // Wait for Category Picker
    const pickerVisible = await page.waitForSelector('.cat-btn[data-cat="coding"]', { timeout: 8000 }).then(() => true).catch(() => false);
    check('PromptIQ Category Picker chip displayed on copilot.com', pickerVisible);

    if (pickerVisible) {
      await page.click('.cat-btn[data-cat="coding"]');
      const p = await page.$('.purpose-btn[data-purpose="default"]');
      if (p) await p.click();
    }

    await page.waitForSelector('text=Prompt enhanced', { timeout: 8000 });
    const enhancedVal = await page.inputValue('#plain-text-input');
    check('Input text was enhanced via PromptIQ', /Task: write a python function/.test(enhancedVal), enhancedVal);

    // 3. Send the enhanced message & wait for AI response
    await page.keyboard.press('Enter'); // 2nd Enter → sends
    await sleep(1000);

    // Wait for streaming / reply to finish
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="stop-button"], [aria-label*="Stop"]');
      return s && getComputedStyle(s).display === 'none';
    }, null, { timeout: 15000 });
    await sleep(3500); // stability window

    // Check message list
    const msgCount = await page.$$eval('[data-content="user-message"], [data-content="ai-message"]', els => els.length);
    check('Messages rendered and captured on Copilot page', msgCount >= 2, msgCount);

    // 4. Test Session Migration (ZIP Export) on copilot.com
    const popup2 = await ctx.newPage();
    await popup2.addInitScript((stub) => {
      chrome.tabs.query = (q, cb) => cb([stub]);
    }, { id: tabId, url: testUrl });
    await popup2.goto(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(600);

    let download = null;
    popup2.on('download', (d) => { download = d; });
    await popup2.click('#migrate-session');

    for (let i = 0; i < 40 && !download; i++) {
      await sleep(250);
    }
    check('Session migration ZIP downloaded from copilot.com', download !== null);

    if (download) {
      const downloadPath = path.join(os.tmpdir(), await download.suggestedFilename());
      await download.saveAs(downloadPath);
      const zipData = fs.readFileSync(downloadPath);
      const zip = await JSZip.loadAsync(zipData);
      check('ZIP has session_continuation.json', zip.file('session_continuation.json') !== null);
      check('ZIP has session_summary.md', zip.file('session_summary.md') !== null);
      const jsonStr = await zip.file('session_continuation.json').async('string');
      const data = JSON.parse(jsonStr);
      check('Exported platform is copilot', data.chat && data.chat.site === 'copilot', data.chat);
      try { fs.unlinkSync(downloadPath); } catch(e) {}
    }
    await popup2.close();

    // 5. Also test copilot.microsoft.com URL
    console.log('\n-- testing copilot.microsoft.com');
    const msUrl = 'https://copilot.microsoft.com/chats/legacy-test-123';
    const msPage = await ctx.newPage();
    await msPage.goto(msUrl);
    await sleep(2000);

    const msTabId = await tabIdFor('https://copilot.microsoft.com');
    check('copilot.microsoft.com tab identified', !!msTabId);

    const popup3 = await ctx.newPage();
    await popup3.addInitScript((stub) => {
      chrome.tabs.query = (q, cb) => cb([stub]);
    }, { id: msTabId, url: msUrl });
    await popup3.goto(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(600);

    const msStatusText = await popup3.textContent('#status-text');
    check('Popup detects copilot.microsoft.com as supported/active', msStatusText.includes('Active on this site') || msStatusText.includes('Supported on this site'), msStatusText);
    await popup3.close();
    await msPage.close();

  } finally {
    await ctx.close();
    backend.close();
  }

  console.log(`\nCopilot Test Results: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
