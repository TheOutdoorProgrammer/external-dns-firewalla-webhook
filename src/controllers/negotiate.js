/**
 * Negotiate endpoint (GET /)
 * Returns domain filter for external-dns
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Handle negotiate request
 */
function negotiate(req, res) {
  const acceptHeader = req.get('Accept');
  
  logger.debug('Negotiate request received', { 
    accept: acceptHeader,
    userAgent: req.get('User-Agent')
  });
  
  // Validate Accept header matches our supported media type
  // External-DNS sends: application/external.dns.webhook+json;version=1
  if (acceptHeader && !acceptHeader.includes(config.contentType)) {
    logger.warn('Unsupported Accept header', { accept: acceptHeader });
    return res.status(406).json({ error: 'Not Acceptable' });
  }
  
  // Return domain filter
  const response = {
    domainFilter: config.domainFilter
  };
  
  // Respond with the EXACT content type from Accept header
  // Must be: application/external.dns.webhook+json;version=1 (no spaces, no charset)
  // Use res.send() instead of res.json() to prevent Express from adding charset
  res.setHeader('Content-Type', config.contentType);
  res.send(JSON.stringify(response));
  
  logger.info('Negotiate response sent', { domainFilterCount: config.domainFilter.length });
}

module.exports = negotiate;
