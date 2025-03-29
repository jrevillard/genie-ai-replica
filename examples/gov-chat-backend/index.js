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
            loginName: {
              type: 'string',
              description: 'Username for authentication'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address' 
            },
            accessToken: {
              type: 'string',
              description: 'JWT access token'
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
        // ... other schema definitions remain the same
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
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
})); 

app.use(cors({
  origin:true, //Allow all origins
  //origin: ['http://localhost:8090', 'http://localhost:3000'], // for production modify this to protect the services
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials']
}));

app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true })); 
app.use(morgan('dev')); 

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
  'service-category-routes',
  'auth-routes'
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
if (routes['auth-routes']) app.use('/api/auth', routes['auth-routes']);

// Email verification redirect
app.get('/verify-email/:token', (req, res) => {
  res.redirect(`/api/auth/verify-email/${req.params.token}`);
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to the Government Services API',
    apiDocumentation: '/api-docs',
    availableEndpoints: availableRoutes.map(route => `/api/${route.replace('-routes', '')}`)
  });
});

// Verification success redirect
app.get('/verify-email-success', (req, res) => {
  // For SPA, we need to serve the index.html file
  res.sendFile(path.join(__dirname, 'dist/index.html'));
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