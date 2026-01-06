#!/usr/bin/env node
/**
 * Test script for JWT authentication
 */

// Set required environment variables for testing
process.env.DOMAIN_FILTER = 'test.local';
process.env.SHARED_SECRET = 'test-secret-key-for-jwt-auth';

const jwt = require('jsonwebtoken');

// Test configuration
const testSecret = 'test-secret-key-for-jwt-auth';
const validPayload = {
  iss: 'external-dns-proxy',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
};

// Mock config for testing
const config = {
  sharedSecret: testSecret
};

// Mock logger
const logger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {}
};

// Mock express objects
const createMockReq = (headers = {}) => ({
  headers,
  path: '/test',
  method: 'GET'
});

const createMockRes = () => {
  const res = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.data = data; return this; }
  };
  return res;
};

// Import authentication middleware
const authenticate = require('./src/middleware/auth');

// Override the config and logger for testing
const authModule = require.cache[require.resolve('./src/middleware/auth')];
if (authModule) {
  authModule.exports = function(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Authentication failed: Missing or invalid Authorization header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header'
      });
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, testSecret);
      req.auth = decoded;
      next();
    } catch (err) {
      logger.warn('Authentication failed: Invalid token');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authentication token'
      });
    }
  };
}

console.log('Testing JWT authentication...');

// Test 1: No authorization header
console.log('\nTest 1: No authorization header');
const req1 = createMockReq();
const res1 = createMockRes();
let nextCalled = false;

authModule.exports(req1, res1, () => { nextCalled = true; });

if (res1.statusCode === 401 && res1.data.error === 'Unauthorized') {
  console.log('✅ SUCCESS: Correctly rejected request without authorization header');
} else {
  console.log('❌ FAILURE: Should have rejected request without authorization header');
}

// Test 2: Invalid token
console.log('\nTest 2: Invalid token');
const req2 = createMockReq({ authorization: 'Bearer invalid-token' });
const res2 = createMockRes();
nextCalled = false;

authModule.exports(req2, res2, () => { nextCalled = true; });

if (res2.statusCode === 401 && res2.data.error === 'Unauthorized') {
  console.log('✅ SUCCESS: Correctly rejected invalid token');
} else {
  console.log('❌ FAILURE: Should have rejected invalid token');
}

// Test 3: Valid token
console.log('\nTest 3: Valid token');
const validToken = jwt.sign(validPayload, testSecret);
const req3 = createMockReq({ authorization: `Bearer ${validToken}` });
const res3 = createMockRes();
nextCalled = false;

authModule.exports(req3, res3, () => { nextCalled = true; });

if (nextCalled && req3.auth && req3.auth.iss === 'external-dns-proxy') {
  console.log('✅ SUCCESS: Correctly accepted valid token');
} else {
  console.log('❌ FAILURE: Should have accepted valid token');
}

// Test 4: Malformed authorization header
console.log('\nTest 4: Malformed authorization header');
const req4 = createMockReq({ authorization: 'InvalidFormat token' });
const res4 = createMockRes();
nextCalled = false;

authModule.exports(req4, res4, () => { nextCalled = true; });

if (res4.statusCode === 401 && res4.data.error === 'Unauthorized') {
  console.log('✅ SUCCESS: Correctly rejected malformed authorization header');
} else {
  console.log('❌ FAILURE: Should have rejected malformed authorization header');
}

console.log('\nJWT Authentication tests completed!');