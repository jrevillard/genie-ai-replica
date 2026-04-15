# **GENIE.AI Components**

This directory contains the source code for the core GENIE.AI application components. All services are deployed via the root `docker-compose.yaml` (dual-mode: `docker compose up` and `docker stack deploy`) located in the project root. There is no separate docker-compose file in this directory.

## **1. Overview**

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

## **2. Prerequisites**

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

## **3. Deployment**

All services are deployed via Docker Swarm from the project root using the root `docker-compose.yaml` (dual-mode).

### **Deploying the Stack**

```bash
# From project root
cp env .env   # First time: create your .env
# Then edit .env with your secrets (ARANGO_PASSWORD, JWT_SECRET, etc.)

set -a && source .env && set +a && docker stack deploy -c docker-compose.yaml genieai
```

See `docs/docker-swarm-setup.md` for the full Swarm deployment guide and `docs/docker-compose-setup.md` for local development.

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

## **4. Service Details**

### **4.1. frontend Service**

This service runs the user interface of the application.

* **Build**: The container image is built using the Dockerfile located in the ./gov-chat-frontend directory.
* **Ports**: The frontend is accessible on the host machine at port **8090**.
* **Environment File**: Loads configuration from the root `.env`.

### **4.2. backend Service**

This service runs the Node.js server that provides the application's API and business logic.

* **Build**: The image is built using the Dockerfile located in the ./gov-chat-backend/ directory.
* **Ports**: The backend API is accessible on the host machine at port **3000**.
* **Volumes**: The service uses bind mounts and named volumes to persist data:
  * ./data/database_backups:/app/database_backups: Persists automated database backups.
  * ./data/logs/backend:/app/logs: Persists application logs.
  * backend_data:/app/data: Named volume for application data persistence.
  * backend_uploads:/app/Uploads: Named volume for user-uploaded files.
* **Environment File**: Loads configuration from the root `.env`.

### **4.3. document-repository Service**

This service handles document uploads, validation, and ingestion.

* **Build**: The image is built using the Dockerfile located in the ./document-repository/ directory.
* **Ports**: The service is accessible on the host machine at port **3001**.
* **Volumes**:
  * ./data/logs/doc-repo:/app/logs: Persists application logs.
  * doc_repo_uploads:/app/uploads: Uses a named volume to persist file uploads.
* **Environment File**: Loads configuration from the root `.env`.

### **4.4. arango-vector-db Service**

This service runs the ArangoDB database.

* **Image**: arangodb/arangodb:3.12.4
* **Ports**: Exposes the ArangoDB interface on the host at port **8529**.
* **Volumes**: Persists database data to /root/arango_data on the host machine.
* **Environment**:
  * ARANGO_ROOT_PASSWORD: **(Secret)** Set via the ARANGO_PASSWORD variable in `.env`.
* **Command**: Starts ArangoDB with the --experimental-vector-index=true flag to enable vector search capabilities.

### **4.5. redis-cache Service**

This service provides a Redis cache, primarily for the backend's translation service.

* **Image**: redis:7-alpine
* **Ports**: Exposes Redis on the host at port **6379** (optional, for debugging).
* **Volumes**: Persists Redis data using the named volume redis_data.
* **Command**:
  * redis-server --appendonly yes --maxmemory-policy noeviction --requirepass "${TRANSLATION_CACHE_PASSWORD}"
  * This command starts Redis with AOF persistence, no eviction, and a password set via `.env`.
* **Healthcheck**: Includes a healthcheck to ensure Redis is responsive before dependent services (like backend) are started.

### **4.6. clamav Service**

This service provides on-demand antivirus scanning.

* **Image**: clamav/clamav
* **Ports**: Exposes the ClamAV daemon on the host at port **3310**. This port is used by the document-repository service.

## **5. Networking**

All services communicate via the Docker network defined in the root `docker-compose.yaml`. Services can communicate with each other using their service names as hostnames (e.g., backend can reach the database at http://arango-vector-db:8529).

## **6. Troubleshooting**

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

### Per-Service Documentation

- **[Backend Services](gov-chat-backend/README.md)** — API routes, services, configuration
- **[Frontend Application](gov-chat-frontend/README.md)** — Vue.js components, configuration
- **[Document Repository](document-repository/README.md)** — File upload, virus scanning
- **[ArangoDB Setup](arangodb/README.md)** — Database configuration, backup, restore
- **[Docker Compose Setup](../docs/docker-compose-setup.md)** — Local development with `docker compose up`
- **[Docker Swarm Setup](../docs/docker-swarm-setup.md)** — Docker Swarm deployments
