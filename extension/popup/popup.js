const toggle = document.getElementById('toggle-enhance');
const statusText = document.getElementById('status-text');
const statTotal = document.getElementById('stat-total');
const statToday = document.getElementById('stat-today');
const statTopSite = document.getElementById('stat-topsite');

const supportedHostnames = [
  'chatgpt.com', 'chat.openai.com', 'claude.ai',
  'gemini.google.com', 'www.perplexity.ai', 'perplexity.ai',
  'copilot.microsoft.com', 'copilot.com'
];

const manualHint = document.getElementById('manual-hint');
const backendUrlInput = document.getElementById('backend-url-input');
const saveBackendBtn = document.getElementById('save-backend-btn');
const backendUrlStatus = document.getElementById('backend-url-status');

function isHostSupported(hostname) {
  if (!hostname) return false;
  const clean = hostname.replace(/^www\./, '').toLowerCase();
  if (/(^|\.)copilot(\.microsoft)?\.com$/i.test(clean)) return true;
  return supportedHostnames.some((h) => h.replace(/^www\./, '').toLowerCase() === clean);
}

function updateStatus(enabled) {
  if (manualHint) {
    manualHint.style.display = enabled ? 'none' : 'block';
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0] || !tabs[0].url) {
      statusText.textContent = enabled ? 'Checking...' : 'Supported on this site (Alt+E)';
      statusText.style.color = enabled ? 'gray' : '#1a7f37';
      return;
    }
    try {
      const url = new URL(tabs[0].url);
      const isSupported = isHostSupported(url.hostname);
      if (isSupported) {
        if (enabled) {
          statusText.textContent = 'Active on this site';
          statusText.style.color = '#1a7f37';
        } else {
          statusText.textContent = 'Supported on this site (Alt+E)';
          statusText.style.color = '#1a7f37';
        }
      } else {
        statusText.textContent = "This site isn't supported";
        statusText.style.color = '#71767b';
      }
    } catch (e) {
      statusText.textContent = enabled ? 'Checking...' : 'Supported on this site (Alt+E)';
      statusText.style.color = 'gray';
    }
  });
}

function loadState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (res) {
      toggle.checked = res.enabled;
      updateStatus(res.enabled);
      if (backendUrlInput && res.backendUrl) {
        backendUrlInput.value = res.backendUrl;
      }
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (res) => {
    if (res) {
      statTotal.textContent = res.total;
      statToday.textContent = res.today;
      statTopSite.textContent = res.topSite || '-';
    }
  });
}

toggle.addEventListener('change', (e) => {
  const enabled = e.target.checked;
  chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled });
  updateStatus(enabled);
});

// ---------------------------------------------------------------- session migration
const migrateSessionBtn = document.getElementById('migrate-session');
const exportStatus = document.getElementById('export-status');

const EXPORT_TIMEOUT_MS = 75000;

function showExportStatus(kind, text) {            // kind: 'success' | 'error' | 'info'
  exportStatus.className = kind;
  exportStatus.textContent = text;
}

function setExportBusy(busy) {
  if (migrateSessionBtn) {
    migrateSessionBtn.disabled = busy;
    migrateSessionBtn.textContent = busy ? '⏳ Packaging Session...' : '📦 Migrate Session (ZIP)';
  }
}

function downloadBase64Zip(filename, base64Data) {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function runMigrationZip() {
  exportStatus.className = '';
  exportStatus.textContent = '';
  setExportBusy(true);
  showExportStatus('info', 'Analyzing conversation with AI model & packaging...');

  let settled = false;
  const finish = (kind, text) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    setExportBusy(false);
    showExportStatus(kind, text);
  };
  const timer = setTimeout(
    () => finish('error', 'Action timed out. Reload the chat page and try again.'),
    EXPORT_TIMEOUT_MS
  );

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    let host = '';
    try { host = new URL(tab && tab.url).hostname; } catch (e) { /* no usable URL */ }
    if (!tab || !isHostSupported(host)) {
      return finish('error', 'Open a supported AI chat (ChatGPT, Claude, Gemini, Perplexity or Copilot) and try again.');
    }

    const sendMigrationMessage = (retried = false) => {
      chrome.tabs.sendMessage(tab.id, { type: 'MIGRATE_SESSION_ZIP' }, async (res) => {
        // If content script wasn't responding (e.g. extension was reloaded in chrome://extensions while tab was open)
        if ((chrome.runtime.lastError || !res) && !retried) {
          try {
            if (chrome.scripting && chrome.scripting.executeScript) {
              const manifest = chrome.runtime.getManifest();
              const scripts = (manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].js) || [
                'content/jszip.min.js',
                'content/adapters/index.js',
                'content/adapters/chatgpt.js',
                'content/adapters/claude.js',
                'content/adapters/gemini.js',
                'content/adapters/perplexity.js',
                'content/adapters/copilot.js',
                'content/chatDom.js',
                'content/chatLog.js',
                'content/exporter.js',
                'content/editor.js',
                'content/ui.js',
                'content/content.js'
              ];
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: scripts
              });
              setTimeout(() => sendMigrationMessage(true), 250);
              return;
            }
          } catch (injectErr) {
            console.warn('[PromptIQ] Auto-injection failed:', injectErr);
          }
        }

        if (chrome.runtime.lastError || !res) {
          return finish('error', 'PromptIQ is not active on this page. Reload the chat tab and try again.');
        }
        if (!res.ok) {
          return finish('error', res.message || 'Migration failed.');
        }

        try {
          downloadBase64Zip(res.filename, res.zipBase64);
          finish('success', 'Session migration package downloaded (ZIP).');
        } catch (e) {
          finish('error', 'Could not save the file: ' + (e && e.message ? e.message : e));
        }
      });
    };

    sendMigrationMessage(false);
  });
}

if (migrateSessionBtn) {
  migrateSessionBtn.addEventListener('click', () => runMigrationZip());
}

if (saveBackendBtn) {
  saveBackendBtn.addEventListener('click', () => {
    const raw = (backendUrlInput.value || '').trim();
    if (!raw) return;
    chrome.storage.local.set({ backendUrl: raw }, () => {
      if (backendUrlStatus) {
        backendUrlStatus.style.display = 'block';
        backendUrlStatus.style.color = '#1a7f37';
        backendUrlStatus.textContent = 'Saved!';
        setTimeout(() => { backendUrlStatus.style.display = 'none'; }, 2000);
      }
    });
  });
}

loadState();
