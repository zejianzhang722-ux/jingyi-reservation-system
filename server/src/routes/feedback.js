var express = require('express')
var router = express.Router()
var feedbackController = require('../controllers/feedbackController')
var authMiddleware = require('../middleware/auth')

router.post('/', authMiddleware.auth, feedbackController.create)
router.get('/', authMiddleware.auth, authMiddleware.requireAdmin, feedbackController.list)
router.put('/:id/resolve', authMiddleware.auth, authMiddleware.requireAdmin, feedbackController.resolve)

module.exports = router
