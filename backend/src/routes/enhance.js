const express = require('express');
const router = express.Router();
const config = require('../config');
const { enhance } = require('../services/enhancer');
const { validateEnhancement } = require('../services/validate');
const rateLimiter = require('../middleware/rateLimit');

router.post('/', rateLimiter, async (req, res, next) => {
  try {
    const { draft, context, category, tag, purpose } = req.body;
    
    // 1. Validate body
    if (!draft || typeof draft !== 'string') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Draft must be a non-empty string' } });
    }
    
    if (draft.length > config.maxDraftChars) {
      return res.status(413).json({ error: { code: 'DRAFT_TOO_LONG', message: 'Draft is too long' } });
    }
    
    let safeContext = [];
    if (Array.isArray(context)) {
      safeContext = context.slice(-4).map(c => ({
        role: c.role || 'user',
        text: (c.text || '').substring(0, 1500)
      }));
    }

    const finalCategory = (category || 'other').toString().toLowerCase().trim();
    const finalTag = tag || null;
    
    // 2. Call enhancer
    let enhancedData;
    try {
      enhancedData = await enhance({
        draft,
        context: safeContext,
        category: finalCategory,
        tag: finalTag,
        purpose
      });
    } catch (err) {
      console.error('[Backend] Enhancer API failed:', err.message, err.stack);
      const status = err.code === 'TIMEOUT' ? 504 : (err.code === 'BAD_REQUEST' ? 400 : 502);
      return res.status(status).json({ error: { code: err.code || 'UPSTREAM_ERROR', message: err.message } });
    }
    
    // 3. Post-validation
    const validation = validateEnhancement(draft, enhancedData.enhanced);
    if (!validation.ok) {
      return res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: validation.reason } });
    }
    
    // 4. Return success
    return res.json({
      enhanced: enhancedData.enhanced,
      latencyMs: enhancedData.latencyMs,
      id: 'stateless-' + Date.now(),
      category: finalCategory
    });
    
  } catch (err) {
    next(err);
  }
});

module.exports = router;