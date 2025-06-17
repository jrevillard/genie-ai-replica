require('dotenv').config();
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

// Import services
const authService = require('./services/auth-service');
const UserProfileService = require('./services/user-profile-service');
const AdminDashboardService = require('./services/admin-dashboard-service');
const AnalyticsService = require('./services/analytics-service');
const QueryService = require('./services/query-service');
const chatHistoryService = require('./services/chat-history-service');
const ServiceCategoryService = require('./services/service-category-service');
const SessionService = require('./services/session-service');
const logsService = require('./services/logs-service');
const DatabaseOperationsService = require('./services/database-operations-service');
const WeatherService = require('./services/weather-service');

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

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Disable ETag generation completely
app.disable('etag');

// Remove X-Powered-By header - prevent information leakage
app.disable('x-powered-by');

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
app.use(securityHeaders);

// Enable trust proxy with specific setting
app.set('trust proxy', 1); // Trust the first proxy (Kong)

// CORS middleware with explicit origin
app.use((req, res, next) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', 'https://e2e-82-109.ssdcloudindia.net');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    next();
  } catch (error) {
    logger.error('CORS middleware error:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
    res.status(500).json({ message: 'CORS configuration error' });
  }
});

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
app.use(morgan(':method :url :status :response-time ms - Headers: :req[content-type] :req[user-agent]', {
  stream: {
    write: (message) => {
      logger.info(`HTTP_REQUEST: ${message.trim()}`);
    }
  }
}));

// Block access to sensitive paths
app.use((req, res, next) => {
  try {
    if (req.path.match(/\/\.[^\/]+/) ||
      req.path.includes('/BitKeeper') ||
      req.path.includes('/.git') ||
      req.path.includes('/.env')) {
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

// Swagger definition
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
        url: process.env.API_URL || 'http://localhost:3000/api',
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
            loginName: { type: 'string', description: 'Username for authentication' },
            email: { type: 'string', format: 'email', description: 'User email address' },
            accessToken: { type: 'string', description: 'JWT access token' },
            personalIdentification: {
              type: 'object',
              properties: {
                fullName: { type: 'string' },
                dob: { type: 'string', format: 'date' },
                gender: { type: 'string' },
                nationality: { type: 'string' }
              }
            },
            addressResidency: {
              type: 'object',
              properties: {
                currentAddress: { type: 'string' }
              }
            },
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
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [
      { bearerAuth: [] }
    ],
    tags: [
      {
        name: 'Chat History',
        description: 'Endpoints for managing chat history and conversations'
      },
      {
        name: 'Weather',
        description: 'Endpoints for fetching weather data'
      }
    ]
  },
  apis: ['./routes/*.js']
};

try {
  const swaggerSpec = swaggerJsdoc(swaggerOptions);
  logger.info('Swagger specification generated successfully');
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }'
  }));
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
} catch (error) {
  logger.error('Failed to initialize Swagger:', {
    error: error.message,
    stack: error.stack,
    rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    errorType: error?.constructor?.name || 'Unknown'
  });
}

// Set up a strict CSP policy with relaxed rules
const cspOptions = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "cdn.jsdelivr.net"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'", "data:"],
    connectSrc: ["'self'", "wss://e2e-82-109.ssdcloudindia.net:8090", "https://e2e-82-109.ssdcloudindia.net", "https://api.open-meteo.com", "https://ipapi.co", "https://nominatim.openstreetmap.org"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
  reportOnly: false
};

// Apply helmet with updated CSP
try {
  app.use(helmet({
    contentSecurityPolicy: cspOptions,
    xssFilter: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true
    }
  }));
  logger.info('Helmet middleware applied with CSP');
} catch (error) {
  logger.error('Failed to apply helmet middleware:', {
    error: error.message,
    stack: error.stack,
    rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    errorType: error?.constructor?.name || 'Unknown'
  });
}

// Set up CORS with a specific origin
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'https://e2e-82-109.ssdcloudindia.net',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

