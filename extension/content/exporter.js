/**
 * exporter.js — Session Migration engine.
 *
 * Extracts the complete state from the active chat:
 *   - Project goal & initial context
 *   - Recent instructions & constraints (both PromptIQ-enhanced and unenhanced)
 *   - Latest working code blocks, draft, files, and generated images
 *
 * Capabilities:
 *   Full Session Migration (ZIP): Calls /summarize API for AI context summary,
 *   collects media and files into an artifacts/ folder, and bundles everything
 *   into a ready-to-use ZIP via JSZip.
 */
window.__ATE__ = window.__ATE__ || {};

(function () {
  const dom = () => window.__ATE__.dom;
  const log = () => window.__ATE__.chatLog;

  class ExportError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  function fileName(kind, adapter, chatId, ext = 'json') {
    const short = (chatId || 'unsaved-chat').replace(/[^a-z0-9-]/gi, '').slice(0, 12) || 'chat';
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `promptiq_${kind}_${adapter.name}_${short}_${stamp}.${ext}`;
  }

  /**
   * Resolves the active adapter and current chat info, or throws ExportError.
   */
  async function getContext() {
    const adapter = window.__ATE__.getAdapter && window.__ATE__.getAdapter();
    if (!adapter) {
      throw new ExportError('UNSUPPORTED_SITE', 'This page is not a supported AI chat site.');
    }
    if (!adapter.messageSelectors) {
      throw new ExportError('UNSUPPORTED_SITE', `Session migration is not supported on ${adapter.name} yet.`);
    }

    if (log() && log().syncChat) {
      try {
        await log().syncChat();
      } catch (e) {}
    }

    const chatId = (log() && log().getChatId) ? log().getChatId() : (dom().getChatId ? dom().getChatId(adapter) : null);

    return {
      adapter,
      chat: { id: chatId, url: location.href, title: document.title || null },
      records: (log() && log().getRecords) ? log().getRecords() : [],
      rawMessages: dom().getMessages(adapter)
    };
  }

  /**
   * Extracts and standardizes conversation data from current page DOM.
   */
  async function extractConversationData() {
    const { adapter, chat, records, rawMessages } = await getContext();

    // 1. Check for pending draft in chat input box
    let pendingDraft = '';
    try {
      const inputEl = adapter.getInput && adapter.getInput();
      if (inputEl && window.__ATE__.editor && window.__ATE__.editor.readText) {
        pendingDraft = (window.__ATE__.editor.readText(inputEl) || '').trim();
      }
    } catch (e) {}

    // If completely blank page and no draft
    if (!rawMessages.length && !pendingDraft) {
      throw new ExportError(
        'EMPTY_CHAT',
        'No messages or pending draft found in this chat. Start a conversation or type a draft, then try again.'
      );
    }

    // 2. Extract structured content for each message on screen
    const messages = rawMessages.map((m, i) => {
      const c = dom().extractContent(m.els);
      return {
        index: i + 1,
        role: m.role,
        text: (c.text || '').trim(),
        codeBlocks: c.codeBlocks || [],
        files: c.files || [],
        images: c.images || [],
        svgs: c.svgs || [],
        toolActions: c.toolActions || []
      };
    });

    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    // 3. Extract Primary Objective / Goal
    let objective = '';
    if (userMessages.length > 0) {
      objective = userMessages[0].text;
    } else if (document.title && !/^(ChatGPT|Claude|Gemini|Perplexity|Copilot|Microsoft Copilot)/i.test(document.title.trim())) {
      objective = document.title.trim();
    } else {
      objective = pendingDraft || 'Continue ongoing task';
    }

    // 4. Extract ALL User Prompts & Instructions (both PromptIQ-enhanced and raw prompts)
    const allUserPrompts = userMessages.map((m) => m.text).filter(Boolean);
    const recentInstructions = allUserPrompts.slice(-10);

    // 5. Extract Latest State & Working Code
    let latestCode = null;
    for (let i = assistantMessages.length - 1; i >= 0; i--) {
      const a = assistantMessages[i];
      if (a.codeBlocks && a.codeBlocks.length > 0) {
        const lastBlock = a.codeBlocks[a.codeBlocks.length - 1];
        if (lastBlock && lastBlock.code) {
          latestCode = {
            language: lastBlock.language || '',
            code: lastBlock.code.trim()
          };
          break;
        }
      }
    }

    let latestAssistantExcerpt = '';
    if (assistantMessages.length > 0) {
      const lastA = assistantMessages[assistantMessages.length - 1];
      latestAssistantExcerpt = (lastA.text || '').trim();
    }

    // Check for half-processed / cut-off assistant response
    const halfProcessedState = dom().checkHalfProcessed
      ? dom().checkHalfProcessed(adapter, latestAssistantExcerpt)
      : { isHalfProcessed: false, reason: null, details: null };

    if (halfProcessedState.isHalfProcessed && assistantMessages.length > 0) {
      const lastA = assistantMessages[assistantMessages.length - 1];
      lastA.isHalfProcessed = true;
      lastA.halfProcessedReason = halfProcessedState.reason;
      lastA.halfProcessedDetails = halfProcessedState.details;
    }

    // 6. Extract Pending Task
    let pendingTask = '';
    if (pendingDraft) {
      pendingTask = pendingDraft;
    } else if (halfProcessedState.isHalfProcessed) {
      pendingTask = `Finish the incomplete response that was interrupted: ${halfProcessedState.details || 'Continue generation'}`;
    } else if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      pendingTask = messages[messages.length - 1].text;
    } else {
      pendingTask = 'Continue implementation from the latest state above and proceed to the next step.';
    }

    // 7. Format Continuation Markdown Prompt
    let sectionNum = 1;
    const promptParts = [
      'We are continuing an ongoing project from a previous session. Here is our context and current state:\n',
      `### ${sectionNum++}. Project Goal & Context:\n` + objective.trim() + '\n'
    ];

    if (recentInstructions.length > 1) {
      promptParts.push(`### ${sectionNum++}. Key Instructions & Refinements:`);
      recentInstructions.forEach((inst, idx) => {
        const clean = inst.replace(/\n+/g, ' ').trim();
        const snippet = clean.length > 250 ? clean.slice(0, 250) + '...' : clean;
        promptParts.push(`- Step ${idx + 1}: ${snippet}`);
      });
      promptParts.push('');
    }

    if (latestCode && latestCode.code) {
      promptParts.push(`### ${sectionNum++}. Current Working Code:`);
      promptParts.push('```' + (latestCode.language || '') + '\n' + latestCode.code + '\n```\n');
    } else if (latestAssistantExcerpt) {
      promptParts.push(`### ${sectionNum++}. Latest Response / Output:`);
      promptParts.push(latestAssistantExcerpt + '\n');
    }

    if (halfProcessedState.isHalfProcessed) {
      promptParts.push(`### ${sectionNum++}. ⚠️ Incomplete / Half-Processed Response:`);
      promptParts.push(`Claude/AI response was cut off mid-stream (${halfProcessedState.details || 'Interrupted'}).`);
      if (latestAssistantExcerpt) {
        promptParts.push(`Last partial output before stopping:\n> ${latestAssistantExcerpt.slice(-300).replace(/\n/g, '\n> ')}\n`);
      }
    }

    const isDraftContent = pendingTask.length > 80 && !pendingTask.toLowerCase().startsWith('continue');
    const taskHeader = isDraftContent
      ? `### ${sectionNum++}. Current Draft / Task to Continue:`
      : `### ${sectionNum++}. Next Task / Instruction:`;

    promptParts.push(taskHeader);
    promptParts.push(pendingTask.trim());

    const continuationPrompt = promptParts.join('\n');

    // 8. Build Structured Payload (Minimal)
    const totalCodeBlocks = messages.reduce((sum, m) => sum + (m.codeBlocks ? m.codeBlocks.length : 0), 0);
    const payload = {
      schema: 'promptiq.session_continuation',
      version: 2,
      exported_at: new Date().toISOString(),
      chat,
      stats: {
        total_messages: messages.length,
        user_messages: userMessages.length,
        assistant_messages: assistantMessages.length,
        code_blocks_found: totalCodeBlocks
      },
      state: {
        is_interrupted: halfProcessedState.isHalfProcessed,
        pending_draft: pendingDraft || null
      }
    };

    return {
      adapter,
      chat,
      messages,
      userMessages,
      assistantMessages,
      pendingDraft,
      objective,
      allUserPrompts,
      recentInstructions,
      latestCode,
      latestAssistantExcerpt,
      halfProcessedState,
      pendingTask,
      continuationPrompt,
      payload
    };
  }

  /**
   * Builds prompt-response exchange pairs from sequential chat messages.
   * Format for each pair:
   *   prompt: user prompt text
   *   response: assistant response text
   *   timestamp: ISO string or message timestamp
   *   prompt_no: index number (1, 2, 3...)
   */
  function buildConversationPairs(messages) {
    const pairs = [];
    let currentPrompt = null;
    let promptCounter = 1;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'user') {
        if (currentPrompt) {
          pairs.push({
            prompt_no: promptCounter++,
            timestamp: currentPrompt.timestamp || new Date().toISOString(),
            prompt: (currentPrompt.text || '').trim(),
            response: ''
          });
        }
        currentPrompt = msg;
      } else if (msg.role === 'assistant') {
        let respText = (msg.text || '').trim();
        if (msg.codeBlocks && msg.codeBlocks.length > 0 && !respText.includes(msg.codeBlocks[0].code)) {
          const codeText = msg.codeBlocks.map((cb) => '```' + (cb.language || '') + '\n' + cb.code + '\n```').join('\n\n');
          respText = respText ? `${respText}\n\n${codeText}` : codeText;
        }

        if (currentPrompt) {
          pairs.push({
            prompt_no: promptCounter++,
            timestamp: currentPrompt.timestamp || msg.timestamp || new Date().toISOString(),
            prompt: (currentPrompt.text || '').trim(),
            response: respText
          });
          currentPrompt = null;
        } else {
          pairs.push({
            prompt_no: promptCounter++,
            timestamp: msg.timestamp || new Date().toISOString(),
            prompt: '',
            response: respText
          });
        }
      }
    }

    if (currentPrompt) {
      pairs.push({
        prompt_no: promptCounter++,
        timestamp: currentPrompt.timestamp || new Date().toISOString(),
        prompt: (currentPrompt.text || '').trim(),
        response: ''
      });
    }

    return pairs;
  }

  /**
   * Picks the upper 4 messages/pairs and the last 4 messages/pairs.
   * If total pairs <= 8, includes all without duplication.
   */
  function selectFirstAndLastPairs(pairs, count = 4) {
    if (!Array.isArray(pairs) || pairs.length <= count * 2) {
      return pairs || [];
    }
    const first = pairs.slice(0, count);
    const last = pairs.slice(-count);
    return [...first, ...last];
  }

  const HANDOFF_SUMMARY_PROMPT = `Please write a handoff summary of our entire conversation so I can paste it into a new chat with no prior context. Write it so that a new Claude session can continue the work seamlessly. Include:

1. **Goal**: What I'm ultimately trying to accomplish, in 2-3 sentences.
2. **Background and context**: Key facts about me, my situation, and the project that Claude needs to know (skill level, tools, constraints, audience, etc.).
3. **Decisions made**: Conclusions we reached and the reasoning behind them, so they don't get re-litigated.
4. **Current state**: What has been completed, what's in progress, and any drafts, code, or outputs that matter. Include the final versions of anything important verbatim.
5. **Open questions and next steps**: What's unresolved and what we should do next.
6. **Preferences**: Tone, format, style, or approach I've asked for or corrected you on.
7. **Things to avoid**: Approaches we tried that didn't work, or topics I said I don't want.

Be specific rather than generic. Preserve exact names, numbers, code, and wording where they matter. Skip pleasantries and anything that no longer matters. Format it as a single block I can copy and paste, and begin it with a line like: "This is a summary of a previous conversation. Use it as context and continue from where we left off."`;

  /**
   * Local fallback summarizer when /summarize API is offline or unreachable.
   * Matches the exact 7-section handoff prompt structure requested by the user.
   */
  function generateFallbackSummary(data, selectedPairs = []) {
    let out = `This is a summary of a previous conversation. Use it as context and continue from where we left off.\n\n`;
    out += `## Session Migration Summary\n\n`;

    out += `1. **Goal**: ${data.objective || 'Continue ongoing task from previous session.'}\n\n`;

    out += `2. **Background and context**: Original platform: ${data.adapter.name}. Chat ID: ${data.chat.id || 'unsaved-chat'}. Migrated at: ${new Date().toISOString()}. Total conversation turns: ${data.messages ? data.messages.length : 0}.\n\n`;

    out += `3. **Decisions made**:\n`;
    if (data.recentInstructions && data.recentInstructions.length > 0) {
      data.recentInstructions.slice(0, 5).forEach((inst, idx) => {
        const clean = inst.replace(/\n+/g, ' ').trim();
        const snippet = clean.length > 200 ? clean.slice(0, 200) + '...' : clean;
        out += `- Decision ${idx + 1}: ${snippet}\n`;
      });
    } else {
      out += `- Maintained continuous conversation context and preserved previous state.\n`;
    }
    out += `\n`;

    out += `4. **Current state**:\n`;
    if (data.latestAssistantExcerpt) {
      out += `${data.latestAssistantExcerpt.slice(0, 1000)}\n\n`;
    } else {
      out += `Active conversation state captured.\n\n`;
    }

    if (data.latestCode && data.latestCode.code) {
      out += `\`\`\`${data.latestCode.language || ''}\n${data.latestCode.code}\n\`\`\`\n\n`;
    }

    if (data.halfProcessedState && data.halfProcessedState.isHalfProcessed) {
      out += `*Interruption Alert:* Response was interrupted (${data.halfProcessedState.details || 'stopped mid-stream'}). Action needed: Complete unfinished output.\n\n`;
    }

    out += `5. **Open questions and next steps**:\n`;
    out += `${data.pendingTask || 'Proceed to the next implementation step.'}\n\n`;

    out += `6. **Preferences**:\n`;
    out += `- Clear, concise, and structured responses without conversational filler.\n`;
    out += `- Preserve all code logic, naming, and constraints exactly as established.\n\n`;

    out += `7. **Things to avoid**:\n`;
    out += `- Do not re-litigate decisions already finalized above.\n`;
    out += `- Avoid repeating already implemented code blocks or completed steps.\n`;

    return out;
  }

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

  /**
   * Request an AI summary from backend /summarize, falling back to local summary if needed.
   */
  async function fetchAiSummary(data, selectedPairs) {
    try {
      if (!isExtensionValid()) {
        console.warn('[PromptIQ] Extension context invalidated; using fallback summary.');
        return generateFallbackSummary(data, selectedPairs);
      }
      const response = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'SUMMARIZE',
              messages: data.messages,
              site: data.adapter.name,
              chatId: data.chat.id,
              pendingDraft: data.pendingDraft,
              isHalfProcessed: data.halfProcessedState ? data.halfProcessedState.isHalfProcessed : false,
              halfProcessedDetails: data.halfProcessedState ? data.halfProcessedState.details : null,
              customPrompt: HANDOFF_SUMMARY_PROMPT,
              continuationData: data.payload
            },
            (res) => {
              try {
                if (!isExtensionValid() || chrome.runtime?.lastError || !res) {
                  resolve({ ok: false, error: chrome.runtime?.lastError?.message || 'No response' });
                } else {
                  resolve(res);
                }
              } catch (cbErr) {
                resolve({ ok: false, error: cbErr?.message || 'Extension context invalidated' });
              }
            }
          );
        } catch (sendErr) {
          resolve({ ok: false, error: sendErr?.message || 'Extension context invalidated' });
        }
      });

      if (response && response.ok && response.summary) {
        return response.summary;
      }
    } catch (e) {
      console.warn('[PromptIQ] Summarize API call failed, using fallback:', e);
    }
    return generateFallbackSummary(data, selectedPairs);
  }

  /**
   * Build the simplified 2-file ZIP package using JSZip:
   *   1. session_summary.md (AI-generated handoff summary)
   *   2. session_continuation.json (first 4 & last 4 messages in requested format + chat metadata)
   * NO artifacts folder.
   */
  async function migrateSessionZip() {
    const data = await extractConversationData();

    // 1. Get JSZip library
    const JSZipConstructor = window.JSZip || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!JSZipConstructor) {
      throw new ExportError('JSZIP_NOT_FOUND', 'JSZip framework could not be loaded. Please reload the extension.');
    }
    const zip = new JSZipConstructor();

    // 2. Build selected prompt-response pairs (upper 4 + last 4)
    const allPairs = buildConversationPairs(data.messages);
    const selectedPairs = selectFirstAndLastPairs(allPairs, 4);

    // 3. Build minimal, non-redundant session continuation JSON
    const minimalContinuation = {
      schema: 'promptiq.session_continuation',
      version: 2,
      exported_at: new Date().toISOString(),
      chat: {
        site: data.adapter.name,
        id: data.chat.id,
        url: data.chat.url || null,
        title: data.chat.title || null
      },
      stats: {
        total_turns: allPairs.length,
        exported_turns: selectedPairs.length
      },
      state: {
        is_interrupted: data.halfProcessedState ? data.halfProcessedState.isHalfProcessed : false,
        pending_draft: data.pendingDraft || null
      },
      exchanges: selectedPairs.map((p, idx) => ({
        index: idx + 1,
        timestamp: p.timestamp,
        prompt: p.prompt,
        response: p.response
      }))
    };

    data.payload = minimalContinuation;

    // 4. Obtain AI handoff summary
    const aiSummary = await fetchAiSummary(data, selectedPairs);
    zip.file('session_summary.md', aiSummary);

    // 5. Add structured minimal session continuation JSON
    zip.file('session_continuation.json', JSON.stringify(minimalContinuation, null, 2));

    // 5. Generate Base64 ZIP (NO artifacts folder - strictly 2 files)
    const zipBase64 = await zip.generateAsync({
      type: 'base64',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const zipFilename = fileName('migration', data.adapter, data.chat.id, 'zip');

    return {
      ok: true,
      filename: zipFilename,
      zipBase64,
      summary: aiSummary,
      stats: {
        totalPairs: allPairs.length,
        exportedPairs: selectedPairs.length,
        files: 2
      },
      message: 'Session migration package ready.'
    };
  }

  // ------------------------------------------------------------- Messaging
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === 'MIGRATE_SESSION_ZIP') {
      migrateSessionZip()
        .then(sendResponse)
        .catch((err) => {
          if (!(err instanceof ExportError)) console.error('[PromptIQ] migration ZIP failed', err);
          sendResponse({
            ok: false,
            code: err instanceof ExportError ? err.code : 'EXPORT_FAILED',
            message: err instanceof ExportError
              ? err.message
              : 'Migration failed unexpectedly. Reload the chat page and try again.'
          });
        });
      return true;
    }
  });
    }
  } catch (e) {
    console.warn('[PromptIQ] Could not register onMessage listener:', e);
  }
})();
