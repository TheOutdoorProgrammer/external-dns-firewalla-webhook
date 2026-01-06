/**
 * Simple logging utility
 * Outputs to stdout/stderr for systemd journal capture
 */

const config = require('../config');

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[config.logLevel] || LOG_LEVELS.info;

/**
 * Format log message with timestamp and level
 */
function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
}

/**
 * Log error message
 */
function error(message, meta) {
  if (currentLevel >= LOG_LEVELS.error) {
    console.error(formatMessage('error', message, meta));
  }
}

/**
 * Log warning message
 */
function warn(message, meta) {
  if (currentLevel >= LOG_LEVELS.warn) {
    console.warn(formatMessage('warn', message, meta));
  }
}

/**
 * Log info message
 */
function info(message, meta) {
  if (currentLevel >= LOG_LEVELS.info) {
    console.log(formatMessage('info', message, meta));
  }
}

/**
 * Log debug message
 */
function debug(message, meta) {
  if (currentLevel >= LOG_LEVELS.debug) {
    console.log(formatMessage('debug', message, meta));
  }
}

module.exports = {
  error,
  warn,
  info,
  debug
};
