# **GENIE.AI Components**

This directory contains the source code for the core GENIE.AI application components. All services are deployed via the root `docker-compose.yaml` (Swarm-compatible) located in the project root. There is no separate docker-compose file in this directory.

## **1\. Overview**

The core GENIE.AI services are:

* **frontend**: The user-facing web application (Vue.js), built from the ./gov-chat-frontend directory.
* **backend**: The server-side application (Node.js) that handles business logic, API requests, and database connections, built from ./gov-chat-backend.
* **document-repository**: A separate (Node.js) service for handling file uploads, ingestion, and security, built from ./document-repository.
* **arango-vector-db**: The ArangoDB database instance, configured with experimental vector index support.
* **redis-cache**: A Redis instance used for caching, particularly for frontend translations.
* **clamav**: A ClamAV antivirus service used by the document-repository to scan uploads.

### Integration with OPEA Services

These core components integrate with the OPEA microservices infrastructure defined in the same root `docker-compose.yaml`. The OPEA services provide:

* **LLM Inference** (vLLM): Text generation via port 8000
* **Embedding Service** (TEI): Vector embeddings via port 7000
* **Reranking Service** (TEI Reranker): Result optimization via port 7100
* **Wrapper Services**: Standardized interfaces for GENIE.AI integration

## **2\. Prerequisites**

Before deploying, ensure the following prerequisites are met:

1. **Docker and Docker Compose**: Must be installed on your system.
2. **Source Code**: The necessary source code directories must be present relative to the project root:
   * components/gov-chat-frontend/
   * components/gov-chat-backend/Dockerfile
   * components/document-repository/Dockerfile
3. **Environment File**: Copy the root `env` template to `.env` and fill in required secrets:
   ```bash
   cp env .env
   ```
4. See `env` template for required secrets (ARANGO_PASSWORD, JWT_SECRET, SESSION_SECRET, etc.).

## **3\. Deployment**

All services are deployed via Docker Swarm from the project root using the root `docker-compose.yaml` (Swarm-compatible).

### **Deploying the Stack**

```bash
# From project root
cp env .env   # First time: create your .env
# Then edit .env with your secrets (ARANGO_PASSWORD, JWT_SECRET, etc.)

set -a && source .env && set +a && docker stack deploy -c docker-compose.yaml genieai
```

See `docs/docker-swarm-setup.md` for the full Swarm deployment guide.

### **Removing the Stack**

```bash
docker stack rm genieai
```

### **Rebuilding After Code Changes**

Images must be built and pushed to a registry before deploying (`docker stack deploy` cannot build):

```bash
docker compose build [service_name]
# Push to your registry, then redeploy:
set -a && source .env && set +a && docker stack deploy -c docker-compose.yaml genieai
```

### **Viewing Logs**

```bash
docker service logs -f genieai_<service_name>
```

## **4\. Service Details**

### **4.1. frontend Service**

This service runs the user interface of the application.

* **Build**: The container image is built using the Dockerfile located in the ./gov-chat-frontend directory.
* **Ports**: The frontend is accessible on the host machine at port **8090**.
* **Environment File**: Loads configuration from the root `.env`.

#### **Frontend Configuration Parameters**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| NODE\_ENV | Sets the Node.js environment. | development |
| VUE\_APP\_API\_URL | The public-facing URL of the backend API. | https://e2e-82-109.ssdcloudindia.net:443/api |
| VUE\_APP\_CSP\_CONNECT\_SRC | Content Security Policy connect-src directive for the Vue app. | "self http://localhost:3000..." |
| CSP\_CONNECT\_SRC | Content Security Policy connect-src directive (likely for the server). | "'self' http://locahost..." |
| CORS\_ALLOWED\_ORIGINS | Comma-separated list of allowed origins for CORS. | "http://localhost,https://localhost..." |

### **4.2. backend Service**

This service runs the Node.js server that provides the application's API and business logic.

* **Build**: The image is built using the Dockerfile located in the ./gov-chat-backend/ directory.
* **Ports**: The backend API is accessible on the host machine at port **3000**.
* **Volumes**: The service uses several bind mounts to persist data:
  * ./database\_backups:/app/database\_backups: Persists automated database backups.
  * ./logs:/app/logs: Persists application logs.
  * ./data:/app/data: A volume for general application data persistence.
  * ./gov-chat-backend/Uploads:/app/Uploads: Persists user-uploaded files.
