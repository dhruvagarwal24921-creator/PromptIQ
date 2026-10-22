const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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

console.log('Starting Test Suite: Modern ChatGPT DOM Extraction & Idle State Handling (Playwright)');

const chatDomCode = fs.readFileSync(path.join(__dirname, '../extension/content/chatDom.js'), 'utf8');
const chatGptAdapterCode = fs.readFileSync(path.join(__dirname, '../extension/content/adapters/chatgpt.js'), 'utf8');
const exporterCode = fs.readFileSync(path.join(__dirname, '../extension/content/exporter.js'), 'utf8');

const modernChatGptHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="canonical" href="https://chatgpt.com/c/modern-chatgpt-id-9988">
  <title>Python FastAPI Project</title>
</head>
<body>
  <div id="main-content">
    <!-- Turn 1: User -->
    <article data-testid="conversation-turn-2">
      <h5 class="sr-only">You said:</h5>
      <div class="user-message-bubble">
        <div class="whitespace-pre-wrap">Build a FastAPI microservice with rate limiting support.</div>
      </div>
    </article>

    <!-- Turn 2: Assistant -->
    <article data-testid="conversation-turn-3">
      <h6 class="sr-only">ChatGPT said:</h6>
      <div class="markdown prose">
        <p>Here is your FastAPI application with a rate limiter configured:</p>
        <pre><code class="language-python">from fastapi import FastAPI\napp = FastAPI()</code></pre>
      </div>
    </article>

    <!-- Turn 3: User -->
    <article data-testid="conversation-turn-4">
      <h5 class="sr-only">You said:</h5>
      <div class="whitespace-pre-wrap">Can you add Redis caching?</div>
    </article>

    <!-- Turn 4: Assistant -->
    <article data-testid="conversation-turn-5">
      <h6 class="sr-only">ChatGPT said:</h6>
      <div class="markdown prose">
        <p>Added Redis backend:</p>
        <pre><code class="language-python">import redis\nr = redis.Redis()</code></pre>
      </div>
    </article>
  </div>

  <!-- Composer at Idle (Empty input box, nothing typed) -->
  <div id="composer">
    <div id="prompt-textarea" contenteditable="true" class="ProseMirror"></div>
    <button data-testid="send-button">Send</button>
  </div>
</body>
</html>
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.route('https://chatgpt.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: modernChatGptHtml
    });
  });

  await page.goto('https://chatgpt.com/');

  // Inject content scripts
  await page.addScriptTag({ content: chatDomCode });
  await page.addScriptTag({ content: chatGptAdapterCode });

  const evalResult = await page.evaluate(() => {
    const adapter = window.__ATE__.adapters.chatgpt;
    const ateDom = window.__ATE__.dom;

    const matchesSite = adapter.matches('chatgpt.com');
    const inputEl = adapter.getInput();
    const inputFound = inputEl !== null && inputEl.id === 'prompt-textarea';

    const chatId = ateDom.getChatId(adapter);

    const messages = ateDom.getMessages(adapter);
    const msgCount = messages.length;
    const roles = messages.map(m => m.role);

    const userContent1 = ateDom.extractContent(messages[0].els);
    const asstContent1 = ateDom.extractContent(messages[1].els);

    const halfProc = ateDom.checkHalfProcessed(adapter, asstContent1.text);

    // Add alert banner and test again
    const alertBanner = document.createElement('div');
    alertBanner.setAttribute('role', 'alert');
    alertBanner.innerText = 'Usage limit reached. Resets in 2 hours.';
    document.body.appendChild(alertBanner);

    const halfProcWithAlert = ateDom.checkHalfProcessed(adapter, asstContent1.text);
    alertBanner.remove();

    const recent = adapter.getRecentMessages(4);

    return {
      matchesSite,
      inputFound,
      chatId,
      msgCount,
      roles,
      userText1: userContent1.text,
      asstText1: asstContent1.text,
      asstCodeBlocksCount: asstContent1.codeBlocks.length,
      halfProc,
      halfProcWithAlert,
      recentCount: recent.length,
      recentRoles: recent.map(r => r.role)
    };
  });

  await browser.close();

  // Test 1: Adapter matching
  check('ChatGPT adapter matches chatgpt.com', evalResult.matchesSite);

  // Test 2: Input element detected at idle
  check('Input element found at idle (empty box)', evalResult.inputFound);

  // Test 3: Chat ID fallback from canonical link
  check('Chat ID extracted from canonical link when path is /', evalResult.chatId === 'modern-chatgpt-id-9988', evalResult.chatId);

  // Test 4: Message extraction on modern ChatGPT DOM (without data-message-author-role)
  check('Messages detected from modern DOM without data-message-author-role', evalResult.msgCount === 4, evalResult.msgCount);
  check('Message roles order: user, assistant, user, assistant', JSON.stringify(evalResult.roles) === JSON.stringify(['user', 'assistant', 'user', 'assistant']), evalResult.roles);

  // Test 5: Screen-reader headers ("You said:", "ChatGPT said:") are stripped out
  check('User text does not contain "You said:"', !evalResult.userText1.includes('You said:'), evalResult.userText1);
  check('User text contains the actual prompt', evalResult.userText1.includes('Build a FastAPI microservice with rate limiting support.'), evalResult.userText1);

  check('Assistant text does not contain "ChatGPT said:"', !evalResult.asstText1.includes('ChatGPT said:'), evalResult.asstText1);
  check('Assistant text contains code block', evalResult.asstCodeBlocksCount === 1, evalResult.asstCodeBlocksCount);

  // Test 6: Casual mention of "rate limit" in chat text does NOT trigger false-positive half-processed
  check('Casual mention of "rate limit" in chat does not falsely trigger limit_reached', evalResult.halfProc.isHalfProcessed === false, evalResult.halfProc);

  // Test 7: Actual alert banner DOES trigger half-processed
  check('Real alert banner with limit phrase triggers limit_reached', evalResult.halfProcWithAlert.isHalfProcessed === true && evalResult.halfProcWithAlert.reason === 'limit_reached', evalResult.halfProcWithAlert);

  // Test 8: getRecentMessages works
  check('getRecentMessages returns items from modern DOM', evalResult.recentCount === 4, evalResult.recentCount);
  check('Recent messages roles match', evalResult.recentRoles[0] === 'user' && evalResult.recentRoles[1] === 'assistant', evalResult.recentRoles);

  // Test 9: Conversation Pairs extraction from exporter.js logic
  const mPairs = exporterCode.match(/function buildConversationPairs\(messages\) \{([\s\S]*?)\n  \}/);
  const fnBuildPairs = new Function('messages', mPairs[1]);

  const extractedMessages = [
    { index: 1, role: 'user', text: evalResult.userText1 },
    { index: 2, role: 'assistant', text: evalResult.asstText1 },
    { index: 3, role: 'user', text: 'Can you add Redis caching?' },
    { index: 4, role: 'assistant', text: 'Added Redis backend' }
  ];

  const pairs = fnBuildPairs(extractedMessages);
  check('Conversation pairs successfully built from idle modern chat', pairs.length === 2, pairs.length);
  check('Pair 1 has prompt and response', pairs[0].prompt.includes('Build a FastAPI') && pairs[0].response.includes('FastAPI application'));
  check('Pair 2 has prompt and response', pairs[1].prompt.includes('Redis caching') && pairs[1].response.includes('Added Redis backend'));

  console.log('\n========================================');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})();
