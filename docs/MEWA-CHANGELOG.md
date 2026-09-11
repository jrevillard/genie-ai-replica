# MEWA Bangladesh deployment — changelog and open items

Branch `climate_polisense_2-1`, server `e2e-64-29.ssdcloudindia.net` (NVIDIA A40, single host, `docker compose`).
Scope: bring the PolisenseAI / MEWA product (mid-May commit set, ancestors of `fb1fcf888`) onto the
GENIE.AI 2.1 Keycloak-era codebase, then make every user-facing flow work on this server.

Last updated: 2026-09-11.

---

## Done

### Platform and infrastructure
- NVIDIA driver upgraded 535 → **580.178.04** (CUDA 13 capable), live module reload, no reboot. Rollback kit in `/root/nvidia-rollback/`. Kernel 5.15.0-191 installed but not yet booted.
- `docker-compose.local-gpu.yaml` (new): `runtime: nvidia` for vLLM, translation vLLM, TEI, TEI reranker, dataprep, geo-inference-worker. Needed on a single host where the default runtime is `runc`.
- Password drift between `.env` and the Postgres / ArangoDB / Keycloak volumes repaired; Keycloak admin restored.
- Public domain / TLS: self-signed certificate for the domain in `secrets/ssl/`; `NGINX_HTTPS_PORT` left empty (no `:443` suffix in issuer / CORS).
- CSP allows Google Fonts, Mapbox (`api.mapbox.com`, `events.mapbox.com`), `worker-src blob:`, `img-src blob:` (nginx templates).
- Observability stack removed on request (`ENABLE_OBSERVABILITY=0`); the fluentd driver is async, so services run without the collector.
- Hugging Face token renewed; `HF_HUB_OFFLINE=1` on model services so restarts never depend on the hub.

### Models
- Chat LLM: `ibm-granite/granite-3.3-8b-instruct` on vLLM with `--enable-auto-tool-choice --tool-call-parser granite` (tool calling for the weather agent). `--enforce-eager` kept (CUDA graphs measured: 31 → 32 tok/s, not worth the KV cache).
- Translation / weather agent LLM: `google/gemma-3-4b-it` on a second vLLM (`VLLM_TRANSLATION_GPU_UTILIZATION=0.26`).
- Reranker switched to `cross-encoder/ms-marco-MiniLM-L-12-v2`; embeddings `BAAI/bge-base-en-v1.5`.
- GPU budget: chat vLLM `VLLM_GPU_UTILIZATION=0.50` (KV cache 44k tokens ≈ 35 concurrent chats) to leave ~7.8 GB for SAM / Prithvi. Measured capacity before the cut: 15 simultaneous RAG requests, mean 7.1 s, TTFT ~130 ms.

### Retrieval and generation (OPEA overlay)
- chatqna: system-prompt leakage stripped from answers; `langdetect` only trusted on ≥ 80 chars; temperature default 0.
- dataprep: agro-met crop-calendar handling (week-number cleanup, aggregated "all stages / all pests" chunks); per-chunk retry when graph conversion fails (one bad chunk no longer aborts the batch).

### Chat routing and weather
- Weather / geo router (backend `query-service.js`): keyword tiers, LLM tie-break, Bengali input translated once (cached) for routing, whitespace / digit-word normalisation, "delineate" typo tolerance, last *user* message used (the web client appends an empty assistant placeholder).
- Weather answers written directly in the UI language by the Gemma agent (Bengali header, weekday / month names, digits, soil words, district name); data-source sentence and greetings removed. Post-stream translation skipped when the answer already matches the UI language.
- RAG answers: translator moved from CPU NLLB (~18 s) to GPU Gemma (~1 s), streaming translation on (`STREAMING_TRANSLATION_ENABLED=1`), so Bengali arrives as it is generated.
- Drought questions with a long horizon go to the on-demand Earth Engine assessment (7–30 days) instead of the seasonal branch. Seasonal branch (Copernicus SEAS5, not seeded) falls back to a friendly note plus the 7-day forecast.
- All operator-facing fallback texts replaced by short user-facing sentences in English or Bengali.

### Satellite geo-inference
- `geo-inference-worker` added to compose (profile `climate`, GPU): field delineation (Sentinel-2 via GEE + SAM ViT-H) and flood extent (Prithvi-EO-2.0). Model weights cached in the `geo_inference_models` volume.
- SAM released after every run and GPU jobs serialised (second request used to hit CUDA OOM); Prithvi runs in a child process so memory is returned; flood inference on GPU (42 s → 27 s).
- Earth Engine key: `secrets/credentials.json` → symlink to the IEEE service-account file; `GEE_PROJECT=ieee-challenge`; secrets JSON git-ignored; drought-monitoring gets the mount too.
- Verified: 84 field polygons around Dhaka in ~40 s (first run downloads 2.5 GB SAM), flood map, live drought assessment for any district.

