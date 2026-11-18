'use strict';

process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
process.env.KEYCLOAK_REALM = 'genie';
process.env.KEYCLOAK_CLIENT_ID = 'genie-app';
// KEYCLOAK_PUBLIC_URL is the browser-facing alias (unset = disabled). It is
// DELETED, not set: an ambient value in the developer's shell or CI runner
// would otherwise change the served Swagger OAuth2 flow URLs and break
// suites that assert the KEYCLOAK_URL-derived ones.
delete process.env.KEYCLOAK_PUBLIC_URL;
process.env.PORT = '0';
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.CSP_CONNECT_SRC = "'self' http://localhost:3000 ws://localhost:3000";
process.env.ARANGO_URL = 'http://localhost:8529';
process.env.ARANGO_DB = 'genie';
process.env.ARANGO_USER = 'root';
process.env.ARANGO_PASSWORD = 'testpass';
process.env.UPLOAD_DIR = 'Uploads';
