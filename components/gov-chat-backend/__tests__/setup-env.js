'use strict';

process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
process.env.KEYCLOAK_REALM = 'genie';
process.env.KEYCLOAK_CLIENT_ID = 'genie-app';
process.env.PORT = '0';
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.CSP_CONNECT_SRC = "'self' http://localhost:3000 ws://localhost:3000";
process.env.ARANGO_URL = 'http://localhost:8529';
process.env.ARANGO_DB = 'genie';
process.env.ARANGO_USER = 'root';
process.env.ARANGO_PASSWORD = 'testpass';
process.env.UPLOAD_DIR = 'Uploads';
