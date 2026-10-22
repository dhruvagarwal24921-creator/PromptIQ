window.__ATE__ = window.__ATE__ || {};

(function() {
  const State = {
    IDLE: 0,
    ENHANCING: 1,
    READY: 2,
    PASSTHROUGH: 3
  };
  
  let state = State.IDLE;
  let originalDraft = '';
  let adapter = null;
  let reentrancy = false;
  let cachedEnabled = true; // Cache it so we can intercept synchronously!

  function isExtensionValid() {
    try {
      if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) return false;
      if (!chrome.runtime.id) return false;
      if (!chrome.runtime.getManifest()) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeSendMessage(payload, callback) {
    if (!isExtensionValid()) {
      if (callback) {
        try { callback({ ok: false, error: 'Extension context invalidated' }); } catch (e) {}
      }
      return false;
    }
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        try {
          if (!isExtensionValid()) {
            if (callback) callback({ ok: false, error: 'Extension context invalidated' });
            return;
          }
          if (chrome.runtime.lastError) {
            if (callback) callback({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          if (callback) callback(response);
        } catch (cbErr) {
          console.warn('[PromptIQ] Callback error in sendMessage:', cbErr);
          if (callback) callback({ ok: false, error: cbErr?.message || 'Extension context invalidated' });
        }
      });
      return true;
    } catch (err) {
      console.warn('[PromptIQ] safeSendMessage caught error:', err);
      if (callback) {
        try { callback({ ok: false, error: err?.message || 'Extension context invalidated' }); } catch (e) {}
      }
      return false;
    }
  }

  // Enhanced-prompt tracker (content/chatLog.js). Wrapped so that a tracking failure can never block the user's send.
  const chatLog = (method, ...args) => {
    try {
      const log = window.__ATE__.chatLog;
      return log ? log[method](...args) : undefined;
    } catch (err) {
      console.warn('[PromptIQ] chatLog.' + method + ' failed:', err);
    }
  };
  
  function init() {
    console.log('[PromptPolish] Initializing content script...');
    
    // Load initial enabled state
    try {
      if (isExtensionValid() && chrome.storage?.local) {
        chrome.storage.local.get(['enabled'], (res) => {
          try {
            if (chrome.runtime?.lastError) return;
            if (res && res.enabled === false) cachedEnabled = false;
          } catch (e) {}
        });
        
        // Listen for changes
        chrome.storage.onChanged?.addListener((changes, area) => {
          try {
            if (area === 'local' && changes && changes.enabled) {
              cachedEnabled = changes.enabled.newValue !== false;
            }
          } catch (e) {}
        });
      }
    } catch (err) {
      console.warn('[PromptIQ] Failed to initialize storage listeners:', err);
    }

    adapter = window.__ATE__.getAdapter();
    if (!adapter) {
      console.log('[PromptIQ] No adapter found for hostname:', window.location.hostname);
      return;
    }
    console.log('[PromptIQ] Found adapter:', adapter.name);
    chatLog('syncChat');
    
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('mousedown', onClick, true);
    document.addEventListener('input', onInput, true);
    
    let lastUrl = location.href;
    setInterval(() => {
      if (!isExtensionValid()) {
        if (state === State.ENHANCING || state === State.READY) {
          state = State.PASSTHROUGH;
          reentrancy = false;
          window.__ATE__.ui?.hide();
        }
        return;
      }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        window.__ATE_CATEGORY__ = null;
        currentPurpose = null;
        chatLog('clearPending');
        chatLog('syncChat');
      }
      if (state === State.READY || state === State.PASSTHROUGH) {
        const input = adapter.getInput();
        if (input && !window.__ATE__.editor.readText(input).trim()) {
          // The user emptied the box without sending: the enhanced prompt was never sent.
          if (state === State.READY) chatLog('clearPending');
          state = State.IDLE;
          window.__ATE__.ui.hide();
        }
      }
    }, 1000);
  }
  
  function isInterceptableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.getAttribute?.('role') === 'textbox') {
      return true;
    }
    const input = adapter ? adapter.getInput() : null;
    return Boolean(input && (target === input || input.contains(target)));
  }

  function isInputTarget(target, e) {
    if (isInterceptableTarget(target)) return true;
    if (document.activeElement && isInterceptableTarget(document.activeElement)) return true;
    const input = adapter ? adapter.getInput() : null;
    if (input) {
      if (document.activeElement === input || input.contains(document.activeElement)) return true;
      if (target && (target === input || input.contains(target))) return true;
      const path = (e && e.composedPath) ? e.composedPath() : [];
      if (path.includes(input)) return true;
      const draft = window.__ATE__.editor ? window.__ATE__.editor.readText(input).trim() : '';
      if (draft.length > 0 && (document.activeElement === document.body || !document.activeElement)) {
        return true;
      }
    }
    return false;
  }
  
  function onKeyDown(e) {
    if (e.isComposing) return;

    const isEnterKey = (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter');
    const isEKey = (e.code === 'KeyE' || e.key === 'e' || e.key === 'E');

    // Manual enhance shortcuts:
    // - Alt + E (or Alt + Shift + E)
    // - Ctrl + Shift + E (or Cmd + Shift + E)
    // (Note: Alt+Enter is intentionally left untouched so ChatGPT extension can use it for new line)
    const isAltE = isEKey && e.altKey && !e.ctrlKey && !e.metaKey;
    const isCtrlShiftE = isEKey && (e.ctrlKey || e.metaKey) && e.shiftKey;

    if (isAltE || isCtrlShiftE) {
      console.log('[PromptIQ] Manual shortcut Alt+E detected! Key:', e.key, 'Code:', e.code, 'Alt:', e.altKey);
      if (isInputTarget(e.target, e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleSendIntent(e, true);
        return;
      }
    }

    // Normal Enter key (Auto-enhance or Normal Send)
    if (isEnterKey) {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isInputTarget(e.target, e)) {
          handleSendIntent(e, false);
        }
      }
    }
  }
  
  let ignoreNextClick = false;

  function onClick(e) {
    if (e.type === 'click' && ignoreNextClick) {
      ignoreNextClick = false;
      if (state === State.ENHANCING || reentrancy) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    const btn = adapter.getSendButton();
    const path = (e.composedPath && e.composedPath()) || [];
    const isSendBtn = btn && (e.target === btn || btn.contains(e.target) || path.includes(btn));
    if (isSendBtn) {
      console.log(`[PromptPolish] Send button clicked via ${e.type}!`);
      if (e.type === 'mousedown') {
         ignoreNextClick = true;
         setTimeout(() => { ignoreNextClick = false; }, 300);
      }
      handleSendIntent(e, false);
    }
  }
  
  function onInput(e) {
    if (state === State.ENHANCING && !window.__ATE__.editor.isSelfWrite()) {
      // User typed while enhancing, cancel!
      safeSendMessage({ type: 'CANCEL' });
      state = State.IDLE;
      window.__ATE__.ui.hide();
    }
  }
  
  let currentPurpose = null;

  function getPastEnhancedPrompts() {
    try {
      const logRecords = chatLog('getRecords') || [];
      const fromLog = logRecords
        .map(r => r.enhancedPrompt || r.sentPrompt)
        .filter(p => typeof p === 'string' && p.trim().length > 0);
      if (fromLog.length > 0) {
        return fromLog.slice(-4);
      }
    } catch (e) {
      console.warn('[PromptIQ] getPastEnhancedPrompts from chatLog error:', e);
    }
    try {
      if (adapter && adapter.getRecentMessages) {
        const recent = adapter.getRecentMessages(8) || [];
        const userPrompts = recent
          .filter(m => m.role === 'user' && m.text && m.text.trim().length > 0)
          .map(m => m.text.trim());
        if (userPrompts.length > 0) {
          return userPrompts.slice(-4);
        }
      }
    } catch (e) {
      console.warn('[PromptIQ] getPastEnhancedPrompts from DOM error:', e);
    }
    return [];
  }

  function handleSendIntent(e, isManual = false) {
    console.log('[PromptPolish] handleSendIntent triggered, isManual:', isManual);

    // If extension context has been invalidated (e.g. extension was updated/reloaded in chrome://extensions):
    if (!isExtensionValid()) {
      console.warn('[PromptIQ] Extension context invalidated; bypassing PromptIQ.');
      state = State.PASSTHROUGH;
      reentrancy = false;
      if (window.__ATE__.ui && window.__ATE__.ui.hide) {
        window.__ATE__.ui.hide();
      }
      if (isManual) {
        const input = adapter ? adapter.getInput() : null;
        if (input && window.__ATE__.ui && window.__ATE__.ui.showWarning) {
          window.__ATE__.ui.showWarning(input, "PromptIQ was updated. Refresh this page to enhance.");
        }
      }
      return;
    }

    if (reentrancy || state === State.ENHANCING) {
      if (window.__ATE__.ui && window.__ATE__.ui.submitActivePicker) {
        window.__ATE__.ui.submitActivePicker();
      }
      if (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    if (state === State.READY || state === State.PASSTHROUGH) {
      console.log('[PromptPolish] Allowing pass through, state:', state);
      if (state === State.READY) {
        // Record exactly what is in the box right now (the user may have edited the enhanced text).
        const sendInput = adapter ? adapter.getInput() : null;
        chatLog('commitSend', adapter, sendInput ? window.__ATE__.editor.readText(sendInput) : '');
      }
      state = State.IDLE;
      window.__ATE__.ui.hide();
      if (isManual) {
        // If the user hit Alt+Enter again to send, trigger the send button
        const btn = adapter ? adapter.getSendButton() : null;
        if (btn) {
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          btn.click();
        }
      }
      return;
    }
    
    if (state === State.IDLE) {
      const input = adapter ? adapter.getInput() : null;
      if (!input) {
        console.log('[PromptPolish] Bailing: no input element found');
        return;
      }
      const draft = window.__ATE__.editor ? window.__ATE__.editor.readText(input).trim() : '';
      console.log('[PromptPolish] Draft read:', draft);
      if (!draft) {
        console.log('[PromptPolish] Bailing: draft is empty');
        return;
      }
      
      // If NOT manual, and auto-enhance is disabled, allow normal send
      if (!isManual && !cachedEnabled) {
        console.log('[PromptPolish] Bailing: auto-enhance disabled');
        return;
      }
      
      console.log('[PromptPolish] Intercepting! Calling preventDefault. isManual:', isManual);
      if (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
        
      reentrancy = true;
      originalDraft = draft;
      state = State.ENHANCING;
      chatLog('clearPending');
      
      chatLog('syncChat');
      const context = (adapter && adapter.getRecentMessages) ? adapter.getRecentMessages(4) : [];
      
      window.__ATE__.ui.showCategoryPicker(input, (category, purpose) => {
        window.__ATE_CATEGORY__ = category;
        currentPurpose = purpose || 'default';
        doEnhance(draft, context, input, category, currentPurpose);
      }, currentPurpose);

      function doEnhance(draftText, contextData, inputEl, category, purpose) {
        window.__ATE__.ui.showSpinner(inputEl);

        const categoryTagMap = {
          'coding': '[Coding]',
          'learning': '[Learning]',
          'write': '[Write]',
          'researching': '[Researching]',
          'life stuff': '[Life Stuff]',
          'life': '[Life]',
          'other': '[Other]'
        };
        const catKey = (category || 'other').toLowerCase().trim();
        const tag = categoryTagMap[catKey] || `[${catKey.charAt(0).toUpperCase() + catKey.slice(1)}]`;

        const sent = safeSendMessage({
          type: 'ENHANCE',
          site: adapter?.name || 'copilot',
          draft: draftText,
          context: contextData,
          category,
          tag,
          purpose
        }, (response) => {
          reentrancy = false;
          if (state !== State.ENHANCING) return; // was cancelled
          
          if (response && response.ok) {
            let finalText = response.enhanced;
            const normPurpose = (purpose || 'default').toLowerCase().trim();
            if (normPurpose === 'quick' && !finalText.includes('(Provide the fastest')) {
              finalText += '\n\n(Provide the fastest, most concise minimal solution immediately.)';
            } else if (normPurpose === 'think' && !finalText.includes('(Ask relentless questions')) {
              finalText += '\n\n(Ask relentless questions about everything you need context on before answering.)';
            }

            const wrote = window.__ATE__.editor.writeText(inputEl, finalText);
            if (wrote) {
              state = State.READY;
              chatLog('setPending', { originalPrompt: originalDraft, enhancedPrompt: finalText, category, purpose });
              window.__ATE__.ui.showUndo(inputEl, () => {
                window.__ATE__.editor.writeText(inputEl, originalDraft);
                chatLog('clearPending');   // the original goes out now, so nothing was "enhanced"
                state = State.PASSTHROUGH;
                window.__ATE__.ui.hide();
              });
            } else {
              fallbackToOriginal("Failed to write to editor.");
            }
          } else {
            const isInvalidated = !isExtensionValid() || (response && response.error && response.error.includes('invalidated'));
            const errorMsg = isInvalidated
              ? "PromptIQ was updated. Please refresh the page to enhance."
              : "Enhancement failed. Next Enter sends original.";
            fallbackToOriginal(errorMsg);
          }
        });

        if (!sent) {
          reentrancy = false;
          fallbackToOriginal("PromptIQ was updated. Please refresh the page to enhance.");
        }
      }
    }
  }
  
  function fallbackToOriginal(msg) {
    state = State.PASSTHROUGH;
    const input = adapter ? adapter.getInput() : null;
    if (input && window.__ATE__.ui && window.__ATE__.ui.showWarning) {
      window.__ATE__.ui.showWarning(input, msg);
    }
  }
  
  // Start up
  setTimeout(init, 1000);
})();
