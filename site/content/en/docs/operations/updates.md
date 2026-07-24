---
title: Updates
description: Updating models, service images, and the GENIE.AI stack — and which changes require re-ingesting the knowledge base.
weight: 2
---

GENIE.AI has three kinds of update, with different blast radii. The critical
thing to know is **which updates force a knowledge-base re-ingestion**.

## The re-ingestion rule

| Change | Re-ingest required? | Why |
|---|---|---|
| **LLM** (`VLLM_LLM_MODEL_ID`) | **No** | The LLM reads chunks at query time; it does not change stored data. Restart vLLM. |
| **Reranker** (`RERANKER_MODEL_ID`) | **No** | Reranking is a query-time re-score. Restart the reranker / TEI. |
| **Translation** (`VLLM_TRANSLATION_MODEL_ID`) | **No** | Translation is query-time. Restart the translation service. |
| **Embedding model** (`EMBEDDING_MODEL_ID`) | **Yes** | Existing chunk vectors are in the old model's space. Re-ingest everything. |
| **Labelling taxonomy** | **Recommended** | Labels are stored on chunks at ingest time; a changed taxonomy needs re-labelling. |
| **Chunking / dataprep logic** | **Yes** | Chunk boundaries and content change. |

> **Changing the embedding model is the expensive update.** Plan a full re-ingest
> (see [Knowledge base]({{< relref "/docs/knowledge-base" >}})) when you change
> `EMBEDDING_MODEL_ID`. Everything else is a service restart.

## Updating a model

1. Edit `.env` (e.g. set `VLLM_LLM_MODEL_ID=...`).
2. Restart the service so it picks up the new model:
   Swarm: `docker service update --force genieai_vllm`
   Compose: `docker compose up -d vllm`
3. The new model will be pulled automatically on startup.
4. Confirm via the [Observability]({{< relref "/docs/observability" >}})
   `docker service update --force genieai_vllm` (Swarm), or
   `docker compose up -d vllm` (Compose).
4. Confirm via the [Observability]({{< relref "/docs/observability" >}})
   dashboards that the new model is serving and latency is normal.

For GPU-profile-specific settings, the `env.t4` / `env.rtx6000` files override
memory and length limits — see [GPU deployment]({{< relref "/docs/deployment/gpu" >}}).

## Updating service images

When a GENIE.AI component image is rebuilt (CI produces a new tag):

```bash
# Swarm — update GENIE_AI_GLOBAL_TAG in .env, then re-deploy
# (images are pulled automatically from GitLab Container Registry)
sed -i "s|^GENIE_AI_GLOBAL_TAG=.*|GENIE_AI_GLOBAL_TAG=<new-tag>|" .env
ansible-playbook -i inventory/<env>.ini deploy.yml --tags deploy --vault-id <env>@prompt

# Compose (local dev) — rebuild locally
docker compose build <service>
docker compose up -d <service>
```

For Ansible-driven deployments, a tagged re-run of `deploy.yml` pulls the new
images and re-deploys. See `deploy/ansible/README.md`.

## Updating the stack

A stack update (new `docker-compose.yaml`, new config, schema migration) is the
broadest change:

1. Read `docs/database-migrations.md` (internal) for any required ArangoDB
   migration order.
2. Back up first — see [Backup & restore]({{< relref "backup-restore" >}}).
3. Re-deploy via Ansible or Compose.
4. Watch the observability dashboards and the ingestion log for regressions.

> **Update cadence.** Take a backup before every stack update, and keep at least
  the previous-known-good image tags so you can roll back. An update without a
  rollback path is not an update — it is a cutover.
