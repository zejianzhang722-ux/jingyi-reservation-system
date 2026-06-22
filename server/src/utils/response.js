const success = function(res, data, message, status) {
  const httpStatus = status || 200;
  return res.status(httpStatus).json({
    code: httpStatus,
    message: message || 'success',
    data: data === undefined ? null : data
  });
};

const error = function(res, message, code, details) {
  const httpStatus = Number(code) || 500;
  const payload = {
    code: httpStatus,
    message: message || '服务器内部错误',
    data: null
  };
  if (details !== undefined && process.env.NODE_ENV !== 'production') {
    payload.details = details;
  }
  return res.status(httpStatus).json(payload);
};

const paginate = function(res, data, total, page, pageSize) {
  const normalizedPage = parseInt(page, 10);
  const normalizedPageSize = parseInt(pageSize, 10);
  return res.status(200).json({
    code: 200,
    message: 'success',
    data: {
      list: data,
      total: total,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalPages: Math.ceil(total / normalizedPageSize)
    }
  });
};

module.exports = { success, error, paginate };
