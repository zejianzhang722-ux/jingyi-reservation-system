function fail(status, message) {
  const err = new Error(message);
  err.httpStatus = status;
  throw err;
}
module.exports = { fail };
