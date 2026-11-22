# V08 rehearsal runbook — routing rollback agentic↔legacy, on a real deployment

Re-runnable procedure for the V08 rehearsal (Epic 3 story 3.3; re-executed per
delivered stage). The rehearsal proves three things against a REAL deployment:

1. **Routing both directions**: the flag on routes a turn to the agent
   service; the flag off (a process restart — the documented switch semantic,
   `components/gov-chat-backend/services/agent-routing.js` reads `AGENT_ENABLED`
   once at module load) routes the SAME conversation's next turn to legacy
   chatqna; the flag on again routes back.
2. **In-flight treatment at switch time** (ADR agentic-003): a stream started
   before a backend restart either completes inside the shutdown window or
   ends like a hard stop — whichever occurs is recorded with timestamps.
3. **The BFF-upstream-timeout / agent-deadline pair**, validated from the
   DEPLOYED values against the derivation constants
   (`docs/agent-budget-deadline-pairs.md`, `agent-frame-writer.js`).

A full agent ANSWER is deliberately not part of the rehearsal's acceptance:
the venue's GPU endpoint has no tool-calling flags pinned (issue #2052,
operator-owned remediation), so the agentic direction's honest outcome is the
agent run failing at the model leg. That outcome is venue evidence, recorded —
not a rehearsal failure, and never silently turned into a requirement (FR-26).

## Venue facts (verify at preflight, never assume)

| Fact                             | Value                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Cluster / namespace              | the shared k3s dev cluster, namespace `genieai`                                                                            |
| Shared backend image             | `genie-ai-backend:main` — PRE-agentic; cannot rehearse routing (dedicated deployments required)                            |
| GPU LLM endpoint                 | `https://ai.assembly.govstack.global:444/llm`, model `ibm-granite/granite-4.1-8b`                                          |
| GPU embed / rerank / translation | `https://ai.assembly.govstack.global:444/{embed,rerank,translation}`                                                       |
| Keycloak internal                | `http://keycloak-service.genieai.svc.cluster.local:8080/auth`, realm `genie`, client `genie-app`                           |
| ArangoDB                         | `http://arangodb-single.genieai.svc.cluster.local:8529`, db `_system`, user `root`                                         |
| doc-repo service                 | `http://document-repository.genieai.svc.cluster.local`                                                                     |
| Secrets                          | `vllm-api-key` (`VLLM_API_KEY`), `arango-root-secret` (`password`), `keycloak-admin-credentials` (`password` + `username`) |
| NetworkPolicies                  | select `genieai.io/component` labels; chatqna ingress admits only `component=backend` sources on 8888                      |
| Budget                           | node headroom checked before the two Deployments are created                                                               |

## Ground rules

- The shared stack's own workloads, env and Flux baseline are NEVER touched.
  The rehearsal runs DEDICATED workloads: `v08-rehearsal-backend`,
  `v08-rehearsal-agent`, `v08-rehearsal-agent` Service — two Deployments +
  one Service in the existing namespace, nothing else.
- The rehearsal backend pod carries `genieai.io/component=backend` (the
  component NetworkPolicy that admits chatqna ingress selects sources by that
  label). The agent pod carries `genieai.io/component=agent` — no NetworkPolicy
  selects that label, so its ingress is unrestricted and its egress (GPU node,
  ArangoDB, doc-repo) is unrestricted. The hop backend→agent is bounded by the
  BACKEND's egress rules, not by the agent pod's label — see Phase 2's two
  wire facts.
- Every artifact of the rehearsal is dedicated and cleaned: a dedicated
  Keycloak user, a dedicated conversation (`queries` docs under a rehearsal
  sessionId), the ROPC grant temporarily enabled and REVERTED, the two
  Deployments + Service deleted. Cleanup verification is part of the runbook,
  not an afterthought.
- Evidence lands in `/tmp/v08-rehearsal/` during the run and is transcribed
  into the stage's rollout record (`docs/rollouts/<stage>-rollout.md`) — the
  record is the durable home, the /tmp files are scratch.

