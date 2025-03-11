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

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

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
        User: {
          type: 'object',
          properties: {
            _key: {
              type: 'string',
              description: 'Unique identifier'
            },
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
            createdAt: {
              type: 'string',
              format: 'date-time'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Query: {
          type: 'object',
          properties: {
            _key: {
              type: 'string',
              description: 'Unique identifier'
            },
            userId: { type: 'string' },
            sessionId: { type: 'string' },
            text: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            categoryId: { type: 'string' },
            serviceId: { type: 'string' },
            isAnswered: { type: 'boolean' },
            responseTime: { type: 'number' },
            userFeedback: {
              type: 'object',
              properties: {
                rating: { type: 'number' },
                comment: { type: 'string' },
                providedAt: { type: 'string', format: 'date-time' }
              }
            },
            metadata: {
              type: 'object',
              properties: {
                criteria: { type: 'string' },
                tags: { 
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        },
        Session: {
          type: 'object',
          properties: {
            _key: { type: 'string' },
            userId: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            active: { type: 'boolean' },
            deviceInfo: { type: 'object' },
            ipAddress: { type: 'string' },
            lastActiveTime: { type: 'string', format: 'date-time' }
          }
        },
        Analytics: {
          type: 'object',
          properties: {
            _key: { type: 'string' },
            type: { type: 'string', enum: ['query', 'feedback'] },
            queryId: { type: 'string' },
            userId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            data: { type: 'object' }
          }
        },
        Event: {
          type: 'object',
          properties: {
            _key: { type: 'string' },
            userId: { type: 'string' },
            eventType: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            data: { type: 'object' }
          }
        },
        ServiceCategory: {
          type: 'object',
          properties: {
            _key: { type: 'string' },
            nameEN: { type: 'string' },
            order: { type: 'integer' },
            services: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  },
  apis: ['./routes/*.js'] // Path to the API routes files
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
    },
  },
})); // Security headers with adjustments for Swagger UI
app.use(cors()); // Allow cross-origin requests
app.use(bodyParser.json()); // Parse JSON request bodies
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded request bodies
app.use(morgan('dev')); // HTTP request logging

// Static file serving for uploads
app.use('/uploads', express.static(uploadsDir));

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

// Check if route files exist
const routeFiles = [
  'user-routes', 
  'query-routes', 
  'service-routes', 
  'analytics-routes', 
  'session-routes',
  'service-category-routes' // Add the new route file
];
const availableRoutes = routeFiles.filter(file => fs.existsSync(`./routes/${file}.js`));

// Import available routes
const routes = {};
availableRoutes.forEach(file => {
  routes[file] = require(`./routes/${file}`);
});

// Use available routes
if (routes['user-routes']) app.use('/api/users', routes['user-routes']);
if (routes['query-routes']) app.use('/api/queries', routes['query-routes']);
if (routes['service-routes']) app.use('/api/services', routes['service-routes']);
if (routes['analytics-routes']) app.use('/api/analytics', routes['analytics-routes']);
if (routes['session-routes']) app.use('/api/sessions', routes['session-routes']);
if (routes['service-category-routes']) app.use('/api/service-categories', routes['service-category-routes']);

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to the Government Services API',
    apiDocumentation: '/api-docs',
    availableEndpoints: availableRoutes.map(route => `/api/${route.replace('-routes', '')}`)
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'An unexpected error occurred',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`API Documentation available at: http://localhost:${PORT}/api-docs`);
  console.log(`Available endpoints: ${availableRoutes.map(route => `/api/${route.replace('-routes', '')}`).join(', ')}`);
});

module.exports = app; // For testing