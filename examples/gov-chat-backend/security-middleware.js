// security-middleware.js
const rateLimit = require('express-rate-limit');
const { logger } = require('./logger'); // Use your existing logger

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  message: 'Too many requests, please try again later.',
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      headers: req.headers,
      userAgent: req.headers['user-agent']
    });
    res.status(options.statusCode).send(options.message);
  }
});

// Authentication failure logging middleware
const authFailureLogger = (req, res, next) => {
  const originalStatus = res.statusCode;
  const originalEnd = res.end;
  
  res.end = function(chunk, encoding) {
    if (res.statusCode === 401 || res.statusCode === 403) {
      logger.warn(`Authentication failure - ${res.statusCode}`, {
        ip: req.ip,
        path: req.path,
        method: req.method,
        headers: req.headers,
        userAgent: req.headers['user-agent'],
        body: req.body // Be careful with PII
      });
    }
    return originalEnd.call(this, chunk, encoding);
  };
  next();
};

// SQL injection attempt detection
const sqlInjectionDetector = (req, res, next) => {
  const sqlPatterns = [
    /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
    /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
    /exec(\s|\+)+(s|x)p\w+/i,
    /UNION(\s|\+)+(ALL|SELECT)/i
  ];
  
  const checkPart = (part) => {
    if (typeof part !== 'string') return false;
    return sqlPatterns.some(pattern => pattern.test(part));
  };
  
  const hasSuspiciousPattern = Object.values(req.query).some(checkPart) || 
                             (req.body && Object.values(req.body).some(checkPart));
  
  if (hasSuspiciousPattern) {
    logger.warn('Potential SQL injection attempt', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      query: req.query,
      body: req.body
    });
  }
  
  next();
};

// Export configured middleware
module.exports = {
  apiLimiter,
  authFailureLogger,
  sqlInjectionDetector,
  applySecurityMiddleware: (app) => {
    // Note: We don't include helmet here since it's already in your index.js
    app.use('/api/', apiLimiter);
    app.use(authFailureLogger);
    app.use(sqlInjectionDetector);
  }
};