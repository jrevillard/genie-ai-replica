\# GENIE.AI - Project Coding Standards Specification



\## 1\\. Introduction



This document defines the coding standards and best practices for the GENIE.AI project. Adhering to these standards is mandatory for all contributors to ensure the codebase remains readable, consistent, and maintainable. The goal is to produce reliable, scalable code that is easy to debug and extend.



This specification covers the full technology stack, including general principles, JavaScript, Vue 3, Node.js (Express), Python, Bash scripting, data formats, internationalization, OPEA patterns, documentation, and Docker configurations.



\## 2\\. Table of Contents



&nbsp; - \[3. General Principles](https://www.google.com/search?q=%233-general-principles)

&nbsp; - \[4. JavaScript (General Standards)](https://www.google.com/search?q=%234-javascript-general-standards)

&nbsp; - \[5. Frontend: Vue 3 Standards](https://www.google.com/search?q=%235-frontend-vue-3-standards)

&nbsp; - \[6. Backend: Node.js \& Express Standards](https://www.google.com/search?q=%236-backend-nodejs--express-standards)

&nbsp; - \[7. Backend: Python Standards](https://www.google.com/search?q=%237-backend-python-standards)

&nbsp; - \[8. Scripting: Bash Standards](https://www.google.com/search?q=%238-scripting-bash-standards)

&nbsp; - \[9. Data \& Schema (JSON / ArangoDB)](https://www.google.com/search?q=%239-data--schema-json--arangodb)

&nbsp; - \[10. Internationalization (i18n) System](https://www.google.com/search?q=%2310-internationalization-i18n-system)

&nbsp; - \[11. OPEA Integration \& RAG Pattern Standards](https://www.google.com/search?q=%2311-opea-integration--rag-pattern-standards)

&nbsp; - \[12. Documentation Standards](https://www.google.com/search?q=%2312-documentation-standards)

&nbsp; - \[13. DevOps: Docker \& Docker Compose Standards](https://www.google.com/search?q=%2313-devops-docker--docker-compose-standards)



\## 3\\. General Principles



&nbsp; - \*\*Clarity and Simplicity\*\*: Code must be written to be as easy to understand as possible. Prefer clear, straightforward logic over clever, complex one-liners.

&nbsp; - \*\*Separation of Concerns\*\*: Each script, module, and component should have a single, well-defined responsibility. This is evident in the project's structure, which uses separate scripts for schema creation, data population, and database maintenance.

&nbsp; - \*\*Configuration over Hardcoding\*\*: Application settings (e.g., database credentials, file paths, API keys) must be managed via environment variables (loaded from a `.env` file) with sensible defaults provided in the code.

&nbsp; - \*\*Robustness and Safety\*\*: Scripts that perform write operations must be designed to be safe. This includes checking for prerequisites, handling errors gracefully, and asking for user confirmation before proceeding with destructive actions.



\## 4\\. JavaScript (General Standards)



These standards apply to all JavaScript code, both frontend (Vue) and backend (Node.js).



&nbsp; - \*\*Linter \& Formatter\*\*: ESLint and Prettier must be used to enforce style consistency. A shared configuration should be committed to the repository.

&nbsp; - \*\*Language Version\*\*: Code should be written in ECMAScript 6 (ES6) or later.

&nbsp; - \*\*Variables\*\*:

&nbsp;     - Use `const` by default for all variable declarations.

&nbsp;     - Use `let` only for variables that must be reassigned, such as loop counters. Avoid `var`.

&nbsp; - \*\*Modules\*\*:

&nbsp;     - \*\*Node.js Scripts\*\*: Use the CommonJS module system (`require`, `module.exports`) for consistency with existing scripts.

&nbsp;     - \*\*Vue 3 / Express App\*\*: Use ES Modules (`import`/`export`) for application code.

&nbsp; - \*\*Style\*\*:

&nbsp;     - \*\*Indentation\*\*: 2 spaces.

&nbsp;     - \*\*Semicolons\*\*: Mandatory.

&nbsp;     - \*\*Quotes\*\*: Single quotes (`'`).

&nbsp;     - \*\*Naming\*\*: `camelCase` for variables and functions; `PascalCase` for classes.



\## 5\\. Frontend: Vue 3 Standards



&nbsp; - \*\*Composition API with `<script setup>`\*\*: All new components must use the Composition API with the `<script setup>` syntax for better logic organization, reusability, and TypeScript support.

&nbsp; - \*\*Component Structure\*\*: Single File Components (`.vue`) must be organized with the following order: `<script setup>`, `<template>`, `<style scoped>`.

&nbsp; - \*\*Component Naming\*\*: Component files must be named in `PascalCase` (e.g., `ServiceCategoryTree.vue`). When used in templates, they should be self-closing and also in `PascalCase` (e.g., `<ServiceCategoryTree />`).

&nbsp; - \*\*Props\*\*:

&nbsp;     - Props must be declared using `defineProps` with detailed definitions (type, required, default, validator).

&nbsp;     - Prop names must be `camelCase`.

&nbsp; - \*\*Events\*\*:

&nbsp;     - Custom event names must be `kebab-case` (e.g., `item-selected`).

&nbsp;     - Events must be declared using `defineEmits`.

&nbsp; - \*\*State Management\*\*: For cross-component state management, \*\*Pinia\*\* is the official state management library. It is mandatory for managing global state like user authentication, conversation history, etc.

&nbsp; - \*\*Styling\*\*: All component styles must be `scoped` using the `<style scoped>` tag to prevent CSS conflicts. For global styles, use a dedicated `main.css` file imported in `main.js`.

&nbsp; - \*\*Routing\*\*: Use \*\*Vue Router\*\* for all client-side routing. Route definitions should be modular and lazy-loaded to improve initial page load performance.



\## 6\\. Backend: Node.js \& Express Standards



&nbsp; - \*\*Project Structure\*\*: Express applications must follow a structured layout:

&nbsp;   ```

&nbsp;   /src

&nbsp;   ├── api / (or /routes)

&nbsp;   ├── config /

&nbsp;   ├── controllers /

&nbsp;   ├── middleware /

&nbsp;   ├── services /

&nbsp;   ├── models / (if applicable)

&nbsp;   └── server.js

&nbsp;   ```

&nbsp; - \*\*RESTful API Design\*\*:

&nbsp;     - \*\*Endpoints\*\*: Use plural nouns for resources (e.g., `/users`, `/conversations`).

&nbsp;     - \*\*HTTP Verbs\*\*: Use standard HTTP verbs correctly (GET, POST, PUT, PATCH, DELETE).

&nbsp;     - \*\*Status Codes\*\*: Return appropriate HTTP status codes (e.g., `200` OK, `201` Created, `400` Bad Request, `404` Not Found, `500` Internal Server Error).

&nbsp;     - \*\*JSON Responses\*\*: API responses must be in JSON and follow a consistent structure: `{ "success": true, "data": \[...] }` or `{ "success": false, "error": { "message": "..." } }`.

&nbsp; - \*\*Routing\*\*: Use `express.Router()` to define routes in separate files within the `/api` directory.

&nbsp; - \*\*Controllers and Services\*\*:

&nbsp;     - \*\*Controllers\*\*: Should only handle HTTP request/response logic (parsing input, validating data, calling services, sending response).

&nbsp;     - \*\*Services\*\*: Should contain the core business logic, including interactions with the database layer. Controllers must not directly access the database.

&nbsp; - \*\*Asynchronous Operations\*\*: All asynchronous route handlers and middleware must handle Promises correctly, either by using a global async error handling middleware or wrapping logic in `try...catch` blocks.

&nbsp; - \*\*Middleware\*\*: Use middleware for cross-cutting concerns like authentication, request logging, and validation.



\## 7\\. Backend: Python Standards



&nbsp; - \*\*Style Guide\*\*: All Python code must strictly adhere to the \*\*PEP 8\*\* style guide.

&nbsp; - \*\*Tooling\*\*:

&nbsp;     - \*\*Formatter\*\*: `black` must be used to auto-format all Python code.

&nbsp;     - \*\*Linter\*\*: `flake8` or a similar linter must be used to check for style and logical errors.

&nbsp; - \*\*Dependency Management\*\*: Use `pip` with a `requirements.txt` file. The file should be generated with pinned versions (`pip freeze > requirements.txt`).

&nbsp; - \*\*Virtual Environments\*\*: All Python development must occur within a dedicated virtual environment (e.g., using `venv`).

&nbsp; - \*\*Typing\*\*: Use Python's standard type hints for all function signatures and variable declarations in new code.

&nbsp; - \*\*Docstrings\*\*: All modules, classes, and functions must have Google-style docstrings.



\## 8\\. Scripting: Bash Standards



&nbsp; - \*\*Shebang\*\*: All scripts must begin with `#!/bin/bash`.

&nbsp; - \*\*Safety\*\*: Scripts should start with `set -euo pipefail` to ensure they exit immediately on errors or unbound variables.

&nbsp; - \*\*Error Handling\*\*: Check for required arguments and file/directory existence, exiting with a non-zero status code and a clear error message on failure.

&nbsp; - \*\*User Feedback\*\*: Use `echo` to inform the user of the script's progress. Use visual separators for readability.

&nbsp; - \*\*Variables\*\*: Use `snake\_case` for variable names. Quote variables (`"$my\_var"`) to prevent word splitting and globbing issues.



\## 9\\. Data \& Schema (JSON / ArangoDB)



&nbsp; - \*\*Formatting\*\*: All JSON files must be well-formed and pretty-printed with an indent of 2 spaces.

&nbsp; - \*\*Naming Convention\*\*: Object keys in JSON documents must use `camelCase`.

&nbsp; - \*\*Data Exports\*\*: Data exports must include a `metadata` object detailing the export version, source, and timestamp, and a `data` object containing the exported collections.

&nbsp; - \*\*Schema Validation\*\*: ArangoDB collections should have schema validation rules defined where data structure is critical (e.g., `serviceCategories`, `users`). Schemas must be defined using the JSON Schema standard.

&nbsp; - \*\*Keys\*\*: For user-generated content like `serviceCategories`, the `\_key` should be a URL-friendly "slug" derived from its name (e.g., "Public Safety" -\\> `public-safety`). System-generated documents or child entities (like `services`) can use numeric keys.



\## 10\\. Internationalization (i18n) System



&nbsp; - \*\*Source of Truth\*\*: The English name (`nameEN`) in core collections like `serviceCategories` and `services` is the source of truth and the primary key for RAG system compatibility.

&nbsp; - \*\*Database Architecture\*\*:

&nbsp;     - Translations must be stored in dedicated translation collections (`serviceCategoryTranslations`, `serviceTranslations`).

&nbsp;     - An edge must link the source document to its translation documents.

&nbsp;     - Translation document keys must follow the pattern `${sourceKey}\_${languageCode}` (e.g., `1\_FR`) for easy identification.

&nbsp; - \*\*Frontend Implementation\*\*:

&nbsp;     - Use the \*\*`vue-i18n`\*\* library for managing translations in the Vue 3 application.

&nbsp;     - Use structured, descriptive keys in translation files (e.g., `page.home.title`). Do not embed raw strings in components.



\## 11\\. OPEA Integration \& RAG Pattern Standards



&nbsp; - \*\*Contextual Labeling\*\*: All user interactions that provide context (e.g., selecting a service category in the UI) must pass both the stable English label (`nameEN`) and the user's current language-specific label to the backend. The `nameEN` serves as a reliable identifier for the RAG system, while the translated label provides natural language context for the LLM.

&nbsp; - \*\*Standardized Data Flow\*\*: The RAG pattern must follow this standard flow:

&nbsp;   1.  \*\*Vue 3 Frontend\*\*: Captures user query and contextual labels.

&nbsp;   2.  \*\*Node.js/Express Backend\*\*: Acts as a Backend-for-Frontend (BFF), receiving the request and securely calling the RAG service.

&nbsp;   3.  \*\*Python RAG Service\*\*: Receives the query and context. Uses the context to perform a vector search or filtered query against ArangoDB to retrieve relevant documents.

&nbsp;   4.  \*\*Prompt Augmentation\*\*: The retrieved documents are used to augment the prompt sent to the LLM.

&nbsp;   5.  \*\*Response Generation\*\*: The LLM generates a response, which is streamed back through the stack to the user.



\## 12\\. Documentation Standards



\### 12.1. In-Code Documentation



&nbsp; - \*\*File Header Docblocks\*\*: Every executable script (`.js`, `.sh`) must begin with a comprehensive block comment explaining its purpose, usage, prerequisites, and environment variables.

&nbsp; - \*\*Functions \& Classes\*\*: All public functions and classes must have JSDoc (for JS) or Google-style (for Python) docstrings explaining what they do, their parameters, and what they return.



\### 12.2. README Files



&nbsp; - \*\*Structure\*\*: `README.md` files must be well-structured with a clear hierarchy of headings, lists, tables, and code blocks.

&nbsp; - \*\*Content\*\*: The root `README.md` for a component (e.g., the scripts directory) must provide:

&nbsp;     - A high-level overview of the component's role.

&nbsp;     - A summary table of all scripts/modules and their functions.

&nbsp;     - Detailed, step-by-step "Workflows" for common user goals.

&nbsp;     - Clear instructions for prerequisites and setup.

&nbsp;     - Use of warnings (`⚠️`) and notes (`📝`) to highlight critical information.



\## 13\\. DevOps: Docker \& Docker Compose Standards



&nbsp; - \*\*Image Versioning\*\*: Pin specific image versions (e.g., `arangodb/arangodb:3.12.4`) in `compose.yaml` files. Do not use `latest`.

&nbsp; - \*\*Configuration\*\*:

&nbsp;     - \*\*Secrets\*\*: Use environment variables (`${ARANGO\_PASSWORD}`) for secrets.

&nbsp;     - \*\*Data Persistence\*\*: Use Docker volumes mapped to absolute host paths for all stateful services like databases.

&nbsp;     - \*\*Networking\*\*: Use explicitly named bridge networks for inter-service communication.

&nbsp; - \*\*Resilience\*\*: Set a `restart: unless-stopped` policy on all long-running services.

&nbsp; - \*\*File Naming\*\*: Use `compose.yaml` for Docker Compose configurations and `Dockerfile` for container definitions.

