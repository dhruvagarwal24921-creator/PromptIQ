window.__ATE__ = window.__ATE__ || {};

let selfWriteTimeout = null;

window.__ATE__.editor = {
  isSelfWrite: () => {
    return selfWriteTimeout !== null;
  },

  readText: (el) => {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return el.value || '';
    }
    return el.innerText || el.textContent || '';
  },

  writeText: (el, text) => {
    if (!el) return false;
    
    // Set self write flag
    if (selfWriteTimeout) clearTimeout(selfWriteTimeout);
    selfWriteTimeout = setTimeout(() => { selfWriteTimeout = null; }, 500);
    
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      try {
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, text);
        } else {
          el.value = text;
        }
      } catch (e) {
        el.value = text;
      }
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      } catch (e) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      setCaretToEnd(el);
      return true;
    }
    
    // Contenteditable fallbacks
    el.focus();
    
    // First, ensure we select all the existing content so it gets replaced.
    // For editors like Quill, we MUST dispatch 'selectionchange' so their internal model syncs with the DOM selection.
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    } catch (e) {}

    try {
      document.execCommand('selectAll', false, null);
      document.dispatchEvent(new Event('selectionchange'));
    } catch (e) {}

    // 1. execCommand insertText (best for replacing selection in most editors including Quill)
    try {
      document.execCommand('insertText', false, text);
      if (normalizeString(window.__ATE__.editor.readText(el)) === normalizeString(text)) {
        setCaretToEnd(el);
        return true;
      }
    } catch(e) {}
    
    // 2. Synthetic paste as a fallback if insertText failed or was intercepted
    try {
      // Re-select all just in case
      document.execCommand('selectAll', false, null);
      document.dispatchEvent(new Event('selectionchange'));
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      el.dispatchEvent(pasteEvent);
      if (normalizeString(window.__ATE__.editor.readText(el)) === normalizeString(text)) {
        setCaretToEnd(el);
        return true;
      }
    } catch(e) {}
    
    // 3. Fallback to direct DOM manipulation
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setCaretToEnd(el);
    return true;
  }
};

function normalizeString(str) {
  return str.replace(/\s+/g, '').trim();
}

function setCaretToEnd(el) {
  try {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.selectionStart = el.selectionEnd = el.value.length;
    } else {
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch(e) {}
}
