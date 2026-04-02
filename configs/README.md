# LLM Prompts Configuration

This directory contains default LLM behavior prompts for GENIE.AI services.

## How It Works

Prompts are loaded via Docker secrets mechanism, providing cloud-native configuration that works identically across all environments (Compose, Swarm, Kubernetes).

## Three-Tier Priority System

1. **ENV VAR** (highest) - Override inline in `.env`
2. **FILE** (medium) - Custom files in `configs/prompts/`
3. **DEFAULT** (lowest) - Built-in prompts in code

## Available Prompts

| File | Service | Purpose |
|------|---------|---------|
| `chatqna-system.txt` | ChatQnA | Main LLM system prompt for RAG responses |
| `chatqna-abstention.txt` | ChatQnA | Instructions when no relevant documents found |
| `label-selector.txt` | Dataprep | LLM prompt for automatic document labeling |

**Note:** `label-selector.txt` contains a `{labels_list}` placeholder that is dynamically replaced by the code at runtime with the actual label taxonomy.

## Usage

### Default (Recommended)
The files in this directory are the defaults. No action needed.

### Customization

**Option 1 - Edit files directly:**
```bash
# For ChatQnA prompts
nano configs/prompts/chatqna-system.txt
docker compose restart chatqna-xeon-backend-server

# For label selector
nano configs/prompts/label-selector.txt
docker compose restart dataprep-arango-service
```

**Option 2 - Environment variable override:**
```bash
# In .env
CHATQNA_SYSTEM_PROMPT="Your custom prompt here..."
```

## Tips

- Keep prompts focused and specific
- Include clear instructions for edge cases
- Test changes in development before production
- These files ARE committed to git (configuration, not secrets)
