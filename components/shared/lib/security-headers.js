// Security headers are managed by nginx (the TLS termination edge proxy).
// This middleware is kept for backward compatibility but is a no-op.
// Upstream headers are stripped via proxy_hide_header in nginx.
const securityHeaders = (req, res, next) => next();

module.exports = securityHeaders;
