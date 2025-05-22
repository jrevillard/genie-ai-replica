const rateLimit = require('express-rate-limit');
const { logger } = require('shared-lib');
const validator = require('validator');
const geoip = require('geoip-lite');

class SecurityMiddleware {
  static threatPatterns = {
    sqlInjection: [
      /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
      /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
      /exec(\s|\+)+(s|x)p\w+/i,
      /UNION(\s|\+)+(ALL|SELECT)/i,
      /(\bSELECT\b.*\bFROM\b)/i,
      /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i,
      /(\%3C)|(%)|(\\)|(=)/i,
      /\b(OR|AND)\s+1\s*=\s*1/i
    ],
    commandInjection: [
      /(cmd|command)=|(\bls\b|\bcat\b)/i,
      /\b(start-sleep|sleep)\b/i,
      /(\%3B|\;)(.*)/i,
      /`|\$\(/,
      /(\bwget\b|\bcurl\b|\bnc\b)/i
    ],
    crossSiteScripting: [
      /(\%3Cscript)|(script)/i,
      /<\s*script\b[^>]*>(.*?)<\s*\/\s*script\s*>/i,
      /javascript:/i,
      /onerror\s*=/i,
      /onload\s*=/i,
      /\beval\b/i
    ],
    serverSideInclusion: [
      /<!--#(exec|include)/i,
      /\%3E\%3C\%21--%23/i
    ],
    pathTraversal: [
      /(\.\.[\/\\])+/i,
      /(%2e%2e[\/\\])+/i,
      /\b(etc\/passwd|\/root\/)\b/i
    ]
  };

  static ipReputation = new Map();

  static apiLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 30 minutes
    max: 1000, // Allow 1000 requests per IP
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

  static chatApiLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 30 minutes
    max: 2000, // Allow 2000 requests per IP
    standardHeaders: true,
    message: 'Too many requests to chat endpoints, please try again later.',
    handler: (req, res, next, options) => {
      SecurityMiddleware.logSecurityEvent('Chat Rate Limit Exceeded', {
        type: 'chat_rate_limit',
        ip: req.ip,
        path: req.path,
        headers: req.headers,
        userAgent: req.headers['user-agent']
      });
      res.status(options.statusCode).send(options.message);
    }
  });

  static threatDetectionMiddleware(req, res, next) {
    const allInputs = {
      ...req.query,
      ...req.body,
      path: req.path
    };

    const threatChecks = [
      { type: 'sqlInjection', patterns: SecurityMiddleware.threatPatterns.sqlInjection },
      { type: 'commandInjection', patterns: SecurityMiddleware.threatPatterns.commandInjection },
      { type: 'crossSiteScripting', patterns: SecurityMiddleware.threatPatterns.crossSiteScripting },
      { type: 'serverSideInclusion', patterns: SecurityMiddleware.threatPatterns.serverSideInclusion },
      { type: 'pathTraversal', patterns: SecurityMiddleware.threatPatterns.pathTraversal }
    ];

    const detectedThreats = SecurityMiddleware.detectThreats(allInputs, threatChecks);

    if (detectedThreats.length > 0) {
      SecurityMiddleware.handleThreatDetection(req, detectedThreats);
      return res.status(403).json({ 
        message: 'Potential security threat detected', 
        threats: detectedThreats 
      });
    }

    SecurityMiddleware.updateIPReputation(req);
    
    next();
  }

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

    SecurityMiddleware.blockIP(req.ip);
  }

  static updateIPReputation(req) {
    const ip = req.ip;
    const reputation = SecurityMiddleware.ipReputation.get(ip) || { 
      score: 0, 
      lastSeen: Date.now() 
    };

    const timeSinceLastSeen = Date.now() - reputation.lastSeen;
    reputation.score = Math.max(0, reputation.score - Math.floor(timeSinceLastSeen / (1000 * 60 * 60)));

    SecurityMiddleware.ipReputation.set(ip, {
      score: reputation.score + 1,
      lastSeen: Date.now()
    });

    if (reputation.score > 10) {
      SecurityMiddleware.blockIP(ip);
    }
  }

  static blockIP(ip) {
    logger.warn('IP Blocked', { 
      ip, 
      reason: 'High threat score' 
    });
  }

  static logSecurityEvent(eventName, eventDetails) {
    logger.warn(eventName, eventDetails);
  }

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

  static applySecurityMiddleware(app) {
    app.use('/api/chat', SecurityMiddleware.chatApiLimiter);
    app.use('/api/', SecurityMiddleware.apiLimiter);
    app.use(SecurityMiddleware.threatDetectionMiddleware.bind(SecurityMiddleware));
    app.use(SecurityMiddleware.authFailureLogger);
    app.use((req, res, next) => {
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