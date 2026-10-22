/**
 * chatDom.js — site-independent DOM helpers used by the chat export feature.
 *
 * Per-site knowledge lives in the adapters (chatIdPatterns, messageSelectors,
 * generatingSelectors, deepSearch). Everything here works off that config.
 *
 * Exposes: window.__ATE__.dom = {
 *   getChatId, getMessages, isGenerating, extractContent, normalize, promptMatches
 * }
 */
window.__ATE__ = window.__ATE__ || {};

(function () {
  // ---------------------------------------------------------------- queries

  // querySelectorAll that can optionally pierce open shadow roots (Copilot).
  function queryAll(adapter, selector, root = document, out = []) {
    try {
      root.querySelectorAll(selector).forEach((el) => out.push(el));
    } catch (e) { /* invalid selector for this root: ignore */ }
    if (adapter && adapter.deepSearch) {
      root.querySelectorAll('*').forEach((n) => {
        if (n.shadowRoot) queryAll(adapter, selector, n.shadowRoot, out);
      });
    }
    return out;
  }

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // ---------------------------------------------------------------- chat id

  /**
   * Returns the id of the chat that is currently open, or null when the page
   * is not a saved chat yet (e.g. a blank "new chat" page).
   */
  function getChatId(adapter) {
    if (adapter && typeof adapter.getChatId === 'function') {
      try {
        const customId = adapter.getChatId();
        if (customId) return customId;
      } catch (e) {}
    }
    const path = location.pathname;
    for (const re of (adapter && adapter.chatIdPatterns) || []) {
      const m = path.match(re);
      if (m) {
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
      }
    }
    // Check URL parameters like ?id= or ?threadId=
    try {
      const sp = new URLSearchParams(location.search);
      const queryId = sp.get('id') || sp.get('threadId') || sp.get('conversationId') || sp.get('chatId');
      if (queryId) return decodeURIComponent(queryId);
    } catch (e) {}
    // Fallback: check canonical link or active sidebar conversation link
    try {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical && canonical.href) {
        const cPath = new URL(canonical.href).pathname;
        for (const re of (adapter && adapter.chatIdPatterns) || []) {
          const m = cPath.match(re);
          if (m) return decodeURIComponent(m[1]);
        }
      }
      const activeLink = document.querySelector('nav a[href*="/c/"][class*="active"], nav a[aria-current="page"][href*="/c/"], nav a[href*="/c/"]');
      if (activeLink) {
        const href = activeLink.getAttribute('href') || '';
        for (const re of (adapter && adapter.chatIdPatterns) || []) {
          const m = href.match(re);
          if (m) return decodeURIComponent(m[1]);
        }
      }
    } catch (e) {}
    return null;
  }

  // --------------------------------------------------------------- messages

  /**
   * Returns the chat as an ordered list: [{ role: 'user'|'assistant', els: [Element] }].
   * Consecutive assistant elements are merged into one message, because some
   * sites split a single reply into several blocks (e.g. text / tool use / text).
   * Returns [] if the adapter has no selectors or nothing matches.
   */
  function getMessages(adapter) {
    const sel = adapter && adapter.messageSelectors;
    if (!sel || !sel.user || !sel.assistant) return [];

    // One combined query keeps document order (also inside shadow roots).
    let all = queryAll(adapter, `${sel.user}, ${sel.assistant}`);

    // Fallback for ChatGPT if specific message selectors produced nothing
    if (all.length === 0 && adapter && adapter.name === 'chatgpt') {
      const turns = queryAll(adapter, 'article[data-testid*="conversation-turn"], [data-testid*="conversation-turn"]');
      if (turns.length > 0) {
        const msgs = [];
        turns.forEach((turn) => {
          const isAssistant = !!turn.querySelector('.markdown, .agent-turn, [data-message-model-slug], button[aria-label*="Copy"]') ||
                              Boolean(turn.getAttribute('data-testid')?.includes('assistant'));
          msgs.push({
            role: isAssistant ? 'assistant' : 'user',
            els: [turn]
          });
        });
        return msgs;
      }
    }

    // Fallback for Copilot if specific message selectors produced nothing
    if (all.length === 0 && adapter && adapter.name === 'copilot') {
      const turns = queryAll(adapter, 'cib-turn, div[class*="turn"], div[data-content*="message"], div[class*="message"]');
      if (turns.length > 0) {
        const msgs = [];
        turns.forEach((turn) => {
          const isUser = Boolean(
            turn.querySelector?.('[data-content="user-message"], cib-message-group[source="user"]') ||
            turn.getAttribute?.('data-content')?.includes('user') ||
            turn.className?.includes?.('user')
          );
          msgs.push({
            role: isUser ? 'user' : 'assistant',
            els: [turn]
          });
        });
        if (msgs.length > 0) return msgs;
      }
    }

    // Drop elements nested inside another matched element (avoids duplicates).
    const set = new Set(all);
    const top = all.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (set.has(p)) return false;
      }
      return true;
    });

    const messages = [];
    for (const el of top) {
      let isUser = false;
      try {
        isUser = el.matches(sel.user);
      } catch (e) {
        try {
          isUser = Boolean(el.closest && el.closest(sel.user));
        } catch (e2) {}
      }
      const role = isUser ? 'user' : 'assistant';
      const last = messages[messages.length - 1];
      if (role === 'assistant' && last && last.role === 'assistant') last.els.push(el);
      else messages.push({ role, els: [el] });
    }
    return messages;
  }

  const STOP_RE = /^\s*stop(\s+(generating|response|streaming|generation|answering))?\s*$/i;

  /** True while the site is still streaming a reply (a "Stop" button is visible). */
  function isGenerating(adapter) {
    for (const sel of (adapter && adapter.generatingSelectors) || []) {
      if (queryAll(adapter, sel).some(isVisible)) return true;
    }
    return queryAll(adapter, 'button[aria-label]').some(
      (b) => STOP_RE.test(b.getAttribute('aria-label') || '') && isVisible(b)
    );
  }

  const LIMIT_PHRASES = [
    'usage limit reached',
    'out of messages',
    'out of free messages',
    'reached your message limit',
    'message limit reached',
    'response was cut off',
    'unable to finish responding',
    'please try again later',
    'resets in',
    'resets at',
    'rate limit',
    'conversation is too long',
    'maximum length',
    'response was interrupted',
    'error generating'
  ];

  /**
   * Checks whether the current chat or the latest assistant reply was left half-processed:
   *  - Streaming was active when migration was triggered
   *  - A rate/token limit banner is displayed
   *  - An unclosed code block or trailing truncation is detected in the last assistant message
   */
  function checkHalfProcessed(adapter, lastAssistantText = '') {
    // 1. Is the AI actively streaming/generating right now?
    if (isGenerating(adapter)) {
      return {
        isHalfProcessed: true,
        reason: 'actively_streaming',
        details: 'Generation was in progress when migration was triggered (stop button or stream indicator active).'
      };
    }

    // 2. Are there limit/error banners visible in the page?
    // Check dedicated alert/banner containers first to prevent false-positives when users or AI discuss "rate limits" in text
    const bannerSelectors = '[role="alert"], div[class*="banner"], div[class*="error"], div[class*="toast"], div[class*="limit"], div[class*="alert"]';
    const alertContainers = queryAll(adapter, bannerSelectors);
    for (const alertEl of alertContainers) {
      if (!isVisible(alertEl)) continue;
      const alertText = (alertEl.innerText || '').toLowerCase();
      for (const phrase of LIMIT_PHRASES) {
        if (alertText.includes(phrase)) {
          return {
            isHalfProcessed: true,
            reason: 'limit_reached',
            details: `AI platform limit or interruption detected: "${phrase}".`
          };
        }
      }
    }

    // 3. Did the last assistant text have unclosed code blocks or explicit truncation tags?
    if (lastAssistantText) {
      const trimmed = lastAssistantText.trim();
      // Count markdown code fences
      const fences = (trimmed.match(/```/g) || []).length;
      if (fences % 2 !== 0) {
        return {
          isHalfProcessed: true,
          reason: 'unclosed_code_block',
          details: 'The last response contains an unclosed code block (cut off mid-code).'
        };
      }

      // Check for explicit truncation markers from the AI platform
      if (/\[(?:response|output|message)?\s*(?:cut\s*off|truncated|incomplete)\]/i.test(trimmed)) {
        return {
          isHalfProcessed: true,
          reason: 'explicit_truncation',
          details: 'The response contains an explicit cut-off/truncation marker from the AI platform.'
        };
      }
    }

    return {
      isHalfProcessed: false,
      reason: null,
      details: null
    };
  }

  // ------------------------------------------------------- text normalising

  function normalize(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Does a prompt shown in the page correspond to a prompt we sent?
   * Exact (whitespace-insensitive) match first; if `allowPrefix`, tolerate
   * sites that truncate/decorate the displayed text.
   */
  function promptMatches(domText, prompt, allowPrefix) {
    const a = normalize(domText);
    const b = normalize(prompt);
    if (!a || !b) return false;
    if (a === b) return true;
    if (!allowPrefix || a.length < 20 || b.length < 20) return false;
    const n = 120;
    return a.startsWith(b.slice(0, n)) || b.startsWith(a.slice(0, n));
  }

  // ------------------------------------------------- DOM -> text extraction

  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'svg', 'button', 'textarea',
    'input', 'select', 'option', 'iframe', 'canvas', 'video', 'audio'
  ]);

  // Labels of collapsed "tool use" chips such as "Searched the web", "Created file…".
  const ACTION_RE = new RegExp(
    '^(searched|searching|analy[sz]ed|analy[sz]ing|created|creating|edited|editing|' +
    'updated|updating|ran|running|read|reading|wrote|writing|generated|generating|' +
    'used|using|executed|executing|fetched|fetching|browsed|browsing|opened|called|' +
    'calling|saved|deleted|installed)\\s+\\S',
    'i'
  );
  const NOT_ACTION_RE = /^(read (more|aloud|less)|use (this|voice))/i;

  const FILE_RE = /\.(pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|json|zip|tar|gz|png|jpe?g|gif|webp|svg|mp3|mp4|wav|py|js|ts|html|css|ipynb)(\?|#|$)/i;

  function detectLanguage(pre, code) {
    const hay = `${code ? code.className : ''} ${pre.className || ''}`;
    const m = hay.match(/language-([\w+#.-]+)/i);
    if (m) return m[1].toLowerCase();
    const attr = (code && code.getAttribute('data-language')) || pre.getAttribute('data-language');
    return attr ? attr.toLowerCase() : '';
  }

  function actionLabel(el) {
    const t = (el.innerText || el.textContent || '').trim().split('\n')[0].trim();
    if (!t || t.length > 160 || NOT_ACTION_RE.test(t)) return null;
    return ACTION_RE.test(t) ? t : null;
  }

  /**
   * Walks one or more message elements and returns:
   *  { text, codeBlocks[], links[], files[], images[], toolActions[] }
   * `text` is markdown-flavoured plain text with code fenced in place; UI
   * chrome (copy buttons, icons, hidden nodes) is left out.
   */
  function extractContent(els) {
    const out = { text: '', codeBlocks: [], links: [], files: [], images: [], svgs: [], artifacts: [], toolActions: [] };
    const texts = [];
    els.forEach((el, i) => {
      texts.push(walkElement(el, out));
      // A reply split into sibling blocks: what sits *between* them (tool-use
      // chips, notes) is part of the same reply, so walk those gaps too.
      const next = els[i + 1];
      if (next && el.parentNode === next.parentNode) {
        for (let n = el.nextSibling; n && n !== next; n = n.nextSibling) texts.push(walkElement(n, out));
      }
    });
    out.text = texts.filter(Boolean).join('\n\n');

    // Deep media & document extractor across message turn/container (captures Claude file cards, PDFs, images)
    const seenHrefs = new Set(out.files.map((f) => f.href));
    const seenImages = new Set(out.images.map((img) => img.src));
    const seenSvgs = new Set();

    els.forEach((rootEl) => {
      const scope = rootEl.closest('[data-testid*="message"], [data-testid*="turn"], div.group, div.relative') || rootEl.parentElement || rootEl;

      // 1. Scrape all <img> elements
      scope.querySelectorAll('img').forEach((img) => {
        const src = img.currentSrc || img.src || img.getAttribute('src') || '';
        if (!src || seenImages.has(src)) return;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if ((w && w <= 32) || (h && h <= 32)) return; // skip avatars
        const alt = (img.getAttribute('alt') || '').trim();
        if (/avatar|profile|user|claude|bot/i.test(alt)) return;
        seenImages.add(src);
        out.images.push({ alt: alt || 'Generated Image', src });
      });

      // 2. Scrape all <a> tags and download triggers (including Claude artifact & file cards)
      scope.querySelectorAll('a, button, div[role="button"]').forEach((node) => {
        const a = node.tagName === 'A' ? node : node.querySelector('a');
        const href = (a && (a.href || a.getAttribute('href'))) || node.getAttribute('data-url') || node.getAttribute('data-href') || '';
        const downloadAttr = (a && a.getAttribute('download')) || node.getAttribute('download');
        const nodeText = (node.innerText || node.textContent || '').trim();
        const card = node.closest('div[class*="border"], div[class*="rounded"], div') || node.parentElement;
        const cardText = card ? (card.innerText || card.textContent || '') : '';
        const combined = `${cardText} ${nodeText} ${downloadAttr || ''} ${href}`;

        // Matches both "Document · PDF" and Claude's "Nes anchor · PNG"
        const artifactMatch = combined.match(/([^\n\r•·]+?)\s*[•·]\s*(PDF|PNG|JPG|JPEG|WEBP|CSV|TXT|XLSX|DOCX|ZIP|JSON|SVG|HTML|CSS|JS|PY)\b/i);
        if (artifactMatch) {
          const rawTitle = artifactMatch[1].trim().replace(/^(Document|Image|Audio|Video|File|Spreadsheet)\s+/i, '');
          const ext = artifactMatch[2].toLowerCase();
          out.artifacts.push({
            title: rawTitle || 'artifact',
            type: ext,
            raw: combined
          });
        }

        const isFile = downloadAttr !== null ||
          /^(blob:|sandbox:)/i.test(href) ||
          FILE_RE.test(href.split('?')[0] + '?') ||
          /\/files\/|\/attachment|\/artifacts\/|\/download/i.test(href) ||
          FILE_RE.test(nodeText) ||
          artifactMatch !== null;

        if (isFile && href && !href.startsWith('javascript:') && href !== '#' && !seenHrefs.has(href)) {
          seenHrefs.add(href);

          let fileName = downloadAttr;
          if (!fileName) {
            const m = combined.match(/[\w.-]+\.(pdf|png|jpe?g|webp|gif|svg|csv|tsv|txt|md|json|zip|tar|gz|py|js|ts|html|css|docx?|xlsx?|pptx?)/i);
            if (m) fileName = m[0];
          }
          if (!fileName && artifactMatch) {
            const rawTitle = artifactMatch[1].trim().replace(/^(Document|Image|Audio|Video|File|Spreadsheet)\s+/i, '');
            fileName = `${rawTitle || 'artifact'}.${artifactMatch[2].toLowerCase()}`;
          }
          if (!fileName) {
            const seg = href.split('?')[0].split('/').filter(Boolean).pop();
            fileName = seg && seg.length < 50 ? seg : 'downloaded_asset';
          }

          const isImg = /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName);
          if (isImg && !seenImages.has(href)) {
            seenImages.add(href);
            out.images.push({ alt: fileName, src: href });
          }
          out.files.push({ name: fileName, href });
        }
      });

      // 3. Scrape graphic/diagram <svg> elements (drawings, charts, illustrations)
      scope.querySelectorAll('svg').forEach((svg) => {
        const cls = (svg.getAttribute('class') || '') + ' ' + (svg.parentElement?.getAttribute('class') || '');
        if (/sheet-card|lucide|icon|btn|button|avatar|spin|stroke/i.test(cls)) return;

        const w = (svg.width && svg.width.baseVal && svg.width.baseVal.value) || svg.clientWidth || 0;
        const h = (svg.height && svg.height.baseVal && svg.height.baseVal.value) || svg.clientHeight || 0;
        const vbStr = (svg.getAttribute('viewBox') || '').trim();
        const vbParts = vbStr.split(/[\s,]+/).map(Number);
        const vbW = vbParts[2] || 0;
        const vbH = vbParts[3] || 0;

        // Must be genuinely sized graphic: at least 40px in dimension or viewBox
        const isSized = (w >= 40 && h >= 40) || (vbW >= 40 && vbH >= 40);
        if (!isSized) return;

        const shapesCount = svg.querySelectorAll('path, rect, circle, polygon, polyline, ellipse, text, g').length;
        if (shapesCount >= 2) {
          const rawSvg = svg.outerHTML;
          if (rawSvg && rawSvg.length > 80 && !seenSvgs.has(rawSvg)) {
            seenSvgs.add(rawSvg);
            const title = svg.getAttribute('aria-label') || svg.getAttribute('title') || 'graphic_diagram';
            out.svgs.push({ title, svg: rawSvg });
          }
        }
      });
    });

    const dedupe = (arr, keyFn) => {
      const seen = new Set();
      return arr.filter((x) => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true; });
    };
    out.links = dedupe(out.links, (l) => l.href + '|' + l.text);
    out.files = dedupe(out.files, (f) => f.href || f.name);
    out.images = dedupe(out.images, (i) => i.src);
    out.svgs = dedupe(out.svgs || [], (s) => s.svg);
    out.artifacts = dedupe(out.artifacts || [], (a) => (a.title + '.' + a.type).toLowerCase());
    out.toolActions = dedupe(out.toolActions, (a) => a.label);
    return out;
  }

  function walkElement(root, out) {
    let buf = '';
    const lists = [];
    const codeStash = [];

    const emit = (s) => { buf += s; };
    const breakLines = (n) => {
      if (!buf) return;
      const have = buf.match(/\n*$/)[0].length;
      if (have < n) buf += '\n'.repeat(n - have);
    };
    const capture = (el, ctx) => {
      const saved = buf;
      buf = '';
      visitChildren(el, ctx);
      const inner = buf;
      buf = saved;
      return inner;
    };
    const wrapInline = (marker, el, ctx) => {
      const inner = capture(el, ctx);
      if (!inner.trim()) { emit(inner); return; }
      const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
      emit(m[1] + marker + m[2] + marker + m[3]);
    };

    function visitChildren(el, ctx) {
      for (const child of el.childNodes) visit(child, ctx);
    }

    function visit(node, ctx) {
      if (node.nodeType === 3) { // text node
        let t = node.nodeValue;
        if (!ctx.pre) {
          t = t.replace(/\s+/g, ' ');
          if (buf === '' || /[\n ]$/.test(buf)) t = t.replace(/^ /, '');
        }
        emit(t);
        return;
      }
      if (node.nodeType !== 1) return;

      const el = node;
      const tag = el.localName;

      // Tool-use chips: record as actions instead of text.
      if (tag === 'button' || tag === 'summary' || el.getAttribute('role') === 'button') {
        const label = actionLabel(el);
        if (label) { out.toolActions.push({ label }); return; }
      }
      if (SKIP_TAGS.has(tag) || el.hidden) return;
      if (el.classList?.contains('sr-only') || el.classList?.contains('screen-reader-only') || el.getAttribute('aria-hidden') === 'true') return;

      let cs = null;
      try { cs = getComputedStyle(el); } catch (e) { /* detached: treat as visible */ }
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return;
      const pre = ctx.pre || !!(cs && /^(pre|break-spaces)/.test(cs.whiteSpace));
      const sub = pre === ctx.pre ? ctx : { ...ctx, pre };

      // KaTeX / MathJax: keep the TeX source rather than the garbled glyph soup.
      if (el.classList.contains('katex')) {
        const ann = el.querySelector('annotation[encoding="application/x-tex"]');
        if (ann) {
          const display = !!el.closest('.katex-display');
          emit(display ? `\n\n$$${ann.textContent}$$\n\n` : `$${ann.textContent}$`);
          return;
        }
      }

      switch (tag) {
        case 'pre': {
          const code = el.querySelector('code');
          const body = (code || el).textContent.replace(/\n$/, '');
          const language = detectLanguage(el, code);
          out.codeBlocks.push({ language, code: body });
          codeStash.push('```' + language + '\n' + body + '\n```');
          breakLines(2);
          emit(`\u0000CODE${codeStash.length - 1}\u0000`);
          breakLines(2);
          return;
        }
        case 'code': {
          const inner = el.textContent;
          emit(inner.includes('\n') || !inner ? inner : '`' + inner + '`');
          return;
        }
        case 'br': emit('\n'); return;
        case 'hr': breakLines(2); emit('---'); breakLines(2); return;
        case 'img': {
          const src = el.currentSrc || el.getAttribute('src') || '';
          const w = el.naturalWidth || el.width || 0;
          if (!src || (w && w <= 32)) return; // icons / avatars
          const alt = (el.getAttribute('alt') || '').trim();
          out.images.push({ alt, src });
          emit(alt ? `[image: ${alt}]` : '[image]');
          return;
        }
        case 'a': {
          const href = el.href || '';
          const inner = capture(el, sub);
          const label = inner.trim();
          const usable = /^(https?:|blob:|sandbox:)/i.test(href);
          if (usable) {
            const download = el.getAttribute('download');
            if (label || download) out.links.push({ text: label, href });
            if (download !== null || /^(blob:|sandbox:)/i.test(href) || FILE_RE.test(href.split('?')[0] + '?')) {
              out.files.push({ name: download || label || href.split('/').pop(), href });
            }
          }
          emit(usable && label && /^https?:/i.test(href) && label !== href ? `[${label}](${href})` : inner);
          return;
        }
        case 'strong': case 'b': wrapInline('**', el, sub); return;
        case 'em': case 'i': wrapInline('*', el, sub); return;
        case 'del': case 's': wrapInline('~~', el, sub); return;
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          breakLines(2);
          emit('#'.repeat(Number(tag[1])) + ' ');
          visitChildren(el, sub);
          breakLines(2);
          return;
        case 'p':
          breakLines(2); visitChildren(el, sub); breakLines(2); return;
        case 'blockquote': {
          breakLines(2);
          const inner = capture(el, sub).trim();
          emit(inner.split('\n').map((l) => '> ' + l).join('\n'));
          breakLines(2);
          return;
        }
        case 'ul': case 'ol':
          breakLines(lists.length ? 1 : 2);
          lists.push({ ordered: tag === 'ol', n: 0 });
          visitChildren(el, sub);
          lists.pop();
          breakLines(lists.length ? 1 : 2);
          return;
        case 'li': {
          const l = lists[lists.length - 1] || { ordered: false, n: 0 };
          breakLines(1);
          emit('  '.repeat(Math.max(0, lists.length - 1)) + (l.ordered ? `${++l.n}. ` : '- '));
          visitChildren(el, sub);
          breakLines(1);
          return;
        }
        case 'table': breakLines(2); visitChildren(el, sub); breakLines(2); return;
        case 'tr': {
          const cells = Array.from(el.children).filter((c) => c.localName === 'td' || c.localName === 'th');
          const row = cells.map((c) => capture(c, sub).replace(/\s*\n\s*/g, ' ').trim());
          breakLines(1);
          emit('| ' + row.join(' | ') + ' |');
          breakLines(1);
          if (el.rowIndex === 0) { emit('| ' + row.map(() => '---').join(' | ') + ' |'); breakLines(1); }
          return;
        }
        default: break;
      }

      const block = cs && /^(block|flex|grid|table|list-item|flow-root)/.test(cs.display);
      if (block) breakLines(1);
      visitChildren(el, sub);
      if (block) breakLines(1);
    }

    visit(root, { pre: false });

    let text = buf
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // Put code back last so whitespace clean-up never touches it.
    text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeStash[Number(i)]);
    return text;
  }

  window.__ATE__.dom = {
    getChatId, getMessages, isGenerating, checkHalfProcessed, extractContent, normalize, promptMatches
  };
})();
