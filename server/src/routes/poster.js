const express = require('express');
const router = express.Router();
const posterController = require('../controllers/posterController');
const scopedQueryController = require('../controllers/scopedQueryController');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const optionalAdminScope = require('../middleware/optionalAdminScope');
const { posterRules } = require('../middleware/validator');

router.post('/', auth, posterRules, posterController.create);
router.get('/', auth, optionalAdminScope, scopedQueryController.posters);
router.post('/:id/approve', auth, requireAdmin, adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.approve);
router.post('/:id/reject', auth, requireAdmin, adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.reject);
router.post('/:id/clean', auth, requireAdmin, adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.clean);
router.post('/:id/violation', auth, requireAdmin, adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.violation);

module.exports = router;
