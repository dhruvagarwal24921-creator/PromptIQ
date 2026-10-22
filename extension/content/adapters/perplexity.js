window.__ATE__ = window.__ATE__ || {};
window.__ATE__.adapters = window.__ATE__.adapters || {};

window.__ATE__.adapters.perplexity = {
  name: 'perplexity',
  matches: (hostname) => /(^|\.)perplexity\.ai$/i.test(hostname),

  // ---- Chat export config (read by content/chatDom.js) ----
  chatIdPatterns: [/^\/search\/([^/?#]+)/, /^\/thread\/([^/?#]+)/],
  messageSelectors: {
    user: '[class~="group/query"]',          // class name contains a slash, so use an attribute selector
    assistant: '[id^="markdown-content-"]'
  },
  generatingSelectors: ['button[aria-label="Stop generating"]'],
  getInput: () => document.querySelector('textarea') || document.querySelector('div[role="textbox"][contenteditable="true"]'),
  getSendButton: () => document.querySelector('button[aria-label*="Submit"]'),
  getRecentMessages: (n) => {
    try {
      if (window.__ATE__ && window.__ATE__.dom && window.__ATE__.dom.getMessages) {
        const msgs = window.__ATE__.dom.getMessages(window.__ATE__.adapters.perplexity);
        if (msgs && msgs.length > 0) {
          return msgs.slice(-n).map(m => {
            const c = window.__ATE__.dom.extractContent(m.els);
            return { role: m.role, text: (c.text || '').trim() };
          });
        }
      }
      return [];
    } catch (e) { return []; }
  }
};