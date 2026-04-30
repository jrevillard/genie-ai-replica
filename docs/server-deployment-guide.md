# Server Deployment Guide — Genie AI RAG Pipeline

This guide documents the configuration required to deploy and operate the Genie AI RAG pipeline on a server with the OPEA microservice stack, ArangoDB, and vLLM.

## Prerequisites

- Docker and Docker Compose
- NVIDIA GPU with drivers installed (for vLLM; dataprep runs on CPU)
- The Genie AI codebase (`genie-ai/` directory with docker-compose.yaml)

## 1. Environment Variables (env file)

The `env` file in the project root must contain the following. Variables marked **CRITICAL** have caused production issues when missing or misconfigured.

### ArangoDB

```bash
ARANGO_PASSWORD=<your-arango-password>
# ARANGO_DB is used by the retriever and backend
# ARANGO_DB_NAME is used by the OPEA parent class in dataprep
# Both MUST be set to the same value
ARANGO_DB=genie-ai
```

### Reranking

```bash
# CRITICAL: The chatqna code defaults to 0.9 if not set, which filters out
# almost all retrieved documents. The cross-encoder/ms-marco-MiniLM-L-6-v2
# model produces scores in the 0.001-0.1 range for relevant documents.
RERANKING_THRESHOLD=0.001
```

### Keycloak (if not deployed)

If Keycloak is not deployed, the dataprep service falls back to the legacy
`http-service:6666/get-token` endpoint for authentication. Ensure:

```bash
# The http-service must be running with valid credentials
AUTH_SERVICE_USERNAME=genie-ai-manager
AUTH_SERVICE_PASSWORD=<password>
```

The password hash in ArangoDB must match. To reset:

```bash
# Generate bcrypt hash of SHA-256(password)
docker exec backend node -e "
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sha256 = crypto.createHash('sha256').update('<password>').digest('hex');
bcrypt.hash(sha256, 10, (err, h) => console.log(h));
"

# Update in ArangoDB
docker exec arango-vector-db arangosh --server.password "<arango-pw>" \
  --javascript.execute-string '
    db._useDatabase("genie-ai");
    var u = db._query("FOR u IN users FILTER u.loginName == \"genie-ai-manager\" RETURN u").toArray()[0];
    db.users.update(u._key, {encPassword: "<bcrypt-hash>"});
  '
```

### HuggingFace Token

```bash
# CRITICAL: Required by HuggingFaceHubEmbeddings for embedding generation.
# The TEI server doesn't validate the token, but the LangChain class
# requires it to be set. A dummy value works.
HUGGINGFACEHUB_API_TOKEN=not-needed
```

### LLM / vLLM

```bash
# Do NOT set OPENAI_API_KEY — it causes the dataprep to try OpenAI's servers
# instead of the local vLLM. The VLLM_ENDPOINT path is used when OPENAI_API_KEY
# is absent.
VLLM_MODEL_ID=ibm-granite/granite-3.3-2b-instruct
```

## 2. Docker Compose Changes

### Dataprep Service

The following must be in the `chatqna-xeon-backend-server` environment:

```yaml
RERANKING_THRESHOLD: ${RERANKING_THRESHOLD:-0.001}
```

The following must be in the `dataprep-arango-service` environment:

```yaml
ARANGO_DB_NAME: ${ARANGO_DB:-genie-ai}   # OPEA parent class reads this
HUGGINGFACEHUB_API_TOKEN: ${HUGGINGFACEHUB_API_TOKEN:-not-needed}
```

### Graph Name Alignment

All services must use the same graph name:

| Service | Env Var | Expected Value |
|---------|---------|----------------|
| Dataprep | `ARANGO_GRAPH_NAME` | `GRAPH_TEST` |
| Retriever | `ARANGO_GRAPH_NAME` / `RETRIEVER_ARANGO_GRAPH_NAME` | `GRAPH_TEST` |

## 3. Service Categories (Knowledge Hierarchy)

The RAG pipeline requires service categories with **translations** in ArangoDB.
Categories are stored in `serviceCategories` but names are read from
`serviceCategoryTranslations`. Both must be populated.

### Creating categories via ArangoDB:

```javascript
db._useDatabase("genie-ai");

// Create category
db.serviceCategories.save({name: "Hypertension", label: "Hypertension", order: 4});

// Create translation (required for the API to return the name)
db.serviceCategoryTranslations.save({
  _key: "<category_key>_EN",
  translation: "Hypertension",
  serviceCategoryId: "<category_key>",
  languageCode: "EN"
});
```

