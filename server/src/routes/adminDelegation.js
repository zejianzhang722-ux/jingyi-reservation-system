const express = require('express');
const router = express.Router();
const controller = require('../controllers/adminDelegationController');
const { auth, requireAdmin } = require('../middleware/auth');

// 临时授权（R-06）
router.get('/me', auth, requireAdmin, controller.myCapabilities);
router.get('/capabilities', auth, requireAdmin, controller.listCapabilities);
router.post('/capabilities', auth, requireAdmin, controller.grantCapability);
router.delete('/capabilities/:id', auth, requireAdmin, controller.revokeCapability);

// 岗位交接（R-06）
router.get('/handovers', auth, requireAdmin, controller.listHandovers);
router.post('/handovers', auth, requireAdmin, controller.initiateHandover);
router.post('/handovers/:id/accept', auth, requireAdmin, controller.acceptHandover);
router.post('/handovers/:id/revoke', auth, requireAdmin, controller.revokeHandover);

module.exports = router;
