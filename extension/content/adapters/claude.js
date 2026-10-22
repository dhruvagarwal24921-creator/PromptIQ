window.__ATE__ = window.__ATE__ || {};
window.__ATE__.adapters = window.__ATE__.adapters || {};

window.__ATE__.adapters.claude = {
  name: 'claude',
  matches: (hostname) => /(^|\.)claude\.ai$/i.test(hostname),

  // ---- Chat export config (read by content/chatDom.js) ----
  // Supports regular chats (/chat/<uuid>) and Claude Project chats (/project/<id>/chat/<uuid> or /project/<id>/<uuid>)
  chatIdPatterns: [
    /^\/chat\/(?!new(?:[/?#]|$))([^/?#]+)/,
    /^\/project\/[^/]+\/chat\/(?!new(?:[/?#]|$))([^/?#]+)/,
    /^\/project\/[^/]+\/([^/?#]+)/
  ],
  messageSelectors: {
    user: '[data-testid="user-message"], div.font-user-message, div[data-message-author-role="user"], div[class*="user-message"]',
    assistant: '.font-claude-response, .font-claude-message, [data-testid="assistant-message"], [data-is-streaming], div[class*="claude-response"], div[class*="font-claude"], div.standard-markdown'
  },
  generatingSelectors: [
    'button[aria-label="Stop response"]',
    'button[aria-label*="Stop"]',
    '[data-is-streaming="true"]',
    'span[class*="animate-pulse"]'
  ],
  getInput: () => document.querySelector('div.ProseMirror[contenteditable="true"]'),
  getSendButton: () => document.querySelector('button[aria-label*="Send"]') || document.querySelector('button[aria-label*="Message"]'),
  getRecentMessages: (n) => {
    try {
      const msgs = Array.from(document.querySelectorAll('[data-testid="user-message"], .font-claude-message, .font-claude-response')).slice(-n);
      return msgs.map(m => ({
        role: (m.getAttribute('data-testid') === 'user-message' || m.className.includes('user-message')) ? 'user' : 'assistant',
        text: m.innerText
      }));
    } catch(e) { return []; }
  }
};