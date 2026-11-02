# Epic F — post-D4 hardening (night-audit fixes)

Born from the 09-28/29 overnight read-only audit (methodology + full evidence:
`_bmad-output/test-artifacts/d4-night-audit.md`). Two user-reported symptoms started it —
weird chat responses + admin "model not connected" — both root-caused (F2, F7). The audit
kept going: 33-agent adversarial verification + 8-surface round 2 + implementation-grade IDOR
checklist; 13 confirmed / 8 partial / 0 refuted candidates, ~130 sweep findings, live probes.

**Wave 1 (F2, F5, F7, F9-frontend, F11, round-2 smalls) was implemented the same night, in
the working tree, uncommitted — every story below marked [wave-1 done] lists its landed
changes. Nothing else is done.** Gates after wave 1: backend 16 suites/207, frontend
13/231, kong 34, compose both modes.

## F1 — make live match HEAD (deploy provenance + coordinated recreate)
The d4-fix (5e5b5265) likely never deployed: backend+chatqna restarts PREDATE the 16:54
commit; gemma absent from docker ps; spec-d4 says redeploy "pending Adem". F1 = run Adem's
two vintage one-liners (`docker exec <chatqna> env | grep LLM_MODEL`; `docker ps -a | grep
translation-guardrail`), then ONE coordinated recreate (backend + chatqna + guardrail env
+ this sprint's compose changes — not three outages), then the d4 + wave-1 live proofs.
**AC:** running containers match HEAD digests; chatqna LLM_MODEL env = granite-4.1-8b;
guardrail chain up or consciously retired; front door green after recreate.
**Gate:** vintage one-liners pasted to plan.md; live chat round-trip (D4's own gate).
**DECIDE:** DEC-17 (recreate window — brief downtime).

## F2 — kill the bytes-repr wire format [wave-1 done — backend side]
chatqna streamed every token as a Python bytes repr; the backend stripped only the wrapper,
leaking literal `\n`, `b"it's"` wrappers, `\xNN` mojibake, doubled backslashes — and
JSON.parsing the token DROPPED numeric chunks (digits vanished from answers). Landed:
full repr decoder in query-routes.js (both quote forms + complete escape set, emit as
plain delta), 7 new regression tests (every escape class + realistic multi-paragraph
answer), SSE heartbeat comments every 15s (mobile idle drops), done sent BEFORE Arango
persistence (spinner no longer hangs on a DB hiccup). Follow-up (with F1's recreate):
chatqna emits JSON deltas natively; backend decoder stays as compat.
**AC:** streamed answers contain real newlines/markdown, contractions intact, digits
intact, accents intact; truncation/error events visible to the user.
**Gate:** backend stream suites; live UI proof after F1. **DECIDE:** none.

## F3 — unblock D5 ingestion (dataprep callback auth, embedding model, graph name)
Dataprep 403s its callback (client-auth wiring); ingest-side embedding model + graph
mismatch with the retriever; stuck-'Ingesting' docs have no recovery; ClamAV handler
unmounted in doc-repo. D5 MUST NOT ingest before this lands (wrong-dimension vectors are
persistent poison).
**AC:** corpus ingest completes; chunks retrievable; failed batches surface as failed.
**Gate:** D5 retrieval smoke. **DECIDE:** DEC-18 (dataprep service-account approach —
touches genie-realm.yaml; coordinate with any F5 realm pass).

## F4 — translation: run it or make it honest
gemma container down since the 0.3 crash-loop (never recreated at 0.12); streamed answers
never translate (streaming path skips _finalize_llm_response); chatqna lacks the
VLLM_TRANSLATION_MODEL_ID env. Backend CPU-NLLB fallback works but is silent.
**AC:** either gemma up + Sesotho round-trips, or English-with-a-visible-notice while it's
down — never a silent wrong-language answer.
**Gate:** st-locale chat probe. **DECIDE:** DEC-19 (product requirement: must answers be
Sesotho?).

## F5 — object-level authorization (IDOR family) [wave-1 done — code, pending deploy]
21-route checklist implemented: owner-or-admin guards on user profile
read/update/delete/context (+ admin whitelist projection), user directory requireAdmin +
KEEP projection, query read/search scoping + server-side attribution on POST / + /stream +
analytics events, session read/end/keepalive/user scoping, conversation
read/patch/messages/read/export/move/folder via getConversationOwnerId, folder
get/patch/path + links via userFolders edge, query-clone + message→query owner checks,
service-category + analytics raw-dump requireAdmin. Non-owner reads 404 (no oracle).
17-test suite pins it. NOT done (needs Adem): check-email enumeration oracle deletion
(permission-blocked tonight — flagged), role-semantics questions (AI-Engineer gating).
**AC:** idor-guards suite green; a non-admin token cannot read/mutate another user's
resources anywhere.
**Gate:** backend suite + tomorrow's authenticated two-account browser probe.
**DECIDE:** DEC-20 (AI-Engineer role API access vs hide tabs; check-email deletion).

## F6 — perimeter closures
Arango 8529 was internet-exposed (live-confirmed 401 from outside) — compose now binds
127.0.0.1 (ARANGO_BIND_IP knob, needs F1 recreate to take effect). Still open: swagger
/api-docs.json public (107 paths), source maps published, Keycloak master console open,
secrets in logs (ARANGO_PASSWORD, Bearer + chat bodies), rotation of everything the
exposure window touched.
**AC:** 8529 unreachable from outside; api-docs gated in prod; logs secret-free.
**Gate:** external port scan + curl probes. **DECIDE:** DEC-21 (rotation window — brief
arango/backend restart; log review for foreign IPs during the exposure window).

## F7 — dashboard truth I: the "model not connected" complaint [wave-1 done — code side]
Root cause bundle: backend container never received the model env vars the admin code
reads → "Not configured" cards + llmModel 'unknown'; fabricated placeholder rows
(externalApi=error, storage=warning) rendered as real; probes dishonest (any-4xx→good,
chatqna probed at /); NavBar called the admin endpoint for every user (403 toast sitewide).
Landed: backend compose env contract (8 model vars), placeholders → neutral unknown state,
chatqna probed at /health, 404-on-a-health-endpoint = warning, NavBar admin-gated,
locale keys for the service rows. Remaining: the AI-config card needs the F1 redeploy to
show live values; live authenticated verification.
**AC:** admin dashboard shows real model ids/endpoints, honest probe states, zero
fabricated data; non-admin pages make zero admin calls.
**Gate:** authenticated admin pass after F1. **DECIDE:** none.

## F8 — dashboard truth II: admin actions that work
Dead DB-maintenance buttons (404 — arangodump not in the backend image), rollover success
shown as error, fabricated analytics on failure, wrong metrics, analytics double-insert,
~50 unlocalizable admin strings.
**AC:** every visible button works or is gone; success means success.
**Gate:** authenticated admin click-through. **DECIDE:** DEC-22 (backup mechanism:
clienttools in image vs sidecar vs drop the button — decide AFTER F6's bind lands).

## F9 — streaming chat integrity [wave-1 done — frontend]
Landed: error STRINGS surfaced (backend reason reaches the bubble + toast), EOF-without-done
= truncation error with partial text (never clean success), partial+error marked truncated
in the bubble, double-submit guard, AbortController + unmount cleanup (orphaned streams no
longer burn vLLM), 150s no-progress watchdog (heartbeats keep it from firing on healthy
silence). Backend: Kong retries 5→0 on express-api (no more replayed chat POSTs), done
before persistence (F2). Remaining (small, unfixed): Stop button UI; classic-path empty
guard (V6 residual — empty-200 persisted as answered, PARTIAL/low).
**AC:** every failure mode a user can hit is visible and correctly labeled.
**Gate:** streamingService suite (8) + live failure-injection probe. **DECIDE:** none.

## F10 — protect the graph (ingestion correctness before D5 corpus lands)
Embedding-dimension bomb at D5 (ingest vs retrieve model mismatch), all-failed batches
marked 'Ingested', empty chunk_labels invisible to filtered queries, label-comma contract,
farmhash keying. Depends on F3.
**AC:** same doc ingested twice = no duplicates; a retracted passage stops being retrieved.
**Gate:** retract-and-recheck probe. **DECIDE:** none.

## F11 — API/data integrity grab-bag [wave-1 done — escaper]
Landed: global query-string HTML-escaping removed (validate-don't-mutate; apostrophe
searches work again), CORS deny = header-omission not HTTP 500, approve response carries
emailNotification sent/failed/skipped. Open (unfixed): boolean filters never match /
invert, serviceId array-vs-scalar, localized labels as DB keys, res.json 10-digit date
rewrite, unbounded feedback rating.
**AC:** search-with-quotes matches; filters filter.
**Gate:** backend suites + manual search probe. **DECIDE:** none.

## F12 — chat UX polish and trust signals
Cancel-must-not-wipe-conversation, error bubbles replayed as assistant history (partial
fix landed via truncation marking; full fix = don't re-feed error bubbles as context),
context-less chats have zero memory, grounding notices (is_grounded never read),
pinch-zoom [done], keyboard-only sidebar, language-switch page reload destroying unsaved
chats, ~1MB unused locale bundle, hardcoded English strings.
**AC:** cancel keeps the conversation; the save/replay path never re-feeds error text.
**Gate:** frontend suites + scripted UX pass. **DECIDE:** none.

## F13 — docs & config truth (RUNS LAST — pulls final numbers)
Runbook drift: guardrail row, keycloak-config "Exited is normal" line (it sleeps by
design — make doc match code), GPU headroom numbers, /healthz consumers, KC admin-password
rotation trap (bootstrap is first-start-only — realm-as-code dies silently on rotation),
ARANGO_DB vs ARANGO_DB_NAME split-brain, deploy verify blind to the AI tier (verify only
checks backend+frontend), README truth, og:url [done], dead kong route [done].
**AC:** the 3am operator follows deploy-rtx6000.md and meets no surprises.
**Gate:** doc-vs-live diff pass. **DECIDE:** DEC-23 (GRAPH vs GRAPH_TEST flip timing +
whether any pilot data must survive).

## Explicitly not in this epic
Rejected/approved-scope items live in the audit report's refuted list. Deployment of
anything here = F1's coordinated recreate, Adem's terminal, vault in hand.

## F14 — URGENT (DEC-24, 09-30): translation model swap + pending-screen fix
(a) Swap VLLM_TRANSLATION_MODEL_ID to qvac/TranslatePsy-AfriSLM-4B (text-only; kills the
gemma multimodal vLLM deadlock AND delivers DEC-19-R). Check the non-translategemma prompt
path in chatqna (generic branch exists — verify it fits AfriSLM), guardrail image/env/compose
fallbacks, test pins; redeploy the guardrail. (b) PendingApprovalScreen "Back to Login" is
dead — the user still holds a valid SSO session, so login() silently re-auths → guarded route
→ 403 ACCOUNT_PENDING → httpService redirects back = loop. Fix: the button must log out
(id_token_hint) then land on the KC login page; also ensure the screen itself makes zero API
calls (no self-triggering 403s).
**AC:** guardrail healthy on AfriSLM + a translated probe round-trips; the pending screen's
button reaches a real login page; no redirect loop. **DECIDE:** DEC-24 (settled).

## F15 — NLLB-200-3.3B GPU translation service (DEC-25; resolves DEC-19-R, supersedes DEC-24)
Dedicated `nllb-translate` sidecar (FastAPI + transformers bf16, local Blackwell-torch
build, gpu-models profile) exposing /translate {texts, source, target} in FLORES-200 codes.
chatqna `_translate_text_chunk` + backend GpuTranslateBackend both route to it (one batched
call at the backend; ISO→FLORES mini-map {en, st} in chatqna); F4 contract untouched
(translation_unavailable, never error). vllm-translation-guardrail DELETED (vLLM 0.30 hangs
on this box; OpenAI API can't express src_lang/forced_bos). granite 0.75 → 0.80.
OPEA translation/guardrail microservices stay untouched (inert, deferred-work).
**AC:** sidecar /translate round-trips eng_Latn→sot_Latn on the box; English path
byte-identical; persisted answer = translated text; preflight + compose config green.
**Gate:** overlay pytest + backend jest grow; Adem's live probes per deploy-rtx6000.md
§translation-model. **DECIDE:** DEC-25 (settled, Adem 09-30).
