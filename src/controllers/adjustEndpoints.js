/**
 * Adjust endpoints endpoint (POST /adjustendpoints)
 * Filters and adjusts endpoints based on provider capabilities
 * Supports A, TXT, and CNAME record types
 */

const config = require('../config');
const logger = require('../utils/logger');
const validator = require('../utils/validator');

/**
 * Handle adjust endpoints request
 */
function adjustEndpoints(req, res) {
  const endpoints = req.body;
  const acceptHeader = req.get('Accept');
  const contentType = req.get('Content-Type');
  
  // Debug logging to see what we're actually receiving
  logger.info('Adjust endpoints request received', { 
    bodyType: typeof endpoints,
    isArray: Array.isArray(endpoints),
    bodyKeys: endpoints && typeof endpoints === 'object' ? Object.keys(endpoints) : null,
    bodyLength: Array.isArray(endpoints) ? endpoints.length : null,
    contentType: contentType,
    accept: acceptHeader,
    rawBody: JSON.stringify(endpoints).substring(0, 500) // First 500 chars
  });
  
  // Validate Accept header
  if (acceptHeader && !acceptHeader.includes(config.contentType)) {
    logger.warn('Unsupported Accept header', { accept: acceptHeader });
    return res.status(406).json({ error: 'Not Acceptable' });
  }
  
  // Validate input
  if (!Array.isArray(endpoints)) {
    logger.warn('Invalid request body for adjust endpoints (not an array)', {
      bodyType: typeof endpoints,
      bodyContent: JSON.stringify(endpoints)
    });
    return res.status(400).json({ error: 'Request body must be an array of endpoints' });
  }
  
   // Filter endpoints:
   // 1. Keep only A, TXT, and CNAME record types
   // 2. Remove invalid endpoints
   const adjustedEndpoints = endpoints.filter(endpoint => {
     // Check if valid endpoint structure
     if (!endpoint || typeof endpoint !== 'object') {
       logger.warn('Skipping invalid endpoint (not an object)');
       return false;
     }

     // Support A, TXT, and CNAME records (as advertised in README)
     const recordType = endpoint.recordType;
     if (recordType !== 'A' && recordType !== 'TXT' && recordType !== 'CNAME') {
       logger.debug('Filtering out unsupported record type', {
         dnsName: endpoint.dnsName,
         recordType
       });
       return false;
     }
    
    // Validate endpoint structure
    if (!validator.isValidEndpoint(endpoint)) {
      logger.warn('Skipping invalid endpoint', { 
        dnsName: endpoint.dnsName, 
        recordType 
      });
      return false;
    }
    
    return true;
  });
  
  logger.info('Adjusted endpoints', { 
    originalCount: endpoints.length, 
    adjustedCount: adjustedEndpoints.length,
    filteredCount: endpoints.length - adjustedEndpoints.length
  });
  
  // Set exact content type (no charset) for external-dns webhook protocol
  res.setHeader('Content-Type', config.contentType);
  res.send(JSON.stringify(adjustedEndpoints));
}

module.exports = adjustEndpoints;
