const express = require('express');
const router = express.Router();
const dataReadinessService = require('../services/dataReadinessService');
const operationalHealthService = require('../services/operationalHealthService');
const metricsService = require('../services/metricsService');
const auditTrailService = require('../services/auditTrailService');
const opsAuth = require('../middleware/opsAuth');

const live = function(req, res) {
  return res.json({
    code: 200,
    message: 'success',
    data: {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime())
    }
  });
};

const ready = async function(req, res) {
  const timestamp = new Date().toISOString();
  const production = process.env.NODE_ENV === 'production';
  try {
    const readiness = await dataReadinessService.checkDataReadiness();
    if (!readiness.ready) {
      return res.status(503).json({
        code: 503,
        message: '服务依赖或数据库结构尚未就绪',
        data: production ? { status: 'not_ready', timestamp } : readiness
      });
    }
    return res.json({
      code: 200,
      message: 'success',
      data: production
        ? { status: 'ready', timestamp }
        : { status: 'ready', timestamp, details: readiness }
    });
  } catch (err) {
    return res.status(503).json({
      code: 503,
      message: production ? '服务依赖尚未就绪' : (err.message || '服务依赖尚未就绪'),
      data: production ? { status: 'not_ready', timestamp } : (err.details || null)
    });
  }
};

router.get('/live', live);
router.get('/ready', ready);

router.use(opsAuth.middleware);

router.get('/status', async function(req, res) {
  try {
    const snapshot = await operationalHealthService.collectSnapshot();
    return res.status(snapshot.status === 'critical' ? 503 : 200).json({
      code: snapshot.status === 'critical' ? 503 : 200,
      message: snapshot.status === 'ok' ? 'success' : 'operational_attention_required',
      data: snapshot
    });
  } catch (err) {
    return res.status(503).json({
      code: 503,
      message: '无法收集运维状态',
      data: { requestId: req.requestId, error: process.env.NODE_ENV === 'production' ? undefined : err.message }
    });
  }
});

router.get('/metrics', async function(req, res) {
  try {
    const snapshot = await operationalHealthService.collectSnapshot();
    const text = metricsService.toPrometheus({ gauges: operationalHealthService.prometheusGauges(snapshot) });
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(text);
  } catch (err) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(503).send('jingyi_metrics_collection_error 1\n');
  }
});

router.get('/audit-integrity', async function(req, res) {
  try {
    const result = await auditTrailService.verifyRecent(req.query.limit);
    return res.status(result.valid ? 200 : 503).json({
      code: result.valid ? 200 : 503,
      message: result.valid ? 'success' : 'audit_chain_invalid',
      data: result
    });
  } catch (err) {
    return res.status(503).json({
      code: 503,
      message: '审计链校验失败',
      data: process.env.NODE_ENV === 'production' ? null : { error: err.message }
    });
  }
});

module.exports = router;
module.exports.live = live;
module.exports.ready = ready;
