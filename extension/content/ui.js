window.__ATE__ = window.__ATE__ || {};

let shadowHost = null;
let shadowRoot = null;
let currentChip = null;
let targetEl = null;
let resizeObserver = null;
let warningTimeout = null;
let spinnerInterval = null;

const styles = `
  .chip {
    position: fixed;
    z-index: 2147483647;
    background: #ffffff;
    color: #1e293b;
    padding: 8px 16px;
    border-radius: 9999px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
    display: flex;
    align-items: center;
    gap: 10px;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: auto;
  }
  .chip.show {
    opacity: 1;
    transform: translateY(0);
  }
  .chip.warning {
    background: #fff3cd;
    color: #856404;
    border: 1px solid #ffeeba;
  }
  .btn {
    background: #f1f5f9;
    color: #334155;
    border: 1px solid transparent;
    padding: 5px 11px;
    border-radius: 9999px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
    transition: all 0.15s ease;
    user-select: none;
    white-space: nowrap;
  }
  .btn:hover {
    background: #e2e8f0;
    color: #0f172a;
    transform: translateY(-1px);
  }
  .btn:active {
    transform: scale(0.97);
  }
  .cat-btn.active {
    background: #1e293b;
    color: #ffffff;
    font-weight: 600;
    border-color: #0f172a;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.35);
  }
  .purpose-btn {
    background: #f8fafc;
    border: 1px solid rgba(0,0,0,0.1);
    color: #475569;
  }
  .purpose-btn:hover {
    background: #f1f5f9;
    color: #1e293b;
  }
  .purpose-btn.active {
    background: #4f46e5;
    color: #ffffff;
    font-weight: 600;
    border-color: #4338ca;
    box-shadow: 0 2px 8px rgba(79, 70, 229, 0.35);
  }
  .purpose-btn[data-purpose="quick"].active {
    background: #d97706;
    border-color: #b45309;
    box-shadow: 0 2px 8px rgba(217, 119, 6, 0.35);
  }
  .purpose-btn[data-purpose="think"].active {
    background: #7c3aed;
    border-color: #6d28d9;
    box-shadow: 0 2px 8px rgba(124, 58, 237, 0.35);
  }
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid #ccc;
    border-top-color: #666;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  
  @media (prefers-color-scheme: dark) {
    .chip {
      background: #1e293b;
      color: #f1f5f9;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1);
    }
    .btn { background: #334155; color: #cbd5e1; }
    .btn:hover { background: #475569; color: #f8fafc; }
    .cat-btn.active {
      background: #38bdf8;
      color: #0f172a;
      font-weight: 600;
      border-color: #0284c7;
      box-shadow: 0 2px 10px rgba(56, 189, 248, 0.45);
    }
    .purpose-btn { background: #1e293b; border-color: rgba(255,255,255,0.15); color: #94a3b8; }
    .purpose-btn:hover { background: #334155; color: #f1f5f9; }
    .purpose-btn.active {
      background: #6366f1;
      border-color: #4f46e5;
      color: #ffffff;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.45);
    }
    .purpose-btn[data-purpose="quick"].active {
      background: #f59e0b;
      border-color: #d97706;
      box-shadow: 0 2px 10px rgba(245, 158, 11, 0.45);
    }
    .purpose-btn[data-purpose="think"].active {
      background: #8b5cf6;
      border-color: #7c3aed;
      box-shadow: 0 2px 10px rgba(139, 92, 246, 0.45);
    }
    .chip.warning { background: #5a4000; color: #ffeb99; border-color: #ffc107; }
  }
`;

function initShadow() {
  if (shadowHost) return;
  shadowHost = document.createElement('div');
  shadowHost.id = 'ate-shadow-host';
  shadowHost.style.position = 'absolute';
  shadowHost.style.top = '0';
  shadowHost.style.left = '0';
  shadowHost.style.pointerEvents = 'none';
  document.body.appendChild(shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: 'closed' });
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  shadowRoot.appendChild(styleEl);
}

function updatePosition() {
  if (!currentChip || !targetEl) return;
  let rect = targetEl.getBoundingClientRect();
  if ((rect.width === 0 || rect.height === 0) && targetEl.parentElement) {
    rect = targetEl.parentElement.getBoundingClientRect();
  }
  const chipRect = currentChip.getBoundingClientRect();
  let top = rect.top + window.scrollY - chipRect.height - 10;
  if (top < 10) top = rect.bottom + window.scrollY + 10;
  let left = rect.right + window.scrollX - chipRect.width;
  if (left < 10) left = 10;
  currentChip.style.top = top + 'px';
  currentChip.style.left = left + 'px';
}

function mountChip(html, el) {
  initShadow();
  if (currentChip) {
    currentChip.remove();
  }
  if (warningTimeout) clearTimeout(warningTimeout);

  const div = document.createElement('div');
  div.innerHTML = html;
  currentChip = div.firstElementChild;
  shadowRoot.appendChild(currentChip);

  targetEl = el;
  updatePosition();

  const mounted = currentChip;
  requestAnimationFrame(() => {
    // hide() or another mountChip() may have run before this frame; don't touch a chip that is gone.
    if (currentChip !== mounted) return;
    mounted.classList.add('show');
    updatePosition();
  });

  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(updatePosition);
  }
  resizeObserver.observe(targetEl);
  window.addEventListener('scroll', updatePosition, true);
  window.addEventListener('resize', updatePosition, true);

  return currentChip;
}

