const path = require('path');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Document Repository API',
      version: '1.0.0',
      description: 'API documentation for the Document Repository service'
    },
    servers: [
      {
        // Relative base: swagger-ui resolves it against the origin the docs
        // are served from, so Try-it-out never targets the browsing user's
        // own machine (the hardcoded localhost default did). API_URL pins an
        // absolute base for external tooling (no /api suffix — the annotated
        // paths already carry it).
        url: process.env.API_URL || '/',
        description: 'API server base'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: [path.join(__dirname, '../routes/fileRoutes.js'), path.join(__dirname, '../routes/labelRoutes.js')]
};

module.exports = swaggerOptions;
