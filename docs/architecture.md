# Architecture Overview

High-level architecture of the GENIE.AI platform with Keycloak OIDC integration.

---

## 1. System Context

```mermaid
graph TB
    subgraph External Actors
        EU[End User]
        SA[IT Admin]
        FA[Functional Admin]
    end

    subgraph External IdPs
        Google[Google Workspace]
        MSFT[Microsoft Entra ID]
        SAML[SAML IdP]
    end

    subgraph GENIE.AI Platform
        GENIE[GENIE.AI<br/>RAG Platform]
    end

    EU -->|Web Browser| GENIE
    SA -->|Admin Console| GENIE
    FA -->|Admin Console| GENIE

    Google -.->|OIDC / OAuth2| GENIE
    MSFT -.->|OIDC / OAuth2| GENIE
    SAML -.->|SAML 2.0| GENIE
```

GENIE.AI is a sovereign RAG platform for the public sector. It authenticates users via Keycloak, which can broker to external identity providers (Google, Microsoft, SAML). Three actor personas interact with the system:

- **End User** -- interacts with the chat frontend to query documents
- **IT Admin** -- manages Keycloak realms, clients, and external IdP connections
- **Functional Admin** -- manages documents, categories, and service data

---

## 2. Service Architecture

```mermaid
graph TB
    subgraph Browser
        FE[Vue 3 Frontend]
    end

    subgraph API Gateway
        NGINX[NGINX<br/>TLS Termination]
        KONG[Kong<br/>Reverse Proxy / CORS / Rate Limiting]
    end

    subgraph Application Layer
        BE[Backend<br/>Node.js / Express]
        DR[Document Repository]
        CLAMAV[ClamAV]
    end

    subgraph Identity Layer
        KC[Keycloak<br/>Identity Provider]
    end

    subgraph Data Layer
        ADB[(ArangoDB<br/>Documents / Graph / Vector)]
        REDIS[(Redis<br/>Cache)]
        PG[(PostgreSQL<br/>Kong + Keycloak)]
    end

    subgraph AI Layer
        CHATQNA[ChatQnA]
        RETRIEVER[Retriever]
        RERANKER[Reranker]
        VLLM[vLLM<br/>LLM Inference]
        TEI[TEI<br/>Embeddings / Reranking]
        DATAPREP[Dataprep<br/>Document Ingestion]
        TRANS[Translation Service]
    end

    subgraph External IdPs
        EIDP[External IdPs<br/>Google / Microsoft / SAML]
    end

    FE -->|HTTPS| NGINX
    NGINX --> KONG
    KONG --> BE
    KONG --> DR
    KONG --> KC
    FE -.->|OIDC| KC
    KC --> PG
    KONG --> PG
    KC -.->|Brokering| EIDP
    BE --> ADB
    DR --> CLAMAV
    BE --> REDIS
    BE --> CHATQNA
    CHATQNA --> RETRIEVER
    CHATQNA --> RERANKER
    RETRIEVER --> ADB
    RERANKER --> TEI
    CHATQNA --> VLLM
    CHATQNA --> TRANS
    DATAPREP -->|client_credentials| KC
    DATAPREP --> BE
    DATAPREP --> ADB
    DATAPREP --> DR
```

### Layer Descriptions

| Layer | Components | Purpose |
|-------|-----------|---------|
| Browser | Vue 3 Frontend | User interface, in-memory OIDC tokens |
| API Gateway | NGINX, Kong | TLS termination, reverse proxy, CORS, rate limiting |
| Application | Backend, Document Repository, ClamAV | Business logic, session management, file upload with virus scanning |
| Identity | Keycloak | User authentication, session management, identity brokering |
| Data | ArangoDB, Redis, PostgreSQL | Document storage, vector search, graph database; Redis caches backend translations; PostgreSQL stores Kong and Keycloak data |
| AI | ChatQnA, Retriever, Reranker, vLLM, TEI, Dataprep, Translation | RAG pipeline, embeddings, LLM inference |

---

## 3. Service Authentication Matrix

| Service | Auth Method | Notes |
|---------|-------------|-------|
| Frontend (Vue 3) | Keycloak OIDC | oidc-client-ts, tokens in-memory only |
| Backend (Node.js) | Keycloak JWT (JWKS) | Validates every request, performs JIT user provisioning, forwards Bearer token to upstream services |
| Document Repository | Keycloak JWT (JWKS) | Independent JWKS validation |
| OPEA ChatQnA | Keycloak JWT (JWKS) | Validates forwarded Bearer token independently; extracts user info from JWT payload |
| OPEA Dataprep | Keycloak client_credentials | Service account (KC_DATAPREP_CLIENT_ID/SECRET) |
| OPEA AI services | None | vLLM, TEI, reranker -- internal network only |
| Keycloak | N/A | Identity provider (source of truth for users, roles, sessions) |
| Kong | None | Pure reverse proxy |
| NGINX | TLS only | Terminates TLS, proxies to Kong |