### Recommended NCD categories:

- NCD Prevention and Control
- Treatment and Management
- Healthcare Services
- Hypertension
- Diabetes
- Cancer
- Respiratory Diseases
- Tobacco Control
- Healthy Diet
- Physical Activity
- Mental Health

## 4. Building the Dataprep Image

The dataprep image must be built from the repo root:

```bash
docker build -f genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai \
  -t genie-ai-dataprep-arango:latest .
```

### Key patches in the Dockerfile:

1. **Component registration**: The OPEA base microservice's loader is deferred
   so the Genie component can register first
2. **Import fix**: The genie component import is added to the base service

## 5. Known Issues and Fixes

### asyncio.to_thread deadlock with embeddings

**Problem**: `HuggingFaceHubEmbeddings` uses `httpx` internally which deadlocks
when called from a thread pool worker within Uvicorn's async event loop.

**Fix**: The `_process_batch` method in `genieai_dataprep_arangodb.py` runs
graph extraction and insertion synchronously. Batches are processed sequentially
instead of via `asyncio.create_task` + `asyncio.gather`.

### None labels from LLM

**Problem**: The LLM sometimes returns `null` in the labels JSON array, causing
`AttributeError: 'NoneType' object has no attribute 'lower'`.

**Fix**: Labels are filtered with `[l for l in labels if l is not None]` after
parsing and in the file_labels fallback path.

### openai.error → openai (SDK v1+ compatibility)

**Problem**: Old OPEA code uses `openai.error.AuthenticationError` which doesn't
exist in openai SDK v1+.

**Fix**: Changed to `openai.AuthenticationError` in the retriever's
`genieai_retriever_arangodb.py`.

### Keycloak service account fallback

**Problem**: The upstream code expects Keycloak for service-to-service auth
(`get_service_account_token()`). When Keycloak isn't deployed, all status
updates, log writes, and label fetches fail silently.

**Fix**: `keycloak_service_account.py` tries Keycloak first, then falls back to
`GET_AUTH_TOKEN_URL` (default: `http://http-service:6666/get-token`).

### Reranking threshold too high

**Problem**: The chatqna code defaults `RERANKING_THRESHOLD` to 0.9. The
`cross-encoder/ms-marco-MiniLM-L-6-v2` model produces scores in the 0.001-0.1
range, so all documents get filtered out.

**Fix**: Set `RERANKING_THRESHOLD=0.001` in the chatqna service environment.

### ARANGO_DB vs ARANGO_DB_NAME

**Problem**: The OPEA parent class reads `ARANGO_DB_NAME` (defaults to
`_system`). The compose file and custom code use `ARANGO_DB`. Without
`ARANGO_DB_NAME`, graph data is written to the `_system` database.

**Fix**: Set both `ARANGO_DB` and `ARANGO_DB_NAME` to the same value.

## 6. Verifying the Pipeline

### Check ingestion:

```bash
# File status
docker exec arango-vector-db arangosh --server.password "<pw>" \
  --javascript.execute-string '
    db._useDatabase("genie-ai");
    db._query("FOR f IN files RETURN {name: f.file_name, status: f.dataprep.status, chunks: f.chunk_count}").toArray();
  '

# Graph data
docker exec arango-vector-db arangosh --server.password "<pw>" \
  --javascript.execute-string '
    db._useDatabase("genie-ai");
    print("SOURCE: " + db.GRAPH_TEST_SOURCE.count());
    print("ENTITY: " + db.GRAPH_TEST_ENTITY.count());
  '
```

### Test retrieval directly:

```bash
curl -X POST http://localhost:7025/v1/retrieval \
  -H "Content-Type: application/json" \
  -d '{"input": "hypertension blood pressure"}'
```

### Test end-to-end via ChatQnA:

```bash
curl -X POST http://localhost:8888/v1/chatqna \
  -H "Content-Type: application/json" \
  -d '{"messages": "What are the symptoms of high blood pressure?"}'
```

## 7. Monitoring

### Dataprep logs:

```bash
docker logs -f genie-ai-dataprep-arango 2>&1 | \
  grep -iE "Batch|inserted|Ingested|error|label"
```

### Retriever logs:

```bash
docker logs -f genie-ai-retriever-arango 2>&1 | \
  grep -iE "documents|score|error"
```

### Reranker logs:

```bash
docker logs -f genie-ai-reranker 2>&1 | \
  grep -iE "score|threshold|output"
```

### vLLM metrics:

```bash
curl http://localhost:8000/metrics | grep "request_success_total"
```
