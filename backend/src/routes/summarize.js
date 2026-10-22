const express = require('express');
const router = express.Router();
const { summarize } = require('../services/summarizer');
const rateLimiter = require('../middleware/rateLimit');

router.post('/', rateLimiter, async (req, res, next) => {
  try {
    const { messages, site, chatId, pendingDraft, isHalfProcessed, halfProcessedDetails, customPrompt } = req.body;

    // 1. Validate body
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'messages must be a non-empty array' }
      });
    }

    // Retain initial messages (containing the project goal & initial prompts)
    // and recent messages (recent instructions, working code, and half-processed output).
    let selectedMessages = messages;
    if (messages.length > 36) {
      const initialMessages = messages.slice(0, 4);
      const recentMessages = messages.slice(-32);
      selectedMessages = [...initialMessages, ...recentMessages];
    }

    // 2. Sanitize messages — cap length to prevent abuse
    const safeMessages = selectedMessages.map(m => ({
      role: m.role || 'user',
      text: (m.text || '').substring(0, 4000),
      isHalfProcessed: !!m.isHalfProcessed,
      halfProcessedReason: (m.halfProcessedReason || '').substring(0, 100),
      halfProcessedDetails: (m.halfProcessedDetails || '').substring(0, 300),
      codeBlocks: Array.isArray(m.codeBlocks)
        ? m.codeBlocks.slice(-8).map(cb => ({
            language: (cb.language || '').substring(0, 30),
            code: (cb.code || '').substring(0, 6000)
          }))
        : []
    }));

    const safeDraft = (pendingDraft || '').substring(0, 2000);
    const safeSite = (site || 'unknown').substring(0, 30);
    const safeChatId = (chatId || '').substring(0, 60);
    const safeCustomPrompt = typeof customPrompt === 'string' ? customPrompt.substring(0, 4000) : null;

    // 3. Call summarizer
    let result;
    try {
      result = await summarize({
        messages: safeMessages,
        site: safeSite,
        chatId: safeChatId,
        pendingDraft: safeDraft,
        isHalfProcessed: !!isHalfProcessed,
        halfProcessedDetails: halfProcessedDetails || null,
        customPrompt: safeCustomPrompt
      });
    } catch (err) {
      console.error('[Backend] Summarizer failed:', err.message);
      const status = err.code === 'TIMEOUT' ? 504 : 502;
      return res.status(status).json({
        error: { code: err.code || 'UPSTREAM_ERROR', message: err.message }
      });
    }

    // 4. Return success
    return res.json({
      ok: true,
      summary: result.summary,
      latencyMs: result.latencyMs,
      model: result.model
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
