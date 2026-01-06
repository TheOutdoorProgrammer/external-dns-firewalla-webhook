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
  logger.debug('Negotiate request received', { 
    accept: req.get('Accept'),
    userAgent: req.get('User-Agent')
  });
  
  // Return domain filter
  const response = {
    domainFilter: config.domainFilter
  };
  
  // Set content type for external-dns webhook protocol
  res.setHeader('Content-Type', config.contentType);
  res.json(response);
  
  logger.info('Negotiate response sent', { domainFilterCount: config.domainFilter.length });
}

module.exports = negotiate;
