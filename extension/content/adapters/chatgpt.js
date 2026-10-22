window.__ATE__ = window.__ATE__ || {};
window.__ATE__.adapters = window.__ATE__.adapters || {};

window.__ATE__.adapters.chatgpt = {
  name: 'chatgpt',
  matches: (hostname) => /(^|\.)(chatgpt\.com|chat\.openai\.com)$/i.test(hostname),

  // ---- Chat export config (read by content/chatDom.js) ----
  // Saved chats live at /c/<id>; custom-GPT chats at /g/<gpt>/c/<id>. A bare /g/<gpt> is a landing page, not a chat.
  chatIdPatterns: [/^\/c\/([^/?#]+)/, /^\/g\/[^/]+\/c\/([^/?#]+)/, /^\/share\/([^/?#]+)/, /^\/project\/[^/]+\/c\/([^/?#]+)/],
  messageSelectors: {
    user: '[data-message-author-role="user"], [data-testid*="user-message"], [data-testid*="user"], div[class*="user-message"], div.whitespace-pre-wrap:not(.markdown *):not([contenteditable="true"]):not(form *)',
    assistant: '[data-message-author-role="assistant"], [data-testid*="assistant-message"], [data-testid*="assistant"], div.markdown, div.agent-turn, div[data-message-model-slug], div[class*="assistant-message"]'
  },
  generatingSelectors: ['[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]', 'button[aria-label*="Stop"]'],
  
  getInput: () => {
    if (document.activeElement && document.activeElement.isContentEditable) {
      return document.activeElement;
    }
    
    const selectors = [
      '#prompt-textarea [contenteditable="true"]',
      '#prompt-textarea',
      '.ProseMirror',
      'div[contenteditable="true"][id*="prompt"]',
      'div[contenteditable="true"]',
      'textarea[id*="prompt"]',
      'textarea'
    ];
    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      const visible = elements.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (visible) {
        return visible.querySelector?.('[contenteditable="true"]') || visible;
      }
    }
    return null;
  },
  
  getSendButton: () => {
    return document.querySelector('[data-testid="send-button"]') ||
           document.querySelector('button[aria-label*="Send"]');
  },
  
  getRecentMessages: (n) => {
    try {
      if (window.__ATE__ && window.__ATE__.dom && window.__ATE__.dom.getMessages) {
        const msgs = window.__ATE__.dom.getMessages(window.__ATE__.adapters.chatgpt);
        if (msgs && msgs.length > 0) {
          return msgs.slice(-n).map(m => {
            const c = window.__ATE__.dom.extractContent(m.els);
            return {
              role: m.role,
              text: (c.text || '').trim()
            };
          });
        }
      }
      const msgs = Array.from(document.querySelectorAll('[data-message-author-role], [data-testid*="user-message"], [data-testid*="assistant-message"], div.whitespace-pre-wrap, div.markdown')).slice(-n);
      return msgs.map(m => ({
        role: (m.getAttribute('data-message-author-role') === 'user' || m.getAttribute('data-testid')?.includes('user') || m.classList.contains('whitespace-pre-wrap')) ? 'user' : 'assistant',
        text: m.innerText
      }));
    } catch(e) {
      return [];
    }
  }
};