const rateLimit = require('express-rate-limit');
const config = require('../config');

// In a stateless, auth-less approach, we limit by IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimitPerMin,
  handler: (req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' }
    });
  }
});

module.exports = limiter;