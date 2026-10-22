/**
 * chatLog.js — remembers, per chat, every prompt that PromptIQ enhanced AND the
 * user actually sent, plus when it was sent and when the AI finished replying.
 *
 * Only metadata is persisted (prompts + timestamps). Response *text* is never
 * stored; it is read from the page at export time, so storage stays small.
 *
 * Storage: one key per chat → "chatLog:<site>:<chatId>" in chrome.storage.local.
 *
 * Exposes: window.__ATE__.chatLog = {
 *   setPending, clearPending, commitSend, syncChat, getRecords, getChatId
 * }
 */
window.__ATE__ = window.__ATE__ || {};

(function () {
  const PREFIX = 'chatLog:';
  const MAX_CHATS = 60;            // oldest chats are pruned beyond this
  const MAX_RECORDS_PER_CHAT = 300;
  const POLL_MS = 500;
  const STABLE_MS = 3000;          // reply text unchanged this long (and no Stop button) => finished
  const GIVE_UP_MS = 15 * 60 * 1000;
  const ADOPT_WINDOW_MS = 2 * 60 * 1000;

  const dom = () => window.__ATE__.dom;
  const adapterNow = () => window.__ATE__.getAdapter && window.__ATE__.getAdapter();

  // ------------------------------------------------------------ chat state

  let initialized = false;
  let currentChatId = null;   // null => blank "new chat" page (or unknown URL scheme)
  let lastPath = '';
  let records = [];           // records of the chat that is open right now
  let loaded = Promise.resolve();
  let pending = null;         // enhancement that is sitting in the input box, not sent yet

  const keyFor = (adapter, id) => `${PREFIX}${adapter.name}:${id}`;

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

  function load(adapter, id) {
    return new Promise((resolve) => {
      try {
        if (!isExtensionValid() || !chrome.storage?.local) return resolve([]);
        const key = keyFor(adapter, id);
        chrome.storage.local.get([key], (res) => {
          try {
            if (!isExtensionValid() || chrome.runtime?.lastError) return resolve([]);
            const v = res && res[key];
            const recs = v && Array.isArray(v.records) ? v.records : [];
            // A reply being timed when the page went away can no longer be timed.
            recs.forEach((r) => { if (r.timingStatus === 'pending') r.timingStatus = 'interrupted'; });
            resolve(recs);
          } catch (e) { resolve([]); }
        });
      } catch (e) { resolve([]); }
    });
  }

  function persist() {
    const adapter = adapterNow();
    if (!adapter || !currentChatId) return;
    try {
      if (!isExtensionValid() || !chrome.storage?.local) return;
      chrome.storage.local.set({
        [keyFor(adapter, currentChatId)]: {
          site: adapter.name,
          chatId: currentChatId,
          url: location.href,
          title: document.title,
          updatedAt: Date.now(),
          records
        }
      });
    } catch (e) { /* extension was reloaded; nothing we can do */ }
  }

  function prune() {
    try {
      if (!isExtensionValid() || !chrome.storage?.local) return;
      chrome.storage.local.get(null, (all) => {
        try {
          if (!isExtensionValid() || chrome.runtime?.lastError) return;
          const chats = Object.entries(all || {})
            .filter(([k]) => k.startsWith(PREFIX))
            .map(([k, v]) => [k, (v && v.updatedAt) || 0])
            .sort((a, b) => a[1] - b[1]);
          if (chats.length > MAX_CHATS) {
            chrome.storage.local.remove(chats.slice(0, chats.length - MAX_CHATS).map((c) => c[0]));
          }
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * On a blank "new chat" page the URL has no chat id until after the first
   * message is sent. When the id appears we adopt the in-memory records — but
   * only if it is clearly the same chat (recent, and the first user message on
   * the page is the prompt we sent), so we never attach them to an unrelated chat.
   */
  function canAdopt(adapter) {
    if (!records.length || records.some((r) => r.chatId !== null)) return false;
    if (Date.now() - records[records.length - 1].sentAt > ADOPT_WINDOW_MS) return false;
    const first = dom().getMessages(adapter).find((m) => m.role === 'user');
    if (!first) return false;
    return dom().promptMatches(dom().extractContent(first.els).text, records[0].sentPrompt, true);
  }

  /** Call whenever the URL may have changed. Cheap when nothing changed. */
  function syncChat() {
    const adapter = adapterNow();
    if (!adapter) return loaded;

    const id = dom().getChatId(adapter);
    const path = location.pathname;
    const changed = !initialized || id !== currentChatId || (id === null && path !== lastPath);
    lastPath = path;
    if (!changed) return loaded;

    const prevId = currentChatId;
    initialized = true;
    currentChatId = id;

    if (prevId === null && id !== null && canAdopt(adapter)) {
      records.forEach((r) => { r.chatId = id; });
      persist();
      prune();
      return loaded;
    }

    records = [];
    loaded = id === null
      ? Promise.resolve()
      : load(adapter, id).then((recs) => { if (currentChatId === id) records = recs; });
    return loaded;
  }

  // ------------------------------------------------------ enhance -> send

  function setPending({ originalPrompt, enhancedPrompt, category, purpose }) {
    pending = { originalPrompt, enhancedPrompt, category: category || null, purpose: purpose || 'default', enhancedAt: Date.now() };
  }

  function clearPending() { pending = null; }

  /**
   * Call synchronously at the moment the user sends a prompt that is in the
   * READY (enhanced) state. `sentText` is whatever is in the input box right now.
   */
  function commitSend(adapter, sentText) {
    const p = pending;
    pending = null;
    if (!p) return;

    // Snapshot now: once the event continues, the site's DOM will change.
    const sentAt = Date.now();
    const userCountAtSend = dom().getMessages(adapter).filter((m) => m.role === 'user').length;
    syncChat();
    const chatIdAtSend = currentChatId;

    loaded.then(() => {
      if (currentChatId !== chatIdAtSend) return; // user switched chats in the meantime
      const sentPrompt = (sentText || p.enhancedPrompt).trim();
      const rec = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        chatId: currentChatId,
        site: adapter.name,
        category: p.category,
        purpose: p.purpose || 'default',
        originalPrompt: p.originalPrompt,
        enhancedPrompt: p.enhancedPrompt,
        sentPrompt,
        editedBeforeSend: dom().normalize(sentPrompt) !== dom().normalize(p.enhancedPrompt),
        enhancedAt: p.enhancedAt,
        sentAt,
        responseStartedAt: null,
        responseCompletedAt: null,
        responseDurationMs: null,
        timingStatus: 'pending'   // pending | measured | interrupted | timed_out
      };
      records.push(rec);
      if (records.length > MAX_RECORDS_PER_CHAT) records.splice(0, records.length - MAX_RECORDS_PER_CHAT);
      persist();
      if (records.length === 1) prune();
      startWatching(rec, userCountAtSend);
    });
  }

  // -------------------------------------------------------- reply timing

  // Several replies can be watched at once (one per rec).
  const watchers = new Map();
  let timer = null;
  let observer = null;
  let lastMutationAt = 0;
  let lastTickAt = 0;

  function startWatching(rec, userCountAtSend) {
    watchers.set(rec.id, { rec, userCountAtSend, sig: null, lastChangeAt: 0, tickedAt: 0 });
    if (!timer) timer = setInterval(tickAll, POLL_MS);
    if (!observer) {
      // Timers are throttled in background tabs; mutation callbacks are not.
      // We use them only to stamp *when* the page last changed, so timestamps
      // stay accurate even if the user switches tabs while waiting.
      observer = new MutationObserver(() => {
        const now = Date.now();
        lastMutationAt = now;
        if (now - lastTickAt >= 250) tickAll();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  function stopWatching(w, status) {
    if (status) w.rec.timingStatus = status;
    watchers.delete(w.rec.id);
    persist();
    if (!watchers.size) {
      clearInterval(timer); timer = null;
      if (observer) { observer.disconnect(); observer = null; }
    }
  }

  function tickAll() {
    const now = Date.now();
    lastTickAt = now;
    syncChat();
    const adapter = adapterNow();
    for (const w of Array.from(watchers.values())) tick(w, adapter, now);
  }

  function tick(w, adapter, now) {
    const { rec } = w;

    // Chat switched (or records reloaded) while we were waiting: can't time it.
    if (!adapter || !records.includes(rec)) return stopWatching(w, 'interrupted');
    if (now - rec.sentAt > GIVE_UP_MS) return stopWatching(w, 'timed_out');

    const msgs = dom().getMessages(adapter);
    let seen = -1;
    let userIdx = -1;
    msgs.forEach((m, i) => { if (m.role === 'user' && ++seen === w.userCountAtSend) userIdx = i; });
    const reply = userIdx >= 0 ? msgs[userIdx + 1] : null;
    if (!reply || reply.role !== 'assistant') return; // prompt/reply not on screen yet

    const sig = reply.els.map((e) => e.textContent).join('\u0001');
    // If the page mutated since our last tick, that mutation is when the text changed.
    const mutatedSince = lastMutationAt > Math.max(w.tickedAt, rec.sentAt) && lastMutationAt <= now;
    if (sig.trim() && !rec.responseStartedAt) {
      rec.responseStartedAt = mutatedSince ? lastMutationAt : now;
    }
    if (sig !== w.sig) {
      w.sig = sig;
      w.lastChangeAt = mutatedSince ? lastMutationAt : now;
    }
    w.tickedAt = now;

    if (rec.responseStartedAt && !dom().isGenerating(adapter) && now - w.lastChangeAt >= STABLE_MS) {
      rec.responseCompletedAt = w.lastChangeAt;
      rec.responseDurationMs = Math.max(0, w.lastChangeAt - rec.sentAt);
      stopWatching(w, 'measured');
    }
  }

  // ----------------------------------------------------------------- public

  window.__ATE__.chatLog = {
    setPending,
    clearPending,
    commitSend,
    syncChat,
    getRecords: () => records.slice().sort((a, b) => a.sentAt - b.sentAt),
    getChatId: () => currentChatId
  };
})();
