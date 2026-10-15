# Capacity sizing — the four OKF lane variables

Step-by-step for sizing `OKF_IMPORT_CONCURRENCY`, `PII_WEB_CONCURRENCY`,
`OKF_INGEST_CONCURRENCY` and `DATAPREP_INGEST_CONCURRENCY` for the host a
deployment targets.

**The shipped defaults are a floor, not a recommendation.** On a 24-core host
the import pair of 4/4 was measured at ~18% utilisation — the rest of the
machine idle. A deployment to anything larger than a small VPS should set these
deliberately.

**These are configuration. Never edit service source to change them.** They are
read once at process start, so the affected containers must be recreated.

## The two pairs

| Pair | Creation side | Worker side | Consequence of raising one half alone |
|---|---|---|---|
| **Import** | `OKF_IMPORT_CONCURRENCY` | `PII_WEB_CONCURRENCY` | extra lanes **queue at the PII sidecar** — latency up, throughput flat |
| **Drain** | `OKF_INGEST_CONCURRENCY` | `DATAPREP_INGEST_CONCURRENCY` | extra lanes get **429** from dataprep; the worker backs off and retries |

**Set both halves of a pair to the same value.** The pairs are bounded by
different resources, which is why they are not sized the same way:

- **Import** is bounded by the host's own **CPU and RAM**. The dominant cost is
  the PII sidecar's model scan, which runs locally and scales with cores.
- **Drain** is bounded by the **model services**, not the host. Labelling calls
  the LLM and the embedding service — shared, often on one GPU. More slots do not
  use more of the machine; they queue on the model, and on a shared GPU they take
  capacity away from chat answering. Size this pair against the models'
  headroom, **not** against the core count.

## Table

| Cores | RAM | Import pair | Drain pair |
|---:|---:|---:|---:|
| 4 | 8 GB | `2` | `2` |
| 8 | 16 GB | `4` | `4` |
| 16 | 32 GB | `8` | `8` |
| 24 | 64 GB | `12` | `12` |
| 32+ | 64 GB+ | `16` (clamp ceiling) | `16`, then follow the model services |

## Apply

Values come from `.env` (Compose) or `group_vars` (Ansible). Nothing is rebuilt.

```bash
docker compose up -d --force-recreate okf-server pii-service dataprep-arango-service
```

Then, per the standing rule, `docker compose restart kong`.

## The memory check — do this BEFORE choosing the import value

`PII_WEB_CONCURRENCY` is a memory setting first and a CPU setting second. Each
worker process loads its own copy of the detection model: **measured ~640 MB per
worker** (sidecar at 2.57 GiB with 4 workers). Budget `workers × 640 MB` against
*free* RAM. At `12` that is about 7.7 GB. A host that cannot afford that should
lower the import pair, not raise it into swap.

**Counting the workers.** The spawned workers are `multiprocessing.spawn`
children, so they do **not** appear as `uvicorn` in `ps`. A `ps | grep uvicorn`
count of 1 or 3 on a healthy sidecar is normal and is not evidence of failure:

```bash
docker exec <pii-container> sh -c \
  'for p in $(ls /proc | grep -E "^[0-9]+$"); do c=$(tr "\0" " " < /proc/$p/cmdline); \
   case "$c" in *spawn_main*) echo "pid $p";; esac; done' | wc -l
```

## Verify — do not infer from timing

Every import writes the capacity it actually started with to the okf-server log
under `OKF import lane capacity`:

```
OKF import lane capacity  repo_id=… concepts=… import_concurrency=12
  pii_web_concurrency=12 paired=true cores=24
```

- `paired: false` → import lanes exceed the sidecar's workers; the extra lanes
  are queueing. Fix the mismatch.
- `pii_web_concurrency: unset` → the two settings were not applied to the same
  deployment (the var belongs to the sidecar service; it is normally absent from
  okf-server, which is exactly the signal that nobody set both ends).

A stuck-drain lane is a different failure and is not a sizing problem — see the
reaper settings in `env` (`OKF_INGEST_WORKER_REAP_GRACE_MS`,
`OKF_INGEST_WORKER_MAX_CLAIMS`).

## Related

- User-facing guide: `site/content/en/docs/configure/okf-variables.md`
- Operator reference for every variable: `env`
- `OKF_INGEST_MAX_CONCEPTS` is a **capacity** knob, not a safety limit, and is
  applied *after* the document-ceiling split — the number of documents selected
  is not the number the cap sees (999 Bali documents expanded to 1112 concepts).