* **Environment File**: Loads configuration from the root `.env`.

#### **Backend Configuration Parameters**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| **Application** |  |  |
| NODE\_ENV | Sets the Node.js environment. | production |
| PORT | The internal port the Express server listens on. | 3000 |
| API\_PREFIX | The base path for all API routes. | /api |
| APP\_NAME | The name of the application, used in emails. | Genie AI |
| FRONTEND\_URL | The public URL of the frontend, for generating links. | https://genie-ai.itu.int/ |
| LOG\_LEVEL | The verbosity of application logs. | debug |
| OPENWEATHERMAP\_API\_KEY | API key for the OpenWeatherMap service. | b115ccced... |
| **ArangoDB** |  |  |
| ARANGO\_URL | Connection URL for the ArangoDB instance. | http://arango-vector-db:8529 |
| ARANGO\_DB | The name of the database to use. | node-services |
| ARANGO\_USERNAME | Username for the ArangoDB connection. | root |
| ARANGO\_PASSWORD | **(Secret)** Password for the ArangoDB connection. | test |
| **Database Backup** |  |  |
| BACKUP\_DIR | Internal directory for storing database backups. | ./database\_backups |
| MAX\_BACKUPS | Maximum number of backups to retain. | 5 |
| BACKUP\_FORMAT | Format for the backups. | json |
| COMPRESS\_BACKUPS | Whether to compress backups. | true |
| **Session & Auth** |  |  |
| JWT\_SECRET | **(Secret)** Long, random string for signing JSON Web Tokens. | UJeFROw+yRJe... |
| JWT\_EXPIRES\_IN | Expiration time for JSON Web Tokens. | 24h |
| SESSION\_SECRET | **(Secret)** Long, random string for signing session cookies. | default-session-secret |
| SESSION\_EXPIRATION\_TIME | Duration of a user session in milliseconds (30 mins). | 1800000 |
| **File Uploads** |  |  |
| UPLOAD\_DIR | Internal directory where uploaded files are stored. | ./uploads |
| MAX\_FILE\_SIZE | Maximum allowed size for file uploads (5 MB). | 5242880 |
| **CORS & CSP** |  |  |
| CORS\_ORIGIN | The URL of the frontend allowed to make requests. | https://e2e-82-109.ssdcloudindia.net/ |
| CORS\_ALLOWED\_ORIGINS | A regex/list of allowed origins. | http://localhost:8090... |
| CSP\_CONNECT\_SRC | Content Security Policy connect-src directive for the backend. | "'self' http://localhost:3000..." |
| **Email Service** |  |  |
| EMAIL\_HOST | SMTP host for the email service. | smtp.itu.ch |
| EMAIL\_PORT | SMTP port for the email service. | 587 |
| EMAIL\_SECURE | Whether to use a secure connection (TLS). | false |
| EMAIL\_USER | **(Secret)** Username for the email service. | genie-ai |
| EMAIL\_PASSWORD | **(Secret)** Password for the email service. | gLp+Ek)Vf) |
| EMAIL\_FROM | Email address from which application emails are sent. | noreply@genie-ai.itu.int |
| **Translation Cache** |  |  |
| TRANSLATION\_THREADS | Number of translation threads. | 4 |
| TRANSLATION\_BATCHES | Number of translation batches. | 5 |
| TRANSLATION\_CACHE | Enable/disable translation cache. | on |
| TRANSLATION\_CACHE\_PATH | Path for cache. | /cache/translations |
| TRANSLATION\_CACHE\_PASSWORD | **(Secret)** Password for the Redis cache. | !@\#$$5678 |
| TRANSLATION\_CACHE\_HOST | Hostname of the Redis service. | redis-cache |
| TRANSLATION\_CACHE\_PORT | Port of the Redis service. | 6379 |
| **OPEA Integration** |  |  |
| OPEA\_HOST | Hostname of the OPEA service for RAG. | e2e-109-198 |
| OPEA\_PORT | Port for the OPEA service. | 8888 |
| CONTEXT\_OPTION | Configuration option for context handling. | conversation-with-context-labels |

