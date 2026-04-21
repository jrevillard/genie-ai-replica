# Keycloak IdP Integration — Architecture Diagrams

## 1. C4 Context — System in Scope

```mermaid
graph TB
    subgraph external["External"]
        EndUser["End User<br/>(Policy Analyst)"]
        ITAdmin["IT Administrator"]
        FuncAdmin["Functional Administrator"]
        ExtIdP["External IdPs<br/>Google, Microsoft,<br/>Institutional SAML/OIDC"]
    end

    GENIE["GENIE.AI Platform<br/>with Keycloak IdP"]

    EndUser -->|"SSO Login"| GENIE
    ITAdmin -->|"Deploy & Configure<br/>Docker Compose + .env"| GENIE
    FuncAdmin -->|"User & Role Mgmt<br/>(Keycloak Admin Console)"| GENIE
    ExtIdP -.->|"Identity Brokering<br/>(configured in Keycloak)"| GENIE

    style GENIE fill:#2563eb,stroke:#1e40af,color:#fff,stroke-width:2px
    style EndUser fill:#f0fdf4,stroke:#16a34a
    style ITAdmin fill:#f0fdf4,stroke:#16a34a
    style FuncAdmin fill:#f0fdf4,stroke:#16a34a
    style ExtIdP fill:#fefce8,stroke:#ca8a04
```

## 2. C4 Container — Internal Architecture

```mermaid
graph TB
    subgraph browser["Browser"]
        Vue["Vue 3 Frontend<br/>oidc-client-ts<br/>In-memory token"]
    end

    subgraph gateway["API Gateway"]
        Nginx["NGINX<br/>TLS + Security Headers"]
        Kong["Kong<br/>JWT Validation<br/>(OPTIONAL)"]
    end

    subgraph app["Application"]
        Backend["Node.js Backend<br/>JWKS Validation (jose)<br/>JIT Provisioning"]
        KC["Keycloak 26.x<br/>Realm + Client + Users<br/>Identity Brokering"]
        KCPg[("PostgreSQL<br/>Keycloak DB")]
    end

    subgraph data["Data"]
        Arango[("ArangoDB<br/>Users (iss_sub)<br/>Conversations")]
        Redis[("Redis<br/>Cache")]
    end

    subgraph ai["AI Layer (Keycloak-Agnostic)"]
        OPEA["OPEA Services<br/>ChatQnA, Retriever,<br/>Reranker, Embedding, LLM"]
    end

    subgraph external_idp["External (Optional)"]
        ExtIdP["Google / Microsoft /<br/>Institutional IdP"]
    end

    Vue -->|"OIDC Auth Code + PKCE<br/>Redirect / Callback"| KC
    Vue -->|"Bearer token"| Nginx
    Nginx --> Kong
    Kong -->|"X-User-Id, X-User-Roles<br/>X-Issuer"| Backend
    Backend -->|"JWKS<br/>/.well-known/jwks.json"| KC
    Backend -->|"JIT UPSERT<br/>iss_sub lookup"| Arango
    Backend -->|"user_id payload<br/>(service-to-service JWT)"| OPEA
    KC <--> KCPg
    ExtIdP -.->|"Brokering"| KC

    style Vue fill:#22c55e,stroke:#16a34a,color:#fff
    style Nginx fill:#64748b,stroke:#475569,color:#fff
    style Kong fill:#64748b,stroke:#475569,color:#fff
    style Backend fill:#f97316,stroke:#c2410c,color:#fff
    style KC fill:#3b82f6,stroke:#1d4ed8,color:#fff
    style OPEA fill:#ef4444,stroke:#dc2626,color:#fff
    style ExtIdP fill:#eab308,stroke:#a16207
```

## 3. Sequence — OIDC Authentication Flow (SSO)

```mermaid
sequenceDiagram
    actor U as End User
    participant V as Vue Frontend
    participant K as Keycloak
    participant E as External IdP
    participant N as NGINX / Kong
    participant B as Backend
    participant A as ArangoDB

    Note over U,V: 1. User accesses protected page
    V->>U: Redirect to Keycloak login
    U->>K: Login page
    opt External IdP configured
        K->>E: Identity brokering
        E-->>K: Auth success
    end
    K-->>U: Authorization Code
    U->>V: Redirect to /callback?code=...
    V->>K: Token exchange (code → tokens)
    K-->>V: id_token + access_token + refresh_token
    Note over V: Token stored in memory only

    Note over U,B: 2. User makes API call
    V->>N: Authorization: Bearer <access_token>
    N->>B: Forward request + headers
    B->>K: JWKS public keys (cached, 5min TTL)
    K-->>B: JWKS
    B->>B: Verify JWT signature + claims (iss, aud, exp)
    B->>A: UPSERT user by iss_sub (JIT provisioning)
    A-->>B: User record
    B-->>N: 200 OK + X-User-Id, X-User-Roles, X-Issuer
    N-->>V: Response
    V-->>U: Data rendered

    Note over U,V: 3. Token expires silently
    V->>K: Refresh token → new access_token
    alt Refresh success
        K-->>V: New access_token
        Note over V: Seamless — no user interaction
    else Refresh token expired
        K-->>V: Error
        V->>U: Redirect to Keycloak login
    end
```

## 4. Sequence — Token Validation with JWKS Force-Refresh

```mermaid
sequenceDiagram
    participant B as Backend Middleware
    participant C as JWKS Cache
    participant K as Keycloak
    participant A as ArangoDB

    B->>C: Get cached JWKS for issuer
    C-->>B: Cached keys (or miss)

    B->>B: Verify JWT signature
    alt Signature valid
        B->>B: Validate claims (iss, aud, exp)
        B->>A: Lookup user by iss_sub
        alt User found
            A-->>B: User record
            alt deleted == true?
                B-->>B: 403 FORBIDDEN
            else User active
                B->>B: Inject user + X-User-Id, X-User-Roles, X-Issuer
                B-->>B: Authenticated ✓
            end
        else User not found
            B->>A: JIT provision (atomic UPSERT)
            alt UPSERT success
                A-->>B: New user record
                B-->>B: Inject user + headers
                B-->>B: Authenticated ✓
            else UPSERT failed
                B-->>B: 500 PROVISIONING_FAILED
            end
        end
    else Signature invalid
        B->>B: Check token exp still valid?
        alt Token not expired
            B->>K: Force-refresh JWKS
            K-->>B: New public keys
            B->>C: Update cache
            B->>B: Retry verification
            alt Valid on retry
                B->>A: Lookup user by iss_sub
                Note over B,A: Continue as above
            else Still invalid
                B-->>B: 401 TOKEN_INVALID
            end
        else Token expired
            B-->>B: 401 TOKEN_EXPIRED
        end
    end
```
