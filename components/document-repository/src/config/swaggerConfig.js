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
        // every topology. API_URL's one consumer is the backend's
        // client-generation pin; a value that is not an absolute http(s)
        // URL after normalization (trim, trailing-slash strip) is ignored
        // rather than served as a broken server entry. Keep this
        // normalization in sync with
        // components/gov-chat-backend/swagger-definition.js.
        url: (() => {
          const base = (process.env.API_URL || '').trim().replace(/\/+$/, '');
          return /^https?:\/\/.+/.test(base) ? base : '/';
        })(),
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
