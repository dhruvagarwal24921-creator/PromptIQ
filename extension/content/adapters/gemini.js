window.__ATE__ = window.__ATE__ || {};
window.__ATE__.adapters = window.__ATE__.adapters || {};

window.__ATE__.adapters.gemini = {
  name: 'gemini',
  matches: (hostname) => /(^|\.)gemini\.google\.com$/i.test(hostname),

  // ---- Chat export config (read by content/chatDom.js) ----
  chatIdPatterns: [/^\/app\/([^/?#]+)/, /^\/gem\/[^/]+\/([^/?#]+)/],
  messageSelectors: { user: 'user-query', assistant: 'model-response' },
  generatingSelectors: ['button[aria-label="Stop response"]', 'button.send-button.stop'],
  getInput: () => document.querySelector('rich-textarea .ql-editor') || document.querySelector('div[contenteditable="true"]'),
  getSendButton: () => document.querySelector('button[aria-label*="Send"]') || document.querySelector('.send-button'),
  getRecentMessages: (n) => {
    try {
      if (window.__ATE__ && window.__ATE__.dom && window.__ATE__.dom.getMessages) {
        const msgs = window.__ATE__.dom.getMessages(window.__ATE__.adapters.gemini);
        if (msgs && msgs.length > 0) {
          return msgs.slice(-n).map(m => {
            const c = window.__ATE__.dom.extractContent(m.els);
            return { role: m.role, text: (c.text || '').trim() };
          });
        }
      }
      const msgs = Array.from(document.querySelectorAll('user-query, model-response')).slice(-n);
      return msgs.map(m => ({
        role: m.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant',
        text: (m.innerText || '').trim()
      }));
    } catch (e) { return []; }
  }
};