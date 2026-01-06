#!/usr/bin/env node
/**
 * Test script for CNAME record functionality
 */

// Set required environment variables for testing
process.env.DOMAIN_FILTER = 'test.local';
process.env.SHARED_SECRET = 'test-secret';

// Mock config for testing
const config = {
  dnsTTL: 300,
  dryRun: true,
  dnsmasqDir: '/tmp/test-dnsmasq'
};

// Mock logger
const logger = {
  debug: console.log,
  info: console.log,
  warn: console.warn,
  error: console.error
};

// Import validator
const validator = require('./src/utils/validator');

// Test CNAME validation
console.log('Testing CNAME validation...');

// Test valid CNAME endpoint
const validCnameEndpoint = {
  dnsName: 'api.example.com',
  targets: ['service.example.com'],
  recordType: 'CNAME'
};

console.log('Valid CNAME endpoint:', validator.isValidEndpoint(validCnameEndpoint));

// Test invalid CNAME endpoint (invalid target)
const invalidCnameEndpoint = {
  dnsName: 'api.example.com',
  targets: ['invalid..domain'],
  recordType: 'CNAME'
};

console.log('Invalid CNAME endpoint:', validator.isValidEndpoint(invalidCnameEndpoint));

// Test multiple CNAME targets
const multiCnameEndpoint = {
  dnsName: 'api.example.com',
  targets: ['service1.example.com', 'service2.example.com'],
  recordType: 'CNAME'
};

console.log('Multiple CNAME targets:', validator.isValidEndpoint(multiCnameEndpoint));

console.log('CNAME validation tests completed.');