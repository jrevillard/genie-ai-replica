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
const { logger } = require('./logger'); // Import the centralized logger
const loggerRoutes = require('./routes/logger-routes'); // Import the logger routes
const { applySecurityMiddleware } = require('./security-middleware'); // Import security middleware
const securityHeaders = require('./security-headers'); // Import our new security headers middleware

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Disable ETag generation completely
app.disable('etag');

// Remove X-Powered-By header - prevent information leakage
app.disable('x-powered-by');

// Apply our comprehensive security headers middleware early
app.use(securityHeaders);

// Enable trust proxy
app.set('trust proxy', true);

// CORS middleware with explicit origin instead of wildcard - added for ZAP compliance
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://e2e-82-109.ssdcloudindia.net');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  next();
});

// Custom morgan format that doesn't expose raw timestamps
app.use(morgan(':method :url :status :response-time ms - Headers: :req[content-type] :req[user-agent]', {
  stream: {
    write: (message) => {
      // Log this message in a format the security scanner can parse
      logger.info(`HTTP_REQUEST: ${message.trim()}`);
    }
  }
}));

// Special middleware to block access to hidden files and suspicious requests
app.use((req, res, next) => {
  // Block access to hidden files, BitKeeper, or other sensitive paths
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
        // New schemas for folder functionality
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
            totalMessages: { type: 'integer', description: 'Total number of messages' },
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
      }
    ]
  },
  apis: ['./routes/*.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Set up a strict CSP policy
const cspOptions = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "cdn.jsdelivr.net"], // Removed unsafe-inline and unsafe-eval
    styleSrc: ["'self'"],  // Removed unsafe-inline
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
  reportOnly: false
};

// Apply helmet with strict CSP
app.use(helmet({
  contentSecurityPolicy: cspOptions,
  xssFilter: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true
  }
}));

// Set up CORS with a specific origin, not a wildcard
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'https://e2e-82-109.ssdcloudindia.net',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Apply all security middleware here, after helmet and cors
applySecurityMiddleware(app);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Format timestamps in response data to avoid timestamp disclosure
app.use((req, res, next) => {
  const originalJson = res.json;

  res.json = function (body) {
    // Only process if body is an object
    if (body && typeof body === 'object') {
      body = formatTimestamps(body);
    }
    return originalJson.call(this, body);
  };

  next();
});

// Recursive function to format timestamps
function formatTimestamps(obj) {
  // If array, process each element
  if (Array.isArray(obj)) {
    return obj.map(item => formatTimestamps(item));
  }

  // If not an object or null, return as is
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Process object properties
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      // If property is timestamp-like (10-digit number representing seconds since epoch)
      if (typeof obj[key] === 'number' && /^\d{10}$/.test(obj[key].toString())) {
        // Convert to ISO string format 
        obj[key] = new Date(obj[key] * 1000).toISOString();
      }
      // Process nested objects
      else if (typeof obj[key] === 'object') {
        obj[key] = formatTimestamps(obj[key]);
      }
    }
  }

  return obj;
}

// Configure static file serving with security headers
app.use('/uploads', (req, res, next) => {
  // Prevent directory listing
  if (req.path === '/' || req.path === '') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
}, express.static(uploadsDir));

// Secure static serving for frontend files with security headers
app.use(express.static('dist', {
  setHeaders: (res, path) => {
    // Set appropriate caching for static assets
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
    }
  }
}));

// Serve swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }'
}));

// Serve swagger.json
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Add a health check endpoint
app.get('/api/health', (req, res) => {
  // Use a formatted date string instead of Unix timestamp
  const now = new Date();
  const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);

  res.json({
    status: 'ok',
    serverTime: formattedDate,
    uptime: Math.floor(process.uptime()) + ' seconds'
  });
});

// Robots.txt handler - prevent 404s and security probes
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /api/\nDisallow: /uploads/');
});

// Sitemap.xml handler - prevent 404s and security probes
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>');
});

// Check if route files exist
const routeFiles = [
  'user-routes',
  'query-routes',
  'service-routes',
  'chat-history-routes',
  'analytics-routes',
  'session-routes',
  'service-category-routes',
  'auth-routes',
  'logger-routes',
  'database-operations-routes',
  'admin-routes',
  'security-routes',
  'chat-history-routes' // Add the new chat history routes file
];
const availableRoutes = routeFiles.filter(file => fs.existsSync(`./routes/${file}.js`));

// Import available routes
const routes = {};
availableRoutes.forEach(file => {
  routes[file] = require(`./routes/${file}`);
});

// Use available routes
if (routes['user-routes']) {
  logger.info('Mounting user routes at /api/users');
  app.use('/api/users', routes['user-routes']);
}

if (routes['query-routes']) app.use('/api/queries', routes['query-routes']);
if (routes['service-routes']) app.use('/api/services', routes['service-routes']);
if (routes['chat-history-routes']) app.use('/api/chat', routes['chat-history-routes']);
if (routes['analytics-routes']) app.use('/api/analytics', routes['analytics-routes']);
if (routes['session-routes']) app.use('/api/sessions', routes['session-routes']);
if (routes['service-category-routes']) app.use('/api/service-categories', routes['service-category-routes']);
if (routes['auth-routes']) app.use('/api/auth', routes['auth-routes']);
if (routes['logger-routes']) app.use('/api/logger', routes['logger-routes']);
if (routes['database-operations-routes']) app.use('/api/database', routes['database-operations-routes']);
if (routes['admin-routes']) {
  logger.info('Mounting admin routes at /api/admin');
  app.use('/api/admin', routes['admin-routes']);
}

if (routes['security-routes']) {
  logger.info('Mounting security routes at /api/security');
  app.use('/api/security', routes['security-routes']);
}

// Add chat history routes
if (routes['chat-history-routes']) {
  logger.info('Mounting chat history routes at /api/chat');
  app.use('/api/chat', routes['chat-history-routes']);
}

// Email verification redirect
app.get('/verify-email/:token', (req, res) => {
  res.redirect(`/api/auth/verify-email/${req.params.token}`);
});

// Root route
app.get('/', (req, res) => {
  logger.info('Accessed root endpoint');
  res.json({
    message: 'Welcome to the Government Services API',
    apiDocumentation: '/api-docs',
    availableEndpoints: availableRoutes.map(route => `/api/${route.replace('-routes', '')}`)
  });
});

// Verification success redirect
app.get('/verify-email-success', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/index.html'));
});

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Error processing ${req.method} ${req.url}: ${err.message}`, {
    stack: err.stack,
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

// 404 handler - Must come after all other routes
app.use((req, res) => {
  logger.warn(`404 Not Found: ${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent') || 'none'
  });
  res.status(404).json({ message: 'Resource not found' });
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(`API Documentation available at: http://localhost:${PORT}/api-docs`);
});

module.exports = app; // For testing