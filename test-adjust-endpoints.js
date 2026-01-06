#!/usr/bin/env node
/**
 * Test script for adjustEndpoints CNAME support
 */

// Mock logger
const logger = {
  info: () => {},
  warn: () => {},
  debug: () => {}
};

// Mock validator
const validator = {
  isValidEndpoint: (endpoint) => {
    // Simple validation - just check required fields exist
    return endpoint && endpoint.dnsName && endpoint.targets && endpoint.recordType;
  }
};

// Mock config
const config = {
  contentType: 'application/external.dns.webhook+json;version=1'
};

// Mock express objects
const mockReq = {
  body: [],
  get: () => null
};

const mockRes = {
  status: function(code) { this.statusCode = code; return this; },
  json: function(data) { this.data = data; return this; },
  setHeader: function() {},
  send: function(data) { this.sentData = data; }
};

// Import and test adjustEndpoints
const adjustEndpoints = require('./src/controllers/adjustEndpoints');

// Test data
const testEndpoints = [
  { dnsName: 'a.example.com', targets: ['1.2.3.4'], recordType: 'A' },
  { dnsName: 'txt.example.com', targets: ['test=value'], recordType: 'TXT' },
  { dnsName: 'cname.example.com', targets: ['target.example.com'], recordType: 'CNAME' },
  { dnsName: 'invalid.example.com', targets: ['1.2.3.4'], recordType: 'AAAA' } // Should be filtered out
];

console.log('Testing adjustEndpoints CNAME support...');

// Mock the request
mockReq.body = testEndpoints;

// Call adjustEndpoints
adjustEndpoints(mockReq, mockRes);

// Parse the response
const response = JSON.parse(mockRes.sentData);
console.log('Original endpoints:', testEndpoints.length);
console.log('Filtered endpoints:', response.length);

console.log('Results:');
response.forEach(endpoint => {
  console.log(`  ${endpoint.recordType}: ${endpoint.dnsName}`);
});

const cnameCount = response.filter(e => e.recordType === 'CNAME').length;
const aCount = response.filter(e => e.recordType === 'A').length;
const txtCount = response.filter(e => e.recordType === 'TXT').length;
const invalidCount = response.filter(e => e.recordType === 'AAAA').length;

console.log(`\nSummary:`);
console.log(`  A records: ${aCount}`);
console.log(`  TXT records: ${txtCount}`);
console.log(`  CNAME records: ${cnameCount}`);
console.log(`  Invalid records: ${invalidCount}`);

if (cnameCount > 0 && invalidCount === 0) {
  console.log('\n✅ SUCCESS: CNAME records are now supported and invalid records are filtered!');
} else {
  console.log('\n❌ FAILURE: CNAME support test failed');
}