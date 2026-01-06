/**
 * Configuration management
 * Loads and validates environment variables
 */

const path = require('path');

// Load .env file if it exists
const envPath = path.join(__dirname, '..', '.env');
try {
  require('fs').accessSync(envPath);
  // Simple env parser for Node 12 compatibility
  const envContent = require('fs').readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
} catch (err) {
  // .env file not found, use environment variables only
}

/**
 * Get required environment variable
 */
function getRequired(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 */
function getOptional(name, defaultValue) {
  return process.env[name] || defaultValue;
}

/**
 * Parse domain filter string to array
 */
function parseDomainFilter(filterString) {
  return filterString
    .split(',')
    .map(d => d.trim())
    .filter(d => d.length > 0);
}

const config = {
  // Required
  domainFilter: parseDomainFilter(getRequired('DOMAIN_FILTER')),
  
  // Optional with defaults
  portProvider: parseInt(getOptional('PORT_PROVIDER', '8888'), 10),
  portHealth: parseInt(getOptional('PORT_HEALTH', '8080'), 10),
  dnsTTL: parseInt(getOptional('DNS_TTL', '300'), 10),
  dnsmasqDir: getOptional('DNSMASQ_DIR', '/home/pi/.firewalla/config/dnsmasq_local'),
  logLevel: getOptional('LOG_LEVEL', 'info'),
  dryRun: getOptional('DRY_RUN', 'false') === 'true',
  
  // Constants
  contentType: 'application/external.dns.webhook+json;version=1',
  restartCommand: 'sudo systemctl restart firerouter_dns'
};

// Validate configuration
if (config.domainFilter.length === 0) {
  throw new Error('DOMAIN_FILTER must contain at least one domain');
}

if (isNaN(config.portProvider) || config.portProvider < 1 || config.portProvider > 65535) {
  throw new Error('PORT_PROVIDER must be a valid port number (1-65535)');
}

if (isNaN(config.portHealth) || config.portHealth < 1 || config.portHealth > 65535) {
  throw new Error('PORT_HEALTH must be a valid port number (1-65535)');
}

if (isNaN(config.dnsTTL) || config.dnsTTL < 0) {
  throw new Error('DNS_TTL must be a non-negative number');
}

const validLogLevels = ['error', 'warn', 'info', 'debug'];
if (!validLogLevels.includes(config.logLevel)) {
  throw new Error(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
}

module.exports = config;
