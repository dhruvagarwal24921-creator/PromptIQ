const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const config = require('./config');

const app = express();

// Middleware
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '200kb' }));

const corsOptions = {
  origin: function (origin, callback) {
    if (config.isDev) {
      return callback(null, true);
    }
    if (!origin) {
      return callback(null, true);
    }
    if (origin && config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  }
};
app.use(cors(corsOptions));

// Routes
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Endpoints
app.use('/enhance', require('./routes/enhance'));
app.use('/summarize', require('./routes/summarize'));

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred'
    }
  });
});

let server;

function startServer() {
  server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

startServer();

// Graceful shutdown
function shutdown() {
  console.log('Shutting down gracefully...');
  if (server) {
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);







