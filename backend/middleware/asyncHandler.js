// Express 4 doesn't catch rejected promises from async route handlers on
// its own - an unhandled rejection here would otherwise either hang the
// request or crash the process. Wrapping every async handler in this
// forwards any thrown/rejected error to the central error handler in
// server.js, which returns a generic 500 without leaking details.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
