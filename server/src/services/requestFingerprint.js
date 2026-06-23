const crypto = require('crypto');

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ':' + stable(value[key]);
  }).join(',') + '}';
}

function create(payload) {
  return crypto.createHash('sha256').update(stable(payload)).digest('hex');
}

module.exports = { stable, create };
