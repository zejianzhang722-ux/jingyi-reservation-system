const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const { auth } = require('../middleware/auth');

router.get('/', auth, groupController.list);
router.post('/', auth, groupController.create);
router.get('/:id', auth, groupController.detail);
router.post('/:id/join', auth, groupController.join);
router.post('/:id/leave', auth, groupController.leave);

module.exports = router;
