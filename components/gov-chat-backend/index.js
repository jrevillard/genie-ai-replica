require('dotenv').config();
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || 128; // Increased from default 4 to support high concurrency
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { logger, dbService, securityHeaders, SecurityMiddleware } = require('./shared-lib');
const { keycloakAuthMiddleware } = require('./middleware/keycloak-auth-middleware');

// Validate shared-lib imports
logger.info('Validating shared-lib imports:', {
  logger: typeof logger,
  dbService: typeof dbService,
  securityHeaders: typeof securityHeaders,
  SecurityMiddleware: typeof SecurityMiddleware
});
if (!securityHeaders) {
  logger.error('securityHeaders is undefined');
  throw new Error('securityHeaders is undefined');
}
if (!logger || !dbService || !SecurityMiddleware) {
  logger.error('Critical shared-lib components missing:', {
    logger: !!logger,
    dbService: !!dbService,
    SecurityMiddleware: !!SecurityMiddleware
  });
  throw new Error('Critical shared-lib components missing');
}

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, process.env.UPLOAD_DIR || 'Uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    logger.info(`Created uploads directory: ${uploadsDir}`);
  } else {
    logger.debug(`Uploads directory already exists: ${uploadsDir}`);
  }
} catch (error) {
  logger.error('Failed to create uploads directory:', {
    error: error.message,
    stack: error.stack,
    rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    errorType: error?.constructor?.name || 'Unknown'
  });
}

