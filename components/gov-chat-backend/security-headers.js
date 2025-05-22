// security-headers.js - Dedicated middleware for security headers
const { logger } = require('shared-lib');

/**
 * Middleware that adds comprehensive security headers to all responses
 */
const securityHeaders = (req, res, next) => {
  // Set Content-Security-Policy with safe defaults and without unsafe directives
  res.set('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' cdn.jsdelivr.net; " + // Remove unsafe-inline and unsafe-eval
    "style-src 'self'; " + // Remove unsafe-inline
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "form-action 'self'; " +
    "base-uri 'self'; " +
    "object-src 'none'"
  );

  // Set strict CORS policy (this addresses Cross-Domain Misconfiguration)
  res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'https://e2e-82-109.ssdcloudindia.net');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // X-Content-Type-Options to prevent MIME type sniffing
  res.set('X-Content-Type-Options', 'nosniff');
  
  // X-Frame-Options to prevent clickjacking attacks
  res.set('X-Frame-Options', 'SAMEORIGIN');
  
  // X-XSS-Protection as an additional layer of XSS protection
  res.set('X-XSS-Protection', '1; mode=block');
  
  // HTTP Strict Transport Security
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // Cache control settings
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  // Referrer Policy
  res.set('Referrer-Policy', 'no-referrer-when-downgrade');
  
  // Permissions Policy to limit browser features
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Feature Policy (older version of Permissions-Policy)
  res.set('Feature-Policy', 'camera none; microphone none; geolocation none');

  // Log the request with all its headers for security scanning
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

module.exports = securityHeaders;