---

## 4. User Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant Vue as Vue Frontend
    participant KC as Keycloak
    participant ExtIdP as External IdP
    participant BE as Backend
    participant ADB as ArangoDB

    User->>Vue: Navigate to app
    Vue->>KC: Authorization request
    alt Using External IdP
        KC->>ExtIdP: Redirect for authentication
        ExtIdP->>KC: Authentication response
    end
    KC->>Vue: Authorization code (callback)
    Vue->>KC: Token exchange (code -> tokens)
    KC->>Vue: id_token + access_token
    Vue->>Vue: Store tokens in-memory

    User->>Vue: Perform action (API call)
    Vue->>BE: Bearer token
    BE->>KC: JWKS public key (cached)
    BE->>BE: Validate JWT signature + claims
    BE->>ADB: JIT provisioning (UPSERT by iss#sub)
    BE->>Vue: API response
```

Keycloak serves as the sole identity authority. If an external IdP is configured, Keycloak brokers the authentication. On each authenticated API request, the backend validates the JWT and ensures the user exists in ArangoDB via just-in-time provisioning.

---

## 5. Token Validation and JWKS

```mermaid
sequenceDiagram
    participant Client
    participant BE as Backend
    participant DR as Document Repository
    participant ChatQnA as OPEA ChatQnA
    participant KC as Keycloak

    Client->>BE: Bearer token
    BE->>BE: Check local JWKS cache
    alt Cache miss
        BE->>KC: Fetch JWKS (public keys)
        KC->>BE: JWKS response
        BE->>BE: Cache public keys
    end
    BE->>BE: Validate signature + expiry + issuer + audience
    BE->>BE: Extract sub, roles, iss

    BE->>ChatQnA: Forward Bearer token
    ChatQnA->>ChatQnA: Check local JWKS cache
    alt Cache miss
        ChatQnA->>KC: Fetch JWKS
        KC->>ChatQnA: JWKS response
        ChatQnA->>ChatQnA: Cache public keys
    end
    ChatQnA->>ChatQnA: Validate signature + claims

    Client->>DR: Bearer token
    DR->>DR: Check local JWKS cache
    alt Cache miss
        DR->>KC: Fetch JWKS
        KC->>DR: JWKS response
        DR->>DR: Cache public keys
    end
    DR->>DR: Validate signature + claims
```

Each service independently validates JWTs against Keycloak JWKS. JWKS public keys are cached locally and refreshed on cache miss or key rotation. Services validate the token signature, expiry, issuer, and audience claims.

---

## 6. Token Lifecycle

### 6.1 Silent Token Renew

```mermaid
sequenceDiagram
    participant Vue as Vue Frontend
    participant KC as Keycloak

    Note over Vue: access_token approaching expiry
    Vue->>KC: Silent auth request (hidden iframe)
    KC->>KC: Check active session
    KC->>Vue: New access_token (no user interaction)
    Vue->>Vue: Replace in-memory token
```

The frontend uses a silent renew mechanism (iframe) to obtain a new access_token from Keycloak before the current one expires. This happens transparently to the user as long as the Keycloak session is still valid.

### 6.2 Logout and Session Termination

```mermaid
sequenceDiagram
    participant User
    participant Vue as Vue Frontend
    participant KC as Keycloak

    User->>Vue: Click logout
    Vue->>KC: signoutRedirect (id_token_hint)
    KC->>KC: Revoke session + tokens
    KC->>Vue: Redirect to post-logout URL
    Vue->>Vue: Clear in-memory tokens
    Vue->>Vue: Redirect to login page
```

Logout is initiated by the frontend calling Keycloak's end_session_endpoint with the id_token_hint. Keycloak revokes all sessions and tokens, then redirects back. The frontend clears its in-memory token storage and redirects to the login page.

---

## 7. API Request Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Vue Frontend
    participant N as NGINX
    participant K as Kong
    participant BE as Backend
    participant ChatQnA as OPEA ChatQnA
    participant Ret as Retriever
    participant ADB as ArangoDB
    participant LLM as vLLM

    User->>FE: Send message
    FE->>N: HTTPS (Bearer token)
    N->>K: Proxy (TLS terminated)
    K->>BE: Reverse proxy (CORS + rate limit)
    BE->>BE: Validate JWT + JIT provision user
    BE->>ChatQnA: Bearer token
    ChatQnA->>ChatQnA: Validate JWT (JWKS)
    ChatQnA->>BE: GET /api/me/context (user profile for AI enrichment)
    BE->>ChatQnA: User context (name, role, emailVerified)
    ChatQnA->>TEI: Generate embedding
    TEI->>ChatQnA: Embedding vector
    ChatQnA->>Ret: Query with embedding
    Ret->>ADB: Vector + graph search
    ADB->>Ret: Ranked chunks
    Ret->>ChatQnA: Retrieved documents
    ChatQnA->>ChatQnA: Rerank results
    ChatQnA->>LLM: Context + prompt
    LLM->>ChatQnA: Generated response
    ChatQnA->>BE: RAG response
    BE->>FE: API response
    FE->>User: Display answer
```

The RAG pipeline flows through the API gateway, backend, and OPEA services. The Bearer token is forwarded to ChatQnA, which performs independent JWKS validation. ChatQnA also fetches user context from the backend via `GET /api/me/context` to enrich AI prompts with user profile data.

---

## 8. Document Upload and Ingestion

### 8.1 Upload Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Vue Frontend
    participant N as NGINX
    participant K as Kong
    participant DR as Document Repository
    participant CLAM as ClamAV

    User->>FE: Upload file(s)
    FE->>N: HTTPS (Bearer token)
    N->>K: Proxy
    K->>DR: POST /api/files/upload (Bearer token)
    DR->>DR: Validate file type + size
    DR->>CLAM: Scan for viruses
    CLAM->>DR: Clean / Infected
    DR->>DR: Store file + metadata
    DR->>FE: 201 Created (file_id)
```

Users upload documents through the frontend to the Document Repository service. Files are validated (type, size), scanned by ClamAV, and stored with metadata. Upload requires an authenticated user with admin role.

### 8.2 Ingestion Flow

Ingestion is triggered manually by an admin after upload. The Document Repository proxies the request to the Dataprep service.

```mermaid
sequenceDiagram
    actor Admin
    participant FE as Vue Frontend
    participant DR as Document Repository
    participant DP as Dataprep
    participant KC as Keycloak
    participant BE as Backend
    participant ADB as ArangoDB

    Admin->>FE: Click "Ingest" on uploaded file
    FE->>DR: POST /api/files/{fileId}/ingest (Bearer token)
    DR->>DR: Validate JWT + admin role
    DR->>DP: POST /v1/dataprep/ingest_file

    DP->>KC: Token request (client_credentials grant)
    KC->>DP: Service account access_token

    DP->>DP: Extract content (Docling / text loader)
    DP->>DP: Chunk document (dynamic size per file type)

    DP->>BE: GET /api/service-categories/categories
    BE->>DP: Label hierarchy
    DP->>DP: Label chunks (LLM / embedding / BM25)
    DP->>ADB: Store chunks + entities + graph edges
    DP->>ADB: Generate and store vector embeddings

    DP->>DR: Update ingestion status + chunk count
    DP->>FE: Ingestion complete
```

Dataprep uses a dedicated Keycloak client with the `client_credentials` grant type. This service account is separate from user tokens and has permissions scoped to document ingestion operations. The ingestion pipeline extracts content, chunks it, labels each chunk against the service taxonomy, constructs a knowledge graph (entities + relationships), generates vector embeddings, and stores everything in ArangoDB.

### 8.3 Document Retraction

```mermaid
sequenceDiagram
    actor Admin
    participant FE as Vue Frontend
    participant DR as Document Repository
    participant DP as Dataprep
    participant ADB as ArangoDB

    Admin->>FE: Click "Retract" on ingested file
    FE->>DR: POST /api/files/{fileId}/retract (Bearer token)
    DR->>DP: POST /v1/dataprep/retract_file
    DP->>ADB: Delete chunks → edges → orphaned entities
    DP->>DR: Status updated to "Retracted"
```

Retraction removes all graph data (chunks, entities, relationships) associated with a document while preserving the original file record for audit purposes.

---

## 9. Public vs Protected Routes

| Route | Access | Notes |
|-------|--------|-------|
| `/health` | Public | Health check endpoints |
| `/api-docs` | Public | Swagger API documentation |
| `/api/auth/callback` | Public | Keycloak OIDC callback redirect |
| `/api/auth/logout/callback` | Public | Keycloak post-logout callback |
| `/api/auth/logout` | Protected | User logout (Keycloak handles session invalidation) |
| `/api/me` | Protected | Current user profile singleton (GET, PUT) |
| `/api/me/context` | Protected | User context for AI enrichment |
| `/api/me/reset-data` | Protected | Reset user profile data |
| `/api/me/delete` | Protected | Delete user account (GDPR erasure) |
| `/api/*` | Protected | All other API routes require valid Bearer token |

Unauthenticated requests to protected routes receive a 401 response. The backend validates the JWT on every protected request before processing.

---

## 10. User Lifecycle

### 10.1 JIT Provisioning

On each authenticated request, the backend checks whether the user exists in ArangoDB. If not, it creates the user record using a composite key formed from the JWT issuer and subject (`iss#sub`). If the user already exists, the backend updates the user's metadata (name, email, roles) to stay in sync with Keycloak.

This ensures ArangoDB always reflects the current state from the identity provider. For detailed user management procedures, see the [Keycloak Admin Guide](keycloak-admin-guide.md).

### 10.2 User Disable and Delete Propagation

```mermaid
sequenceDiagram
    participant Admin as Keycloak Admin
    participant KC as Keycloak
    participant BE as Backend
    participant ADB as ArangoDB

    Admin->>KC: Disable / Delete user
    KC->>KC: Update user status

    Note over BE: On next API request with expired token
    BE->>BE: JWT validation fails (TOKEN_EXPIRED)
    BE->>KC: UserInfo endpoint (check if user disabled/deleted)
    KC->>BE: 401 (user disabled/deleted)
    BE->>BE: Reject request (401)
    BE->>ADB: Soft-delete user record
```

When a user is disabled or deleted in Keycloak, the propagation is handled at the next interaction point:

- **Disabled user**: The backend detects the disabled status during token validation and rejects the request. The user record in ArangoDB is soft-deleted.
- **Deleted user**: Tokens issued before deletion are rejected at validation time. The user record in ArangoDB is soft-deleted.

---

## 11. External Identity Providers

```mermaid
sequenceDiagram
    actor User
    participant FE as Vue Frontend
    participant KC as Keycloak
    participant ExtIdP as External IdP<br/>(Google / Microsoft / SAML)

    User->>FE: Click "Login with Google" (or other IdP)
    FE->>KC: Authorization request (with identity_provider hint)
    KC->>ExtIdP: Redirect to external IdP login
    User->>ExtIdP: Authenticate
    ExtIdP->>KC: Authentication response (OIDC code / SAML assertion)
    KC->>KC: Map external user to local Keycloak user
    KC->>FE: Authorization code (callback)
    FE->>KC: Token exchange
    KC->>FE: GENIE.AI JWT (id_token + access_token)
    FE->>FE: Store tokens in-memory
```

Keycloak acts as a broker between GENIE.AI and external identity providers. The external IdP authenticates the user, Keycloak maps the external identity to a local user, and issues a GENIE.AI-signed JWT. The frontend and backend only interact with Keycloak -- they are unaware of which external IdP was used.

For configuration details, see the [External IdP Integration Guide](external-idp-integration-guide.md).

---

## 12. API Gateway

The API gateway consists of two layers:

**NGINX** -- The outermost layer. Terminates TLS on port 443 and applies security headers. Proxies all requests to Kong.

**Kong** -- Sits behind NGINX and acts as a pure reverse proxy. Provides CORS configuration and rate limiting. Routes requests to backend services. No JWT validation is performed at the gateway level -- authentication is enforced at each service boundary.

Request path: `Browser -> NGINX (TLS) -> Kong (CORS, rate limit) -> Backend (JWT validation) -> Upstream services`

---

## 13. Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Keycloak as sole identity authority | Eliminates local password management. Single source of truth for users, roles, and sessions. |
| D2 | Token passthrough to OPEA | The original user's Bearer token is forwarded to ChatQnA, which independently validates it via JWKS and extracts user identity from the JWT payload. No shared trust boundary. |
| D3 | JWT validation at service boundary | Each service (Backend, Document Repository, ChatQnA) validates tokens independently against Keycloak JWKS. No shared trust boundary at the gateway. |
| D4 | JIT user provisioning | ArangoDB user records are created or updated on every login. Keeps the application database in sync with the identity provider without requiring separate user management. |
| D5 | In-memory token storage | The frontend stores tokens in JavaScript memory only (no localStorage or sessionStorage). Mitigates token theft via XSS. |
| D6 | Dataprep service account | Dataprep authenticates via Keycloak client_credentials grant with a dedicated service account, separate from user tokens. |
| D7 | Gateway architecture | NGINX terminates TLS and proxies all traffic to Kong. Kong provides CORS and rate limiting. Both are required in the current configuration — Kong cannot be bypassed. |
| D8 | `/api/me` singleton resource | After Keycloak migration, the frontend has no access to ArangoDB `_key` (only OIDC claims). A singleton `/api/me` resource eliminates the need for path-based user IDs. User resolution happens via JWT middleware (`req.user._key`). The `_key` never leaves the backend. |

---

## 14. Further Reading

- [Keycloak Admin Guide](keycloak-admin-guide.md) -- Realm configuration, user management, client setup
- [Docker Compose Setup](docker-compose-setup.md) -- Local development deployment with Docker Compose
- [Docker Swarm Setup](docker-swarm-setup.md) -- Production deployment with Docker Swarm and Ansible
- [External IdP Integration Guide](external-idp-integration-guide.md) -- Connecting Google, Microsoft, and SAML identity providers
- [E2E Tests](e2e-tests/README.md) -- End-to-end test procedures for authentication and session lifecycle
