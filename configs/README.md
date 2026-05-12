# Configuration Directory

This directory contains OPEA (Open Platform for Enterprise AI) configuration files.

## Contents

- `keycloak/` - Keycloak Identity Provider (Dockerfiles, realm configuration)
- `opea-config/` - OPEA service configuration files
- `postgres/` - PostgreSQL initialization (multi-database setup)

## LLM Prompts

LLM prompts are now **built into the Python code** with a two-tier override system:

1. **ENV VAR** (highest) - Override in `.env` for deployment-specific customization
2. **DEFAULT** (lowest) - Built-in prompts in Python code

### Prompt Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `CHATQNA_SYSTEM_PROMPT` | ChatQnA | Main RAG system prompt; built-in default is Master Farmer Bot guardrails (closed KB, citations, Lesotho scope, safety, mandatory sections) in `genieai_chatqna.py` |
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
