---
title: "Tune the chat stream idle timeout"
description: "How long the web UI waits for a silent chat stream before reporting a timeout. Covers VUE_APP_STREAM_IDLE_TIMEOUT_MS."
weight: 7
---

When the assistant's stream goes silent — the backend is unreachable upstream, or a model call hangs — the web UI does not wait forever. A watchdog in the frontend aborts the connection after an idle budget and shows the localized "not responding" error on the turn, together with the retry affordance.

## The variable

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `VUE_APP_STREAM_IDLE_TIMEOUT_MS` | `.env` (rendered by `docker-entrypoint.sh` into `window.APP_CONFIG.streamIdleTimeoutMs`) | 300000 (5 min) | Milliseconds of stream silence (no data frame) before the frontend aborts the request and reports a timeout. |

The budget resets on every received data frame, so a slow-but-flowing generation is never interrupted — only a genuinely silent connection trips the watchdog. The backend's keepalive SSE comments deliberately do **not** reset it: a live connection with a stuck backend must still time out.

## Sizing it

The default must outlast the slowest legitimate time-to-first-frame: the backend's LLM timeout (`MODEL_LLM_TIMEOUT_SECONDS`, default 180 s) plus retrieval and reranking. Raise the variable on deployments with slower GPU nodes:

```bash
# .env — allow up to 15 minutes of silence
VUE_APP_STREAM_IDLE_TIMEOUT_MS=900000
```

Lowering it below the backend's own budget discards answers the backend is still computing and would have returned.

On Ansible deployments, set `vue_app_stream_idle_timeout_ms` in the environment's `vars.yml`; the `env.j2` template renders it into the stack's env file only when defined.

## Where it lands

`docker-compose.yaml` passes the variable to the frontend container; the entrypoint bakes it into `/app/dist/runtime/config.js` as `window.APP_CONFIG.streamIdleTimeoutMs`; the streaming client in `chatbotService.submitQueryStream` reads it at each request.
