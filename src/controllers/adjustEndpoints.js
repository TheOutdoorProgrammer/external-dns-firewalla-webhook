/**
 * Adjust endpoints endpoint (POST /adjustendpoints)
 * Filters and adjusts endpoints based on provider capabilities
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
  
  logger.debug('Adjust endpoints request received', { 
    count: (endpoints || []).length,
    accept: acceptHeader
  });
  
  // Validate Accept header
  if (acceptHeader && !acceptHeader.includes(config.contentType)) {
    logger.warn('Unsupported Accept header', { accept: acceptHeader });
    return res.status(406).json({ error: 'Not Acceptable' });
  }
  
  // Validate request body
  if (!Array.isArray(endpoints)) {
    logger.warn('Invalid request body for adjust endpoints');
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  // Filter out unsupported record types
  // We only support A and TXT records
  const filtered = endpoints.filter(endpoint => {
    const supported = SUPPORTED_RECORD_TYPES.has(endpoint.recordType);
    if (!supported) {
      logger.debug('Filtering out unsupported record type', {
        dnsName: endpoint.dnsName,
        recordType: endpoint.recordType
      });
    }
    return supported;
  });
  
  logger.info('Adjust endpoints completed', {
    input: endpoints.length,
    output: filtered.length,
    filtered: endpoints.length - filtered.length
  });
  
  // Set exact content type (no charset) for external-dns webhook protocol
  res.setHeader('Content-Type', config.contentType);
  res.send(JSON.stringify(filtered));
}
  
  // Filter endpoints:
  // 1. Keep only A and TXT record types
  // 2. Remove invalid endpoints
  const adjustedEndpoints = endpoints.filter(endpoint => {
    // Check if valid endpoint structure
    if (!endpoint || typeof endpoint !== 'object') {
      logger.warn('Skipping invalid endpoint (not an object)');
      return false;
    }
    
    // Only support A and TXT records
    const recordType = endpoint.recordType;
    if (recordType !== 'A' && recordType !== 'TXT') {
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
  
  // Set content type for external-dns webhook protocol
  res.setHeader('Content-Type', config.contentType);
  res.json(adjustedEndpoints);
}

module.exports = adjustEndpoints;
