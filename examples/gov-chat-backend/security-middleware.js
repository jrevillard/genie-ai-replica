const rateLimit = require('express-rate-limit');
const { logger } = require('./logger');
const validator = require('validator');
const geoip = require('geoip-lite');

class SecurityMiddleware {
  // Comprehensive regex patterns for threat detection
  static threatPatterns = {
    // SQL Injection Patterns
    sqlInjection: [
      // Classic SQL injection attempts
      /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
      /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
      /exec(\s|\+)+(s|x)p\w+/i,
      /UNION(\s|\+)+(ALL|SELECT)/i,
      
      // Advanced SQL injection patterns
      /(\bSELECT\b.*\bFROM\b)/i,
      /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i,
      /(\%3C)|(%)|(\\)|(=)/i,
      /\b(OR|AND)\s+1\s*=\s*1/i
    ],

    // Command Injection Patterns
    commandInjection: [
      /(cmd|command)=|(\bls\b|\bcat\b)/i,
      /\b(start-sleep|sleep)\b/i,
      /(\%3B|\;)(.*)/i,  // Semicolon-based command chaining
      /`|\$\(/,  // Shell command substitution
      /(\bwget\b|\bcurl\b|\bnc\b)/i  // Common download/network tools
    ],

    // XSS Patterns
    crossSiteScripting: [
      /(\%3Cscript)|(script)/i,
      /<\s*script\b[^>]*>(.*?)<\s*\/\s*script\s*>/i,
      /javascript:/i,
      /onerror\s*=/i,
      /onload\s*=/i,
      /\beval\b/i
    ],

    // Server-Side Include (SSI) Injection
    serverSideInclusion: [
      /<!--#(exec|include)/i,
      /\%3E\%3C\%21--%23/i  // Encoded SSI trigger
    ],

    // Path Traversal
    pathTraversal: [
      /(\.\.[\/\\])+/i,  // ../../../ with case-insensitive flag
      /(%2e%2e[\/\\])+/i,  // Encoded ../
      /\b(etc\/passwd|\/root\/)\b/i  // Sensitive file/directory checks
    ]
  };

  // IP Reputation Tracking
  static ipReputation = new Map();

  // Rate Limiting Configuration
  static apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    message: 'Too many requests, please try again later.',
    handler: (req, res, next, options) => {
      SecurityMiddleware.logSecurityEvent('Rate Limit Exceeded', {
        type: 'rate_limit',
        ip: req.ip,
        path: req.path,
        headers: req.headers,
        userAgent: req.headers['user-agent']
      });
      res.status(options.statusCode).send(options.message);
    }
  });

  // Comprehensive Threat Detection Middleware
  static threatDetectionMiddleware(req, res, next) {
    // Combine all inputs for comprehensive checking
    const allInputs = {
      ...req.query,
      ...req.body,
      path: req.path
    };

    // Check for various injection attempts
    const threatChecks = [
      { type: 'sqlInjection', patterns: SecurityMiddleware.threatPatterns.sqlInjection },
      { type: 'commandInjection', patterns: SecurityMiddleware.threatPatterns.commandInjection },
      { type: 'crossSiteScripting', patterns: SecurityMiddleware.threatPatterns.crossSiteScripting },
      { type: 'serverSideInclusion', patterns: SecurityMiddleware.threatPatterns.serverSideInclusion },
      { type: 'pathTraversal', patterns: SecurityMiddleware.threatPatterns.pathTraversal }
    ];

    // Perform threat detection
    const detectedThreats = SecurityMiddleware.detectThreats(allInputs, threatChecks);

    if (detectedThreats.length > 0) {
      SecurityMiddleware.handleThreatDetection(req, detectedThreats);
      return res.status(403).json({ 
        message: 'Potential security threat detected', 
        threats: detectedThreats 
      });
    }

    // IP Reputation and Geoblocking
    SecurityMiddleware.updateIPReputation(req);
    
    next();
  }

  // Detect Threats in Inputs
  static detectThreats(inputs, threatChecks) {
    const detectedThreats = [];

    Object.entries(inputs).forEach(([key, value]) => {
      threatChecks.forEach(({ type, patterns }) => {
        if (typeof value === 'string') {
          patterns.forEach(pattern => {
            if (pattern.test(value)) {
              detectedThreats.push({
                type,
                key,
                value,
                pattern: pattern.toString()
              });
            }
          });
        }
      });
    });

    return detectedThreats;
  }

  // Handle Detected Threats
  static handleThreatDetection(req, detectedThreats) {
    const geoInfo = geoip.lookup(req.ip);

    SecurityMiddleware.logSecurityEvent('Threat Detection', {
      type: 'threat_detected',
      ip: req.ip,
      geo: geoInfo ? {
        country: geoInfo.country,
        city: geoInfo.city,
        region: geoInfo.region
      } : null,
      path: req.path,
      method: req.method,
      threats: detectedThreats,
      headers: req.headers,
      userAgent: req.headers['user-agent']
    });

    // Optional: Block IP temporarily
    SecurityMiddleware.blockIP(req.ip);
  }

  // Update IP Reputation
  static updateIPReputation(req) {
    const ip = req.ip;
    const reputation = SecurityMiddleware.ipReputation.get(ip) || { 
      score: 0, 
      lastSeen: Date.now() 
    };

    // Decay reputation over time
    const timeSinceLastSeen = Date.now() - reputation.lastSeen;
    reputation.score = Math.max(0, reputation.score - Math.floor(timeSinceLastSeen / (1000 * 60 * 60)));

    SecurityMiddleware.ipReputation.set(ip, {
      score: reputation.score + 1,
      lastSeen: Date.now()
    });

    // Block IPs with high threat score
    if (reputation.score > 10) {
      SecurityMiddleware.blockIP(ip);
    }
  }

  // Block IP Temporarily
  static blockIP(ip) {
    logger.warn('IP Blocked', { 
      ip, 
      reason: 'High threat score' 
    });
    // Implement actual IP blocking mechanism here
    // Could integrate with firewall, iptables, etc.
  }

  // Logging Security Events
  static logSecurityEvent(eventName, eventDetails) {
    logger.warn(eventName, eventDetails);
  }

  // Authentication Failure Logging
  static authFailureLogger(req, res, next) {
    const originalEnd = res.end;
    
    res.end = function(chunk, encoding) {
      if (res.statusCode === 401 || res.statusCode === 403) {
        SecurityMiddleware.logSecurityEvent(`Authentication Failure - ${res.statusCode}`, {
          ip: req.ip,
          path: req.path,
          method: req.method,
          headers: req.headers,
          userAgent: req.headers['user-agent']
        });
      }
      return originalEnd.call(this, chunk, encoding);
    };
    next();
  }

  // Apply Security Middleware
  static applySecurityMiddleware(app) {
    // Rate Limiting
    app.use('/api/', SecurityMiddleware.apiLimiter);

    // Threat Detection
    app.use(SecurityMiddleware.threatDetectionMiddleware.bind(SecurityMiddleware));

    // Authentication Failure Logging
    app.use(SecurityMiddleware.authFailureLogger);

    // Input Sanitization
    app.use((req, res, next) => {
      // Sanitize inputs
      Object.keys(req.query).forEach(key => {
        req.query[key] = validator.escape(req.query[key]);
      });

      if (req.body) {
        Object.keys(req.body).forEach(key => {
          req.body[key] = validator.escape(req.body[key]);
        });
      }

      next();
    });
  }
}

module.exports = SecurityMiddleware;