try {
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  logger.info('CORS middleware applied');
} catch (error) {
  logger.error('Failed to apply CORS middleware:', {
    error: error.message,
    stack: error.stack,
    rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    errorType: error?.constructor?.name || 'Unknown'
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

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

// Recursive function to format timestamps
function formatTimestamps(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => formatTimestamps(item));
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

// Configure static file serving
try {
  app.use('/Uploads', (req, res, next) => {
    if (req.path === '/' || req.path === '') {
      return res.status(404).json({ message: 'Not Found' });
    }
    next();
  }, express.static(uploadsDir));
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
  app.use(express.static('dist', {
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (path.endsWith('.js') || path.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    }
  }));
  logger.info('Static file serving configured for dist');
} catch (error) {
  logger.error('Failed to configure static file serving for dist:', {
    error: error.message,
    stack: error.stack,
    rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    errorType: error?.constructor?.name || 'Unknown'
  });
}

// Initialize services
async function initializeServices() {
  logger.info('Starting service initialization');
  logger.debug('Logger level:', logger.level || 'unknown');

  // Validate environment variables
  const requiredEnvVars = ['ARANGO_URL', 'ARANGO_DB', 'ARANGO_USERNAME', 'ARANGO_PASSWORD'];
  const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);
  if (missingEnvVars.length > 0) {
    logger.error('Missing required environment variables:', { missing: missingEnvVars });
    throw new Error(`Missing environment variables: ${missingEnvVars.join(', ')}`);
  }

  // Log ArangoDB configuration
  logger.debug('ArangoDB configuration:', {
    ARANGO_URL: process.env.ARANGO_URL,
    ARANGO_DB: process.env.ARANGO_DB,
    ARANGO_USERNAME: process.env.ARANGO_USERNAME,
    ARANGO_PASSWORD: process.env.ARANGO_PASSWORD ? '***' : 'undefined'
  });

  // Pre-initialization connection test
  logger.info('Performing pre-initialization connection test');
  try {
    const defaultConnection = await Promise.race([
      dbService.getConnection('default'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Pre-initialization connection test timed out')), 30000))
    ]);
    logger.info('Pre-initialization connection test successful');

    // Get ArangoDB version
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

  // Import SecurityScanService
  const SecurityScanService = require('./services/security-scan-service');

  // Use singletons and validate
  const serviceMap = {
    authService: { instance: authService, name: 'AuthService' },
    serviceCategoryService: { instance: ServiceCategoryService, name: 'ServiceCategoryService' },
    userProfileService: { instance: UserProfileService, name: 'UserProfileService' },
    adminDashboardService: { instance: AdminDashboardService, name: 'AdminDashboardService' },
    analyticsService: { instance: AnalyticsService, name: 'AnalyticsService' },
    databaseOperationsService: { instance: DatabaseOperationsService, name: 'DatabaseOperationsService' },
    sessionService: { instance: SessionService, name: 'SessionService' },
    queryService: { instance: QueryService, name: 'QueryService' },
    chatHistoryService: { instance: chatHistoryService, name: 'ChatHistoryService' },
    logsService: { instance: logsService, name: 'LogsService' },
    weatherService: { instance: WeatherService, name: 'WeatherService' },
    securityScanService: { instance: SecurityScanService, name: 'SecurityScanService' }
  };

  for (const [key, { instance, name }] of Object.entries(serviceMap)) {
    if (!instance) {
      logger.error(`Service ${name} is undefined`);
      throw new Error(`Service ${name} is undefined`);
    }
    services[key] = instance;
    logger.debug(`${name} singleton loaded`, {
      methods: Object.getOwnPropertyNames(instance.__proto__).filter(m => m !== 'constructor')
    });
  }

  // Validate AdminDashboardService specifically
  if (services.adminDashboardService && typeof services.adminDashboardService.getSystemHealth !== 'function') {
    logger.warn('AdminDashboardService missing getSystemHealth method');
  }

  // Initialize services
  try {
    await services.sessionService.init();
    logger.info('SessionService initialized');
    await services.authService.setSessionService(services.sessionService);
    await services.authService.init();
    logger.info('AuthService initialized');
    await services.serviceCategoryService.init();
    logger.info('ServiceCategoryService initialized');
    await services.userProfileService.init();
    logger.info('UserProfileService initialized');
    await services.adminDashboardService.init();
    logger.info('AdminDashboardService initialized');
    await services.analyticsService.init();
    logger.info('AnalyticsService initialized');
    await services.databaseOperationsService.init();
    logger.info('DatabaseOperationsService initialized');
    await services.queryService.init();
    logger.info('QueryService initialized');
    await services.chatHistoryService.init();
    logger.info('ChatHistoryService initialized');
    await services.logsService.init();
    logger.info('LogsService initialized');
    await services.weatherService.init();
    logger.info('WeatherService initialized');
    services.userProfileService.setSessionService(services.sessionService);
    logger.info('UserProfileService.setSessionService completed');
  } catch (error) {
    logger.error('Service initialization failed:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
    throw error;
  }

  // Set dependencies
  logger.info('Setting service dependencies');
  try {
    if (services.queryService && services.analyticsService) {
      services.queryService.setAnalyticsService(services.analyticsService);
      logger.debug('QueryService.setAnalyticsService completed');
    }
    if (services.queryService && services.chatHistoryService) {
      services.queryService.setChatHistoryService(services.chatHistoryService);
      logger.debug('QueryService.setChatHistoryService completed');
    }
    if (services.chatHistoryService && services.analyticsService) {
      services.chatHistoryService.setAnalyticsService(services.analyticsService);
      logger.debug('ChatHistoryService.setAnalyticsService completed');
    }
    if (services.adminDashboardService && services.logsService) {
      services.adminDashboardService.setLogsService(services.logsService);
      logger.debug('AdminDashboardService.setLogsService completed');
    }
    if (services.adminDashboardService && services.securityScanService) {
      services.adminDashboardService.setSecurityScanService(services.securityScanService);
      logger.debug('AdminDashboardService.setSecurityScanService completed');
    }
    if (services.weatherService && services.analyticsService) {
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
    initialized: Object.keys(services).filter(key => services[key]).length,
    failed: Object.keys(services).filter(key => !services[key]).length
  });

  return services;
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
    res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>');
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

// Start the server
async function startApp() {
  logger.info('Starting application');
  let services;
  try {
    services = await initializeServices();
    logger.info('Services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', {
      error: error.message,
      stack: error.stack,
      rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      errorType: error?.constructor?.name || 'Unknown'
    });
    throw error;
  }

  // Define routes with paths and services
  const routeConfigs = [
    { file: 'user-routes', paths: ['/api/users', '/api/user'], service: services.userProfileService },
    { file: 'query-routes', paths: ['/api/queries', '/api/query'], service: services.queryService },
    { file: 'service-routes', paths: ['/api/services'], service: services.serviceCategoryService },
    { file: 'chat-history-routes', paths: ['/api/chat-history', '/api/chat'], service: services.chatHistoryService },
    { file: 'analytics-routes', paths: ['/api/analytics'], service: services.analyticsService },
    { file: 'session-routes', paths: ['/api/sessions', '/api/session'], service: services.sessionService },
    { file: 'service-category-routes', paths: ['/api/service-categories'], service: services.serviceCategoryService },
    { file: 'auth-routes', paths: ['/api/auth'], service: services.authService },
    { file: 'logger-routes', paths: ['/api/logger'], service: null },
    { file: 'database-operations-routes', paths: ['/api/database'], service: services.databaseOperationsService },
    { file: 'admin-routes', paths: ['/api/admin'], service: services.adminDashboardService, extraService: services.logsService },
    { file: 'weather-routes', paths: ['/api/weather'], service: services.weatherService }
  ];

  // Log route configurations
  logger.info('Route configurations:', {
    routes: routeConfigs.map(config => ({
      file: config.file,
      paths: config.paths,
      service: config.service ? config.service.constructor.name : 'null',
      extraService: config.extraService ? config.extraService.constructor.name : 'null'
    }))
  });

  // Load and mount routes
  for (const config of routeConfigs) {
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
    let routeInstance;
    try {
      logger.debug(`Instantiating route ${config.file} with service: ${config.service ? config.service.constructor.name : 'null'}`);
      if (config.file === 'analytics-routes') {
        const AnalyticsController = require('./controllers/analyticsController');
        const analyticsController = new AnalyticsController(config.service);
        routeInstance = routeModule(config.service, analyticsController);
      } else if (config.file === 'admin-routes') {
        routeInstance = routeModule(config.service, config.extraService);
      } else {
        routeInstance = routeModule(config.service);
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
    for (const path of config.paths) {
      try {
        logger.info(`Mounting ${config.file} at ${path}`);
        app.use(path, routeInstance);
        logger.info(`${config.file.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Module: LOADED`);
        logger.debug(`Route ${config.file} mounted at ${path} with service: ${config.service ? config.service.constructor.name : 'no service'}`);
        logger.info('Total routes in stack:', app._router.stack.length);
      } catch (error) {
        logger.error(`Failed to mount route ${config.file} at ${path}:`, {
          error: error.message,
          stack: error.stack,
          rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          errorType: error?.constructor?.name || 'Unknown'
        });
        console.error(`[ERROR] Failed to mount route ${config.file} at ${path}:`, {
          message: error.message || 'No message',
          stack: error.stack || 'No stack',
          rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          type: error?.constructor?.name || 'Unknown'
        });
        logger.warn(`Skipping ${config.file} at ${path}: route not mounted`);
      }
    }
  }

  // Email verification redirect
  app.get('/verify-email/:token', (req, res) => {
    try {
      logger.debug(`Redirecting to /api/auth/verify-email/${req.params.token}`);
      res.redirect(`/api/auth/verify-email/${req.params.token}`);
    } catch (error) {
      logger.error('Email verification redirect error:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      res.status(500).json({ message: 'Failed to process email verification redirect' });
    }
  });

  // Root route
  app.get('/', (req, res) => {
    try {
      logger.info('Accessed root endpoint');
      res.json({
        message: 'Welcome to the Government Services API',
        apiDocumentation: '/api-docs',
        availableEndpoints: routeConfigs.map(config => config.paths).flat()
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

  // Verification success redirect
  app.get('/verify-email-success', (req, res) => {
    try {
      logger.debug('Serving verify-email-success page');
      res.sendFile(path.join(__dirname, 'dist/index.html'));
    } catch (error) {
      logger.error('Verify email success endpoint error:', {
        error: error.message,
        stack: error.stack,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorType: error?.constructor?.name || 'Unknown'
      });
      res.status(500).json({ message: 'Failed to serve verification success page' });
    }
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
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

  // Start the server
  try {
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`API Documentation available at: http://localhost:${PORT}/api-docs`);
    });
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
});

// Start the application
try {
  startApp();
} catch (error) {
  logger.error('Application startup failed:', {
    error: error.message,
    stack: error.stack,
    rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    errorType: error?.constructor?.name || 'Unknown'
  });
  process.exit(1);
}

module.exports = app;