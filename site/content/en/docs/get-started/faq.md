---
title: "FAQ"
weight: 8
description: "The 12 questions deployers ask first — answered in one paragraph each."
mode: explanation
persona: mixed
owner: docs-stewards
last_reviewed: 2026-09-18
---

## The 12 most common questions

### 1. Do I need a GPU?

For a **demo / pilot** with 100s of documents and a handful of users, no — the
backend works without OPEA, but the chat will say *"I cannot answer"*
because the LLM is not running. For **production**, yes — a single 24 GB GPU
(RTX 6000 ADA or A40) is enough for embedding + reranking + a 7B-chat
LLM. The minimum for a 7B model is 16 GB. See
[Deploy → GPU profiles](/docs/deploy/gpu/).

### 2. Can I run GENIE.AI fully air-gapped?

Yes. Pull the 16 Docker images from the GitLab Container Registry onto a
machine with internet, copy them (`docker save` / `docker load`), and run the
Compose stack on the air-gapped host. Models are pulled at first start from
HuggingFace Hub (set `HUGGING_FACE_HUB_TOKEN` in `.env`); for air-gapped
deployments you must pre-warm the `hf_cache` Docker volume or set
`HF_HUB_OFFLINE=1` with the model baked into the image at build time.

### 3. Does it work with my SSO?

Yes — Keycloak brokers to Google, Microsoft Entra, generic OIDC, or SAML.
See [Configure → External IdP](/docs/configure/external-idp-integration-guide/).

### 4. How is data isolated?

ArangoDB runs in your perimeter. The backend, ChatQnA, and the OPEA stack
talk to it over the Docker network. Nothing leaves your host unless you
explicitly configure a remote GPU node
([Deploy → Remote GPU](/docs/deploy/gpu/)).

### 5. Can I use a different LLM?

Yes. Override `VLLM_LLM_MODEL_ID` in `.env` to any
[vLLM-supported](https://docs.vllm.ai/en/latest/models/supported_models.html)
chat model. Restart the `vllm` service. For a labelled-by-tagging pipeline
you also need the model to support guided JSON (`response_format={"type":
"json_object"}`).

### 6. How do I add a new language?

The chat UI locales are configured by `VUE_APP_AVAILABLE_LOCALES` (web) and
`KeycloakConfig.supportedLocaleCodes` (mobile). Keycloak login pages use
`KEYCLOAK_SUPPORTED_LOCALES`. See [Restrict active locales](/docs/configure/locale-whitelist/)
for the canonical reference. For translations, see
[Contribute → i18n](/docs/contribute/i18n/).

### 7. What's the cost of running this?

For a single-node Compose setup on commodity hardware (no GPU): **~2 GB RAM
and 1 CPU per core service**. With OPEA: **add 1× 24 GB GPU and 16 GB host
RAM**. The observability stack adds **~1 GB RAM per Victoria* node and
~500 MB disk per day** at low traffic.

### 8. How do I update to a new release?

See [Operate → Updates](/docs/operate/updates/). The short version:
`git pull && docker compose pull && docker compose up -d`. Changing the
embedding model (`EMBEDDING_MODEL_ID`) requires a full re-ingest because
existing chunk vectors live in the old model's space; LLM, reranker, and
translation model changes are query-time and only need a service restart.

### 9. How do I back up?

`arangodump` against the running ArangoDB container, then copy the dump off
host. See [Operate → Backup & restore](/docs/operate/backup-restore/).

### 10. How do I see logs?

The admin UI's **Logs** tab (VictoriaLogs-backed) is the operator surface.
Direct Grafana access: `https://<host>/grafana/` → Explore → VictoriaLogs
datasource. See [Operate → Admin logs](/docs/operate/admin-logs/).

### 11. How do I add my own documents?

Upload through the admin dashboard (**Admin → Knowledge base → Upload**), or
the document-repository HTTP API. See
[Knowledge base → Ingestion](/docs/knowledge-base/ingestion/).

### 12. Where do I report a problem?

[Open an issue](https://opensource.unicc.org/un/itu/genie-ai/-/issues) on
GitLab, or — if you can — send a merge request. See
[Contribute → How to open a MR](/docs/contribute/how-to-mr/).

## Related

- [Concepts in 5 minutes](/docs/get-started/concepts/)
- [Deploy → Choose your deployment mode](/docs/deploy/install-guide/)
- [Operate → Troubleshooting](/docs/operate/troubleshooting/)