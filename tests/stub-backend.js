// Minimal stand-in for the real /enhance backend so the extension tests run offline
// and deterministically (no Dahl API key, no network). Listens on the same port the extension expects.
const http = require('http');

module.exports = function startBackend(port = 3000) {
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.method === 'POST' && req.url === '/enhance') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let draft = '';
        let purpose = 'default';
        try {
          const parsed = JSON.parse(body);
          draft = parsed.draft || '';
          purpose = parsed.purpose || 'default';
        } catch (e) { /* ignore */ }
        let enhanced = `You are an expert assistant.\nTask: ${draft}\nBe clear and concise.`;
        const normPurpose = (purpose || 'default').toLowerCase().trim();
        if (normPurpose === 'quick') {
          enhanced += '\n\n(Provide the fastest, most concise minimal solution immediately.)';
        } else if (normPurpose === 'think') {
          enhanced += '\n\n(Ask relentless questions about everything you need context on before answering.)';
        }
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enhanced }));
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/summarize') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          summary: 'This is a summary of a previous conversation. Use it as context and continue from where we left off.\n\n## Session Migration Context\n\n1. **Goal**: Build a complete Python FastAPI backend with image processing\n\n2. **Background and context**: Original platform: chatgpt. Chat ID: mock-chat-1.\n\n3. **Decisions made**:\n- Test prompt\n\n4. **Current state**:\n```js\nconsole.log("hello");\n```\n\n5. **Open questions and next steps**:\nProceed to next steps.\n\n6. **Preferences**:\nClear and concise.\n\n7. **Things to avoid**:\nDo not re-litigate decisions.'
        }));
      });
      return;
    }
    res.writeHead(404, cors); res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
};
