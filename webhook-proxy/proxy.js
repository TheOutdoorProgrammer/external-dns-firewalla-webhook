/**
 * External-DNS Webhook Proxy
 * 
 * Lightweight HTTP proxy that forwards external-dns webhook requests
 * from the Kubernetes cluster to the Firewalla webhook provider.
 * 
 * This runs as a sidecar in the external-dns pod and proxies requests
 * to the actual webhook provider running on the Firewalla device.
 */

const http = require('http');
const https = require('https');

// Configuration from environment variables
const FIREWALLA_HOST = process.env.FIREWALLA_HOST || '192.168.229.1';
const FIREWALLA_PROVIDER_PORT = process.env.FIREWALLA_PROVIDER_PORT || '8888';
const FIREWALLA_HEALTH_PORT = process.env.FIREWALLA_HEALTH_PORT || '8080';
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || '8888';
const METRICS_PORT = process.env.METRICS_PORT || '8080';

// Build Firewalla URLs
const FIREWALLA_PROVIDER_URL = `http://${FIREWALLA_HOST}:${FIREWALLA_PROVIDER_PORT}`;
const FIREWALLA_HEALTH_URL = `http://${FIREWALLA_HOST}:${FIREWALLA_HEALTH_PORT}`;

console.log('Starting External-DNS Webhook Proxy');
console.log(`Firewalla Provider: ${FIREWALLA_PROVIDER_URL}`);
console.log(`Firewalla Health: ${FIREWALLA_HEALTH_URL}`);
console.log(`Webhook Port: ${WEBHOOK_PORT}`);
console.log(`Metrics Port: ${METRICS_PORT}`);

/**
 * Proxy HTTP request to Firewalla
 */
function proxyRequest(clientReq, clientRes, targetUrl) {
  const startTime = Date.now();
  const url = new URL(clientReq.url, targetUrl);
  
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      'host': url.host,
      'x-forwarded-for': clientReq.socket.remoteAddress,
      'x-forwarded-proto': 'http',
      'x-forwarded-host': clientReq.headers.host
    }
  };

  console.log(`[${clientReq.method}] ${clientReq.url} -> ${url.href}`);

  const proxyReq = http.request(options, (proxyRes) => {
    // Forward status code and headers
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    
    // Pipe response body
    proxyRes.pipe(clientRes);
    
    proxyRes.on('end', () => {
      const duration = Date.now() - startTime;
      console.log(`[${clientReq.method}] ${clientReq.url} - ${proxyRes.statusCode} (${duration}ms)`);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error for ${clientReq.url}:`, err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        error: 'Bad Gateway',
        message: `Failed to connect to Firewalla: ${err.message}`
      }));
    }
  });

  // Forward request body if present
  if (clientReq.method !== 'GET' && clientReq.method !== 'HEAD') {
    clientReq.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

/**
 * Webhook server - proxies external-dns requests to Firewalla
 */
const webhookServer = http.createServer((req, res) => {
  proxyRequest(req, res, FIREWALLA_PROVIDER_URL);
});

/**
 * Metrics/Health server - provides health and readiness endpoints
 */
const metricsServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Health check endpoint
  if (url.pathname === '/health' || url.pathname === '/healthz') {
    // Proxy to Firewalla health endpoint
    proxyRequest(req, res, FIREWALLA_HEALTH_URL);
    return;
  }
  
  // Readiness check endpoint
  if (url.pathname === '/ready' || url.pathname === '/readyz') {
    // Check if we can reach Firewalla
    const healthCheck = http.get(`${FIREWALLA_HEALTH_URL}/healthz`, (healthRes) => {
      if (healthRes.statusCode === 200) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ready');
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('not ready');
      }
    });
    
    healthCheck.on('error', (err) => {
      console.error('Readiness check failed:', err.message);
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('not ready');
    });
    
    healthCheck.setTimeout(5000, () => {
      healthCheck.destroy();
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('not ready - timeout');
    });
    return;
  }
  
  // Metrics endpoint (basic)
  if (url.pathname === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('# No metrics implemented yet\n');
    return;
  }
  
  // Unknown endpoint
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Start servers
webhookServer.listen(WEBHOOK_PORT, '0.0.0.0', () => {
  console.log(`Webhook proxy listening on port ${WEBHOOK_PORT}`);
});

metricsServer.listen(METRICS_PORT, '0.0.0.0', () => {
  console.log(`Metrics server listening on port ${METRICS_PORT}`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  
  webhookServer.close(() => {
    console.log('Webhook server closed');
    metricsServer.close(() => {
      console.log('Metrics server closed');
      process.exit(0);
    });
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
