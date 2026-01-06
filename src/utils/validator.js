/**
 * Input validation utilities
 */

/**
 * Validate DNS name
 * Prevents path traversal and ensures valid DNS format
 */
function isValidDnsName(name) {
  if (!name || typeof name !== 'string') {
    return false;
  }
  
  // Prevent path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return false;
  }
  
  // Basic DNS name validation
  // Allows letters, numbers, hyphens, dots, and wildcards
  const dnsRegex = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.?$/;
  return dnsRegex.test(name);
}

/**
 * Validate IP address (IPv4)
 */
function isValidIPv4(ip) {
  if (!ip || typeof ip !== 'string') {
    return false;
  }
  
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return false;
  }
  
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Validate record type
 */
function isValidRecordType(type) {
  const allowedTypes = ['A', 'TXT', 'CNAME'];
  return allowedTypes.includes(type);
}

/**
 * Validate endpoint object structure
 */
function isValidEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'object') {
    return false;
  }
  
  // Required fields
  if (!endpoint.dnsName || !endpoint.recordType) {
    return false;
  }
  
  if (!isValidDnsName(endpoint.dnsName)) {
    return false;
  }
  
  if (!isValidRecordType(endpoint.recordType)) {
    return false;
  }
  
  // Targets must be an array
  if (!Array.isArray(endpoint.targets) || endpoint.targets.length === 0) {
    return false;
  }
  
  // For A records, validate all IPs
  if (endpoint.recordType === 'A') {
    return endpoint.targets.every(isValidIPv4);
  }
  
  // For TXT records, targets are strings (no validation needed beyond non-empty)
  if (endpoint.recordType === 'TXT') {
    return endpoint.targets.every(t => typeof t === 'string' && t.length > 0);
  }

  // For CNAME records, targets must be valid DNS names
  if (endpoint.recordType === 'CNAME') {
    return endpoint.targets.every(isValidDnsName);
  }

  return true;
}

/**
 * Sanitize domain name for use as filename
 */
function sanitizeDomainForFilename(domain) {
  // Remove any path separators and ensure safe filename
  return domain.replace(/[\/\\]/g, '-').replace(/\.\./g, '--');
}

module.exports = {
  isValidDnsName,
  isValidIPv4,
  isValidRecordType,
  isValidEndpoint,
  sanitizeDomainForFilename
};