## Phase 0 — build the rehearsal images

Fresh images are built from the stage's branch HEAD by the **tag pipeline**:
`build:backend` and `build:agent-service` both carry the `if: $CI_COMMIT_TAG`
rule, and `.build_template` tags every non-MR build `pending-<short-sha>` in
the `tmp/` namespace — so a tag on the branch HEAD builds BOTH images under
the SAME content tag. (A `FORCE_IMAGE_REBUILD=true` pipeline does NOT cover
this pair: the agent-service build job predates the FORCE rule and carries
only tag/MR/default/release rules — measured on story 3.3, where the FORCE
pipeline built `build:backend` but never `build:agent-service`. The API and
`web` pipeline sources cannot carry it either: the workflow blocks plain
branch pipelines and both build jobs are `when: never` on web.)

```bash
STAGE_BRANCH=<branch>            # the stage's delivery branch
# CI_COMMIT_SHORT_SHA is EIGHT chars — `git rev-parse --short` on this repo
# yields nine, and the tag must name the SAME short sha the pipeline stamps:
SHORT_SHA=$(git rev-parse --short=8 HEAD)
git push origin "$STAGE_BRANCH"
git tag "v08-rehearsal-$SHORT_SHA" "$SHORT_SHA" && git push origin "v08-rehearsal-$SHORT_SHA"
PIPELINE_ID=$(glab api "projects/90/pipelines?ref=v08-rehearsal-$SHORT_SHA&per_page=1" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
# The two jobs this rehearsal needs:
glab api "projects/90/pipelines/$PIPELINE_ID/jobs?per_page=100" \
  | python3 -c "import sys,json; [print(j['id'],j['name'],j['status']) for j in json.load(sys.stdin) if j['name'] in ('build:backend','build:agent-service')]"
# Poll until both are "success", then:
BACKEND_IMAGE="registry.opensource.unicc.org/un/itu/genie-ai/tmp/genie-ai-backend:pending-$SHORT_SHA"
AGENT_IMAGE="registry.opensource.unicc.org/un/itu/genie-ai/tmp/genie-ai-agent-server:pending-$SHORT_SHA"
# Registry proof before deploying (regctl or skopeo):
regctl image inspect "$BACKEND_IMAGE" >/dev/null && echo backend-ok
regctl image inspect "$AGENT_IMAGE" >/dev/null && echo agent-ok
```

