// ============================================================================
// PromptIQ Backend Configuration
// Default: Live Cloudflare Workers edge network (works 24/7 out-of-the-box)
// For local Node.js development, switch to: 'http://127.0.0.1:3000'
// ============================================================================
let backendUrl = 'https://promptiq-backend.dhruvagarwal24921.workers.dev';

chrome.storage.local.get(['backendUrl'], (res) => {
  if (res.backendUrl) backendUrl = res.backendUrl;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.backendUrl) {
    backendUrl = changes.backendUrl.newValue;
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ENHANCE') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    // Strip trailing slashes, /health, or /enhance if user pasted full path
    const finalUrl = backendUrl
      .trim()
      .replace('localhost', '127.0.0.1')
      .replace(/\/health\/?$/i, '')
      .replace(/\/enhance\/?$/i, '')
      .replace(/\/summarize\/?$/i, '')
      .replace(/\/+$/, '');

    fetch(`${finalUrl}/enhance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft: msg.draft,
        context: msg.context,
        category: msg.category,
        tag: msg.tag,
        purpose: msg.purpose
      }),
      signal: controller.signal
    })
      .then(async res => {
        clearTimeout(timeoutId);
        let data;
        try { data = await res.json(); } catch (e) { }
        if (!res.ok) {
          sendResponse({ ok: false, code: data?.error?.code || 'UPSTREAM_ERROR' });
        } else {
          // Save to local history
          saveToHistory(msg.site, msg.draft, data.enhanced, msg.category, msg.purpose);
          sendResponse({ ok: true, enhanced: data.enhanced });
        }
      })
      .catch(err => {
        clearTimeout(timeoutId);
        console.error(err);
        sendResponse({ ok: false, code: err.name === 'AbortError' ? 'TIMEOUT' : 'UPSTREAM_ERROR' });
      });
    return true; // Keep message channel open
  }

  if (msg.type === 'GET_STATE') {
    chrome.storage.local.get(['enabled', 'backendUrl'], (res) => {
      sendResponse({
        enabled: res.enabled !== false, // default true
        backendUrl: res.backendUrl || backendUrl
      });
    });
    return true;
  }

  if (msg.type === 'SET_ENABLED') {
    chrome.storage.local.set({ enabled: msg.enabled });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'GET_STATS') {
    chrome.storage.local.get(['history'], (res) => {
      const history = res.history || [];
      const total = history.length;
      const today = history.filter(h => new Date(h.timestamp).toDateString() === new Date().toDateString()).length;

      const counts = {};
      let topSite = null;
      let maxCount = 0;
      for (const h of history) {
        counts[h.site] = (counts[h.site] || 0) + 1;
        if (counts[h.site] > maxCount) {
          maxCount = counts[h.site];
          topSite = h.site;
        }
      }

      sendResponse({ total, today, bySite: counts, topSite });
    });
    return true;
  }

  if (msg.type === 'SUMMARIZE') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const finalUrl = backendUrl
      .trim()
      .replace('localhost', '127.0.0.1')
      .replace(/\/health\/?$/i, '')
      .replace(/\/summarize\/?$/i, '')
      .replace(/\/enhance\/?$/i, '')
      .replace(/\/+$/, '');

    fetch(`${finalUrl}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: msg.messages,
        site: msg.site,
        chatId: msg.chatId,
        pendingDraft: msg.pendingDraft,
        isHalfProcessed: msg.isHalfProcessed,
        halfProcessedDetails: msg.halfProcessedDetails,
        customPrompt: msg.customPrompt,
        continuationData: msg.continuationData
      }),
      signal: controller.signal
    })
      .then(async res => {
        clearTimeout(timeoutId);
        let data;
        try { data = await res.json(); } catch (e) { }
        if (!res.ok) {
          sendResponse({ ok: false, error: data?.error?.message || 'Summarize failed' });
        } else {
          sendResponse({ ok: true, summary: data.summary });
        }
      })
      .catch(err => {
        clearTimeout(timeoutId);
        console.error('[PromptIQ] Summarize proxy error:', err);
        sendResponse({ ok: false, error: err.name === 'AbortError' ? 'TIMEOUT' : 'UPSTREAM_ERROR' });
      });
    return true;
  }

  if (msg.type === 'DELETE_HISTORY') {
    chrome.storage.local.set({ history: [] });
    sendResponse({ deleted: true });
    return true;
  }
});

function saveToHistory(site, originalText, enhancedText, category, purpose) {
  chrome.storage.local.get(['history'], (res) => {
    const history = res.history || [];
    history.unshift({
      id: Date.now().toString(),
      site,
      originalText,
      enhancedText,
      category: category || null,
      purpose: purpose || 'default',
      timestamp: new Date().toISOString()
    });
    if (history.length > 50) history.length = 50;
    chrome.storage.local.set({ history });
  });
}