window.__ATE__.ui = {
  showSpinner: (el) => {
    if (spinnerInterval) clearInterval(spinnerInterval);
    const phrases = [
      "Refining your thoughts...",
      "Polishing the edges...",
      "Working some magic...",
      "Sharpening the focus...",
      "Musing in progress...",
      "Leveling up prompt...",
      "Adding some flavor...",
      "Brewing perfect words..."
    ];
    let phraseIndex = Math.floor(Math.random() * phrases.length);
    mountChip(`<div class="chip"><div class="spinner"></div><span id="ate-spinner-text">${phrases[phraseIndex]}</span></div>`, el);

    let ticks = 0;
    spinnerInterval = setInterval(() => {
      if (!currentChip) {
        clearInterval(spinnerInterval);
        return;
      }
      ticks++;
      if (ticks > 3) {
        const span = currentChip.querySelector('#ate-spinner-text');
        if (span) span.textContent = "Still waiting (AI servers are busy)...";
      } else {
        phraseIndex = (phraseIndex + 1) % phrases.length;
        const span = currentChip.querySelector('#ate-spinner-text');
        if (span) span.textContent = phrases[phraseIndex];
      }
    }, 4000);
  },
  
  showUndo: (el, onUndo) => {
    const chip = mountChip(`<div class="chip">✨ Prompt enhanced <button class="btn">Undo</button></div>`, el);
    const btn = chip.querySelector('button');
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onUndo();
    });
  },
  
  showWarning: (el, msg) => {
    const chip = mountChip(`<div class="chip warning">${msg}</div>`, el);
    warningTimeout = setTimeout(() => {
      window.__ATE__.ui.hide();
    }, 8000);
  },
  
  showCategoryPicker: (el, onSelect) => {
    let selectedCategory = null;
    let selectedPurpose = null;
    let submitted = false;

    const chip = mountChip(`
      <div class="chip" style="display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 8px 16px; border-radius: 9999px; max-width: min(94vw, 840px); flex-wrap: wrap;">
        <div style="font-weight: 600; font-size: 13px; white-space: nowrap; opacity: 0.9;">Topic:</div>
        <div style="display: flex; gap: 6px; flex-wrap: nowrap;">
          <button class="btn cat-btn" data-cat="write">Write</button>
          <button class="btn cat-btn" data-cat="learning">Learning</button>
          <button class="btn cat-btn" data-cat="coding">Coding</button>
          <button class="btn cat-btn" data-cat="researching">Researching</button>
          <button class="btn cat-btn" data-cat="life stuff">Life</button>
          <button class="btn cat-btn" data-cat="other">Other</button>
        </div>
        <div style="width: 1px; height: 18px; background: rgba(150, 150, 150, 0.3); margin: 0 4px; flex-shrink: 0;"></div>
        <div style="font-weight: 600; font-size: 13px; white-space: nowrap; opacity: 0.9;">Purpose:</div>
        <div style="display: flex; gap: 6px; flex-wrap: nowrap;">
          <button class="btn purpose-btn" data-purpose="quick" title="Quick: do ASAP in short, best minimum solution">⚡ Quick</button>
          <button class="btn purpose-btn" data-purpose="default" title="Default: standard continuous enhancement">Default</button>
          <button class="btn purpose-btn" data-purpose="think" title="Think: ask relentless questions for context">🧠 Think</button>
        </div>
      </div>
    `, el);

    const catBtns = chip.querySelectorAll('.cat-btn');
    const purposeBtns = chip.querySelectorAll('.purpose-btn');

    function checkAndSubmit() {
      if (selectedCategory && selectedPurpose && !submitted) {
        submitted = true;
        setTimeout(() => {
          onSelect(selectedCategory, selectedPurpose);
        }, 80);
      }
    }

    catBtns.forEach(b => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        selectedCategory = b.dataset.cat;
        catBtns.forEach(other => other.classList.toggle('active', other.dataset.cat === selectedCategory));
        checkAndSubmit();
      });
    });

    purposeBtns.forEach(pBtn => {
      pBtn.addEventListener('mousedown', (e) => e.preventDefault());
      pBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        selectedPurpose = pBtn.dataset.purpose;
        purposeBtns.forEach(other => other.classList.toggle('active', other.dataset.purpose === selectedPurpose));
        checkAndSubmit();
      });
    });

    window.__ATE__.ui.submitActivePicker = () => {
      if (submitted) return;
      const cat = selectedCategory || 'other';
      const purp = selectedPurpose || 'default';
      submitted = true;
      onSelect(cat, purp);
    };
  },
  
  hide: () => {
    window.__ATE__.ui.submitActivePicker = null;
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
    if (currentChip) {
      currentChip.classList.remove('show');
      const toRemove = currentChip;
      setTimeout(() => { if (toRemove.parentNode) toRemove.remove(); }, 200);
      currentChip = null;
    }
    if (resizeObserver && targetEl) {
      resizeObserver.unobserve(targetEl);
    }
    window.removeEventListener('scroll', updatePosition, true);
    window.removeEventListener('resize', updatePosition, true);
  }
};
