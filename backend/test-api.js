const { enhance } = require('./src/services/enhancer');
const config = require('./src/config');

async function test() {
  console.log('Testing PromptIQ backend enhancer (model: ' + config.dahlModel + ')\n');
  
  const testCases = [
    {
      draft: 'build a rate limiter for my api',
      category: 'coding',
      context: [
        { role: 'user', text: 'I am creating a REST API in Node.js' },
        { role: 'assistant', text: 'I can help with backend architecture.' }
      ]
    },
    {
      draft: 'explain quantum computing simply',
      category: 'learning',
      context: []
    },
    {
      draft: 'write an email to decline a meeting politely',
      category: 'write',
      context: []
    }
  ];

  for (const tc of testCases) {
    console.log(`--- Testing [Category: ${tc.category}] ---`);
    console.log('Input Draft:', tc.draft);
    console.log('Context messages count:', tc.context.length);
    const start = Date.now();
    try {
      const res = await enhance({
        draft: tc.draft,
        context: tc.context,
        category: tc.category
      });
      const elapsed = Date.now() - start;
      console.log(`Latency: ${res.latencyMs}ms (Total elapsed: ${elapsed}ms)`);
      console.log('Enhanced Output:\n' + res.enhanced);
      console.log('Tokens: in=' + res.inputTokens + ', out=' + res.outputTokens);
      console.log('');
    } catch(e) {
      console.error('Error:', e.message);
    }
  }
}
test();