// Swagger definition (stays at module level for swagger-config.test.js compatibility)
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Government Services API',
      version: '1.0.0',
      description: 'API documentation for Government Services microservices',
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      }
    },
    servers: [
      {
        url: process.env.API_URL || `http://localhost:${process.env.PORT || 3000}/api`,
        description: 'Development server'
      }
    ],
    components: {
      schemas: {
        Event: {
          type: 'object',
          properties: {
            _key: { type: 'string', description: 'Unique identifier' },
            userId: { type: 'string', description: 'ID of the user' },
            eventType: { type: 'string', description: 'Type of event' },
            eventData: { type: 'object', description: 'Additional event data' },
            timestamp: { type: 'string', format: 'date-time', description: 'Event timestamp' }
          }
        },
        Analytics: {
          type: 'object',
          properties: {
            _key: { type: 'string', description: 'Unique identifier' },
            queryCount: { type: 'integer', description: 'Number of queries' },
            feedbackCount: { type: 'integer', description: 'Number of feedback submissions' },
            avgRating: { type: 'number', description: 'Average rating' },
            timestamp: { type: 'string', format: 'date-time', description: 'Analytics timestamp' }
          }
        },
        Query: {
          type: 'object',
          properties: {
            _key: { type: 'string', description: 'Unique identifier' },
            userId: { type: 'string', description: 'ID of the user' },
            sessionId: { type: 'string', description: 'ID of the session' },
            text: { type: 'string', description: 'Query text' },
            isAnswered: { type: 'boolean', description: 'Whether the query has been answered' },
            timestamp: { type: 'string', format: 'date-time', description: 'Query timestamp' },
            categoryId: { type: 'string', description: 'Category ID' },
            feedback: {
              type: 'object',
              properties: {
                rating: { type: 'number' },
                comment: { type: 'string' }
              }
            }
          }
        },
        Session: {
          type: 'object',
          properties: {
            _key: { type: 'string', description: 'Unique identifier' },
            userId: { type: 'string', description: 'ID of the user' },
            startTime: { type: 'string', format: 'date-time', description: 'Session start time' },
            endTime: { type: 'string', format: 'date-time', description: 'Session end time' },
            isActive: { type: 'boolean', description: 'Whether the session is active' },
            deviceInfo: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                browser: { type: 'string' },
                os: { type: 'string' }
              }
            },
            ipAddress: { type: 'string', description: 'Client IP address' }
          }
        },
        User: {
          type: 'object',
          properties: {
            _key: { type: 'string', description: 'Unique identifier' },
            email: { type: 'string', format: 'email', description: 'User email address' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Conversation: {
          type: 'object',
          properties: {
            _key: { type: 'string', description: 'Unique identifier' },
            userId: { type: 'string', description: 'ID of the user who owns the conversation' },
            title: { type: 'string', description: 'Conversation title' },
            categoryId: { type: 'string', description: 'ID of the service category' },
            lastMessage: { type: 'string', description: 'Preview of the last message' },
            created: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
            updated: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
            messageCount: { type: 'integer', description: 'Number of messages in the conversation' },
            isStarred: { type: 'boolean', description: 'Whether the conversation is starred' },
            isArchived: { type: 'boolean', description: 'Whether the conversation is archived' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags associated with the conversation'
            }
          }
        },
        Message: {
          type: 'object',
          properties: {
            _key: { type: 'string', description: 'Unique identifier' },
            conversationId: { type: 'string', description: 'ID of the parent conversation' },
            userId: { type: 'string', description: 'ID of the user who sent or received the message' },
            content: { type: 'string', description: 'Message content' },
            timestamp: { type: 'string', format: 'date-time', description: 'Message timestamp' },
            sender: {
              type: 'string',
              enum: ['user', 'assistant'],
              description: 'Sender type (user or assistant)'
            },
            queryId: { type: 'string', description: 'Optional ID of a related query (for assistant messages)' },
            readStatus: { type: 'boolean', description: 'Whether the message has been read' },
            metadata: {
              type: 'object',
              description: 'Additional message metadata'
            }
          }
        },
        Folder: {
          type: 'object',
          properties: {
            _key: { type: 'string', description: 'Unique identifier' },
            name: { type: 'string', description: 'Folder name' },
            description: { type: 'string', description: 'Folder description' },
            created: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
            updated: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
            isArchived: { type: 'boolean', description: 'Whether the folder is archived' },
            color: { type: 'string', description: 'Color code for the folder' },
            icon: { type: 'string', description: 'Icon identifier for the folder' },
            parentFolderId: { type: 'string', description: 'Parent folder ID (null for root folders)' },
            order: { type: 'integer', description: 'Display order within parent' }
          }
        },
        FolderListResponse: {
          type: 'object',
          properties: {
            folders: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Folder'
              }
            }
          }
        },
        ConversationListResponse: {
          type: 'object',
          properties: {
            conversations: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Conversation'
              }
            },
            total: {
              type: 'integer',
              description: 'Total number of conversations matching the filter criteria'
            },
            offset: {
              type: 'integer',
              description: 'Current offset for pagination'
            },
            limit: {
              type: 'integer',
              description: 'Current limit for pagination'
            }
          }
        },
        MessageListResponse: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Message'
              }
            },
            total: {
              type: 'integer',
              description: 'Total number of messages in the conversation'
            },
            offset: {
              type: 'integer',
              description: 'Current offset for pagination'
            },
            limit: {
              type: 'integer',
              description: 'Current limit for pagination'
            }
          }
        },
        SearchResponse: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  conversation: { $ref: '#/components/schemas/Conversation' },
                  snippet: { type: 'string', description: 'Text snippet containing the search match' },
                  matchType: { type: 'string', description: 'Type of match (title, message, etc.)' }
                }
              }
            },
            total: { type: 'integer', description: 'Total number of matching results' },
            offset: { type: 'integer', description: 'Current offset for pagination' },
            limit: { type: 'integer', description: 'Current limit for pagination' }
          }
        },
        ConversationStats: {
          type: 'object',
          properties: {
            totalConversations: { type: 'integer', description: 'Total number of conversations' },
            totalMessages: { type: 'integer', description: 'Number of messages' },
            avgMessagesPerConversation: { type: 'number', description: 'Average number of messages per conversation' },
            starredCount: { type: 'integer', description: 'Number of starred conversations' },
            archivedCount: { type: 'integer', description: 'Number of archived conversations' },
            conversationsByCategory: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  categoryId: { type: 'string', description: 'Category ID' },
                  count: { type: 'integer', description: 'Number of conversations in this category' }
                }
              }
            },
            messagesByType: {
              type: 'object',
              properties: {
                user: { type: 'integer', description: 'Number of user messages' },
                assistant: { type: 'integer', description: 'Number of assistant messages' }
              }
            }
          }
        }
      },
      securitySchemes: {
        KeycloakOAuth2: {
          type: 'oauth2',
          description: 'Keycloak OAuth2 authentication (Authorization Code + PKCE)',
          flows: {
            authorizationCode: {
              authorizationUrl: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/auth`,
              tokenUrl: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
              scopes: {
                openid: 'OpenID Connect scope',
                profile: 'User profile information',
                email: 'User email address'
              }
            }
          }
        }
      }
    },
    security: [{ KeycloakOAuth2: ['openid', 'profile'] }],
    tags: [
      {
        name: 'Chat History',
        description: 'Endpoints for managing chat history and conversations'
      },
      {
        name: 'Weather',
        description: 'Endpoints for fetching weather data'
      },
      {
        name: 'Translation',
        description: 'On-the-fly text translation endpoints'
      }
    ]
  },
  apis: ['./routes/*.js']
};

// Generate swagger spec at module level (for swagger-config.test.js compatibility)
let swaggerSpec;
try {
  swaggerSpec = swaggerJsdoc(swaggerOptions);
  logger.info('Swagger specification generated successfully');
} catch (error) {
  logger.error('Failed to generate Swagger spec:', {
    error: error.message,
    stack: error.stack,
    rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    errorType: error?.constructor?.name || 'Unknown'
  });
}

// Swagger UI setup options (called at module level for swagger-config.test.js compatibility)
const swaggerUiSetupOptions = {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    oauth: {
      clientId: process.env.KEYCLOAK_CLIENT_ID,
      usePkceWithAuthorizationCodeGrant: true,
      scopes: 'openid profile email'
    }
  }
};

// Trigger swaggerUi.setup at module level so swagger-config.test.js captures the options
let swaggerUiMiddleware;
if (swaggerSpec) {
  try {
    swaggerUiMiddleware = swaggerUi.setup(swaggerSpec, swaggerUiSetupOptions);
  } catch (error) {
    logger.error('Failed to setup Swagger UI:', {
      error: error.message,
      stack: error.stack
    });
  }
}

// --- CSP configuration ---
const connectSrcUrls = (
  process.env.CSP_CONNECT_SRC || `'self' http://localhost:3000 ws://localhost:3000 ${process.env.KEYCLOAK_URL}`
).split(' ');

const cspOptions = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'cdn.jsdelivr.net'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'", 'data:', 'https://cdnjs.cloudflare.com'],
    connectSrc: connectSrcUrls,
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"]
  },
  reportOnly: false
};

// --- CORS configuration ---
const allowlist = (process.env.CORS_ALLOWED_ORIGINS || '').split(',');
logger.debug('CORS allowlist configured:', { allowlist });
console.log('allowlist:' + allowlist);

const corsOptions = {
  origin: function (origin, callback) {
    logger.debug('--- CORS CHECK ---', {
      'Request Origin': origin || 'No Origin (e.g., Postman, server-to-server)'
    });

    if (!origin) {
      logger.debug('CORS Allowed: No origin provided.');
      return callback(null, true);
    }

    const isAllowed = allowlist.some((allowedOrigin) => {
      if (allowedOrigin.startsWith('/') && allowedOrigin.endsWith('/')) {
        const regex = new RegExp(allowedOrigin.slice(1, -1));
        return regex.test(origin);
      }
      return origin === allowedOrigin;
    });

    if (isAllowed) {
      logger.debug(`CORS Allowed: Origin "${origin}" is in the allowlist.`);
      callback(null, true);
    } else {
      logger.error(`CORS Denied: Origin "${origin}" is NOT in the allowlist.`);
      callback(new Error(`This origin (${origin}) is not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 204
};

// Recursive function to format timestamps
function formatTimestamps(obj) {
  if (Array.isArray(obj)) {
    return obj.map((item) => formatTimestamps(item));
  }
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === 'number' && /^\d{10}$/.test(obj[key].toString())) {
        obj[key] = new Date(obj[key] * 1000).toISOString();
      } else if (typeof obj[key] === 'object') {
        obj[key] = formatTimestamps(obj[key]);
      }
    }
  }
  return obj;
}

// Route configuration constants (service names used for route injection)
const ROUTE_CONFIGS = [
  { file: 'user-routes', paths: ['/api/me'], serviceName: 'userProfileService', keycloakAuth: true },
  { file: 'query-routes', paths: ['/api/queries', '/api/query'], serviceName: 'queryService', keycloakAuth: true },
  { file: 'service-routes', paths: ['/api/services'], serviceName: 'serviceCategoryService', keycloakAuth: true },
  {
    file: 'chat-history-routes',
    paths: ['/api/chat-history', '/api/chat'],
    serviceName: 'chatHistoryService',
    keycloakAuth: true
  },
  { file: 'analytics-routes', paths: ['/api/analytics'], serviceName: 'analyticsService', keycloakAuth: true },
  {
    file: 'service-category-routes',
    paths: ['/api/service-categories'],
    serviceName: 'serviceCategoryService',
    keycloakAuth: true
  },
  { file: 'auth-routes', paths: ['/api/auth'], serviceName: null },
  { file: 'logger-routes', paths: ['/api/logger'], serviceName: null, keycloakAuth: true },
  {
    file: 'database-operations-routes',
    paths: ['/api/database'],
    serviceName: 'databaseOperationsService',
    keycloakAuth: true
  },
  {
    file: 'admin-routes',
    paths: ['/api/admin'],
    serviceName: 'adminDashboardService',
    extraServiceName: 'logsService',
    keycloakAuth: true
  },
  { file: 'weather-routes', paths: ['/api/weather'], serviceName: 'weatherService', keycloakAuth: true },
  { file: 'translation-routes', paths: ['/api/translate'], serviceName: 'translationService', keycloakAuth: true }
];

/**
 * Creates a configured Express application.
 * @param {Object} [options]
 * @param {Object} [options.services] - Service instances for route injection.
 *   When provided, routes are mounted with these services. Keys must match
 *   ROUTE_CONFIGS serviceName values: userProfileService, queryService,
 *   serviceCategoryService, chatHistoryService, analyticsService, logsService,
 *   databaseOperationsService, adminDashboardService, weatherService, translationService
 * @returns {import('express').Express} Configured Express app (not listening).
 */
function createApp({ services = {} } = {}) {
  const app = express();

  // App config
  app.disable('etag');
  app.disable('x-powered-by');

  // Security headers and trust proxy
  app.use(securityHeaders);
  app.set('trust proxy', 1);

  // Debug middleware for IP and request details
  app.use((req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    logger.debug(`Request IP details:`, {
      ip: ip,
      xForwardedFor: req.headers['x-forwarded-for'],
      realIp: req.headers['x-real-ip'],
      path: req.path,
      method: req.method,
      headers: req.headers
    });
    next();
  });

  // Custom morgan format
  app.use(
    morgan(':method :url :status :response-time ms - Headers: :req[content-type] :req[user-agent]', {
      stream: {
        write: (message) => {
          logger.info(`HTTP_REQUEST: ${message.trim()}`);
        }
      }
    })
  );

  // Block access to sensitive paths
  app.use((req, res, next) => {
    try {
      if (
        req.path.match(/\/\.[^/]+/) ||
        req.path.includes('/BitKeeper') ||
        req.path.includes('/.git') ||
        req.path.includes('/.env')
      ) {
        logger.warn(`SECURITY: Blocked access to sensitive path: ${req.path}`, {
          ip: req.ip,
          method: req.method,
          userAgent: req.get('User-Agent') || 'none'
        });
        return res.status(404).json({ message: 'Not Found' });
      }
      next();
    } catch (error) {
      logger.error('Sensitive path middleware error:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Swagger UI middleware (uses spec generated at module level)
  if (swaggerSpec && swaggerUiMiddleware) {
    app.use('/api-docs', swaggerUi.serve, swaggerUiMiddleware);
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
  }

  // Helmet middleware
  try {
    app.use(
      helmet({
        contentSecurityPolicy: cspOptions,
        xssFilter: true,
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true
        }
      })
    );
    logger.info('Helmet middleware applied with CSP from environment variables');
  } catch (error) {
    logger.error('Failed to apply helmet middleware:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
  }

  // CORS middleware
  try {
    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions));
    logger.info('CORS middleware applied with debugging');
  } catch (error) {
    logger.error('Failed to apply CORS middleware:', {
      error: error.message,
      stack: error.stack
    });
  }

  // Apply security middleware
  try {
    SecurityMiddleware.applySecurityMiddleware(app);
    logger.info('Security middleware applied');
  } catch (error) {
    logger.error('Failed to apply security middleware:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
  }

  // Body parser
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

  // Format timestamps in response data
  app.use((req, res, next) => {
    try {
      const originalJson = res.json;
      res.json = function (body) {
        if (body && typeof body === 'object') {
          body = formatTimestamps(body);
        }
        return originalJson.call(this, body);
      };
      next();
    } catch (error) {
      logger.error('Timestamp formatting middleware error:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      next(error);
    }
  });

  // Configure static file serving for Uploads
  try {
    app.use(
      '/Uploads',
      (req, res, next) => {
        if (req.path === '/' || req.path === '') {
          return res.status(404).json({ message: 'Not Found' });
        }
        next();
      },
      express.static(uploadsDir)
    );
    logger.info('Static file serving configured for Uploads');
  } catch (error) {
    logger.error('Failed to configure static file serving for Uploads:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
  }

  // Secure static serving for frontend files
  try {
    app.use(
      express.static('dist', {
        setHeaders: (res, staticPath) => {
          if (staticPath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (staticPath.endsWith('.js') || staticPath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
          }
        }
      })
    );
    logger.info('Static file serving configured for dist');
  } catch (error) {
    logger.error('Failed to configure static file serving for dist:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
  }

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    try {
      const now = new Date();
      const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);
      res.json({
        status: 'ok',
        serverTime: formattedDate,
        uptime: Math.floor(process.uptime()) + ' seconds'
      });
    } catch (error) {
      logger.error('Health check endpoint error:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      res.status(500).json({ message: 'Health check failed' });
    }
  });

  // Robots.txt handler
  app.get('/robots.txt', (req, res) => {
    try {
      res.type('text/plain');
      res.send('User-agent: *\nDisallow: /api/\nDisallow: /Uploads/');
    } catch (error) {
      logger.error('Robots.txt endpoint error:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      res.status(500).json({ message: 'Failed to serve robots.txt' });
    }
  });

  // Sitemap.xml handler
  app.get('/sitemap.xml', (req, res) => {
    try {
      res.type('application/xml');
      res.send(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>'
      );
    } catch (error) {
      logger.error('Sitemap.xml endpoint error:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      res.status(500).json({ message: 'Failed to serve sitemap.xml' });
    }
  });

  // Route registration (only when services provided)
  if (Object.keys(services).length > 0) {
    registerRoutes(app, services);
  }

  // Root endpoint
  app.get('/', (req, res) => {
    try {
      logger.info('Accessed root endpoint');
      res.json({
        message: 'Welcome to the Government Services API',
        apiDocumentation: '/api-docs',
        availableEndpoints: ROUTE_CONFIGS.map((config) => config.paths).flat()
      });
    } catch (error) {
      logger.error('Root endpoint error:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      res.status(500).json({ message: 'Failed to serve root endpoint' });
    }
  });

  // Error handling middleware
  app.use((err, req, res) => {
    logger.error(`Error processing ${req.method} ${req.url}:`, {
      error: err.message || 'Unknown error',
      stack: err.stack || 'No stack trace',
      rawError: JSON.stringify(err, Object.getOwnPropertyNames(err)),
      errorType: err?.constructor?.name || 'Unknown',
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent') || 'none'
    });
    // Typed errors (AppError subclasses) carry their own status code
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    res.status(500).json({
      message: 'An unexpected error occurred',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  });

  // 404 handler
  app.use((req, res) => {
    logger.warn(`404 Not Found: ${req.method} ${req.url}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent') || 'none'
    });
    res.status(404).json({ message: 'Resource not found' });
  });

  return app;
}

function registerRoutes(app, services) {
  // Log route configurations
  logger.info('Route configurations:', {
    routes: ROUTE_CONFIGS.map((config) => ({
      file: config.file,
      paths: config.paths,
      service: config.serviceName ? (services[config.serviceName] ? 'loaded' : 'missing') : 'null'
    }))
  });

  // Load and mount routes
  for (const config of ROUTE_CONFIGS) {
    const routeFilePath = `./routes/${config.file}.js`;
    logger.info(`Processing route file: ${config.file}`);

    // Check if route file exists
    try {
      if (!fs.existsSync(routeFilePath)) {
        logger.warn(`Route file ${routeFilePath} does not exist, skipping`);
        continue;
      }
      logger.debug(`Route file ${routeFilePath} found`);
    } catch (error) {
      logger.error(`Error checking existence of route file ${routeFilePath}:`, {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      continue;
    }

    // Load route module
    let routeModule;
    try {
      logger.debug(`Attempting to require route file: ${routeFilePath}`);
      console.log(`[DEBUG] Attempting to require route file: ${routeFilePath}`);
      routeModule = require(routeFilePath);
      logger.info(`Route module ${config.file} loaded successfully`);
      console.log(`[INFO] Route module ${config.file} loaded successfully`);
    } catch (error) {
      logger.error(`Failed to load route module ${config.file}:`, {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      console.error(`[ERROR] Failed to load route module ${config.file}:`, {
        message: error.message || 'No message',
        stack: error.stack || 'No stack',
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        type: error?.constructor?.name || 'Unknown'
      });
      logger.warn(`Skipping ${config.file}: route module not loaded`);
      continue;
    }

    // Instantiate route
    const service = config.serviceName ? services[config.serviceName] : null;
    const extraService = config.extraServiceName ? services[config.extraServiceName] : null;

    let routeInstance;
    try {
      logger.debug(
        `Instantiating route ${config.file} with service: ${service ? service.constructor.name : 'null'}`
      );
      if (config.file === 'analytics-routes') {
        const AnalyticsController = require('./controllers/analyticsController');
        const analyticsController = new AnalyticsController(service);
        routeInstance = routeModule(service, analyticsController);
      } else if (config.file === 'admin-routes') {
        routeInstance = routeModule(service, extraService);
      } else if (config.file === 'auth-routes') {
        // auth-routes exports a plain router (no factory function)
        routeInstance = routeModule;
      } else if (config.file === 'logger-routes') {
        routeInstance = routeModule();
      } else {
        routeInstance = routeModule(service);
      }
      if (!routeInstance || typeof routeInstance.use !== 'function') {
        throw new Error(`Route instance for ${config.file} is not a valid Express router`);
      }
      logger.info(`Route instance for ${config.file} created successfully`);
    } catch (error) {
      logger.error(`Failed to instantiate route ${config.file}:`, {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      console.error(`[ERROR] Failed to instantiate route ${config.file}:`, {
        message: error.message || 'No message',
        stack: error.stack || 'No stack',
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        type: error?.constructor?.name || 'Unknown'
      });
      logger.warn(`Skipping ${config.file}: route instance not created`);
      continue;
    }

    // Mount routes
    for (const routePath of config.paths) {
      try {
        logger.info(`Mounting ${config.file} at ${routePath}`);
        if (config.keycloakAuth) {
          app.use(routePath, keycloakAuthMiddleware.authenticate, routeInstance);
        } else {
          app.use(routePath, routeInstance);
        }
        logger.info(`${config.file.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Module: LOADED`);
        logger.debug(
          `Route ${config.file} mounted at ${routePath} with service: ${service ? service.constructor.name : 'no service'}`
        );
        logger.info('Total routes in stack:', app._router.stack.length);
      } catch (error) {
        logger.error(`Failed to mount route ${config.file} at ${routePath}:`, {
          error: error.message,
          stack: error.stack,
          rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          errorType: error?.constructor?.name || 'Unknown'
        });
        console.error(`[ERROR] Failed to mount route ${config.file} at ${routePath}:`, {
          message: error.message || 'No message',
          stack: error.stack || 'No stack',
          rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          type: error?.constructor?.name || 'Unknown'
        });
        logger.warn(`Skipping ${config.file} at ${routePath}: route not mounted`);
      }
    }
  }
}

// Initialize services
async function initializeServices() {
  logger.info('Starting service initialization');
  logger.debug('Logger level:', logger.level || 'unknown');

  // Validate environment variables
  const requiredEnvVars = [
    'ARANGO_URL',
    'ARANGO_DB',
    'ARANGO_USER',
    'ARANGO_PASSWORD',
    'KEYCLOAK_URL',
    'KEYCLOAK_REALM',
    'KEYCLOAK_CLIENT_ID'
  ];
  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
  if (missingEnvVars.length > 0) {
    logger.error('Missing required environment variables:', { missing: missingEnvVars });
    throw new Error(`Missing environment variables: ${missingEnvVars.join(', ')}`);
  }

  // Validate required secrets in production
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    const requiredSecrets = ['TRANSLATION_CACHE_PASSWORD'];
    const missingSecrets = requiredSecrets.filter(
      (key) => !process.env[key] || process.env[key].includes('default') || process.env[key].includes('change')
    );
    if (missingSecrets.length > 0) {
      logger.error('Missing or insecure secrets in production:', { missing: missingSecrets });
      throw new Error(`Production requires secure values for: ${missingSecrets.join(', ')}`);
    }
  }

  // Log ArangoDB configuration
  logger.debug('ArangoDB configuration:', {
    ARANGO_URL: process.env.ARANGO_URL,
    ARANGO_DB: process.env.ARANGO_DB,
    ARANGO_USER: process.env.ARANGO_USER,
    ARANGO_PASSWORD: process.env.ARANGO_PASSWORD ? '***' : 'undefined'
  });

  // Pre-initialization connection test
  logger.info('Performing pre-initialization connection test');
  try {
    const defaultConnection = await Promise.race([
      dbService.getConnection('default'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pre-initialization connection test timed out')), 30000)
      )
    ]);
    logger.info('Pre-initialization connection test successful');

    try {
      const version = await defaultConnection.version();
      logger.debug('ArangoDB version:', { version: version.version, server: version.server });
    } catch (versionError) {
      logger.error('Failed to get ArangoDB version:', {
        error: versionError.message,
        stack: versionError.stack,
        rawError: JSON.stringify(versionError, Object.getOwnPropertyNames(versionError)),
        errorType: versionError?.constructor?.name || 'Unknown'
      });
    }
  } catch (error) {
    logger.error('Pre-initialization connection test failed:', {
      error: error.message || 'Unknown error',
      stack: error.stack || 'No stack trace',
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
    throw error;
  }

  const services = {};

  // Import services individually with error handling
  let userProfileService, adminDashboardService, analyticsService, queryService;
  let chatHistoryService, serviceCategoryService, logsService;
  let databaseOperationsService, weatherService, securityScanService, translationService;

  const importService = async (name, servicePath) => {
    logger.info(`Importing service: ${name}`);
    try {
      const module = require(servicePath);
      logger.debug(`Service ${name} imported successfully`);
      return module;
    } catch (error) {
      logger.error(`Failed to import service ${name}:`, {
        error: error.message || 'Unknown error',
        stack: error.stack || 'No stack trace',
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      throw error;
    }
  };

  try {
    userProfileService = await importService('UserProfileService', './services/user-profile-service');
    adminDashboardService = await importService('AdminDashboardService', './services/admin-dashboard-service');
    analyticsService = await importService('AnalyticsService', './services/analytics-service');
    queryService = await importService('QueryService', './services/query-service');
    chatHistoryService = await importService('ChatHistoryService', './services/chat-history-service');
    serviceCategoryService = await importService('ServiceCategoryService', './services/service-category-service');
    logsService = await importService('LogsService', './services/logs-service');
    databaseOperationsService = await importService(
      'DatabaseOperationsService',
      './services/database-operations-service'
    );
    weatherService = await importService('WeatherService', './services/weather-service');
    securityScanService = await importService('SecurityScanService', './services/security-scan-service');
    translationService = await importService('TranslationService', './services/translation-service');

    // Initialize user provisioning schema (indexes, legacy cleanup)
    const userProvisioningService = require('./services/user-provisioning-service');
    await userProvisioningService.initialize();

    logger.info('Constructing service map');
    const serviceMap = {
      serviceCategoryService: { instance: serviceCategoryService, name: 'ServiceCategoryService' },
      userProfileService: { instance: userProfileService, name: 'UserProfileService' },
      adminDashboardService: { instance: adminDashboardService, name: 'AdminDashboardService' },
      analyticsService: { instance: analyticsService, name: 'AnalyticsService' },
      databaseOperationsService: { instance: databaseOperationsService, name: 'DatabaseOperationsService' },
      queryService: { instance: queryService, name: 'QueryService' },
      chatHistoryService: { instance: chatHistoryService, name: 'ChatHistoryService' },
      logsService: { instance: logsService, name: 'LogsService' },
      weatherService: { instance: weatherService, name: 'WeatherService' },
      securityScanService: { instance: securityScanService, name: 'SecurityScanService' },
      translationService: { instance: translationService, name: 'TranslationService' }
    };

    // Validate services
    logger.info('Validating services');
    for (const [key, { instance, name }] of Object.entries(serviceMap)) {
      try {
        if (!instance) {
          logger.error(`Service ${name} is undefined`);
          throw new Error(`Service ${name} is undefined`);
        }
        services[key] = instance;
        logger.debug(`${name} singleton loaded`, {
          methods: Object.getOwnPropertyNames(instance.__proto__).filter((m) => m !== 'constructor')
        });
      } catch (validationError) {
        logger.error(`Failed to validate service ${name}:`, {
          error: validationError.message || 'Unknown error',
          stack: validationError.stack || 'No stack trace',
          rawError: JSON.stringify(validationError, Object.getOwnPropertyNames(validationError)),
          errorType: validationError?.constructor?.name || 'Unknown'
        });
        throw validationError;
      }
    }

    // Add delay to capture async rejections
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Validate AdminDashboardService specifically
    if (services.adminDashboardService && typeof services.adminDashboardService.getSystemHealth !== 'function') {
      logger.warn('AdminDashboardService missing getSystemHealth method');
    }

    // Initialize services with detailed error logging and optional service handling
    logger.info('Initializing services');
    const initPromises = [
      { service: services.serviceCategoryService, name: 'ServiceCategoryService' },
      { service: services.userProfileService, name: 'UserProfileService' },
      { service: services.adminDashboardService, name: 'AdminDashboardService' },
      { service: services.analyticsService, name: 'AnalyticsService' },
      { service: services.databaseOperationsService, name: 'DatabaseOperationsService' },
      { service: services.queryService, name: 'QueryService' },
      { service: services.chatHistoryService, name: 'ChatHistoryService' },
      { service: services.logsService, name: 'LogsService' },
      // Marked optional: true to prevent boot failure on rate limits
      { service: services.weatherService, name: 'WeatherService', optional: true },
      { service: services.translationService, name: 'TranslationService' }
    ];

    for (const { service, name, preInit, optional } of initPromises) {
      logger.info(`Initializing ${name}`);
      try {
        if (preInit) await preInit();
        if (typeof service.init === 'function') await service.init();
        logger.info(`${name} initialized successfully`);
      } catch (initError) {
        logger.error(`Failed to initialize ${name}:`, {
          error: initError.message || 'Unknown error',
          stack: initError.stack || 'No stack trace',
          rawError: JSON.stringify(initError, Object.getOwnPropertyNames(initError)),
          errorType: initError?.constructor?.name || 'Unknown'
        });

        // If service is optional, log a warning but don't throw
        if (optional) {
          logger.warn(
            `⚠️ Optional service ${name} failed to initialize. Continuing startup without it. Reason: ${initError.message}`
          );
        } else {
          throw initError;
        }
      }
    }

    // Set dependencies
    logger.info('Setting service dependencies');
    try {
      if (
        services.queryService &&
        services.analyticsService &&
        typeof services.queryService.setAnalyticsService === 'function'
      ) {
        services.queryService.setAnalyticsService(services.analyticsService);
        logger.debug('QueryService.setAnalyticsService completed');
      }
      if (
        services.queryService &&
        services.chatHistoryService &&
        typeof services.queryService.setChatHistoryService === 'function'
      ) {
        services.queryService.setChatHistoryService(services.chatHistoryService);
        logger.debug('QueryService.setChatHistoryService completed');
      }
      if (
        services.chatHistoryService &&
        services.analyticsService &&
        typeof services.chatHistoryService.setAnalyticsService === 'function'
      ) {
        services.chatHistoryService.setAnalyticsService(services.analyticsService);
        logger.debug('ChatHistoryService.setAnalyticsService completed');
      }
      if (
        services.adminDashboardService &&
        services.logsService &&
        typeof services.adminDashboardService.setLogsService === 'function'
      ) {
        services.adminDashboardService.setLogsService(services.logsService);
        logger.debug('AdminDashboardService.setLogsService completed');
      }
      if (
        services.adminDashboardService &&
        services.securityScanService &&
        typeof services.adminDashboardService.setSecurityScanService === 'function'
      ) {
        services.adminDashboardService.setSecurityScanService(services.securityScanService);
        logger.debug('AdminDashboardService.setSecurityScanService completed');
      }
      if (
        services.weatherService &&
        services.analyticsService &&
        typeof services.weatherService.setAnalyticsService === 'function'
      ) {
        services.weatherService.setAnalyticsService(services.analyticsService);
        logger.debug('WeatherService.setAnalyticsService completed');
      }
    } catch (error) {
      logger.error('Failed to set service dependencies:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      throw error;
    }

    logger.info('Service initialization completed', {
      initialized: Object.keys(services).filter((key) => services[key]).length,
      failed: Object.keys(services).filter((key) => !services[key]).length
    });

    return services;
  } catch (error) {
    logger.error('Service initialization process failed:', {
      error: error.message || 'Unknown error',
      stack: error.stack || 'No stack trace',
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
    throw error;
  }
}

// Start the server
async function startApp() {
  logger.info('Starting application');
  const services = await initializeServices();
  logger.info('Services initialized successfully');

  const app = createApp({ services });
  const PORT = process.env.PORT || 3000;

  try {
    const server = app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`API Documentation available at: http://localhost:${PORT}/api-docs`);
    });
    // Set server timeout to 1 hour (must match Kong/NGINX streaming timeouts)
    if (typeof server.setTimeout === 'function') {
      server.setTimeout(3600000);
    }
    logger.info(`Server timeout set to 3600 seconds`);
  } catch (error) {
    logger.error('Failed to start server:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
    throw error;
  }
}

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', {
    promise: promise.toString(),
    reason: reason?.message || 'Unknown reason',
    stack: reason?.stack || 'No stack trace',
    rawReason: JSON.stringify(reason, Object.getOwnPropertyNames(reason)),
    errorType: reason?.constructor?.name || 'Unknown'
  });
  process.exit(1);
});

// Auto-start only when run directly
if (require.main === module) {
  startApp().catch((error) => {
    logger.error('Application startup failed:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
    process.exit(1);
  });
}

module.exports = { createApp };
