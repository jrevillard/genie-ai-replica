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
        // Default: RELATIVE ('/') — swagger-ui resolves it against the
        // origin the docs are served from, so Try-it-out is same-origin in
        // every topology. API_URL pins an absolute base instead (no /api
        // suffix; trailing slashes are stripped — a raw join would build
        // //api/... URLs).
        url: (process.env.API_URL || '/').replace(/\/+$/, '') || '/',
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