### **4.3. document-repository Service**

This service handles document uploads, validation, and ingestion.

* **Build**: The image is built using the Dockerfile located in the ./document-repository/ directory.
* **Ports**: The service is accessible on the host machine at port **3001**.
* **Volumes**:
  * ./logs:/app/logs: Persists application logs.
  * doc\_repo\_uploads:/app/uploads: Uses a named volume to persist file uploads.
* **Environment File**: Loads configuration from the root `.env`.

#### **Document Repository Configuration Parameters**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| **Service** |  |  |
| HOST | Host address the service binds to. | 0.0.0.0 |
| PORT | Internal port the service listens on. | 3001 |
| NODE\_ENV | Sets the Node.js environment. | development |
| **ArangoDB** |  |  |
| ARANGO\_URL | Connection URL for the ArangoDB instance. | http://91.203.132.51:8529 |
| ARANGO\_USERNAME | Username for the ArangoDB connection. | root |
| ARANGO\_PASSWORD | **(Secret)** Password for the ArangoDB connection. | test |
| ARANGO\_DB\_NAME | The name of the database to use. | node-services |
| **Document Ingestion** |  |  |
| DOCUMENT\_INGESTION\_LANGUAGE | Default language for document ingestion. | en |
| **Data Prep Service** |  |  |
| DATAPREP\_HOST | Hostname of the data preparation service. | http://91.203.132.198 |
| DATAPREP\_PORT | Port of the data preparation service. | 5000 |
| **File Uploads** |  |  |
| MAX\_FILES\_UPLOAD | Maximum number of files in a single upload. | 10 |
| MAX\_FILE\_SIZE | Maximum file size (50 MB). | 52428800 |
| UPLOAD\_DIR | Internal directory for storing uploads. | ./uploads |
| **Security** |  |  |
| JWT\_SECRET | **(Secret)** JWT secret for token validation. | default-jwt-secret |
| JWT\_EXPIRATION | Expiration time for JSON Web Tokens. | 24h |
| BCRYPT\_ROUNDS | Cost factor for bcrypt hashing. | 10 |
| **Clamscan (Virus Scanning)** |  |  |
| VIRUS\_SCANNING | Enable/disable virus scanning. | true |
| CLAMSCAN\_HOST | Hostname of the ClamAV service. | 127.0.0.1 |
| CLAMSCAN\_PORT | Port of the ClamAV service. | 3310 |
| CLAMSCAN\_TIMEOUT | Timeout for scan requests (ms). | 60000 |
| CLAMSCAN\_ACTIVE | Enable/disable the clamscan module. | true |
| **Logging** |  |  |
| LOG\_LEVEL | The verbosity of application logs. | info |
| LOG\_FILE | The name of the log file. | app.log |

### **4.4. arango-vector-db Service**

This service runs the ArangoDB database.

* **Image**: arangodb/arangodb:3.12.4
* **Ports**: Exposes the ArangoDB interface on the host at port **8529**.
* **Volumes**: Persists database data to /root/arango\_data on the host machine.
* **Environment**:
  * ARANGO\_ROOT\_PASSWORD: **(Secret)** Set via the ARANGO\_PASSWORD variable in `.env`.
* **Command**: Starts ArangoDB with the --experimental-vector-index=true flag to enable vector search capabilities.

### **4.5. redis-cache Service**

This service provides a Redis cache, primarily for the backend's translation service.

* **Image**: redis:7-alpine
* **Ports**: Exposes Redis on the host at port **6379** (optional, for debugging).
* **Volumes**: Persists Redis data using the named volume redis\_data.
* **Command**:
  * redis-server --appendonly yes --maxmemory-policy noeviction --requirepass "${TRANSLATION_CACHE_PASSWORD}"
  * This command starts Redis with AOF persistence, no eviction, and a password set via `.env`.
* **Healthcheck**: Includes a healthcheck to ensure Redis is responsive before dependent services (like backend) are started.

### **4.6. clamav Service**

This service provides on-demand antivirus scanning.

* **Image**: clamav/clamav
* **Ports**: Exposes the ClamAV daemon on the host at port **3310**. This port is used by the document-repository service.

