var express = require('express')
var router = express.Router()
var feedbackController = require('../controllers/feedbackController')
var authMiddleware = require('../middleware/auth')

router.post('/', authMiddleware.auth, feedbackController.create)
router.get('/', authMiddleware.auth, authMiddleware.requireRole('counselor', 'super_admin'), feedbackController.list)
router.put('/:id/resolve', authMiddleware.auth, authMiddleware.requireRole('counselor', 'super_admin'), feedbackController.resolve)

module.exports = router
