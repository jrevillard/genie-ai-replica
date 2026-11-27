# Configuration Directory

This directory contains application configuration files.

## Contents

- `keycloak/` - Keycloak Identity Provider (Dockerfiles, realm configuration)
- `opea-config/` - OPEA service configuration files
- `postgres/` - PostgreSQL initialization (multi-database setup)
- `otel/` - OpenTelemetry Collector configuration (observability stack)
- `grafana/` - Grafana provisioning (datasources, dashboards)
- `agent/` - the agent service's tool catalog (the deployment file that decides what a run may call) and the SearXNG settings for the optional web-search tool

## LLM Prompts

LLM prompts are now **built into the Python code** with a two-tier override system:

1. **ENV VAR** (highest) - Override in `.env` for deployment-specific customization
2. **DEFAULT** (lowest) - Built-in prompts in Python code

### Prompt Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `CHATQNA_SYSTEM_PROMPT` | ChatQnA | Main LLM system prompt for RAG responses |
| `CHATQNA_ABSTENTION_INSTRUCTIONS` | ChatQnA | Instructions when no relevant documents found |
| `CHATQNA_ENFORCE_ABSTENTION` | ChatQnA | Whether to enforce abstention (default: "true") |
| `LABEL_SELECTOR_SYSTEM_PROMPT` | Dataprep | LLM prompt for automatic document labeling |

### Customization

**Environment variable override in `.env`:**
```bash
CHATQNA_SYSTEM_PROMPT="Your custom prompt here..."
```

**To change built-in defaults**, edit the Python code:
- `genie-ai-overlay/chatqna/genieai_chatqna.py` - CHATQNA_SYSTEM_PROMPT default
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` - LABEL_SELECTOR_SYSTEM_PROMPT default

## Enabling the agent's `web_search` tool (optional — an operator's addition)

The shipped catalog (`agent/tool-catalog.json`) declares the two document
tools only. `web_search` exists behind a SECOND source and is enabled per
deployment:

1. **Add the entry to the deployment's catalog copy** (the file the compose
   block mounts read-only; on an ansible deployment, the seeded
   `configs/agent/tool-catalog.json` on the node):

   ```json
   {
     "name": "web_search",
     "source": "web",
     "server": null,
     "tool": null,
     "allow": true,
     "risk": "read",
     "requires_approval": false,
     "egress": "open_web",
     "scopes": []
   }
   ```

2. **Set the flag AND the pair in `.env`** — three settings, and the flag
   comes FIRST: `AGENT_WEB_SEARCH_ENABLED=1` is the deployment's own INTENT
   (the run surface declares no web source without it — the pii-service
   endpoint alone can never be the presence signal, because it belongs to the
   OKF pillar and is set on every deployment), and the pair then supplies
   the ENDPOINTS (read fail-closed at assembly: an enabled deployment
   holding one endpoint is answered 503 naming the missing one):

   ```
   AGENT_WEB_SEARCH_ENABLED=1
   AGENT_SEARXNG_URL=http://searxng:8080
   PII_SERVICE_URL=http://pii-service:8000
   ```

3. **Start the services**: `PII_SERVICE_ENABLED=1` (the pii-service replica
   gate — derived for you on the ansible path, and the OKF pillar's own flag
   is the compose fallback), plus the `agent` compose profile
   (`docker compose --profile agent up -d`, or `COMPOSE_PROFILES=agent`).

4. **Recreate the agent service** — the flag and the knob pair are read once
   at assembly (`docker compose up -d --force-recreate agent-service`).

The egress rule is the tool's contract, not an option: the query passes the
pii-service first and the call fails closed if the scan fails — the raw
query never reaches the web. The scan's model is English-only (the sidecar's
shipped limitation): non-English queries are scanned best-effort.
