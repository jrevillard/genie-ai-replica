console.log('Loading security-headers.js'); // Log to confirm the file is being required
const { logger } = require('./logger');
const securityHeaders = (req, res, next) => {
  res.set('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' cdn.jsdelivr.net; " +
    "style-src 'self'; " +
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "form-action 'self'; " +
    "base-uri 'self'; " +
    "object-src 'none'"
  );
  res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'https://e2e-82-109.ssdcloudindia.net');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Referrer-Policy', 'no-referrer-when-downgrade');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Feature-Policy', 'camera none; microphone none; geolocation none');
  logger.info(`HTTP_SECURE_REQUEST: ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    headers: req.headers,
    remoteAddress: req.ip,
    referrer: req.get('Referrer') || 'none',
    userAgent: req.get('User-Agent') || 'none'
  });
  next();
};
console.log('securityHeaders defined:', typeof securityHeaders); // Log to confirm it’s a function
module.exports = securityHeaders;
