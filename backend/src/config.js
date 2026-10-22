require('dotenv').config(); // Active Dahl API config reloaded

const requiredEnvs = [
  'PORT', 'DAHL_API_KEY', 'DAHL_MODEL', 
  'ALLOWED_ORIGINS', 'MAX_DRAFT_CHARS', 'RATE_LIMIT_PER_MIN'
];

for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`FATAL: Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

module.exports = {
  port: parseInt(process.env.PORT, 10),
  dahlApiKey: process.env.DAHL_API_KEY,
  dahlModel: process.env.DAHL_MODEL,
  allowedOrigins: process.env.ALLOWED_ORIGINS.split(','),
  maxDraftChars: parseInt(process.env.MAX_DRAFT_CHARS, 10),
  rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN, 10),
  isDev: process.env.NODE_ENV !== 'production'
};