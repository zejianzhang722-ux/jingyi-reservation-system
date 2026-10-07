const response = require('../utils/response');
const rulesText = require('../services/reservationRulesText');
const getRules = async function(req, res) {
  return response.success(res, { content: rulesText.getRules(req.query.type || '') });
};
module.exports = { getRules };
