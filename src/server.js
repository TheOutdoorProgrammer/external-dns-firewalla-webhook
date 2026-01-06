#!/home/pi/firewalla/bin/node
/**
 * External-DNS Firewalla Webhook Provider
 * Main Express.js server
 */

const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');

// Controllers
const negotiate = require('./controllers/negotiate');
const { getRecords, applyChanges } = require('./controllers/records');
const adjustEndpoints = require('./controllers/adjustEndpoints');

// Create Express apps for provider and health endpoints
const providerApp = express();
const healthApp = express();

// Middleware - parse all requests as JSON regardless of content-type
// External-DNS uses 'application/external.dns.webhook+json;version=1' but the payload is always JSON
providerApp.use(express.json({ 
  limit: '10mb',
  type: '*/*'  // Accept any content-type and parse as JSON
}));
healthApp.use(express.json());

// Request logging middleware
providerApp.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: duration + 'ms'
    });
  });
  
  next();
});

// Error handling middleware
providerApp.use((err, req, res, next) => {
  logger.error('Unhandled error in request', { 
    error: err.message, 
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Provider API endpoints (port 8888)
// These are the external-dns webhook protocol endpoints
providerApp.get('/', negotiate);
providerApp.get('/records', getRecords);
providerApp.post('/records', applyChanges);
providerApp.post('/adjustendpoints', adjustEndpoints);

// Health check endpoint (port 8080)
healthApp.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

// Start servers
function startServers() {
  // Start provider API server
  const providerServer = providerApp.listen(config.portProvider, '0.0.0.0', () => {
    logger.info('Provider API server started', { 
      port: config.portProvider,
      address: '0.0.0.0'
    });
  });
  
  // Start health check server
  const healthServer = healthApp.listen(config.portHealth, '0.0.0.0', () => {
    logger.info('Health check server started', { 
      port: config.portHealth,
      address: '0.0.0.0'
    });
  });
  
  // Log configuration
  logger.info('External-DNS Firewalla Webhook Provider is running', {
    version: require('../package.json').version,
    domainFilter: config.domainFilter,
    dnsmasqDir: config.dnsmasqDir,
    dryRun: config.dryRun,
    logLevel: config.logLevel
  });
  
  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info('Shutdown signal received', { signal });
    
    providerServer.close(() => {
      logger.info('Provider API server closed');
      
      healthServer.close(() => {
        logger.info('Health check server closed');
        process.exit(0);
      });
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', { reason: reason, promise: promise });
  });
}

// Start the application
try {
  startServers();
} catch (err) {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
}
