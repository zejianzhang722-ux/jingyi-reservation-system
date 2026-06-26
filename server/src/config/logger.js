const winston = require('winston');
const path = require('path');

const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|authorization|cookie|session_key|credential|private[_-]?key)/i;

const redactValue = function(value, depth) {
  const level = Number(depth || 0);
  if (level > 6) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 50).map(function(item) { return redactValue(item, level + 1); });
  if (value && typeof value === 'object' && !(value instanceof Error)) {
    const result = {};
    Object.keys(value).forEach(function(key) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redactValue(value[key], level + 1);
    });
    return result;
  }
  if (typeof value === 'string' && value.length > 4000) return value.slice(0, 4000) + '[truncated]';
  return value;
};

const redactionFormat = winston.format(function(info) {
  Object.keys(info).forEach(function(key) {
    if (SENSITIVE_KEY_PATTERN.test(key)) info[key] = '[redacted]';
    else if (key !== 'stack') info[key] = redactValue(info[key], 0);
  });
  return info;
});

const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactionFormat(),
  winston.format.json()
);

const transports = [
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/error.log'),
    level: 'error',
    maxsize: 5242880,
    maxFiles: 5
  }),
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/combined.log'),
    maxsize: 5242880,
    maxFiles: 5
  })
];

if (process.env.NODE_ENV === 'production') {
  transports.push(new winston.transports.Console({ format: jsonFormat }));
} else {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: jsonFormat,
  defaultMeta: { service: 'jingyi-reservation' },
  transports
});

module.exports = logger;
module.exports.SENSITIVE_KEY_PATTERN = SENSITIVE_KEY_PATTERN;
module.exports.redactValue = redactValue;
