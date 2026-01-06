/**
 * Adjust endpoints endpoint (POST /adjustendpoints)
 * Filters and adjusts endpoints based on provider capabilities
 */

const config = require('../config');
const logger = require('../utils/logger');
const validator = require('../utils/validator');

/**
 * Adjust endpoints - filter out unsupported record types
 */
function adjustEndpoints(req, res) {
  const endpoints = req.body;
  
  logger.debug('Adjust endpoints request received', { 
    count: Array.isArray(endpoints) ? endpoints.length : 0 
  });
  
  // Validate input
  if (!Array.isArray(endpoints)) {
    logger.warn('Invalid request body for adjust endpoints (not an array)');
    return res.status(400).json({ error: 'Request body must be an array of endpoints' });
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
