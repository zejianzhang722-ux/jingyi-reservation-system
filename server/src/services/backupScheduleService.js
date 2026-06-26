const schedule = require('node-schedule');
const logger = require('../config/logger');
const distributedLockService = require('./distributedLockService');
const backupService = require('./backupService');
const dataRetentionService = require('./dataRetentionService');

let jobs = [];

const executeBackup = async function() {
  const result = await distributedLockService.withLock({
    name: 'scheduled-encrypted-backup',
    ttlMs: Math.max(10 * 60 * 1000, Number(process.env.BACKUP_LOCK_TTL_MS || 2 * 60 * 60 * 1000))
  }, function() {
    return backupService.createBackup({ trigger: 'scheduled' });
  });
  if (!result.acquired) return { skipped: true, reason: 'another-instance-running' };
  return result.value;
};

const executeRetention = async function() {
  const result = await distributedLockService.withLock({
    name: 'scheduled-data-retention',
    ttlMs: Math.max(10 * 60 * 1000, Number(process.env.RETENTION_LOCK_TTL_MS || 2 * 60 * 60 * 1000))
  }, function() {
    return dataRetentionService.runRetention({ apply: process.env.DATA_RETENTION_APPLY === 'true' });
  });
  if (!result.acquired) return { skipped: true, reason: 'another-instance-running' };
  return result.value;
};

const start = function(options) {
  if (jobs.length) return { started: true, reused: true, jobs: jobs.length };
  if (process.env.ENABLE_AUTOMATED_BACKUPS !== 'true') {
    return { started: false, reused: false, jobs: 0, reason: 'disabled' };
  }
  const scheduleLib = options && options.scheduleLib ? options.scheduleLib : schedule;
  const definitions = [
    {
      name: 'encrypted-backup',
      cron: process.env.BACKUP_CRON || '30 2 * * *',
      run: executeBackup
    },
    {
      name: 'data-retention',
      cron: process.env.RETENTION_CRON || '15 3 * * 0',
      run: executeRetention
    }
  ];
  jobs = definitions.map(function(definition) {
    return scheduleLib.scheduleJob(definition.cron, function() {
      definition.run().then(function(result) {
        logger.info('backup_schedule_completed', { task: definition.name, result });
      }).catch(function(err) {
        logger.error('backup_schedule_failed', { task: definition.name, error: err.message, code: err.code });
      });
    });
  });
  return { started: true, reused: false, jobs: jobs.length, taskNames: definitions.map(function(item) { return item.name; }) };
};

const stop = function() {
  jobs.forEach(function(job) { if (job && typeof job.cancel === 'function') job.cancel(); });
  jobs = [];
  return { stopped: true };
};

const state = function() {
  return { started: jobs.length > 0, jobs: jobs.length };
};

module.exports = { executeBackup, executeRetention, start, stop, state };
