const express = require('express');
const router = express.Router();
const rulesController = require('../controllers/rulesController');

router.get('/', rulesController.getRules);

module.exports = router;