One CI monitor per pipeline (the repo's CI-monitoring rule) watches the
pipeline; the rehearsal proceeds when the two build jobs are green. **Cancel
the pipeline as soon as both build jobs are green** — the tag pipeline's
promote stage would retag the content to `latest` (a non-`-alpha/-beta/-rc`
tag updates `latest`) and DELETE the `tmp/...:pending-*` source tags the
rehearsal deployments reference. Canceling after the build stage prevents
both. The rehearsal tag is a build marker, not a release: it carries no
changelog entry (the tag pipeline's `config:changelog` gate failing on it is
expected and harmless once the pipeline is canceled), and it is deleted after
the rehearsal's images are superseded.

## Phase 1 — preflight

```bash
mkdir -p /tmp/v08-rehearsal
# Shared stack healthy, headroom within budget (abort if CPU or mem > 70%):
kubectl -n genieai get pods --no-headers | grep -cv -E "Completed|Running" || true
kubectl top nodes
# Secrets present:
kubectl -n genieai get secret vllm-api-key arango-root-secret keycloak-admin-credentials -o name
# No leftover rehearsal objects from a previous run:
kubectl -n genieai get deploy,svc | grep v08-rehearsal && echo "ABORT: leftovers" || echo clean
```

## Phase 2 — deploy the dedicated rehearsal workloads

The backend Deployment is CLONED from the shared one (jq) so its env carries
the venue's exact ArangoDB/Keycloak/translation wiring; the agentic knobs are
added on top. The image is the stage build; the identity (labels, selector,
name) is the rehearsal's own — never the Helm release's.

**Two wire facts this topology forces (both discovered live, story 3.3):**

1. **The BFF dials the bare `AGENT_SERVICE_URL`** (`agent-frame-writer.js`
   POSTs the URL as configured — the agent route is `POST /v1/runs`, so the
   shipped compose default `http://agent-service:8010` answers 404 on a real
   deployment; the unit suites pin both sides with a mocked axios and never
   joined them). Until the code-side fix lands, the rehearsal deployment
   carries the run path IN the env value
   (`http://...:8080/v1/runs` — axios posts the full URL verbatim).
2. **The component NetworkPolicy's egress list does not include the agent
   port.** The rehearsal backend carries `genieai.io/component=backend`
   (required for chatqna ingress/egress), whose egress rules admit specific
   ports — 8010 is not among them, and this k3s REJECTS denied flows. The
   agent pod therefore binds **8080** (in the egress allow-list; a deployment
   -level command override — the image's shipped port stays 8010), exposed
   through a HEADLESS Service: this venue's netpol rejects pod→ClusterIP
   egress too, and a headless Service resolves DNS straight to the pod IP.

```bash
kubectl -n genieai get deploy genieai-genieai-umbrella-backend -o json | jq '
  {
    apiVersion: "apps/v1", kind: "Deployment",
    metadata: {name: "v08-rehearsal-backend", namespace: "genieai",
               labels: {"v08-rehearsal": "true", "genieai.io/component": "backend"}},
    spec: {
      replicas: 1,
      selector: {matchLabels: {"v08-rehearsal": "true", "app": "v08-rehearsal-backend"}},
      template: {
        metadata: {labels: {"v08-rehearsal": "true", "app": "v08-rehearsal-backend",
                            "genieai.io/component": "backend"}},
        spec: {containers: [(.spec.template.spec.containers[0]
          | .image = $img
          | .env = (.env + [
              {name: "AGENT_ENABLED", value: "1"},
              {name: "AGENT_SERVICE_URL", value: "http://v08-rehearsal-agent-hl:8080/v1/runs"},
              {name: "AGENT_UPSTREAM_TIMEOUT_MS", value: "3600000"},
              {name: "AGENT_TRANSLATION_MAX_TOKENS", value: "4096"},
              {name: "AGENT_TRANSLATION_MAX_CALLS", value: "8"}
            ]))]}
      }
    }
  }' --arg img "$BACKEND_IMAGE" > /tmp/v08-rehearsal/backend-deployment.yaml
kubectl apply -f /tmp/v08-rehearsal/backend-deployment.yaml

# AGENT_IMAGE_HERE is substituted with $AGENT_IMAGE before applying
cat > /tmp/v08-rehearsal/agent-stack.yaml <<EOF
apiVersion: v1
kind: Service
metadata:
  name: v08-rehearsal-agent-hl
  namespace: genieai
  labels: {v08-rehearsal: "true"}
spec:
  clusterIP: None
  selector: {v08-rehearsal: "true", app: v08-rehearsal-agent}
  ports:
    - name: http
      port: 8080
      targetPort: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: v08-rehearsal-agent
  namespace: genieai
  labels: {v08-rehearsal: "true", "genieai.io/component": agent}
spec:
  replicas: 1
  selector: {matchLabels: {v08-rehearsal: "true", app: v08-rehearsal-agent}}
  template:
    metadata:
      labels: {v08-rehearsal: "true", app: v08-rehearsal-agent, "genieai.io/component": agent}
    spec:
      containers:
        - name: agent
          image: AGENT_IMAGE_HERE
          imagePullPolicy: IfNotPresent
          # Deployment-level port override: 8080 sits in the component netpol's
          # egress allow-list (8010 does not). The shipped image default (8010)
          # is unchanged; real deployments on a flat compose network keep it.
          command: ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port 8080"]
          ports: [{containerPort: 8080, name: http}]
          readinessProbe:
            httpGet: {path: /ready, port: 8080}
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 12
          env:
            - {name: AGENT_ENABLED, value: "1"}
            - {name: LOG_LEVEL, value: "INFO"}
            # The REQUIRED budget knobs (fail-closed; docs/agent-budget-deadline-pairs.md)
            - {name: AGENT_RUN_MAX_STEPS, value: "8"}
            - {name: AGENT_RUN_MAX_MODEL_CALLS, value: "12"}
            - {name: AGENT_RUN_MAX_TOOL_CALLS, value: "12"}
            - {name: AGENT_RUN_MAX_TOTAL_TOKENS, value: "50000"}
            - {name: AGENT_RUN_MAX_EVIDENCE_BYTES, value: "200000"}
            - {name: AGENT_RUN_MAX_WALL_CLOCK_SECONDS, value: "240"}
            - {name: AGENT_TOOL_TIMEOUT_MS, value: "30000"}
            - {name: AGENT_TOOL_MAX_RESULTS, value: "10"}
            - {name: AGENT_TOOL_MAX_RESULT_BYTES, value: "50000"}
            - {name: AGENT_VERDICT_JUDGE_TIMEOUT_MS, value: "30000"}
            # Port assembly
            - {name: AGENT_DOCREPO_URL, value: "http://document-repository.genieai.svc.cluster.local"}
            - {name: AGENT_OKF_URL, value: "http://okf-server:3002"}   # nominal: OKF_ENABLED=0 on this venue
            - {name: AGENT_AUTHORIZED_GRAPHS, value: "GRAPH"}
            - {name: TEI_EMBEDDING_ENDPOINT, value: "https://ai.assembly.govstack.global:444/embed"}
            - {name: TEI_RERANKING_ENDPOINT, value: "https://ai.assembly.govstack.global:444/rerank"}
            # Model legs (loop + preparation) — the venue's GPU gateway
            - {name: VLLM_ENDPOINT, value: "https://ai.assembly.govstack.global:444/llm"}
            - {name: VLLM_LLM_MODEL_ID, value: "ibm-granite/granite-4.1-8b"}
            - {name: VLLM_TRANSLATION_ENDPOINT, value: "https://ai.assembly.govstack.global:444/translation"}
            - {name: VLLM_TRANSLATION_MODEL_ID, value: "google/gemma-3-4b-it"}
            - {name: OPEA_SSL_SKIP_VERIFY, value: "1"}
            # Corpus (the venue's deployed values)
            - {name: ARANGO_URL, value: "http://arangodb-single.genieai.svc.cluster.local:8529"}
            - {name: ARANGO_USERNAME, value: "root"}
            - {name: ARANGO_DB, value: "_system"}
            - {name: ARANGO_GRAPH_NAME, value: "GRAPH"}
            - name: OPENAI_API_KEY
              valueFrom: {secretKeyRef: {name: vllm-api-key, key: VLLM_API_KEY}}
            - name: VLLM_API_KEY
              valueFrom: {secretKeyRef: {name: vllm-api-key, key: VLLM_API_KEY}}
            - name: ARANGO_PASSWORD
              valueFrom: {secretKeyRef: {name: arango-root-secret, key: password}}
EOF
sed -i "s|AGENT_IMAGE_HERE|$AGENT_IMAGE|" /tmp/v08-rehearsal/agent-stack.yaml
kubectl apply -f /tmp/v08-rehearsal/agent-stack.yaml
kubectl -n genieai rollout status deploy/v08-rehearsal-backend deploy/v08-rehearsal-agent --timeout=300s
# seam reachability proof BEFORE any turn (both wire facts above verified):
kubectl -n genieai exec deploy/v08-rehearsal-backend -- \
  sh -c 'wget -q -O /tmp/seam -T 3 --post-data="{\"question\":\"probe\",\"deadline_ms\":5000,\"context\":{}}" --header="Content-Type: application/json" http://v08-rehearsal-agent-hl:8080/v1/runs; echo "seam-exit:$?"'
# expected: exit 0 with a 422 validation answer (the probe body carries no
# CallerContext) — the hop BFF→agent is proven reachable end to end
```

**Rehearsal turn protocol:** a flag change is a pod replacement; the
port-forward targets a POD NAME, so every switch needs the forward re-armed
against the CURRENT pod — and `kubectl get pod -l app=... -o
jsonpath='{.items[0]...}'` can pick the TERMINATING surge pod mid-rollout.
Wait for `rollout status` AND a single Ready pod before resolving the name,
and verify the pod's `AGENT_ENABLED` value before arming the forward.

## Phase 3 — pair validation (from the DEPLOYED pods)

Read the effective values out of the running pods; never from a manifest.

```bash
kubectl -n genieai exec deploy/v08-rehearsal-backend -- \
  sh -c 'echo UPSTREAM=$AGENT_UPSTREAM_TIMEOUT_MS'
kubectl -n genieai exec deploy/v08-rehearsal-agent -- \
  sh -c 'echo WALLCLOCK=$AGENT_RUN_MAX_WALL_CLOCK_SECONDS'
```

The invariant (the derivation constants live in
`components/gov-chat-backend/services/agent-frame-writer.js`:
`TRANSLATION_RESERVE_MS=30000`, `FINALIZATION_MARGIN_MS=5000`,
`DEADLINE_FLOOR_MS=1000`; `DEFAULT_UPSTREAM_TIMEOUT_MS=3600000`):

```
deadline_ms            = AGENT_UPSTREAM_TIMEOUT_MS − 30000 − 5000     (floor 1000)
effective_wall_clock   = min(AGENT_RUN_MAX_WALL_CLOCK_SECONDS, deadline_ms/1000)
pair rule              = AGENT_UPSTREAM_TIMEOUT_MS ≥ deadline_ms + 30000 + 5000
```

A mismatch ABORTS the rehearsal — a broken pair is a stage-gate blocker, not a
footnote. Record both pods' values and the arithmetic in the record.

## Phase 4 — the rehearsal token (temporary ROPC, reverted immediately)

The documented SERVER-TESTING procedure: enable ROPC on the `genie-app`
client, mint the token(s), revert, verify the revert. The rehearsal user is
dedicated test data.

```bash
kubectl -n genieai port-forward svc/keycloak-service 18080:8080 &   # KPF=keycloak
KC_ADMIN_PWD=$(kubectl -n genieai get secret keycloak-admin-credentials -o jsonpath='{.data.password}' | base64 -d)
ADMIN_TOKEN=$(curl -sk -X POST "http://localhost:18080/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_ADMIN_PWD}" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# dedicated rehearsal user
curl -sk -X POST "http://localhost:18080/auth/admin/realms/genie/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{
    "username": "v08-rehearsal", "email": "v08-rehearsal@rehearsal.invalid",
    "emailVerified": true, "firstName": "V08", "lastName": "Rehearsal",
    "enabled": true, "attributes": {"v08_rehearsal": "true"},
    "credentials": [{"type": "password", "value": "<rehearsal-password>", "temporary": false}]}'

# temporary ROPC on the app client
# (the PUT bodies go through FILES: a process substitution or an unquoted
# body occasionally ships a shell artifact Keycloak answers 400 on — the
# 204/400 difference is visible, so a failed PUT never goes unnoticed)
CLIENT_ID=$(curl -s "http://localhost:18080/auth/admin/realms/genie/clients?clientId=genie-app" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
CLIENT_JSON=$(curl -s "http://localhost:18080/auth/admin/realms/genie/clients/$CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$CLIENT_JSON" > /tmp/v08-rehearsal/client-pre.json
echo "$CLIENT_JSON" | jq '.directAccessGrantsEnabled = true' > /tmp/v08-rehearsal/client-ropc.json
echo "$CLIENT_JSON" | jq '.directAccessGrantsEnabled = false' > /tmp/v08-rehearsal/client-reverted.json
curl -s -X PUT "http://localhost:18080/auth/admin/realms/genie/clients/$CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/v08-rehearsal/client-ropc.json -w "PUT-enable HTTP %{http_code}\n"   # expected: 204

# mint the rehearsal token(s) — the brief ROPC window; a refresh_token is
# requested too, so later phases refresh WITHOUT touching ROPC again
# (genie-app is a PUBLIC client on this realm — no client_secret involved)
curl -s -X POST "http://localhost:18080/auth/realms/genie/protocol/openid-connect/token" \
  --data-urlencode "grant_type=password" --data-urlencode "client_id=genie-app" \
  --data-urlencode "username=v08-rehearsal" --data-urlencode "password=<rehearsal-password>" \
  --data-urlencode "scope=openid offline_access" > /tmp/v08-rehearsal/token.json

# REVERT immediately, then VERIFY the revert
curl -s -X PUT "http://localhost:18080/auth/admin/realms/genie/clients/$CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/v08-rehearsal/client-reverted.json -w "PUT-revert HTTP %{http_code}\n"   # expected: 204
curl -s "http://localhost:18080/auth/admin/realms/genie/clients/$CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.directAccessGrantsEnabled'
# expected output: false

TOKEN=$(jq -r .access_token /tmp/v08-rehearsal/token.json)
REFRESH=$(jq -r .refresh_token /tmp/v08-rehearsal/token.json)
```

A fresh access token without ROPC (used when the original expires mid-run;
the refresh grant needs no ROPC and no secret on a public client):

```bash
TOKEN=$(curl -s -X POST "http://localhost:18080/auth/realms/genie/protocol/openid-connect/token" \
  --data-urlencode "grant_type=refresh_token" --data-urlencode "client_id=genie-app" \
  --data-urlencode "refresh_token=$REFRESH" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['access_token'])")
```

## Phase 5 — the rehearsal turns

Port-forward the rehearsal backend (data plane through the API server is fine
for single requests; the suite-scale caveat does not apply):

```bash
BP=$(kubectl -n genieai get pod -l app=v08-rehearsal-backend -o jsonpath='{.items[0].metadata.name}')
kubectl -n genieai port-forward "pod/$BP" 19000:3000 &   # KPF=backend
SESSION="v08-rehearsal-$(date +%Y%m%d-%H%M%S)"
```

### 5a. Pair validation — before any turn (Phase 3 numbers go in the record)

### 5b. Agentic direction (flag on)

```bash
curl -sN -D /tmp/v08-rehearsal/5b.headers -o /tmp/v08-rehearsal/5b.stream \
  -X POST "http://localhost:19000/api/queries/stream" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\",\"messages\":[{\"role\":\"user\",\"content\":\"What is GENIE.AI?\"}]}"
```

Expected: the request ROUTES to the rehearsal agent service — the `queries`
doc is minted with agent metadata (`agent_run` block), and the run's honest
outcome arrives (on this venue: the SSE `error` frame carrying the agent
run's model-leg failure, the #2052 tool-calling 400). The stream itself
proves the routing hop (BFF → `v08-rehearsal-agent`, real orchestrator, real
seam stream); `kubectl -n genieai logs deploy/v08-rehearsal-agent --since=5m`
backs it with the run record.

### 5c. Rollback direction (flag off — a process restart)

```bash
kubectl -n genieai set env deploy/v08-rehearsal-backend AGENT_ENABLED=0
kubectl -n genieai rollout restart deploy/v08-rehearsal-backend
kubectl -n genieai rollout status deploy/v08-rehearsal-backend --timeout=300s
```

SAME conversation, next turn:

```bash
curl -sN -o /tmp/v08-rehearsal/5c.stream -X POST "http://localhost:19000/api/queries/stream" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\",\"messages\":[{\"role\":\"user\",\"content\":\"Continue: in one sentence, what is GENIE.AI?\"}]}"
```

Expected: answered via legacy chatqna (real streamed chunks); the conversation
history reads through the legacy path (`GET /api/queries/:queryId` for both
turns' docs — same shape, the agentic one carrying its `agent_run` metadata
verbatim as unread extras); `queries` docs same shape (the 3.2 contracts).

### 5d. Re-activation direction (flag on again)

```bash
kubectl -n genieai set env deploy/v08-rehearsal-backend AGENT_ENABLED=1
kubectl -n genieai rollout restart deploy/v08-rehearsal-backend
kubectl -n genieai rollout status deploy/v08-rehearsal-backend --timeout=300s
# next turn → routes to the agent leg again (same curl shape as 5b, new content)
```

### 5e. In-flight treatment at switch time

Flag off (rollback to legacy first), start a stream, restart the backend
mid-stream, watch what the client sees, then read the persisted doc:

```bash
kubectl -n genieai set env deploy/v08-rehearsal-backend AGENT_ENABLED=0
kubectl -n genieai rollout restart deploy/v08-rehearsal-backend
kubectl -n genieai rollout status deploy/v08-rehearsal-backend --timeout=300s

curl -sN -o /tmp/v08-rehearsal/5e.stream -X POST "http://localhost:19000/api/queries/stream" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\",\"messages\":[{\"role\":\"user\",\"content\":\"Describe the GENIE.AI platform in detail.\"}]}" &
CURL_PID=$!
# wait until chunks are flowing, then restart under the stream
sleep 8
date -u +%FT%TZ   # switch timestamp
kubectl -n genieai rollout restart deploy/v08-rehearsal-backend
wait $CURL_PID; date -u +%FT%TZ   # stream-end timestamp
```

Then read the newest `queries` doc for the session and record which treatment
occurred: `answer_interrupted: true` (completed + partial-saved inside the
shutdown window) or `isAnswered: false` (hard-stop, honest unanswered doc).
Whichever variant occurs is the evidence — with timestamps.

The port-forward targets a POD NAME: the restart replaces the pod and the
forwarded connection dies with it — which is exactly the client-side
observation wanted (the stream ending). For the NEXT turn, re-resolve `$BP`
and re-arm the port-forward.

## Phase 6 — evidence capture

Save into `/tmp/v08-rehearsal/`, transcribe into the record:

- the pair-validation numbers (both pods' env) and the arithmetic;
- `5b.stream` / `5c.stream` / the re-activation stream / `5e.stream` excerpts
  with the verdicts;
- `kubectl -n genieai logs deploy/v08-rehearsal-agent --since=30m` excerpt
  (the run record at the model leg);
- the `queries` docs of every turn (API GET), proving same-shape persistence;
- the switch timestamps of 5e.

## Phase 7 — cleanup and revert verification

Nothing of the rehearsal remains; every removal is verified.

```bash
# workloads
kubectl -n genieai delete deploy/v08-rehearsal-backend deploy/v08-rehearsal-agent svc/v08-rehearsal-agent
kubectl -n genieai get deploy,svc | grep v08-rehearsal   # expected: empty

# rehearsal user
curl -sk "http://localhost:18080/auth/admin/realms/genie/users?username=v08-rehearsal" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.[0].id'   # capture id
curl -sk -X DELETE "http://localhost:18080/auth/admin/realms/genie/users/$UID" -H "Authorization: Bearer $ADMIN_TOKEN"
curl -sk "http://localhost:18080/auth/admin/realms/genie/users?username=v08-rehearsal" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq 'length'     # expected: 0

# ROPC reverted (Phase 4 already did the revert; re-verify here)
curl -sk "http://localhost:18080/auth/admin/realms/genie/clients/$CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.directAccessGrantsEnabled'   # expected: false

# rehearsal conversation docs (dedicated sessionId)
ARANGO_PWD=$(kubectl -n genieai get secret arango-root-secret -o jsonpath='{.data.password}' | base64 -d)
kubectl -n genieai port-forward svc/arangodb-single-single 18529:8529 &
curl -s -u "root:$ARANGO_PWD" -X POST "http://localhost:18529/_db/_system/_api/cursor" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"FOR d IN queries FILTER d.sessionId == '$SESSION' COLLECT WITH COUNT INTO c RETURN c\"}"
curl -s -u "root:$ARANGO_PWD" -X POST "http://localhost:18529/_db/_system/_api/cursor" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"FOR d IN queries FILTER d.sessionId == '$SESSION' REMOVE d IN queries\"}"
# re-count → expected: 0

# kill the port-forwards (keycloak, backend, arango)
```
