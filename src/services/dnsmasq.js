/**
 * Dnsmasq file management service
 * Handles reading/writing DNS records to dnsmasq configuration files
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const config = require('../config');
const logger = require('../utils/logger');
const validator = require('../utils/validator');

/**
 * Get file path for a DNS record
 */
function getRecordFilePath(dnsName, recordType) {
  const sanitized = validator.sanitizeDomainForFilename(dnsName);
  const suffix = recordType === 'TXT' ? '.txt' : '';
  return path.join(config.dnsmasqDir, sanitized + suffix);
}

/**
 * Read all DNS records from dnsmasq directory
 */
async function getRecords() {
  logger.debug('Reading DNS records from dnsmasq directory', { dir: config.dnsmasqDir });
  
  try {
    // Ensure directory exists
    await fs.mkdir(config.dnsmasqDir, { recursive: true });
    
    // Read all files in directory
    const files = await fs.readdir(config.dnsmasqDir);
    logger.debug('Found files in dnsmasq directory', { count: files.length });
    
    const records = [];
    
    for (const file of files) {
      const filePath = path.join(config.dnsmasqDir, file);
      
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          continue;
        }
        
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        
        // Determine record type based on file extension or content
        const isTxtFile = file.endsWith('.txt');
        
        if (isTxtFile) {
          // Parse TXT records
          const txtTargets = [];
          let dnsName = null;
          
          for (const line of lines) {
            // Format: txt-record=domain,"value"
            const match = line.match(/^txt-record=([^,]+),"(.*)"/);
            if (match) {
              dnsName = match[1];
              txtTargets.push(match[2]);
            }
          }
          
          if (dnsName && txtTargets.length > 0) {
            records.push({
              dnsName: dnsName,
              targets: txtTargets,
              recordType: 'TXT',
              recordTTL: config.dnsTTL
            });
          }
        } else {
          // Parse A records
          const targets = [];
          let dnsName = null;
          
          for (const line of lines) {
            // Format: address=/domain/ip
            const match = line.match(/^address=\/([^\/]+)\/(.+)$/);
            if (match) {
              dnsName = match[1];
              const ip = match[2];
              if (validator.isValidIPv4(ip)) {
                targets.push(ip);
              }
            }
          }
          
          if (dnsName && targets.length > 0) {
            records.push({
              dnsName: dnsName,
              targets: targets,
              recordType: 'A',
              recordTTL: config.dnsTTL
            });
          }
        }
      } catch (err) {
        logger.warn('Failed to parse file', { file, error: err.message });
      }
    }
    
    logger.info('Successfully read DNS records', { count: records.length });
    return records;
    
  } catch (err) {
    logger.error('Failed to read DNS records', { error: err.message, stack: err.stack });
    throw err;
  }
}

/**
 * Write a DNS record to file
 */
async function writeRecord(endpoint) {
  const { dnsName, targets, recordType } = endpoint;
  
  logger.debug('Writing DNS record', { dnsName, recordType, targetCount: targets.length });
  
  if (!validator.isValidEndpoint(endpoint)) {
    throw new Error(`Invalid endpoint: ${dnsName}`);
  }
  
  const filePath = getRecordFilePath(dnsName, recordType);
  
  let content;
  if (recordType === 'A') {
    // Generate dnsmasq A record format
    content = targets.map(ip => `address=/${dnsName}/${ip}`).join('\n') + '\n';
  } else if (recordType === 'TXT') {
    // Generate dnsmasq TXT record format
    content = targets.map(txt => `txt-record=${dnsName},"${txt}"`).join('\n') + '\n';
  } else {
    throw new Error(`Unsupported record type: ${recordType}`);
  }
  
  if (config.dryRun) {
    logger.info('[DRY RUN] Would write file', { filePath, content: content.trim() });
    return;
  }
  
  // Ensure directory exists
  await fs.mkdir(config.dnsmasqDir, { recursive: true });
  
  // Write file
  await fs.writeFile(filePath, content, { mode: 0o644 });
  logger.debug('Successfully wrote DNS record file', { filePath });
}

/**
 * Delete a DNS record file
 */
async function deleteRecord(endpoint) {
  const { dnsName, recordType } = endpoint;
  
  logger.debug('Deleting DNS record', { dnsName, recordType });
  
  const filePath = getRecordFilePath(dnsName, recordType);
  
  if (config.dryRun) {
    logger.info('[DRY RUN] Would delete file', { filePath });
    return;
  }
  
  try {
    await fs.unlink(filePath);
    logger.debug('Successfully deleted DNS record file', { filePath });
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn('DNS record file not found (already deleted?)', { filePath });
    } else {
      throw err;
    }
  }
}

/**
 * Restart firerouter_dns service
 */
async function restartDnsService() {
  logger.info('Restarting firerouter_dns service');
  
  if (config.dryRun) {
    logger.info('[DRY RUN] Would restart service', { command: config.restartCommand });
    return;
  }
  
  try {
    const { stdout, stderr } = await execPromise(config.restartCommand);
    
    if (stdout) {
      logger.debug('Service restart stdout', { stdout: stdout.trim() });
    }
    if (stderr) {
      logger.debug('Service restart stderr', { stderr: stderr.trim() });
    }
    
    logger.info('Successfully restarted firerouter_dns service');
  } catch (err) {
    logger.error('Failed to restart firerouter_dns service', {
      error: err.message,
      code: err.code,
      stderr: err.stderr
    });
    throw new Error('Failed to restart DNS service: ' + err.message);
  }
}

/**
 * Apply DNS changes (create, update, delete)
 * This function implements optimistic updates with service restart
 */
async function applyChanges(changes) {
  const { create, updateOld, updateNew, delete: deleteRecords } = changes;
  
  const createCount = (create || []).length;
  const updateCount = (updateNew || []).length;
  const deleteCount = (deleteRecords || []).length;
  
  logger.info('Applying DNS changes', { createCount, updateCount, deleteCount });
  
  try {
    // Delete records
    if (deleteRecords && deleteRecords.length > 0) {
      logger.debug('Deleting records', { count: deleteRecords.length });
      for (const record of deleteRecords) {
        await deleteRecord(record);
      }
    }
    
    // Update records (delete old, create new)
    if (updateOld && updateNew && updateOld.length > 0) {
      logger.debug('Updating records', { count: updateOld.length });
      for (let i = 0; i < updateOld.length; i++) {
        const oldRecord = updateOld[i];
        const newRecord = updateNew[i];
        
        // Delete old record if DNS name changed
        if (oldRecord.dnsName !== newRecord.dnsName || oldRecord.recordType !== newRecord.recordType) {
          await deleteRecord(oldRecord);
        }
        
        // Create new record
        await writeRecord(newRecord);
      }
    }
    
    // Create records
    if (create && create.length > 0) {
      logger.debug('Creating records', { count: create.length });
      for (const record of create) {
        await writeRecord(record);
      }
    }
    
    // If any changes were made, restart the DNS service
    const totalChanges = createCount + updateCount + deleteCount;
    if (totalChanges > 0) {
      await restartDnsService();
    } else {
      logger.info('No DNS changes to apply');
    }
    
    logger.info('Successfully applied DNS changes');
    
  } catch (err) {
    logger.error('Failed to apply DNS changes', { error: err.message, stack: err.stack });
    throw err;
  }
}

module.exports = {
  getRecords,
  applyChanges
};
