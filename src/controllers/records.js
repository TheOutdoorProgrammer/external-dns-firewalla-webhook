/**
 * Records endpoints (GET /records and POST /records)
 * Handles fetching and applying DNS records
 */

const dnsmasqService = require('../services/dnsmasq');
const config = require('../config');
const logger = require('../utils/logger');

// Mutex for concurrent request handling
let isUpdating = false;
const updateQueue = [];

/**
 * Get all DNS records (GET /records)
 */
async function getRecords(req, res) {
  const acceptHeader = req.get('Accept');
  
  logger.debug('Get records request received', { accept: acceptHeader });
  
  // Validate Accept header
  if (acceptHeader && !acceptHeader.includes(config.contentType)) {
    logger.warn('Unsupported Accept header', { accept: acceptHeader });
    return res.status(406).json({ error: 'Not Acceptable' });
  }
  
  try {
    const records = await dnsmasqService.getRecords();
    
    // Set exact content type (no charset) for external-dns webhook protocol
    res.setHeader('Content-Type', config.contentType);
    res.send(JSON.stringify(records));
    
    logger.info('Get records response sent', { count: records.length });
    
  } catch (err) {
    logger.error('Failed to get records', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to retrieve DNS records' });
  }
}

/**
 * Apply DNS changes (POST /records)
 */
async function applyChanges(req, res) {
  const changes = req.body;
  
  logger.debug('Apply changes request received', {
    createCount: (changes.create || []).length,
    updateCount: (changes.updateNew || []).length,
    deleteCount: (changes.delete || []).length
  });
  
  // Validate request body
  if (!changes || typeof changes !== 'object') {
    logger.warn('Invalid request body for apply changes');
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  // If already updating, queue this request
  if (isUpdating) {
    logger.debug('Update in progress, queueing request');
    return new Promise((resolve) => {
      updateQueue.push({ changes, resolve, res });
    });
  }
  
  // Mark as updating
  isUpdating = true;
  
  try {
    await dnsmasqService.applyChanges(changes);
    
    // Return 204 No Content on success (per external-dns spec)
    res.status(204).send();
    
    logger.info('Apply changes completed successfully');
    
  } catch (err) {
    logger.error('Failed to apply changes', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to apply DNS changes' });
    
  } finally {
    isUpdating = false;
    
    // Process next queued request if any
    if (updateQueue.length > 0) {
      logger.debug('Processing queued update request', { queueLength: updateQueue.length });
      const next = updateQueue.shift();
      
      // Process the queued request
      setImmediate(async () => {
        if (isUpdating) {
          // Re-queue if still updating (shouldn't happen but safety check)
          updateQueue.unshift(next);
          return;
        }
        
        isUpdating = true;
        try {
          await dnsmasqService.applyChanges(next.changes);
          next.res.status(204).send();
          next.resolve();
        } catch (err) {
          logger.error('Failed to apply queued changes', { error: err.message });
          next.res.status(500).json({ error: 'Failed to apply DNS changes' });
          next.resolve();
        } finally {
          isUpdating = false;
        }
      });
    }
  }
}

module.exports = {
  getRecords,
  applyChanges
};
