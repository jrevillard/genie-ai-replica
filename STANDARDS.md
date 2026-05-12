# GENIE.AI - Project Coding Standards Specification

## 1\. Introduction

This document defines the coding standards and best practices for the GENIE.AI project. Adhering to these standards is mandatory for all contributors to ensure the codebase remains readable, consistent, and maintainable. The goal is to produce reliable, scalable code that is easy to debug and extend.

This specification covers the full technology stack, including general principles, JavaScript, Vue 3, Node.js (Express), Python, Flutter/Dart, Bash scripting, data formats, internationalization, OPEA patterns, documentation, logging, security, and Docker configurations.

## 2\. Table of Contents

  - [3. General Principles](#3-general-principles)
  - [4. JavaScript (General Standards)](#4-javascript-general-standards)
  - [5. Frontend: Vue 3 Standards](#5-frontend-vue-3-standards)
  - [6. Backend: Node.js & Express Standards](#6-backend-nodejs--express-standards)
  - [7. Backend: Python Standards](#7-backend-python-standards)
  - [8. Mobile: Flutter & Dart Standards](#8-mobile-flutter--dart-standards)
  - [9. Scripting: Bash Standards](#9-scripting-bash-standards)
  - [10. Data & Schema (JSON / ArangoDB)](#10-data--schema-json--arangodb)
  - [11. Internationalization (i18n) System](#11-internationalization-i18n-system)
  - [12. OPEA Integration & RAG Pattern Standards](#12-opea-integration--rag-pattern-standards)
  - [13. Logging Standards](#13-logging-standards)
  - [14. Security Standards](#14-security-standards)
  - [15. Documentation Standards](#15-documentation-standards)
  - [16. DevOps: Docker & Docker Compose Standards](#16-devops-docker--docker-compose-standards)
  - [17. API Documentation Standards](#17-api-documentation-standards)

## 3\. General Principles

  - **Clarity and Simplicity**: Code must be written to be as easy to understand as possible. Prefer clear, straightforward logic over clever, complex one-liners.

  - **Separation of Concerns**: Each script, module, and component should have a single, well-defined responsibility. This is evident in the project's structure, which uses separate scripts for schema creation, data population, and database maintenance.

  - **Configuration over Hardcoding**: Application settings (e.g., database credentials, file paths, API keys) must be managed via environment variables (loaded from a `.env` file) with sensible defaults provided in the code.

  - **Robustness and Safety**: Scripts that perform write operations must be designed to be safe. This includes checking for prerequisites, handling errors gracefully, and asking for user confirmation before proceeding with destructive actions.

## 4\. JavaScript (General Standards)

These standards apply to all JavaScript code, both frontend (Vue) and backend (Node.js).

  - **Linter & Formatter**: ESLint and Prettier must be used to enforce style consistency. A shared configuration should be committed to the repository.

  - **Language Version**: Code should be written in ECMAScript 6 (ES6) or later.

  - **Node.js Version**: Use Node.js version 18.0.0 or higher as specified in package.json `engines` field.

  - **Variables**:

      - Use `const` by default for all variable declarations.
      - Use `let` only for variables that must be reassigned, such as loop counters. Avoid `var`.

  - **Modules**:

      - **Node.js Scripts**: Use the CommonJS module system (`require`, `module.exports`) for consistency with existing scripts.
      - **Vue 3 / Express App**: Use ES Modules (`import`/`export`) for application code.

  - **Style**:

      - **Indentation**: 2 spaces.
      - **Semicolons**: Mandatory.
      - **Quotes**: Single quotes (`'`).
      - **Naming**: `camelCase` for variables and functions; `PascalCase` for classes.

  - **Comments**: Use JSDoc style comments for function documentation:

      ```javascript
      /**
       * Process uploaded files and return metadata
       * @param {Object[]} files - Array of uploaded files
       * @returns {Promise<Object[]>} Array of file metadata objects
       */
      async function processFiles(files) {
        // implementation
      }
      ```

  - **Error Handling**:

      - Use try-catch blocks for asynchronous operations
      - Propagate errors appropriately using `next()` in Express middleware
      - Provide meaningful error messages
      - Log errors with context information

## 5\. Frontend: Vue 3 Standards

  - **Composition API with `<script setup>`**: All new components must use the Composition API with the `<script setup>` syntax for better logic organization, reusability, and TypeScript support.

  - **Component Structure**: Single File Components (`.vue`) must be organized with the following order: `<script setup>`, `<template>`, `<style scoped>`.

  - **Component Naming**: Component files must be named in `PascalCase` (e.g., `ServiceCategoryTree.vue`). When used in templates, they should be self-closing and also in `PascalCase` (e.g., `<ServiceCategoryTree />`).

  - **Props**:

      - Props must be declared using `defineProps` with detailed definitions (type, required, default, validator).
      - Prop names must be `camelCase`.

  - **Events**:

      - Custom event names must be `kebab-case` (e.g., `item-selected`).
      - Events must be declared using `defineEmits`.

  - **State Management**:

      - Use **Vuex** for global state management (currently used in codebase)
      - Store modules should be organized by feature
      - Use actions for async operations, mutations for state changes
      - Consider migrating to **Pinia** for new projects (recommended)

  - **Internationalization**:

      - Use **vue-i18n** for translation management
      - Store translations in structured JSON files
      - Use `translate()` function with fallback text
      - Support all required languages with proper fallbacks
      - Format: `translate('key.path', 'default text')`

  - **HTTP Client**:

      - Use `axios` for HTTP requests
      - Create centralized API service modules
      - Implement request/response interceptors
      - Handle errors globally where appropriate

  - **Styling**:

      - All component styles must be `scoped` using the `<style scoped>` tag to prevent CSS conflicts.
      - For global styles, use a dedicated `main.css` file imported in `main.js`.
      - Use theme variables for consistent styling
      - Support dark/light themes where applicable

  - **Routing**: Use **Vue Router** for all client-side routing. Route definitions should be modular and lazy-loaded to improve initial page load performance.

  - **Security**:

      - Use DOMPurify for sanitizing user-generated content
      - Implement proper XSS prevention measures
      - Validate and sanitize all user inputs
      - Use Content Security Policy headers

  - **Chart/Data Visualization**:

      - Use ECharts or ApexCharts for data visualization
      - Use vue3-apexcharts wrapper for ApexCharts integration
      - Ensure charts are responsive and accessible

  - **PDF Export**:

      - Use jsPDF for PDF generation
      - Include proper headers and formatting
      - Support international characters

## 6\. Backend: Node.js & Express Standards

  - **Project Structure**: Express applications must follow a structured layout:

    ```
    /src
    ├── api / (or /routes)
    ├── config /
    ├── controllers /
    ├── middlewares /
    ├── services /
    ├── models / (if applicable)
    ├── app.js
    └── server.js
    ```

  - **Configuration Management**:

      - Use `dotenv` for environment variable management
      - Create a centralized `config/appConfig.js` file
      - Provide sensible defaults for all configuration values
      - Implement `getFormattedConfiguration()` method with sensitive data redaction
      - Document all environment variables in a `.env.example` file

  - **Security Middleware**:

      - Use `helmet` for security headers configuration
      - Implement proper CORS configuration
      - Use `express-rate-limit` for rate limiting (configurable via environment)
      - Set `trust proxy` when behind a reverse proxy
      - Use `compression` middleware for response compression

  - **RESTful API Design**:

      - **Endpoints**: Use plural nouns for resources (e.g., `/users`, `/conversations`).
      - **HTTP Verbs**: Use standard HTTP verbs correctly (GET, POST, PUT, PATCH, DELETE).
      - **Status Codes**: Return appropriate HTTP status codes (e.g., `200` OK, `201` Created, `400` Bad Request, `404` Not Found, `500` Internal Server Error).
      - **JSON Responses**: API responses must be in JSON and follow a consistent structure: `{ "success": true, "data": [...] }` or `{ "success": false, "error": { "message": "..." } }`.

  - **Routing**: Use `express.Router()` to define routes in separate files within the `/routes` or `/api` directory.

  - **Controllers and Services**:

      - **Controllers**: Should only handle HTTP request/response logic (parsing input, validating data, calling services, sending response).
      - **Services**: Should contain the core business logic, including interactions with the database layer. Controllers must not directly access the database.

  - **Asynchronous Operations**: All asynchronous route handlers and middleware must handle Promises correctly, either by using a global async error handling middleware or wrapping logic in `try...catch` blocks.

  - **Middleware**: Use middleware for cross-cutting concerns like authentication, request logging, and validation.

  - **Error Handling**:

      - Implement a global error handling middleware
      - Use error handler that logs errors properly with context
      - Provide user-friendly error messages
      - Include error details in development mode only
      - Handle 404 routes appropriately

  - **Logging**:

      - Use `winston` for structured logging
      - Use `winston-daily-rotate-file` for log rotation
      - Import shared logger from `shared-lib` when available
      - Include correlation IDs for request tracking
      - Redact sensitive information from logs

  - **Health Checks**: Implement `/health` endpoint returning:

      - Service status
      - Timestamp
      - Uptime
      - Environment
      - Version information

  - **API Documentation**:

      - Use `swagger-jsdoc` for OpenAPI specification
      - Serve documentation with `swagger-ui-express`
      - Make documentation available at `/api-docs`
      - Include comprehensive examples for all endpoints

  - **Package.json Standards**:

      - **Name**: Use kebab-case for package names
      - **Version**: Follow semantic versioning (MAJOR.MINOR.PATCH)
      - **Description**: Provide clear, concise description
      - **Main**: Specify the entry point (e.g., `src/server.js`)
      - **Scripts**: Include standard scripts:
        - `start`: Production start command
        - `dev`: Development start with hot-reload (nodemon)
        - `test`: Run tests
        - `test:watch`: Run tests in watch mode
        - `test:coverage`: Run tests with coverage report
      - **Engines**: Specify Node.js version requirement
      - **Author**: Specify author information
      - **License**: Specify license (ISC, Apache-2.0, etc.)
      - **Type**: Specify module type (`commonjs` or `module`)

  - **Dependency Management**:

      - Separate `dependencies` and `devDependencies` properly
      - Regular security audits using `npm audit`
      - Keep dependencies updated
      - Document reasons for unusual dependencies
      - Use `^` for minor updates, `~` for patch updates
      - Lock file (`package-lock.json`) must be committed

## 7\. Backend: Python Standards

  - **Style Guide**: All Python code must strictly adhere to the **PEP 8** style guide.

  - **Copyright Headers**: All Python files must begin with copyright headers:

      ```python
      # Copyright (C) 2025 International Telecommunication Union (ITU)
      # SPDX-License-Identifier: Apache-2.0
      ```

      For files adapted from other sources (e.g., Intel OPEA):
      ```python
      # Copyright (C) 2024 Intel Corporation
      # Copyright (C) 2025 International Telecommunication Union (ITU)
      # SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU
      ```

  - **Tooling**:

      - **Formatter**: `ruff format` must be used to auto-format all Python code.
      - **Linter**: `ruff check` must be used to check for style and logical errors.

  - **Dependency Management**: Use `pip` with a `requirements.txt` file. The file should be generated with pinned versions (`pip freeze > requirements.txt`).

  - **Virtual Environments**: All Python development must occur within a dedicated virtual environment (e.g., using `venv`).

  - **Typing**: Use Python's standard type hints for all function signatures and variable declarations in new code.

  - **Docstrings**: All modules, classes, and functions must have Google-style docstrings.

  - **Logging Standards**:

      - Use the `CustomLogger` from the `comps` library for all logging
      - Initialize loggers at module level: `logger = CustomLogger("module_name")`
      - Use the `LOGFLAG` environment variable to control logging verbosity
      - Include context information in log messages

  - **Environment Configuration**:

      - Use `os.getenv()` for all environment variable access
      - Provide sensible defaults for all configuration values
      - Document required and optional environment variables
      - Use type conversion for environment variables (e.g., `int(os.getenv("PORT", "8888"))`)

  - **OPEA Integration Standards**:

      - Follow OPEA microservice patterns for service implementation
      - Use standard OPEA enums for service types and endpoints
      - Implement proper service orchestration using `ServiceOrchestrator`
      - Handle streaming responses appropriately for LLM services

## 8\. Mobile: Flutter & Dart Standards

  - **Style Guide**: All Dart code must follow the [Effective Dart](https://dart.dev/guides/language/effective-dart) style guide.

  - **Code Formatting**: Use `dart format` to format all Dart code consistently.

  - **Linter**: Use `dart analyze` to catch code issues and ensure code quality.

  - **File Organization**:

      - Organize code into logical directories: `lib/components/`, `lib/services/`, `lib/utils/`, `lib/models/`
      - Use descriptive file names in `snake_case.dart` format
      - Keep widgets separated from business logic

  - **Widget Structure**:

      - Prefer `StatelessWidget` for simple UI components
      - Use `StatefulWidget` only when state management is required
      - Separate state management logic from UI building logic
      - Use `const` constructors where possible for performance

  - **State Management**:

      - Use the Provider pattern orGetX for global state management
      - Keep state management logic separate from UI components
      - Use `setState()` sparingly and only for local component state

  - **Naming Conventions**:

      - Classes: `PascalCase` (e.g., `LoginScreen`, `UserService`)
      - Variables and methods: `camelCase` (e.g., `usernameController`, `handleLogin`)
      - Private members: prefix with `_` (e.g., `_loadSavedCredentials`)
      - Constants: `lowerCamelCase` for local, `UPPER_SNAKE_CASE` for global constants

  - **Dependencies**:

      - Use `pubspec.yaml` for dependency management
      - Pin dependency versions to ensure reproducibility
      - Keep dependencies updated and remove unused ones

  - **Internationalization**:

      - Use `flutter_localizations` and `intl` packages for i18n
      - Store translations in `lib/l10n/` directory
      - Use `.arb` files for translation resources
      - Support RTL (Right-to-Left) languages where applicable

  - **Error Handling**:

      - Use try-catch blocks for asynchronous operations
      - Provide user-friendly error messages
      - Log errors appropriately for debugging
      - Handle network failures gracefully

  - **Testing**:

      - Write unit tests for business logic
      - Write widget tests for UI components
      - Write integration tests for critical user flows
      - Aim for minimum 80% code coverage

  - **Platform Integration**:

      - Use platform channels carefully when integrating with native code
      - Handle platform-specific features with conditional imports
      - Test on both iOS and Android platforms

## 9\. Scripting: Bash Standards

  - **Shebang**: All scripts must begin with `#!/bin/bash`.

  - **Safety**: Scripts should start with `set -euo pipefail` to ensure they exit immediately on errors or unbound variables.

  - **Error Handling**: Check for required arguments and file/directory existence, exiting with a non-zero status code and a clear error message on failure.

  - **User Feedback**: Use `echo` to inform the user of the script's progress. Use visual separators for readability.

  - **Variables**: Use `snake_case` for variable names. Quote variables (`"$my_var"`) to prevent word splitting and globbing issues.

## 10\. Data & Schema (JSON / ArangoDB)

  - **Formatting**: All JSON files must be well-formed and pretty-printed with an indent of 2 spaces.

  - **Naming Convention**: Object keys in JSON documents must use `camelCase`.

  - **Data Exports**: Data exports must include a `metadata` object detailing the export version, source, and timestamp, and a `data` object containing the exported collections.

  - **Schema Validation**: ArangoDB collections should have schema validation rules defined where data structure is critical (e.g., `serviceCategories`, `users`). Schemas must be defined using the JSON Schema standard.

  - **Keys**: For user-generated content like `serviceCategories`, the `_key` should be a URL-friendly "slug" derived from its name (e.g., "Public Safety" -\> `public-safety`). System-generated documents or child entities (like `services`) can use numeric keys.

## 11\. Internationalization (i18n) System

  - **Source of Truth**: The English name (`nameEN`) in core collections like `serviceCategories` and `services` is the source of truth and the primary key for RAG system compatibility.

  - **Database Architecture**:

      - Translations must be stored in dedicated translation collections (`serviceCategoryTranslations`, `serviceTranslations`).
      - An edge must link the source document to its translation documents.
      - Translation document keys must follow the pattern `${sourceKey}_${languageCode}` (e.g., `1_FR`) for easy identification.

  - **Frontend Implementation**:

      - Use the **`vue-i18n`** library for managing translations in the Vue 3 application.
      - Use structured, descriptive keys in translation files (e.g., `page.home.title`). Do not embed raw strings in components.

## 12\. OPEA Integration & RAG Pattern Standards

  - **Contextual Labeling**: All user interactions that provide context (e.g., selecting a service category in the UI) must pass both the stable English label (`nameEN`) and the user's current language-specific label to the backend. The `nameEN` serves as a reliable identifier for the RAG system, while the translated label provides natural language context for the LLM.

  - **Standardized Data Flow**: The RAG pattern must follow this standard flow:

    1.  **Vue 3 Frontend**: Captures user query and contextual labels.
    2.  **Node.js/Express Backend**: Acts as a Backend-for-Frontend (BFF), receiving the request and securely calling the RAG service.
    3.  **Python RAG Service**: Receives the query and context. Uses the context to perform a vector search or filtered query against ArangoDB to retrieve relevant documents.
    4.  **Prompt Augmentation**: The retrieved documents are used to augment the prompt sent to the LLM.
    5.  **Response Generation**: The LLM generates a response, which is streamed back through the stack to the user.

## 13\. Logging Standards

  - **Python Services**: Use the `CustomLogger` from the `comps` library for consistent logging across all Python microservices.

  - **Node.js Services**: Use `winston` for structured logging with the following configuration:

      - Log levels: error, warn, info, http, verbose, debug, silly
      - Use daily rotating file transport for persistent logs
      - Include timestamps and correlation IDs where applicable
      - Redact sensitive information (passwords, tokens, etc.)

  - **Log Format**: All logs should follow a consistent format:

      - Timestamp in ISO 8601 format
      - Log level (ERROR, WARN, INFO, DEBUG)
      - Service/component name
      - Message
      - Contextual data (when applicable)

  - **Sensitive Data**: Never log sensitive information including:

      - Passwords or API keys
      - Personal user information (PII)
      - Session tokens or JWTs
      - Credit card numbers or financial data

  - **Log Levels Usage**:

      - **ERROR**: Application errors requiring immediate attention
      - **WARN**: Unexpected conditions that don't stop execution
      - **INFO**: General informational messages about normal operation
      - **DEBUG**: Detailed information for debugging purposes
      - **HTTP**: HTTP request/response logs (for web services)

  - **Environment-Specific Logging**:

      - Development: DEBUG level with detailed logs
      - Staging: INFO level with moderate logging
      - Production: WARN or ERROR level only

## 14\. Security Standards

  - **Authentication & Authorization**:

      - Use JWT (JSON Web Tokens) for stateless authentication
      - Implement proper token expiration and refresh mechanisms
      - Validate and sanitize all user inputs
      - Use role-based access control (RBAC) where applicable

  - **Data Protection**:

      - Encrypt sensitive data at rest using industry-standard encryption
      - Use HTTPS/TLS for all data in transit
      - Never store passwords in plain text - use bcrypt with appropriate rounds
      - Implement proper data retention and deletion policies

  - **API Security**:

      - Implement rate limiting to prevent abuse
      - Use API keys for service-to-service communication
      - Validate all incoming requests (schema validation)
      - Implement CORS policies appropriately
      - Use security headers (Helmet.js for Express)

  - **Dependency Management**:

      - Keep all dependencies up to date
      - Regularly scan for security vulnerabilities
      - Use `npm audit` and `pip-audit` tools
      - Review and update dependencies monthly

  - **Secrets Management**:

      - Never commit secrets to version control
      - Use environment variables for configuration
      - Use `.env` files (excluded from git) for local development
      - Implement proper secrets rotation policies
      - Use vault services for production secrets management

  - **File Upload Security**:

      - Validate file types and extensions
      - Scan uploaded files for malware (ClamAV integration)
      - Limit file sizes to prevent DoS attacks
      - Store uploads outside the web root
      - Sanitize filenames to prevent path traversal

  - **Cross-Site Scripting (XSS) Prevention**:

      - Sanitize and validate all user-generated content
      - Use DOMPurify for HTML sanitization
      - Implement Content Security Policy (CSP) headers
      - Escape user-generated content before rendering

## 15\. Documentation Standards

### 12.1. In-Code Documentation

  - **File Header Docblocks**: Every executable script (`.js`, `.sh`) must begin with a comprehensive block comment explaining its purpose, usage, prerequisites, and environment variables.

  - **Functions & Classes**: All public functions and classes must have JSDoc (for JS) or Google-style (for Python) docstrings explaining what they do, their parameters, and what they return.

### 12.2. README Files

  - **Structure**: `README.md` files must be well-structured with a clear hierarchy of headings, lists, tables, and code blocks.

  - **Content**: The root `README.md` for a component (e.g., the scripts directory) must provide:

      - A high-level overview of the component's role.
      - A summary table of all scripts/modules and their functions.
      - Detailed, step-by-step "Workflows" for common user goals.
      - Clear instructions for prerequisites and initial setup.
      - Use of warnings (`⚠️`) and notes (`📝`) to call out critical information.

## 16\. DevOps: Docker & Docker Compose Standards

  - **Image Versioning**: Always pin specific image versions (e.g., `arangodb/arangodb:3.12.4`) in `compose.yaml` files. Do not use the `latest` tag.

  - **File Naming**: Use the standard `compose.yaml` for Docker Compose configurations and `Dockerfile` for container definitions.

  - **Configuration**:

      - **Secrets**: Use environment variables (`${ARANGO_PASSWORD}`) for secrets like passwords.
      - **Environment Files**: Use `.env` files for environment-specific configuration
      - **Data Persistence**: Use Docker volumes to persist database data. Map volumes to clear, absolute paths on the host (e.g., `/root/arango_data`).
      - **Networking**: Use explicitly named bridge networks for inter-service communication.
      - **Health Checks**: Define health checks for all critical services
      - **Resource Limits**: Set appropriate resource limits for containers

  - **Service Organization**:

      - Group related services in the same network
      - Use service names that match their function
      - Document port mappings at the top of compose files
      - Use environment-specific compose files (e.g., `compose-T4.yaml`)

  - **Resilience**: Set a `restart: unless-stopped` policy on all long-running services.

  - **Volume Management**:

      - Use named volumes for data persistence
      - Create volumes before starting services when needed
      - Document volume purposes in comments
      - Implement backup strategies for critical volumes

  - **Multi-Stage Builds**: Use multi-stage Dockerfiles to reduce image sizes and improve security.

## 17\. API Documentation Standards

  - **OpenAPI/Swagger Specification**: All REST APIs must be documented using OpenAPI 3.0 specification.

  - **Documentation Tools**:

      - Use `swagger-jsdoc` for Express.js APIs
      - Use `swagger-ui-express` for interactive API documentation
      - Serve API documentation at `/api-docs` endpoint

  - **Required Documentation Elements**:

      - **Endpoints**: All API endpoints must be documented with:
        - HTTP method and path
        - Description of functionality
        - Request parameters (query, path, body)
        - Request body schema (for POST/PUT)
        - Response schemas for all status codes
        - Authentication requirements
        - Rate limiting information
        - Example requests and responses

      - **Data Models**: Define reusable schemas for common data structures
      - **Error Responses**: Document all possible error responses with:
        - HTTP status codes
        - Error message format
        - Troubleshooting information

  - **API Versioning**:

      - Include version in the endpoint path (e.g., `/api/v1/`)
      - Document version changes and deprecation notices
      - Maintain backward compatibility when possible

  - **Example Documentation Structure**:

      ```yaml
      paths:
        /api/files:
          post:
            summary: Upload a new file
            description: Upload and process a document file
            tags:
              - Files
            security:
              - bearerAuth: []
            requestBody:
              required: true
              content:
                multipart/form-data:
                  schema:
                    type: object
                    properties:
                      file:
                        type: string
                        format: binary
            responses:
              '201':
                description: File uploaded successfully
              '400':
                description: Invalid file format or size
              '401':
                description: Unauthorized
      ```

  - **Documentation Updates**: Update API documentation whenever:
      - New endpoints are added
      - Request/response schemas change
      - Authentication requirements change
      - Deprecation notices are added

**Document Version:** 2.0
**Last Updated:** March 10, 2026
**Project:** GENIE.AI
**Maintained By:** ITU (International Telecommunication Union)