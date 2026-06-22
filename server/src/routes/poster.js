const express = require('express');
const router = express.Router();
const posterController = require('../controllers/posterController');
const { auth, requireAdmin } = require('../middleware/auth');
const { posterRules } = require('../middleware/validator');

router.post('/', auth, posterRules, posterController.create);
router.get('/', auth, posterController.list);
router.post('/:id/approve', auth, requireAdmin, posterController.approve);
router.post('/:id/reject', auth, requireAdmin, posterController.reject);
router.post('/:id/clean', auth, requireAdmin, posterController.clean);
router.post('/:id/violation', auth, requireAdmin, posterController.violation);

module.exports = router;
