const config = require('../config');

const SUMMARIZE_SYSTEM_PROMPT = `You are a session-migration assistant inside a browser extension called PromptIQ.
The user has been working in an AI chat (ChatGPT, Claude, Gemini, Perplexity, or Copilot) and wants to
continue their work in a new chat window. You receive all user prompts (both PromptIQ-enhanced and raw prompts)
and all assistant responses from this single chat. You must produce a clean, structured summary in Markdown
that another AI model can read to instantly pick up where they left off.

You receive:
- <chat_messages>: the ordered conversation (user prompts and assistant responses, including code blocks)
- <site>: which AI platform the chat was on
- <chat_id>: ID of the active chat
- <half_processed_alert>: present if Claude or the AI was interrupted or cut off mid-generation
- <pending_draft>: any unsent text the user typed in the chat input box (may be empty)

YOUR TASK: Analyze the conversation and produce a structured migration summary in Markdown.

OUTPUT FORMAT (use this exact structure):

## Session Migration Context

**Original Platform:** [site name]
**Chat ID:** [chat id or unsaved-chat]
**Migrated at:** [timestamp will be added automatically]

### Goal
[What the user was trying to accomplish — extracted from the user's initial prompts and clarified by later context]

### What Was Done & Instructions History
[Chronological list of key instructions, refinements, and prompts given by the user across the conversation. Include both PromptIQ-enhanced and raw user requests]

### Current State
[Describe the latest working state of the project. If code was being written, describe what the current implementation does. If a document or design was being drafted, describe the current version]

### Latest Working Code
[If the conversation contains code, include the MOST RECENT complete working version here in a fenced code block with the correct language tag. Preserve code syntax exactly. If multiple files, include all of them. If no code, omit this section]

### Incomplete / Half-Processed Response
[CRITICAL: If the assistant's response was left half-processed, cut off, or interrupted (e.g. Claude hitting a message limit or token limit mid-generation), explain EXACTLY what was being outputted, where it stopped, and what was left unfinished. If no half-processed response was detected, write "None - all responses completed successfully."]

### What's Pending / Next Steps
[What needs to happen next? If there was a half-processed response, specify that finishing it is the immediate priority. If the user had a pending draft, incorporate it here. Be specific and actionable]

### Key Constraints & Decisions
[Any important constraints, preferences, architecture decisions, or rules established during the chat]

RULES:
1. Be CONCISE but COMPLETE. Every line must provide actionable context.
2. PRESERVE all code exactly as-is. Never alter, abbreviate, or hallucinate code.
3. Include ALL latest code blocks.
4. Pay special attention to half-processed / cut-off Claude responses — the new AI must know exactly what was left half-done so it can complete it seamlessly.
5. The output should be ready to paste directly into a new AI chat window.

OUTPUT: Only the markdown summary. No conversational filler, no commentary.`;

function truncateText(text, maxLen) {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen) + '... [truncated]';
}

async function summarize({ messages, site, chatId, pendingDraft, isHalfProcessed, halfProcessedDetails, customPrompt }) {
  const start = Date.now();
  const systemPrompt = customPrompt || SUMMARIZE_SYSTEM_PROMPT;

  // Build the conversation text for the AI
  let userMessage = '<chat_messages>\n';
  for (const msg of messages) {
    const isUser = msg.role === 'user';
    let roleHeader = isUser ? '[USER PROMPT]' : '[ASSISTANT RESPONSE]';
    if (!isUser && msg.isHalfProcessed) {
      roleHeader = '[ASSISTANT RESPONSE - INCOMPLETE / CUT OFF MID-GENERATION]';
    }
    userMessage += `${roleHeader}:\n${truncateText(msg.text, 3500)}\n`;

    if (msg.isHalfProcessed) {
      userMessage += `⚠️ [INTERRUPTION ALERT: This assistant response was interrupted and left half-finished. Reason: ${msg.halfProcessedDetails || 'Cut off / limit reached'}]\n`;
    }

    if (msg.codeBlocks && msg.codeBlocks.length > 0) {
      for (const cb of msg.codeBlocks) {
        userMessage += '```' + (cb.language || '') + '\n' + truncateText(cb.code, 4500) + '\n```\n';
      }
    }
    userMessage += '\n';
  }
  userMessage += '</chat_messages>\n';

  userMessage += `<site>${site || 'unknown'}</site>\n`;
  if (chatId) userMessage += `<chat_id>${chatId}</chat_id>\n`;

  if (isHalfProcessed) {
    userMessage += `<half_processed_alert>\nThe conversation ended on an INCOMPLETE / HALF-PROCESSED response from Claude or the AI model.\nDetails: ${halfProcessedDetails || 'Interrupted or hit limit'}\nYou MUST explicitly state what was being generated and what needs to be completed in the new session.\n</half_processed_alert>\n`;
  }

  if (pendingDraft) {
    userMessage += `<pending_draft>\n${truncateText(pendingDraft, 1500)}\n</pending_draft>\n`;
  }

  const candidateModels = Array.from(new Set([
    config.dahlModel || 'deepseek-ai/DeepSeek-V4-Flash-0731',
    'deepseek-ai/DeepSeek-V4-Flash-0731',
    'MiniMaxAI/MiniMax-M2.7',
    'zai-org/GLM-5.3-Flash'
  ].filter(Boolean)));

  let lastError;

  for (const model of candidateModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch('https://inference.dahl.global/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.dahlApiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage }
            ],
            temperature: 0.2
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          if (response.status === 429) {
            console.warn(`[Backend] Summarize: Model ${model} rate limited (429), trying next...`);
            lastError = new Error(`Dahl 429: ${errText}`);
            lastError.code = 'RATE_LIMITED';
            break;
          }
          const err = new Error(`Dahl API Error: ${response.status} - ${errText}`);
          err.code = 'UPSTREAM_ERROR';
          throw err;
        }

        const data = await response.json();
        let outputText = data.choices && data.choices[0]?.message?.content ? data.choices[0].message.content : '';
        if (!outputText) {
          throw new Error(`Empty response from model ${model}`);
        }

        // Clean out <think> tags if model produces reasoning
        const cleaned = outputText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        return {
          summary: cleaned,
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
          latencyMs: Date.now() - start,
          model: model
        };
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        if (error.name === 'AbortError') {
          console.warn(`[Backend] Summarize: Model ${model} timed out, trying next...`);
          break;
        }
        if (attempt === 2) {
          console.warn(`[Backend] Summarize: Model ${model} failed after 2 attempts: ${error.message}`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  if (lastError && lastError.name === 'AbortError') {
    const err = new Error('Summarize request timed out across all models');
    err.code = 'TIMEOUT';
    throw err;
  }
  throw lastError || new Error('All inference models failed');
}

module.exports = {
  SUMMARIZE_SYSTEM_PROMPT,
  summarize
};
