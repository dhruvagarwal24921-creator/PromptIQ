window.__ATE__ = window.__ATE__ || {};
window.__ATE__.adapters = window.__ATE__.adapters || {};

function isVisible(el) {
  if (!el) return false;
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  } catch (e) {
    return true;
  }
}

function deepQuerySelector(selector, root = document) {
  try {
    const el = root.querySelector(selector);
    if (el) return el;
  } catch (e) {}
  try {
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const child = all[i];
      if (child.shadowRoot) {
        const found = deepQuerySelector(selector, child.shadowRoot);
        if (found) return found;
      }
    }
  } catch (e) {}
  return null;
}

function deepQuerySelectorAll(selector, root = document, out = []) {
  try {
    root.querySelectorAll(selector).forEach((el) => out.push(el));
  } catch (e) {}
  try {
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const child = all[i];
      if (child.shadowRoot) {
        deepQuerySelectorAll(selector, child.shadowRoot, out);
      }
    }
  } catch (e) {}
  return out;
}

window.__ATE__.adapters.copilot = {
  name: 'copilot',
  matches: (hostname) => /(^|\.)copilot(\.microsoft)?\.com$/i.test(hostname),

  // ---- Chat export config (read by content/chatDom.js) ----
  chatIdPatterns: [
    /^\/chats\/([^/?#]+)/,
    /^\/chat\/([^/?#]+)/,
    /^\/c\/([^/?#]+)/,
    /^\/sl\/chat\/([^/?#]+)/
  ],

  getChatId: () => {
    try {
      const path = window.location.pathname;
      const patterns = [
        /^\/chats\/([^/?#]+)/,
        /^\/chat\/([^/?#]+)/,
        /^\/c\/([^/?#]+)/,
        /^\/sl\/chat\/([^/?#]+)/
      ];
      for (const re of patterns) {
        const m = path.match(re);
        if (m) return decodeURIComponent(m[1]);
      }
      const params = new URLSearchParams(window.location.search);
      const qId = params.get('id') || params.get('threadId') || params.get('conversationId') || params.get('chatId');
      if (qId) return decodeURIComponent(qId);
      if (path === '/chat' || path === '/chat/') {
        const fromCode = params.get('fromcode');
        if (fromCode) return `chat-${fromCode}`;
        return 'copilot-chat';
      }
    } catch (e) {}
    return null;
  },

  messageSelectors: {
    user: [
      '[data-content="user-message"]',
      'cib-message-group[source="user"]',
      '.cib-thread-message-user',
      '[data-testid*="user-message"]',
      'div[class*="user-message"]',
      'div[class*="userMessage"]',
      'div[class*="userQuery"]',
      '[data-author="user"]',
      '[data-message-author-role="user"]'
    ].join(', '),
    assistant: [
      '[data-content="ai-message"]',
      'cib-message-group[source="bot"]',
      '.cib-thread-message-bot',
      '[data-testid*="ai-message"]',
      '[data-testid*="bot-message"]',
      '[data-testid*="copilot-message"]',
      'div[class*="ai-message"]',
      'div[class*="bot-message"]',
      'div[class*="copilot-message"]',
      'div[class*="botResponse"]',
      '[data-author="assistant"]',
      '[data-author="bot"]',
      '[data-author="copilot"]',
      '[data-message-author-role="assistant"]',
      '.ac-textBlock'
    ].join(', ')
  },

  deepSearch: true, // pierce open shadow roots when looking for messages

  generatingSelectors: [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Cancel" i]',
    '[data-testid="stop-button"]',
    'button.stop-button',
    'span[class*="loading"]',
    'div[class*="typing"]'
  ],

  getInput: () => {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable || active.getAttribute('role') === 'textbox')) {
      return active;
    }

    const inputSelectors = [
      'textarea#userInput',
      'textarea#plain-text-input',
      '[data-testid="composer-input"]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Type" i]',
      'textarea[aria-label*="Ask" i]',
      'textarea[aria-label*="Message" i]',
      'textarea[aria-label*="Copilot" i]',
      'textarea[aria-label*="Prompt" i]',
      'div[contenteditable="true"][role="textbox"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
      'div[role="textbox"]',
      'textarea'
    ];

    for (const sel of inputSelectors) {
      const candidates = deepQuerySelectorAll(sel);
      const visible = candidates.find(isVisible);
      if (visible) return visible;
    }

    return deepQuerySelector('textarea#userInput') || deepQuerySelector('textarea');
  },

  getSendButton: () => {
    const btnSelectors = [
      'button[data-testid="submit-button"]',
      'button[data-testid="send-button"]',
      'button[aria-label*="Submit" i]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Ask" i]',
      'button[title*="Submit" i]',
      'button[title*="Send" i]',
      'button.submit-button',
      'button[type="submit"]'
    ];

    for (const sel of btnSelectors) {
      const candidates = deepQuerySelectorAll(sel);
      const visible = candidates.find(isVisible);
      if (visible) return visible;
    }

    return deepQuerySelector('button[aria-label*="Submit" i]') || deepQuerySelector('button[aria-label*="Send" i]');
  },

  getRecentMessages: (n) => {
    try {
      if (window.__ATE__ && window.__ATE__.dom && window.__ATE__.dom.getMessages) {
        const msgs = window.__ATE__.dom.getMessages(window.__ATE__.adapters.copilot);
        if (msgs && msgs.length > 0) {
          return msgs.slice(-n).map((m) => {
            const c = window.__ATE__.dom.extractContent(m.els);
            return { role: m.role, text: (c.text || '').trim() };
          });
        }
      }

      const userSel = '[data-content="user-message"], cib-message-group[source="user"], [data-testid*="user-message"], div[class*="user-message"]';
      const botSel = '[data-content="ai-message"], cib-message-group[source="bot"], [data-testid*="bot-message"], [data-testid*="copilot-message"], div[class*="bot-message"]';
      const userEls = deepQuerySelectorAll(userSel);
      const botEls = deepQuerySelectorAll(botSel);
      const allEls = [
        ...userEls.map((el) => ({ role: 'user', el })),
        ...botEls.map((el) => ({ role: 'assistant', el }))
      ];
      if (allEls.length > 0) {
        allEls.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        return allEls.slice(-n).map((item) => ({
          role: item.role,
          text: (item.el.innerText || item.el.textContent || '').trim()
        }));
      }
      return [];
    } catch (e) {
      return [];
    }
  }
};