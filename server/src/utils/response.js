const success = function(res, data, message) {
  return res.json({
    code: 200,
    message: message || 'success',
    data: data || null
  });
};

const error = function(res, message, code) {
  return res.json({
    code: code || 500,
    message: message || '服务器内部错误',
    data: null
  });
};

const paginate = function(res, data, total, page, pageSize) {
  return res.json({
    code: 200,
    message: 'success',
    data: {
      list: data,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      totalPages: Math.ceil(total / pageSize)
    }
  });
};

module.exports = { success, error, paginate };