### Web app (MEWA branding and UX)
- Title "MEWA Bangladesh" in tab (static and from config), navbar, Keycloak login page (realm display name persisted via `KEYCLOAK_REALM_DISPLAY_NAME`).
- Navbar text / icons / hamburger white in light and dark mode (configured navbar colours now win over the dark-mode token).
- Locales limited to English and Bengali (`VUE_APP_AVAILABLE_LOCALES=en,bn`); Keycloak login page English only (no Bengali theme exists).
- Quick-help chips: just chat, weather this week, drought status, field map, flood map, crop planning (config-driven, bilingual).
- Logo / brand click leaves the conversation and returns to the dashboard (save / discard prompt if unsaved).
- Map overlay (Mapbox GL) opens from answer metadata for delineation / flood results.
- Crop alert banner: visible close button (SVG, no icon font), Bengali labels and translated engine text (Redis-cached), district-aware (browser location → nearest of 64 districts, cached a day, Dhaka fallback), notice cards for general / district broadcasts with per-notice dismiss.
- Drought PDF report served through a public, whitelisted backend route (links open without a bearer header).
- Welcome message and password-reset screen say MEWA; lint errors inherited in the password-reset screen fixed so the pre-commit hook passes.

### Notifications (backend)
- FCM push service ported from the PolisenseAI branch (BullMQ + firebase-admin): device-token registry with district / crop / alert-type preferences, broadcast fan-out, idempotent broadcasts, load-test script. Routes use Keycloak; `x-notification-secret` guards broadcast for the warning engine.
- Broadcasts are now always stored; push is skipped (status `stored`) while Firebase credentials are absent, so the web banner works on its own.
- `GET /api/notifications/latest?district=` for the web banner (general + district notices, last 48 h).
- Warning engine posts weather warnings to the backend broadcast route (`BACKEND_API_URL`, shared secret).

---

## Remaining action items

### Needs something from you
1. **Firebase service account** → `secrets/firebase-service-account.json` (path already git-ignored; `GOOGLE_APPLICATION_CREDENTIALS` in `.env`). Until then Android push is skipped and only the web banner shows notices.
2. **SMS provider**: name the gateway trialled earlier and its API; a provider seam in `warning_system_engine/app/core/notifier.py` replaces the hard-wired Twilio calls (tier 3 SMS, tier 4 voice). Also decide where per-district emergency contact numbers live.
3. **Copernicus CDS key** (`CDSAPI_KEY`) for the seasonal outlook; without it the seasonal branch keeps falling back to the 7-day forecast.
4. **Real TLS certificate** (Let's Encrypt via certbot, `CERTBOT_EMAIL`) — currently self-signed.
5. **Visual sign-off and commit cadence**: two global stylesheets were reverted from the IDE once and silently undid a fix; commit after each verified change.

### Build next
6. **Admin "compose notification" form** (or endpoint for admins) posting to `/api/notifications/broadcast` with districts or "everyone"; single entry point for Android push and web notices. Do together with item 1 so it can be tested on a device.
7. **Mobile app** (28 Flutter files untouched): Keycloak OIDC, FCM token registration with district preference, weather / map screens. Android-only FCM for now.
8. **Bengali district names in the drought report / seasonal outlook** and the remaining English strings in longer markdown answers (currently machine-translated; the short sentences are templated).

### Nice to have / known quirks
9. Keycloak theme still ships the GENIE.AI logo image and "GENIE.AI" email subjects; a Bengali login page needs a custom theme.
10. Gemma occasionally emits a stray foreign suffix on a Bengali city name; NLLB is no longer used, but the translator can drop an en dash ("65–80%").
11. Faster chat decode needs a quantised Granite build (AWQ/int4); CUDA graphs gave ~3%.
12. Reboot into kernel 5.15.0-191 at a convenient time (driver already runs on the current kernel).
13. Unit tests for the new banner behaviour and the notices endpoint; the Playwright E2E suite has not been run on this deployment (headless server, Chromium intentionally not installed).
14. `VLLM_GPU_UTILIZATION` can go back up (0.625–0.65) if the geo worker is ever disabled.

---

## Where things live
- Secrets: `secrets/` (SSL, `credentials.json` → GEE key, future Firebase JSON). All `*.json` there are git-ignored.
- Deployment variables: `.env` (never committed); template and documentation in `env`.
- Local GPU override: `docker-compose.local-gpu.yaml`; always pass `--profile opea --profile gpu-models --profile climate`.
- Rebuild a service: `docker compose <profiles> -f docker-compose.yaml -f docker-compose.local-gpu.yaml build <svc> && ... up -d --no-deps --force-recreate <svc>`, then `docker restart genie-ai-kong-1` after recreating the backend or frontend.