## **5\. Networking**

All services communicate via the Docker network defined in the root `docker-compose.yaml`. Services can communicate with each other using their service names as hostnames (e.g., backend can reach the database at http://arango-vector-db:8529).

## **6\. Additional Documentation**

For detailed documentation on each component, see:

* **[Backend Services](gov-chat-backend/README.md)** - Complete backend architecture, API routes, and services
* **[Frontend Application](gov-chat-frontend/README.md)** - Vue.js components, configuration, and features
* **[Document Repository](document-repository/README.md)** - File upload, virus scanning, and ingestion
* **[ArangoDB Setup](arangodb/README.md)** - Database configuration, backup, and restore procedures
* **[Shared Libraries](shared/lib/README.md)** - Common utilities and shared code

## **7\. Component Documentation Sub-folders**

### Backend Sub-folders
* **[Routes Documentation](gov-chat-backend/routes/README.md)** - API route specifications
* **[Services Documentation](gov-chat-backend/services/README.md)** - Backend service architecture
* **[Schema Scripts](gov-chat-backend/scripts/new-schema-scripts/README.md)** - Database setup and migration scripts

### Frontend Sub-folders
* **[Configuration Guide](gov-chat-frontend/public/config/README.md)** - Application configuration and theming
* **[Component Library](gov-chat-frontend/src/components/README.md)** - Vue.js component reference

## **8\. Quick Reference**

### Service Ports

| Service | Internal Port | External Port | Purpose |
|---------|--------------|---------------|---------|
| frontend | 8090 | 8090 | Web UI |
| backend | 3000 | 3000 | API Server |
| document-repository | 3001 | 3001 | File Management |
| arango-vector-db | 8529 | 8529 | Database |
| redis-cache | 6379 | 6379 | Cache |
| clamav | 3310 | 3310 | Virus Scanner |

### OPEA Service Integration (defined in root docker-compose.yaml)

| OPEA Service | Port | Purpose |
|--------------|------|---------|
| vLLM | 8000 | LLM Inference |
| TEI Embedding | 7000 | Vector Embeddings |
| TEI Reranker | 7100 | Result Reranking |
| Text Generation Wrapper | 9000 | GENIE.AI LLM Interface |
| Embedding Wrapper | 6000 | GENIE.AI Embedding Interface |
| Reranker Wrapper | 6100 | GENIE.AI Reranking Interface |

### Volume Mounts

| Service | Volume | Purpose |
|---------|--------|---------|
| backend | ./database_backups | Database backups |
| backend | ./logs | Application logs |
| backend | ./data | Application data |
| backend | ./gov-chat-backend/Uploads | User uploads |
| document-repository | ./logs | Service logs |
| document-repository | doc_repo_uploads | File uploads |
| arango-vector-db | /root/arango_data | Database persistence |
| redis-cache | redis_data | Cache persistence |

### Health Status

Check service health:
```bash
# All services
docker service ls

# Service logs
docker service logs -f genieai_backend
```

## **9\. Troubleshooting**

### Common Issues

**Services won't start**:
1. Check environment file exists at project root: `ls -la .env`
2. Verify required secrets are set in `.env`

**Backend can't connect to database**:
1. Ensure arango-vector-db is running: `docker service ls | grep arango`
2. Check ARANGO_URL, ARANGO_USERNAME, and ARANGO_PASSWORD in .env
3. Verify database is accessible: `curl http://localhost:8529/_api/version`

**Document uploads fail**:
1. Verify clamav service is running: `docker service ls | grep clamav`
2. Check file size limits in document-repository configuration
3. Ensure sufficient disk space

**OPEA integration issues**:
1. Verify OPEA services are deployed: `docker service ls`
2. Check OPEA_HOST and OPEA_PORT in `.env`
3. Ensure all services are on the same Docker network

### Getting Help

- **Component Documentation**: See individual component READMEs
- **Backend Issues**: [Backend Documentation](gov-chat-backend/README.md)
- **Frontend Issues**: [Frontend Documentation](gov-chat-frontend/README.md)
- **Swarm Deployment**: [Docker Swarm Setup](../docs/docker-swarm-setup.md)
