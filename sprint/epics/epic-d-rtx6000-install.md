# Epic D — rtx6000 fresh install execution

**HARD GATE:** D does not start until A2–A5, B1–B3, C1 are done AND DEC-1 + DEC-9 (+ every
DECIDE gating those) are answered in decisions.md. Fresh box → PG16 native (migration runbook
N/A here); re-ingestion required (bge-m3). Target env: `agrivisory_rtx6000` (post-B5).
Install doc: `docs/deploy-rtx6000.md` (post-C2).

## D1 — preflight on rtx6000
Run B2 preflight + B1 cert check against rtx6000 inventory. Print full chosen config (domain,
cert_mode, models, deploy_mode, profiles) for Adem's eyeball BEFORE deploy.
**AC:** preflight green; plan block pasted into plan.md §Log and confirmed by Adem.
**Gate:** this IS the gate. **DECIDE:** DEC-1, DEC-9 answered.

## D2 — deploy
`ansible-playbook -i inventory/rtx6000.ini deploy.yml` local mode, profiles opea + gpu-models
(models ON box; `gpu_node_host` empty). Vault via README flow.
RUNBOOK (A6 review finding): **set `admin_bootstrap_email` (= `GENIE_ADMIN_EMAIL` vault) in the
rtx6000 env render — 005-seed-admin seeds/promotes that doc `status:'Active'` + `roles:['admin']`;
leave it unset and the first admin's own first login lands Pending with no admin able to approve
them (chicken-and-egg).**
**AC:** compose ps — 11 healthchecked + 3 one-shots green; front door 200; kong routes live.
**Gate:** live checks pasted to plan.md. **DECIDE:** none beyond D1.

## D3 — auth end-to-end on the real domain
Browser: login via realm (real domain certs), callback lands authenticated; silent renew
observed; forced-expiry 401 → recovery; Adem's own account JIT-provisioned → approved → role
applied. Also `https://<domain>/auth/...` well-known + admin console reachable.
CHECKLIST ADDITION (DEC-14): hit both `https://agriconnect.site` AND `https://www.agriconnect.site`
— both must be trusted (cert carries both SANs) and serve the app (nginx `server_name _`).
CHECKLIST ADDITION (A6 defer): with real SMTP live, click admin resend-verification once —
if Keycloak 400s "Redirect URI missing", add `client_id` + `redirect_uri` params to
`keycloak-proxy-service.sendVerifyEmail` (the only A6 proxy call never live-tested; smoke had
no SMTP).
**AC:** manual checklist all green, results logged. **Gate:** checklist. **DECIDE:** none.

## D4 — real-model chat round-trip (S2b at last)
vLLM (granite per DEC-9) + TEI (bge-m3) + reranker on the 96GB box; streamed chat completes
end-to-end; SSE legs correct (backend→browser progressive; chatqna token-burst known).
**AC:** real tokens in response; query persisted; retrieval metadata present.
**Gate:** curl + UI proof in log. **DECIDE:** none.

## D5 — re-ingestion + retrieval checks
Ingest Agrivisory corpus (doc-repo → dataprep → Arango, bge-m3 vectors, labeling per DEC-9
config). Retrieval returns expected chunks for known queries; BM25 + vector paths both live.
**AC:** known-query retrieval hits. **Gate:** retrieval smoke results in log. **DECIDE:** none.
