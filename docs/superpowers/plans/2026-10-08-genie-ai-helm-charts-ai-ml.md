# GENIE.AI Helm Charts — AI/ML Tier (Plan 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the AI/ML tier (spec §7 Group 6, 14 services): 4 GPU model servers (vllm, vllm-translation-guardrail, tei, tei-reranker — upstream images), 7 CPU OPEA wrappers (embedding, reranker, retriever, dataprep, chatqna-server, textgen, translation — CI-built `genie-ai-*` images), 3 shipped-but-off services (guardrail, chatqna-ui, chatqna-nginx — Swarm parity: replicas 0), GPU scheduling (nodeSelector + tolerations + `nvidia.com/gpu`), a shared HuggingFace model cache PVC, remote-GPU mode (Swarm `GPU_NODE_HOST` equivalent), the 3 remaining §8 secrets (VLLM_API_KEY, keycloakProxyClientSecret, kcDataprepClientSecret), and NetworkPolicies.

**Architecture:** The Plan 3 service factory is EXTENDED (not duplicated) with volumes/volumeMounts/nodeSelector/tolerations/GPU-resource passthrough — the factory currently cannot mount a volume at all, which this tier needs for the HF cache. Model servers run only on GPU nodes (`genieai.io/gpu: "true"` + taint toleration); wrappers are ordinary stateless Deployments pointed at the model servers via Service DNS. All Services expose port 80 (Plan 3 F10 contract: container ports are targetPort details). Remote-GPU deployments skip the 4 GPU Deployments entirely and point wrapper env at external endpoints.

**Tech Stack:** Helm 4.x, chart-testing (`ct` v3.x), kind 1.33 (GPU tests skipped in CI — `ai.gpu.enabled=false` renders), vLLM v0.29.0, TEI 1.9.3, OPEA 1.3/1.5, NVIDIA device plugin (cluster prerequisite — the GPU OPERATOR itself is a bootstrap prerequisite, NOT a chart dep; see Task 10).

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — implements §7 Group 6, §8 (VLLM_API_KEY + 2 keycloak secrets), §5.1 dependency-graph extension, §11 manifest entries. Ground truth for env/args: `docker-compose.yaml` services (`vllm`, `textgen`, `vllm-translation-guardrail`, `translation`, `guardrail`, `tei`, `tei_reranker`, `embedding`, `reranker`, `dataprep-arango-service`, `retriever-arango-service`, `chatqna-xeon-backend-server`, `chatqna-xeon-ui-server`, `chatqna-xeon-nginx-server`).

## Global Constraints

- Helm chart API version: `v2`. Helm 4.x.
- All in-cluster addressing via Service DNS on port 80 (Plan 3 F10 contract). Env values copied from `docker-compose.yaml` MUST be re-pointed from container ports to Service port 80.
- Image names: CI-built = `genie-ai-{embedding,reranker,retriever-arango,dataprep-arango,chatqna-server,textgen}`; upstream = `vllm/vllm-openai:v0.29.0`, `ghcr.io/huggingface/text-embeddings-inference:1.9.3`, `opea/translation:1.3`, `opea/guardrails:1.5` (compose-verified).
- No secrets in any committed file — only encrypted SealedSecret resources.
- All English documentation and comments per project CLAUDE.md. Commits in English, Conventional Commits.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.
- Every new Deployment maps to a `docs/charts/k8s-native-audit.md` row (Task 10 amends the table).

## Review Focus

Five input-class concerns the spec implies but no Plan 5 task tests explicitly. Each pinned to a specific step.

1. **GPU scheduling mismatch** — GPU Deployments land `Pending` forever if nodeSelector keys/toleration keys don't match the cluster's actual labels/taints (Swarm used `node.labels.gpu == true`; K8s needs label + usually a taint). **Pinned in Task 3 Step 6** — render asserts all 4 model servers carry `genieai.io/gpu: "true"`, the toleration, and `nvidia.com/gpu` limits; defaults documented as the contract GPU nodes must satisfy.
2. **HF cache PVC access mode** — four GPU pods mount ONE model cache; `ReadWriteOnce` deadlocks multi-node clusters (each node's kubelet fights for the attach). **Pinned in Task 3 Step 7** — render asserts `accessModes: ["ReadWriteMany"]` + a README note that single-node clusters may relax it per-env.
3. **Swarm env-port coupling** — `chatqna-xeon-backend-server` env carries `EMBEDDING_SERVER_PORT: 6000`, `RETRIEVER_SERVICE_PORT: 7000`, `RERANK_SERVER_PORT: 8000` (container ports). Porting them verbatim makes chatqna dial dead ports (Services listen on 80). **Pinned in Task 4 Step 5** — render asserts every `*_SERVICE_PORT` env is `80` / every `*_ENDPOINT` host is a Service DNS name on port 80.
4. **Remote-GPU flip** — with `ai.remoteGpu.enabled=true` the 4 GPU Deployments must vanish AND every wrapper endpoint env must switch to the external URLs; a half-flip leaves wrappers dialing in-cluster names that no longer resolve. **Pinned in Task 8 Steps 3-4** — render asserts 0 GPU Deployments + all endpoint envs match `ai.remoteGpu.*` URLs.
5. **Secret key collisions / cross-tier consumers** — `HF_TOKEN` and `VLLM_API_KEY` carry the SAME value under two env names (compose feeds both from `VLLM_API_KEY`); one SealedSecret must carry both keys. `KEYCLOAK_PROXY_CLIENT_SECRET` is consumed by the BACKEND (keycloak-proxy-service.js), not the AI tier — the SealedSecret ships here but the envFrom lands on backend (Plan 3 values). **Pinned in Task 6 Steps 4-5** — render asserts both keys exist in `vllm-api-key` and backend's envFrom includes `keycloak-proxy-client-secret`.

---

### Task 1: `ai.*` values block (14 services + models + gpu + cache + remote)

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml`

**Interfaces:**
- Consumes: Plan 3 `services.*` entry shape (extended here with `gpu`, `nodeSelector`, `tolerations`, `volumes`, `volumeMounts`, `args`, `command` fields — factory support added in Task 2).
- Produces: `ai.services.<name>` entries for all 14 Group-6 services + `ai.models` + `ai.gpu` + `ai.hfCache` + `ai.remoteGpu`. Defaults mirror Swarm: everything ON except `guardrail`, `chatqnaUi`, `chatqnaNginx` (replicas 0 in Swarm).

- [ ] **Step 1: Run red-gate — no ai block yet**

Run: `helm template test charts/genieai-umbrella -n genieai --set ai.enabled=true 2>&1 | grep -c "ai.services"; true`
Expected: prints `0` (no ai values → templates in later tasks don't exist; this gate asserts the values block is absent).

- [ ] **Step 2: Append to `charts/genieai-umbrella/values.yaml`**

```yaml
# Plan 5 — AI/ML tier (spec §7 Group 6; 14 services)
#
# Master switch: whole tier off for partial installs (Day-0 pattern: core
# only). Per-service toggles mirror Swarm defaults (guardrail + OPEA
# ui/nginx ran at replicas 0).
ai:
  enabled: true

  models:
    # IDs from `env` Section "Deployment-Specific" + compose defaults.
    # NOTE: docker-compose.gpu.yaml (the NEWER GPU reference) defaults to
    # ibm-granite/granite-3.3-2b-instruct while main docker-compose.yaml
    # still carries meta-llama — per-env values-override picks the model;
    # the chart default follows the GPU compose (granite, validated for
    # guided JSON per CLAUDE.md VLLM_LLM_MODEL_ID note).
    llmId: ibm-granite/granite-3.3-2b-instruct          # VLLM_LLM_MODEL_ID
    translationId: google/gemma-3-4b-it                  # VLLM_TRANSLATION_MODEL_ID
    embeddingId: BAAI/bge-large-en-v1.5                  # EMBEDDING_MODEL_ID
    rerankerId: BAAI/bge-reranker-v2-m3                  # RERANKER_MODEL_ID

  gpu:
    # Contract for GPU nodes: label genieai.io/gpu=true (+ taint
    # genieai.io/gpu=true:NoSchedule tolerated below). The NVIDIA device
    # plugin / GPU operator is a cluster bootstrap prerequisite.
    nodeSelector:
      genieai.io/gpu: "true"
    tolerations:
      - key: genieai.io/gpu
        operator: Equal
        value: "true"
        effect: NoSchedule
    vllm:
      count: 1                       # nvidia.com/gpu limit
      enforceEager: true             # --enforce-eager (both composes; CUDA
                                     # graph memory at util 0.55 + 65536 ctx)
      memoryUtilization: "0.55"      # --gpu_memory_utilization
      maxModelLen: "65536"           # --max_model_len
      maxNumSeqs: "16"               # --max_num_seqs (GPU compose; main
                                     # compose's 64 is the stale value)
      dtype: half                    # --dtype
    vllmTranslation:
      count: 1
      enforceEager: false
      noChunkedPrefill: true         # --no-enable-chunked-prefill (gemma)
      chatTemplateFormat: openai     # --chat-template-content-format
      memoryUtilization: "0.3"
      maxModelLen: "8192"            # GPU compose value (2048 was main-compose stale)
      maxNumSeqs: "16"
      dtype: auto
    tei:
      count: 1
    teiReranker:
      count: 1
      maxBatchTokens: "8192"
      maxConcurrentRequests: "32"
      autoTruncate: "false"

  # Empirically-tuned knobs (el-salvador calibration history) — compose parity
  rerankerConfig:
    noveltySigmoidA: "20.0"
    noveltySigmoidB: "0.25"
    contextDecayFactor: "0.0025"
    minValueThreshold: "-1.0"
  retrieverConfig:
    hybridEnabled: "true"
    hybridRrfK: "60"
    hybridBm25Candidates: "50"
    hybridDenseWeight: "1.0"
    hybridLexicalWeight: "1.0"
    hybridBm25Analyzer: text_en
  dataprepConfig:
    chunkSizePdf: "500"
    chunkSizeDocx: "1000"
    chunkSizeXlsx: "1500"
    chunkSizePptx: "500"
    chunkSizeHtml: "500"
    chunkSizeTxt: "500"
    chunkSizeMd: "500"
    chunkOverlap: "50"

  # RAG tuning knobs consumed by the chatqna wrapper env (Task 4) —
  # defaults mirror `env` + compose (RERANKING_STRATEGY, RERANKER_TOP_N, ...)
  chatqnaConfig:
    rerankingStrategy: slice
    rerankingThreshold: "0.75"
    rerankerTopN: "3"
    retrieverK: "20"
    retrieverFetchK: "30"

  hfCache:
    # Shared HuggingFace model cache mounted by all 4 model servers.
    # ReadWriteMany is REQUIRED when model servers land on different nodes.
    enabled: true
    storageSize: 100Gi
    accessModes: ["ReadWriteMany"]

  remoteGpu:
    # Swarm GPU_NODE_HOST equivalent: model servers run OUTSIDE the cluster
    # (docker-compose.gpu.yaml node: nginx-gpu TLS + api_keys.map bearer,
    # path-prefixed routing). When true: the 4 GPU Deployments + the HF
    # cache PVC are not rendered and wrapper env endpoints point at these
    # URLs — which MUST carry the nginx-gpu PATH PREFIXES, exactly like the
    # Swarm env §14 derivation:
    #   GPU_NODE_HOST=gpu.example.org ->
    #     vllmUrl:            https://gpu.example.org/llm
    #     vllmTranslationUrl: https://gpu.example.org/translation
    #     teiEmbeddingUrl:    https://gpu.example.org/embed
    #     teiRerankingUrl:    https://gpu.example.org/rerank
    #     doclingUrl:         https://gpu.example.org/docling
    # Auth: VLLM_API_KEY bearer (Authorization header) — same contract the
    # GPU node's nginx validates via api_keys.map.
    enabled: false
    vllmUrl: ""
    vllmTranslationUrl: ""
    teiEmbeddingUrl: ""
    teiRerankingUrl: ""
    # docling-serve exists ONLY on the GPU node (no main-compose service).
    # Empty = dataprep runs docling IN-PROCESS (Swarm default when unset).
    # Set = dataprep ships extraction to the remote docling-serve.
    doclingUrl: ""
    doclingTimeout: "120"            # DOCLING_ENDPOINT_TIMEOUT

  services:
    # ---- GPU model servers (upstream images) ----
    vllm:
      enabled: true
      # v0.29.0 per docker-compose.gpu.yaml (newer than main compose's
      # 0.10.0 — the GPU-node reference wins)
      image: { repository: vllm/vllm-openai, tag: "0.29.0" }
      port: 8000                     # container port; Service exposes 80
    vllmTranslation:
      enabled: true
      image: { repository: vllm/vllm-openai, tag: "0.29.0" }
      port: 9031
    tei:
      enabled: true
      image: { repository: ghcr.io/huggingface/text-embeddings-inference, tag: "1.9.3" }
      port: 8080   # unprivileged (non-root cannot bind :80; --port 8080)
    teiReranker:
      enabled: true
      image: { repository: ghcr.io/huggingface/text-embeddings-inference, tag: "1.9.3" }
      port: 8080
    # ---- CPU OPEA wrappers (CI-built images) ----
    embedding:
      enabled: true
      image: { repository: registry.example.org/genie-ai-embedding, tag: "1.0.0" }
      port: 6000
    reranker:
      enabled: true
      image: { repository: registry.example.org/genie-ai-reranker, tag: "1.0.0" }
      port: 8000
    retriever:
      enabled: true
      image: { repository: registry.example.org/genie-ai-retriever-arango, tag: "1.0.0" }
      port: 7000
    dataprep:
      enabled: true
      image: { repository: registry.example.org/genie-ai-dataprep-arango, tag: "1.0.0" }
      port: 5000
      # Swarm runs dataprep WITH GPU access (NVIDIA_VISIBLE_DEVICES=all,
      # DOCLING_DEVICE=cuda — in-process docling is GPU-fed). K8s default:
      # CPU-only pod + in-process docling on CPU (slower ingestion, zero
      # GPU coupling). Set true per-env to schedule it on GPU nodes
      # (nodeSelector + tolerations + nvidia.com/gpu: 1 are injected by
      # the template when onGpu is set).
      onGpu: false
    chatqna:
      enabled: true
      image: { repository: registry.example.org/genie-ai-chatqna-server, tag: "1.0.0" }
      port: 8888
    textgen:
      enabled: true
      image: { repository: registry.example.org/genie-ai-textgen, tag: "1.0.0" }
      port: 9000
    translation:
      enabled: true
      image: { repository: opea/translation, tag: "1.3" }
      port: 8888
    # ---- Shipped but OFF (Swarm replicas 0) ----
    guardrail:
      enabled: false
      image: { repository: opea/guardrails, tag: "1.5" }
      port: 9090
    chatqnaUi:
      enabled: false
      # compose-verified: opea/chatqna-ui:1.5 (NOT chatqna-xeon-ui-server)
      image: { repository: opea/chatqna-ui, tag: "1.5" }
      port: 5173
    chatqnaNginx:
      enabled: false
      # compose-verified: opea/nginx:1.5, listens on 80
      image: { repository: opea/nginx, tag: "1.5" }
      port: 80
```

- [ ] **Step 3: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): ai.* values block (14 Group-6 services, models, gpu, hf-cache, remote-gpu)"
```

---

### Task 2: Factory extensions — volumes, nodeSelector, tolerations, GPU resources, command/args

**Files:**
- Modify: `charts/genieai-umbrella/templates/_lib/_service-factory.tpl`

**Interfaces:**
- Consumes: Plan 3 factory (`genieai-umbrella.serviceDeployment`).
- Produces: factory support for `volumes`, `volumeMounts`, `nodeSelector`, `tolerations`, `gpu` (renders `nvidia.com/gpu` resource limit), `command`, `args` — all optional values passthrough. These fields also serve Plan 6 (document-repository PVC).

- [ ] **Step 1: Fix the factory's component derivation THEN extend**

The Plan 3 factory derives ALL labels/selectors from `$svcName := $ctx.name` — it never reads `$ctx.component`. Model servers pass `name=vllm, component=ai-vllm`, so the factory labels pods `genieai.io/component: vllm` while the hand-written Services select `ai-vllm` → **zero endpoints**. Change the factory's first lines to:

```gotemplate
{{- $ctx := . -}}
{{- $svcName := $ctx.name -}}
{{- $component := $ctx.component | default $svcName -}}
{{- $svc := $ctx.aiService | default (index $ctx.Values.services $svcName) -}}
```

and use `$component` (not `$svcName`) in every `merge (dict "component" ...)` label dict. Backward compatible: Plan 3 callers pass name == component. The `aiService | default` line is the C2 companion — AI tasks pass a fully-merged per-service dict (Task 3 Step 2).

**Second C2 fix — guard the probes section** (`$svc.probes.readiness` nil-pointers when a merged dict carries no probes):

```gotemplate
          {{- with $svc.probes }}
          {{- with .readiness }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .liveness }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .startup }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- end }}
```

- [ ] **Step 1b: Extend the factory Deployment body**

In the `spec.template.spec` block (after `securityContext:`), add:

```gotemplate
      {{- /* Optional scheduling + storage passthrough (values-driven;
             absent keys render nothing). GPU services set gpu.count ->
             nvidia.com/gpu resource limit + nodeSelector + tolerations
             come from ai.gpu defaults merged per-service. */ -}}
      {{- with $svc.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $svc.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $svc.volumes }}
      volumes:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- /* Wave-8 F7: podSecurityContext passthrough — required for the
             HF-cache PVC to be group-writable (fsGroup: 1000/100). Without
             it the vLLM/TEI pods cannot write the first model download
             and crashloop. */ -}}
      {{- with $svc.podSecurityContext }}
      securityContext:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

And in the container block (after `envFrom:`), add:

```gotemplate
          {{- with $svc.command }}
          command:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $svc.args }}
          args:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $svc.volumeMounts }}
          volumeMounts:
            {{- toYaml . | nindent 12 }}
          {{- end }}
```

And merge the GPU resource limit into the `resources:` block:

```gotemplate
          resources:
            {{- if $svc.gpu }}
            limits:
              nvidia.com/gpu: {{ $svc.gpu.count | default 1 }}
            {{- end }}
            {{- toYaml $svc.resources | nindent 12 }}
```

- [ ] **Step 2: Verify existing renders unchanged**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "nodeSelector\|nvidia.com/gpu" || echo "0"`
Expected: prints `0` — no Plan 3 service sets these fields; passthrough is inert until used.

- [ ] **Step 3: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/templates/_lib/_service-factory.tpl
git commit -m "feat(charts): factory passthrough — volumes, scheduling, GPU resources, command/args"
```

---

### Task 3: GPU model servers ×4 + HF cache PVC

**Files:**
- Create: `charts/genieai-umbrella/templates/ai/hf-cache-pvc.yaml`
- Create: `charts/genieai-umbrella/templates/ai/vllm.yaml`
- Create: `charts/genieai-umbrella/templates/ai/vllm-translation.yaml`
- Create: `charts/genieai-umbrella/templates/ai/tei.yaml`
- Create: `charts/genieai-umbrella/templates/ai/tei-reranker.yaml`

**Interfaces:**
- Consumes: factory (Task 2), `ai.gpu.*`, `ai.hfCache.*`, `ai.models.*`, secret `vllm-api-key` (Task 6).
- Produces: 1 PVC + 4 GPU Deployments + 4 Services. Each mounts the HF cache at `/root/.cache/huggingface` (compose-verified path) and carries `nodeSelector`/`tolerations` from `ai.gpu`.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/ai/hf-cache-pvc.yaml`**

```yaml
{{- /* M7: render only when at least one GPU server actually renders */ -}}
{{- $anyGpu := or .Values.ai.services.vllm.enabled .Values.ai.services.vllmTranslation.enabled .Values.ai.services.tei.enabled .Values.ai.services.teiReranker.enabled -}}
{{- if and .Values.ai.enabled .Values.ai.hfCache.enabled $anyGpu (not .Values.ai.remoteGpu.enabled) -}}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: genieai-hf-cache
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-cache"))) | nindent 4 }}
spec:
  accessModes:
    {{- toYaml .Values.ai.hfCache.accessModes | nindent 4 }}
  {{- with .Values.pluggable.storageClassName }}
  storageClassName: {{ . }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.ai.hfCache.storageSize }}
{{- end -}}
```

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/ai/vllm.yaml`**

```yaml
{{- if and .Values.ai.enabled .Values.ai.services.vllm.enabled (not .Values.ai.remoteGpu.enabled) -}}
{{- /* The factory reads .Values.services.<name>; model servers live under
       ai.services — pass the per-service values MERGED with the GPU/scheduling
       extras through the `aiService` context key (factory support: Task 2
       note) so the factory renders it unchanged.
       vLLM pods also need pod-level fsGroup: 1000 — the PVC root is
       root-owned and runAsUser 1000 cannot write the first model download
       without it (factory passthrough via "podSecurityContext"). */ -}}
{{- $merged := deepCopy .Values.ai.services.vllm
      | merge (dict
          "nodeSelector" .Values.ai.gpu.nodeSelector
          "tolerations" .Values.ai.gpu.tolerations
          "gpu" .Values.ai.gpu.vllm
          "resources" (dict "requests" (dict "cpu" "500m" "memory" "8Gi"))
          "command" (list "python3" "-m" "vllm.entrypoints.openai.api_server")
          "args" (list
            "--model" .Values.ai.models.llmId
            "--gpu_memory_utilization" .Values.ai.gpu.vllm.memoryUtilization
            "--served-model-name" .Values.ai.models.llmId
            "--max_model_len" .Values.ai.gpu.vllm.maxModelLen
            "--max_num_seqs" .Values.ai.gpu.vllm.maxNumSeqs
            (printf "--dtype=%s" .Values.ai.gpu.vllm.dtype)
            (printf "--enforce-eager=%v" .Values.ai.gpu.vllm.enforceEager))
          "volumeMounts" (list (dict "name" "hf-cache" "mountPath" "/root/.cache/huggingface"))
          "volumes" (list (dict "name" "hf-cache" "persistentVolumeClaim" (dict "claimName" "genieai-hf-cache")))
          "securityContext" (dict "runAsNonRoot" true "runAsUser" 1000 "allowPrivilegeEscalation" false "capabilities" (dict "drop" (list "ALL")))
          # Wave-8 F7: podSecurityContext passthrough (factory reads
          # `podSecurityContext` from the aiService dict) — fsGroup 1000
          # makes the RWX HF-cache PVC group-writable for vLLM.
          "podSecurityContext" (dict "fsGroup" 1000)
          # C2: the factory reads these keys UNGUARDED elsewhere (env,
          # envFrom-from-secrets, probes) — stub them or render nil-pointers.
          "env" (list)
          "secrets" (list (dict "name" "vllm-api-key"))
          "probes" (dict "readiness" (dict "httpGet" (dict "path" "/health" "port" 8000) "initialDelaySeconds" 120 "periodSeconds" 10 "failureThreshold" 30)
                         "liveness"  (dict "httpGet" (dict "path" "/health" "port" 8000) "initialDelaySeconds" 300 "periodSeconds" 30))) -}}
{{- /* Model pulls are slow: start_period 120-300s parity with the Swarm
       healthchecks (docker-compose.gpu.yaml vllm-llm: start_period 120s). */ -}}
{{- include "genieai-umbrella.serviceDeployment" (dict "name" "vllm" "component" "ai-vllm" "aiService" $merged "Values" .Values "Chart" .Chart "Release" .Release) }}
---
apiVersion: v1
kind: Service
metadata:
  name: vllm
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-vllm"))) | nindent 4 }}
spec:
  ports:
    - name: http
      port: 80
      targetPort: 8000
  selector:
    {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-vllm"))) | nindent 4 }}
{{- end -}}
```

**Note on the `aiService` context**: the factory's first line reads `index $ctx.Values.services $svcName`. Extend the factory's lookup to check `aiService` FIRST (one-line change):

```gotemplate
{{- $svc := $ctx.aiService | default (index $ctx.Values.services $svcName) -}}
```

This keeps Group-5 rendering untouched (no `aiService` key → old path) and lets AI tasks pass fully-merged dicts (image + gpu + args + volumes).

- [ ] **Step 3: Write `vllm-translation.yaml`, `tei.yaml`, `tei-reranker.yaml`** — same shape as Step 2 with these deltas (all compose-verified):

`vllm-translation`: same shape as vllm with `podSecurityContext.fsGroup: 1000` (RWX cache); args gain `--port 9031`, `--no-enable-chunked-prefill`, `--chat-template-content-format openai` (gemma handling); Service targetPort 9031; component `ai-vllm-translation`.

**I2 fixes baked in (round-7):**

`tei`: command `["/bin/sh","-c"]`, args `["text-embeddings-router --json-output --model-id <ai.models.embeddingId> --auto-truncate --port 8080"]` — **`--port 8080`**: the image binds :80 as root (Swarm needed `cap_add: NET_BIND_SERVICE`); running non-root with ALL caps dropped, an unprivileged port avoids the EPERM. Service targetPort **8080** (values `port` updated). Mount the HF cache at **`/data`** (NOT `/root/.cache/huggingface` — the TEI image bakes `HUGGINGFACE_HUB_CACHE=/data`; docker-compose.yaml tei/tei_reranker mount `huggingface:/data`); `podSecurityContext.fsGroup: 100` (TEI image UID; without it the first model download EACCES's the RWX PVC); component `ai-tei`.

`tei-reranker`: same `/data` mount + `podSecurityContext.fsGroup: 100` + `--port 8080` + `--max-batch-tokens <ai.gpu.teiReranker.maxBatchTokens> --max-concurrent-requests <ai.gpu.teiReranker.maxConcurrentRequests> --auto-truncate <ai.gpu.teiReranker.autoTruncate>`; Service targetPort 8080; component `ai-tei-reranker`.

All four: `envFrom` BOTH `vllm-api-key` (VLLM_API_KEY/HF_TOKEN/OPENAI_API_KEY — GPU-node bearer) AND Plan 3's `huggingface-hub-token` (HUGGING_FACE_HUB_TOKEN — the REAL HF pull token; distinct value, do not conflate — round-7 I4). vLLM pair mounts the cache at `/root/.cache/huggingface`; TEI pair at `/data`. All four carry `podSecurityContext: { fsGroup: 1000 }` (vLLM) / `{ fsGroup: 100 }` (TEI image UID) so the PVC is group-writable on first download.

- [ ] **Step 4: Red-gate → render all 4**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -cE "^kind: (Deployment)$" `
Expected: before this task's commit the count is `5` (Group 5); after, `9` (+4 GPU servers).

- [ ] **Step 5: Verify PVC renders (Review Focus #2)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -A 3 "kind: PersistentVolumeClaim" | grep -c "ReadWriteMany"`
Expected: prints `1` (accessModes carries ReadWriteMany).

- [ ] **Step 6: Verify GPU scheduling on all 4 (Review Focus #1)**

```bash
helm template test charts/genieai-umbrella -n genieai | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  gpu = [d for d in docs if d and d.get('kind')=='Deployment' and 'ai-' in str(d['metadata']['labels'].get('genieai.io/component',''))]; \
  assert len(gpu) == 4, f'{len(gpu)} gpu deployments'; \
  for d in gpu: \
    assert d['spec']['template']['spec'].get('nodeSelector',{}).get('genieai.io/gpu') == 'true', d['metadata']['name']; \
    assert any(r.get('nvidia.com/gpu') for c in d['spec']['template']['spec']['containers'] for r in [c.get('resources',{}).get('limits',{})]), d['metadata']['name']; \
  print('PASS')"
```

Expected: prints `PASS`.

- [ ] **Step 7: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/templates/ai/ charts/genieai-umbrella/templates/_lib/_service-factory.tpl
git commit -m "feat(charts): GPU model servers (vllm, vllm-translation, tei, tei-reranker) + shared HF cache PVC"
```

---

### Task 4: CPU OPEA wrappers ×7

**Files:**
- Create: `charts/genieai-umbrella/templates/ai/embedding.yaml`
- Create: `charts/genieai-umbrella/templates/ai/reranker.yaml`
- Create: `charts/genieai-umbrella/templates/ai/retriever.yaml`
- Create: `charts/genieai-umbrella/templates/ai/dataprep.yaml`
- Create: `charts/genieai-umbrella/templates/ai/chatqna.yaml`
- Create: `charts/genieai-umbrella/templates/ai/textgen.yaml`
- Create: `charts/genieai-umbrella/templates/ai/translation.yaml`

**Interfaces:**
- Consumes: factory + `aiService` merge pattern (Task 3 Step 2 note), secrets `vllm-api-key` + `kc-dataprep-client-secret` + `arango-root-secret` (Plan 2), `ai.chatqnaConfig` + `ai.arangoConfig` values (Task 1).
- Produces: 7 Deployments + 7 Services (port 80). **Env contract = the compose env blocks, transcribed VERBATIM** with exactly two classes of change, marked inline per env: `# re-pointed` (host/port → Service DNS :80) or `# values-exposed` (tunable via ai.* values). Nothing load-bearing is silently dropped.

- [ ] **Step 1: Add the `ai.arangoConfig` values block** (consumed by retriever + dataprep):

```yaml
  arangoConfig:
    db: genie-ai          # ARANGO_DB
    graphName: GRAPH      # ARANGO_GRAPH_NAME
    username: root        # ARANGO_USERNAME (password via arango-root-secret)
```

- [ ] **Step 2: Write `chatqna.yaml`** — canonical template, COMPLETE env (compose `chatqna-xeon-backend-server` block, lines ~1366-1432):

```yaml
{{- if and .Values.ai.enabled .Values.ai.services.chatqna.enabled -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chatqna
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-chatqna"))) | nindent 4 }}
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-chatqna"))) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-chatqna"))) | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: chatqna
          image: {{ .Values.ai.services.chatqna.image.repository }}:{{ .Values.ai.services.chatqna.image.tag }}
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8888
          workingDir: /app/ChatQnA
          env:
            - { name: CHATQNA_TYPE, value: ChatQnA }
            - { name: MEGA_SERVICE_HOST_IP, value: chatqna }
            - { name: LOG_LEVEL, value: info }
            # --- RAG pipeline peers (re-pointed to Service DNS :80;
            #     compose carried container ports 6000/7000/8000) ---
            - { name: EMBEDDING_SERVER_HOST_IP, value: embedding }
            - { name: EMBEDDING_SERVER_PORT, value: "80" }
            - { name: EMBEDDING_SERVER_ENDPOINT, value: /v1/embeddings }
            - { name: RETRIEVER_SERVICE_HOST_IP, value: retriever }
            - { name: RETRIEVER_SERVICE_PORT, value: "80" }
            - { name: RERANK_SERVER_HOST_IP, value: reranker }
            - { name: RERANK_SERVER_PORT, value: "80" }
            # --- LLM generation (compose LLM_SERVER_HOST_IP/PORT +
            #     VLLM_LLM_ENDPOINT; re-pointed + Task 8 ternary) ---
            - name: LLM_SERVER_HOST_IP
              {{- if .Values.ai.remoteGpu.enabled }}
              value: ""                       # remote: VLLM_LLM_ENDPOINT drives
              {{- else }}
              value: vllm
              {{- end }}
            - { name: LLM_SERVER_PORT, value: "80" }
            - name: VLLM_LLM_ENDPOINT
              {{- if .Values.ai.remoteGpu.enabled }}
              value: {{ .Values.ai.remoteGpu.vllmUrl | quote }}
              {{- else }}
              value: http://vllm.{{ .Values.namespace }}.svc.cluster.local:80
              {{- end }}
            # --- Translation model (chatqna dials it directly) ---
            - { name: TRANSLATION_SERVICE_HOST_IP, value: vllm-translation }
            - { name: TRANSLATION_SERVICE_PORT, value: "80" }
            - { name: GUARDRAIL_SERVICE_HOST_IP, value: guardrail }
            - { name: GUARDRAIL_SERVICE_PORT, value: "9090" }
            # --- Reranking strategy (values-exposed) ---
            - { name: RERANKING_STRATEGY, value: {{ .Values.ai.chatqnaConfig.rerankingStrategy | default "slice" | quote }} }
            - { name: RERANKING_THRESHOLD, value: {{ .Values.ai.chatqnaConfig.rerankingThreshold | default "0.75" | quote }} }
            - { name: RERANKER_TOP_N, value: {{ .Values.ai.chatqnaConfig.rerankerTopN | default "3" | quote }} }
            # --- Retriever defaults (INERT in production — chatqna forwards
            #     its own values; kept for parity) ---
            - { name: RETRIEVER_ARANGO_K, value: {{ .Values.ai.chatqnaConfig.retrieverK | default "20" | quote }} }
            - { name: RETRIEVER_ARANGO_FETCH_K, value: {{ .Values.ai.chatqnaConfig.retrieverFetchK | default "30" | quote }} }
            - { name: RETRIEVER_ARANGO_SCORE_THRESHOLD, value: "0.2" }
            - { name: RETRIEVER_ARANGO_DISTANCE_THRESHOLD, value: "1" }
            - { name: RETRIEVER_ARANGO_LAMBDA_MULT, value: "0.5" }
            - { name: RETRIEVER_ARANGO_SEARCH_START, value: chunk }
            - { name: RETRIEVER_ARANGO_TRAVERSAL_ENABLED, value: "true" }
            - { name: RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH, value: "2" }
            - { name: RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED, value: "5" }
            - { name: RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD, value: "0.7" }
            # --- Auth + identity ---
            - { name: KEYCLOAK_URL, value: "http://keycloak.{{ .Values.namespace }}.svc.cluster.local:8080/auth" }
            - { name: KC_REALM, value: genie }
            - { name: KC_CLIENT_ID, value: genie-app }
            - { name: OPEA_SSL_SKIP_VERIFY, value: "0" }
            # --- Prompts (two-tier override contract; empty = code default) ---
            - { name: CHATQNA_SYSTEM_PROMPT, value: "" }
            - { name: CHATQNA_ENFORCE_ABSTENTION, value: "true" }
            # --- Confidence scoring ---
            - { name: CONFIDENCE_RANK_DECAY, value: "0.5" }
            - { name: RERANKER_SCORE_CALIBRATION, value: none }
            - { name: RERANKER_SCORE_TEMPERATURE, value: "1.0" }
            - { name: LLM_SELF_CONFIDENCE_ENABLED, value: "0" }
            # --- Multi-turn blending (issue #833; default OFF) ---
            - { name: MULTI_TURN_BLEND_ENABLED, value: "false" }
            - { name: MULTI_TURN_BLEND_ALPHA, value: "0.7" }
            - { name: MULTI_TURN_HISTORY_TURNS, value: "1" }
            # --- Service URLs (re-pointed) ---
            - { name: DOC_REPO_URL, value: "http://document-repository.{{ .Values.namespace }}.svc.cluster.local:80" }
            - { name: BACKEND_SERVICE_URL, value: "http://backend.{{ .Values.namespace }}.svc.cluster.local:80" }
            # --- Observability (SDK no-op when 0) ---
            - { name: ENABLE_OBSERVABILITY, value: {{ ternary "1" "0" .Values.observability.enabled | quote }} }
            - { name: OTEL_EXPORTER_OTLP_ENDPOINT, value: "http://genieai-collector-collector.{{ .Values.namespace }}.svc.cluster.local:4318" }
          # OPENAI_API_KEY (+ VLLM_API_KEY) arrive via envFrom below — the
          # AsyncOpenAI client needs it for remote-GPU bearer auth.
          envFrom:
            - secretRef: { name: vllm-api-key }
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits:   { cpu: 2, memory: 2Gi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 65534
            capabilities:
              drop: ["ALL"]
          # Compose healthchecks use /health for ALL OPEA wrappers
          # (docker-compose.yaml lines 1438, 1333, 1241, 1051) — the
          # /v1/health_check guess from an earlier draft was wrong.
          readinessProbe:
            httpGet: { path: /health, port: 8888 }
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /health, port: 8888 }
            initialDelaySeconds: 30
            periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: chatqna
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-chatqna"))) | nindent 4 }}
spec:
  ports:
    - name: http
      port: 80
      targetPort: 8888
  selector:
    {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-chatqna"))) | nindent 4 }}
{{- end -}}
```

- [ ] **Step 3: Write the remaining six wrappers.** Same Deployment/Service skeleton (component `ai-<name>`, containerPort per Task 1, probe path `/health` per compose). Env contracts, transcribed from compose with re-point/values-exposed markers:

**`embedding.yaml`** (targetPort 6000; compose 1029-1045):
`EMBEDDING_MODEL_ENDPOINT` + `TEI_EMBEDDING_ENDPOINT` (BOTH names — compose sets both, one may be the name the code reads) → `http://tei.<ns>:80` (+ Task 8 ternary), `EMBEDDING_MODEL_ID=<ai.models.embeddingId>`, `OPEA_SSL_SKIP_VERIFY=0`, `LOG_LEVEL=info`; envFrom `vllm-api-key` (HF_TOKEN + VLLM_API_KEY both fed from it in compose).

**`reranker.yaml`** (targetPort 8000; compose 1113-1133):
`TEI_RERANKING_ENDPOINT` → `http://tei-reranker.<ns>:80` (+ternary), `RERANK_COMPONENT_NAME=GENIE_TEI_RERANKING`, `OPEA_SSL_SKIP_VERIFY=0`, `ENABLE_OBSERVABILITY`/`OTEL_EXPORTER_OTLP_ENDPOINT` (same pattern as chatqna), `LOG_LEVEL=info`; **empirically-tuned knobs, values-exposed via `ai.rerankerConfig`** (add to values: `noveltySigmoidA: "20.0"`, `noveltySigmoidB: "0.25"`, `contextDecayFactor: "0.0025"`, `minValueThreshold: "-1.0"` — el-salvador calibration history lives on these; do NOT drop); envFrom `vllm-api-key`.

**`retriever.yaml`** (targetPort 7000; compose 1281-1325):
`ARANGO_URL=http://arangodb-single.<ns>:8529`, `ARANGO_DB=<ai.arangoConfig.db>`, `ARANGO_GRAPH_NAME=<ai.arangoConfig.graphName>`, `RETRIEVER_COMPONENT_NAME=GENIE_RETRIEVER_ARANGODB`, `VLLM_ENDPOINT`/`TEI_EMBEDDING_ENDPOINT` (re-pointed + ternary), `OPEA_SSL_SKIP_VERIFY=0`, `ENABLE_OBSERVABILITY`/`OTEL_*`; hybrid-retrieval block (values-exposed via `ai.retrieverConfig`, defaults from compose): `RETRIEVER_HYBRID_RETRIEVAL_ENABLED=true`, `RETRIEVER_HYBRID_RRF_K=60`, `RETRIEVER_HYBRID_BM25_CANDIDATES=50`, `RETRIEVER_HYBRID_DENSE_WEIGHT=1.0`, `RETRIEVER_HYBRID_LEXICAL_WEIGHT=1.0`, `RETRIEVER_HYBRID_BM25_ANALYZER=text_en`, `RETRIEVER_ARANGO_FILTER_STRATEGY=OR`, `RETRIEVER_SUMMARIZER_ENABLED=false` + traversal block as in chatqna. **ARANGO credentials via explicit secretKeyRef — envFrom a `password`-keyed Secret would create env `password`, not `ARANGO_PASSWORD`:**
```yaml
            - { name: ARANGO_USERNAME, value: {{ .Values.ai.arangoConfig.username | quote }} }
            - name: ARANGO_PASSWORD
              valueFrom:
                secretKeyRef: { name: arango-root-secret, key: password }
```
envFrom `vllm-api-key`.

**`dataprep.yaml`** (targetPort 5000; compose 1175-1215):
`DATAPREP_COMPONENT_NAME=GENIE_DATAPREP_ARANGODB`, `VLLM_MODEL_ID=<llmId>`, `VLLM_ENDPOINT`/`TEI_EMBEDDING_ENDPOINT` (re-pointed + ternary), `GUARDRAIL_URL=http://guardrail.<ns>:80/v1/guardrails` (re-pointed), arango block as retriever (URL/DB/GRAPH + secretKeyRef password), `DOCUMENT_REPOSITORY_URL`/`BACKEND_SERVICE_URL` (re-pointed :80), `KEYCLOAK_URL=http://keycloak.<ns>:8080/auth`, `KC_REALM=genie`, `KC_DATAPREP_CLIENT_ID=dataprep-service-client`, `LABELING_STRATEGY=llm`, `EMBEDDING_LABEL_THRESHOLD=0.75`, `BM25_LABEL_THRESHOLD=2.00`, `CONTENT_EXTRACTION_METHOD=docling`, `DOCLING_DEVICE=cuda|cpu` (from `onGpu`), `DOCLING_ENDPOINT` (Task 8 ternary; empty = in-process), `DOCLING_ENDPOINT_TIMEOUT=<ai.remoteGpu.doclingTimeout>` (M4 fix — wire it), `DATAPREP_MAX_CONCURRENT_BATCHES=20`, `DATAPREP_LLM_LABEL_BATCH_SIZE=4`, chunk sizes (values-exposed `ai.dataprepConfig.chunkSize*`: PDF 500 / DOCX 1000 / XLSX 1500 / PPTX 500 / HTML 500 / TXT 500 / MD 500), `DATAPREP_CHUNK_OVERLAP=50`, `LABEL_SELECTOR_SYSTEM_PROMPT=""` (two-tier prompt contract), `CONTEXTUAL_RETRIEVAL_ENABLED=true`, `DATAPREP_CONTEXTUAL_MODEL=""`, `DATAPREP_CONTEXTUAL_DOC_BUDGET=6000` (+ `DATAPREP_CONTEXTUAL_MAX_TOKENS=512` — the MR !218 fix); envFrom `vllm-api-key` + `kc-dataprep-client-secret`; emptyDir `/tmp` scratch.

**`textgen.yaml`** (targetPort 9000; compose 868-885):
`LLM_ENDPOINT=http://vllm.<ns>:80` (+ternary), `LLM_MODEL_ID=<llmId>`; envFrom `vllm-api-key`.

**`translation.yaml`** (targetPort 8888; compose 951-982):
`LLM_ENDPOINT=http://vllm-translation.<ns>:80` (+ternary), `LLM_MODEL_ID=<translationId>`, `SAFETY_GUARD_MODEL_ID=<translationId>`, `GUARDRAILS_COMPONENT_NAME=OPEA_LLM_GUARD`.

- [ ] **Step 4: Render count**

Run: `helm template test charts/genieai-umbrella -n genieai --show-only 'templates/ai/*' | grep -c "^kind: Deployment$"`
Expected: prints `11` (4 GPU + 7 wrappers). (`--show-only` avoids subchart-Deployment drift — see M11 convention note in Self-Review.)

- [ ] **Step 5: Verify all AI Services expose port 80**

Run: `helm template test charts/genieai-umbrella -n genieai | python3 -c "import sys,yaml; docs=list(yaml.safe_load_all(sys.stdin)); ai=[d for d in docs if d and d.get('kind')=='Service' and str(d['metadata']['labels'].get('genieai.io/component','')).startswith('ai-')]; assert len(ai)==11, len(ai); assert all(p['port']==80 for d in ai for p in d['spec']['ports']), 'non-80 service port'; print('PASS')"`
Expected: prints `PASS`.

- [ ] **Step 6: Env-port + credential sweep (Review Focus #3; replaces the broken grep)**

```bash
helm template test charts/genieai-umbrella -n genieai |   python3 -c "
import sys, yaml
docs = list(yaml.safe_load_all(sys.stdin))
bad = []
for d in docs:
    if not d or d.get('kind') != 'Deployment': continue
    for c in d['spec']['template']['spec']['containers']:
        for e in c.get('env', []):
            n, v = e.get('name',''), str(e.get('value',''))
            if n.endswith('_PORT') and v not in ('80', '9090'): bad.append((d['metadata']['name'], n, v))
            if n.endswith('_ENDPOINT') and v.startswith('http://') and not v.endswith(':80') and ':8529' not in v and ':8080' not in v:
                bad.append((d['metadata']['name'], n, v))
assert not bad, bad
print('PASS')"
```

Expected: prints `PASS` — every `*_PORT` is 80 (GUARDRAIL 9090 excepted), every http endpoint is Service-DNS :80 (arango 8529 / keycloak 8080 excepted).

- [ ] **Step 7: ARANGO_PASSWORD secretKeyRef present on retriever + dataprep (C3 gate)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -B 2 "key: password" | grep -c "name: ARANGO_PASSWORD"`
Expected: prints `2`.

- [ ] **Step 8: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/templates/ai/ charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): CPU OPEA wrappers — compose-verbatim env, Service-DNS :80, secretKeyRef arango creds"
```

---

### Task 5: Disabled-tier templates ×3 (guardrail, chatqna-ui, chatqna-nginx)

**Files:**
- Create: `charts/genieai-umbrella/templates/ai/guardrail.yaml`
- Create: `charts/genieai-umbrella/templates/ai/chatqna-ui.yaml`
- Create: `charts/genieai-umbrella/templates/ai/chatqna-nginx.yaml`

**Interfaces:**
- Consumes: `ai.services.{guardrail,chatqnaUi,chatqnaNginx}.enabled` (default false — Swarm replicas 0).
- Produces: 3 template files that render NOTHING by default; flipping the toggles in `values-override.yaml` brings them up (guardrail: `LLM_ENDPOINT=http://vllm-translation.<ns>:80`, `SAFETY_GUARD_MODEL_ID=<translationId>`; ui/nginx: OPEA defaults, nginx env points at chatqna + ui).

- [ ] **Step 1: Write the three templates** — same shape as Task 4 wrappers, gated on their `enabled` flags. Guardrail Service targetPort 9090; ui/nginx 5173.

- [ ] **Step 2: Default render — zero of the three**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -cE "ai-guardrail|ai-chatqna-ui|ai-chatqna-nginx"; true`
Expected: prints `0`.

- [ ] **Step 3: Flip toggle render — guardrail appears**

Run: `helm template test charts/genieai-umbrella -n genieai --set ai.services.guardrail.enabled=true | grep -c "ai-guardrail"`
Expected: prints ≥ 2 (Deployment + Service labels).

- [ ] **Step 4: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/templates/ai/
git commit -m "feat(charts): guardrail + chatqna ui/nginx templates (off by default, Swarm replicas-0 parity)"
```

---

### Task 6: AI-tier SealedSecrets ×3 + backend envFrom update

**Files:**
- Create: `charts/genieai-umbrella/templates/secrets/ai-secrets.yaml`
- Modify: `charts/genieai-umbrella/values.yaml` (backend `secrets:` list + `ai.chatqnaConfig` block referenced by Task 4)

**Interfaces:**
- Consumes: spec §8 rows: `VLLM_API_KEY` (Plan 5), `keycloakProxyClientSecret` (Plan 5), `kcDataprepClientSecret` (Plan 5).
- Produces: 3 SealedSecret CRs. `vllm-api-key` carries FOUR keys (`VLLM_API_KEY`, `HF_TOKEN`, `HUGGINGFACEHUB_API_TOKEN`, `OPENAI_API_KEY`) — the GPU-node bearer under every env name the wrappers + chatqna AsyncOpenAI client read. The real HF pull token is a SEPARATE value: Plan 3 `huggingface-hub-token` (key `HUGGING_FACE_HUB_TOKEN`), envFrom-ed by the model servers alongside `vllm-api-key`. `keycloak-proxy-client-secret` (key `KEYCLOAK_PROXY_CLIENT_SECRET`) is consumed by the BACKEND (keycloak-proxy-service.js) — values update only here; its envFrom already works via Plan 3's backend secrets list. `kc-dataprep-client-secret` (key `KC_DATAPREP_CLIENT_SECRET`) feeds dataprep's client-credentials grant.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/secrets/ai-secrets.yaml`**

```yaml
{{- /* GATES:
       vllm-api-key + keycloak-proxy-client-secret + kc-dataprep-client-secret
       all render whenever secrets.sealedSecrets.enabled — the AI master
       switch is INDEPENDENT of secret presence. Reasons:
         - vllm-api-key is also envFrom-ed by the BACKEND (VLLM_API_KEY for
           remote-GPU bearer auth); a Day-0 ai.enabled=false install with
           the backend on must still see the secret or backend pods
           crashloop with CreateContainerConfigError.
         - kc-dataprep is consumed only by dataprep (AI-tier), but having
           it present in Day-0 lets a single env-override flip the dataprep
           toggle without re-running kubeseal on a missing CR.
       Spec §8 mapping (names DNS-1123; encryptedData keys = ENV VAR NAMES):
         VLLM_API_KEY → vllm-api-key (keys VLLM_API_KEY + HF_TOKEN +
           HUGGINGFACEHUB_API_TOKEN + OPENAI_API_KEY — the GPU-node bearer
           value under every env name the WRAPPERS + chatqna AsyncOpenAI
           client read; the real HF pull token is a SEPARATE value in
           Plan 3's huggingface-hub-token secret (HUGGING_FACE_HUB_TOKEN)
           — model servers envFrom BOTH.)
         keycloakProxyClientSecret → keycloak-proxy-client-secret
           (key KEYCLOAK_PROXY_CLIENT_SECRET — backend consumer)
         kcDataprepClientSecret    → kc-dataprep-client-secret
           (key KC_DATAPREP_CLIENT_SECRET — dataprep consumer)
*/ -}}
{{- if .Values.secrets.sealedSecrets.enabled -}}
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: vllm-api-key
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: vllm-api-key
spec:
  encryptedData:
    VLLM_API_KEY: UExBQ0VIT0xERVIr     # PLACEHOLDER+ — RE-SEAL before helm install (F12)
    HF_TOKEN: UExBQ0VIT0xERVIr          # ditto
    HUGGINGFACEHUB_API_TOKEN: UExBQ0VIT0xERVIr    # ditto
    OPENAI_API_KEY: UExBQ0VIT0xERVIr     # ditto   # all four = same bearer value, re-sealed
---
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: kc-dataprep-client-secret
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: kc-dataprep-client-secret
spec:
  encryptedData:
    KC_DATAPREP_CLIENT_SECRET: UExBQ0VIT0xERVIr     # PLACEHOLDER+ — RE-SEAL (F12)
---
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: keycloak-proxy-client-secret
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: keycloak-proxy-client-secret
spec:
  encryptedData:
    KEYCLOAK_PROXY_CLIENT_SECRET: UExBQ0VIT0xERVIr     # PLACEHOLDER+ — RE-SEAL (F12)
{{- end -}}
```

- [ ] **Step 2: Wire the backend's AI-consumer env** in `values.yaml`:

```yaml
  services:
    backend:
      env:
        # ... existing Plan 3 env ...
        # --- Plan 5: AI consumers (compose-verified backend env block) ---
        - name: OPEA_HOST
          value: chatqna    # code default is a deployment-specific hostname
        - name: KEYCLOAK_PROXY_CLIENT_ID
          value: genie-proxy-client
        - name: VLLM_TRANSLATION_MODEL_ID
          value: {{ .Values.ai.models.translationId | default "google/gemma-3-4b-it" | quote }}
        - name: VLLM_TRANSLATION_ENDPOINT
          # ternaried at template level in templates/services/backend.yaml
          # (Plan 3 file — Task 8 Step 1 covers it)
          value: http://vllm-translation.{{ .Values.namespace }}.svc.cluster.local:80
        - name: STREAMING_TRANSLATION_ENABLED
          value: "0"
      secrets:
        - name: keycloak-client-secret
        - name: huggingface-hub-token
        - name: keycloak-proxy-client-secret   # Plan 5: keycloak-proxy-service
        - name: vllm-api-key                    # Plan 5: remote-GPU bearer (VLLM_API_KEY)
          # Wave-8 F6: vllm-api-key SealedSecret is gated on ai.enabled
          # in Task 6 — but backend references it for `OPEA_HOST`/VLLM_API_KEY
          # and would crashloop on the same Day-0 ai.enabled=false install
          # the C5 fix unlocked for keycloak-proxy-client-secret. Move
          # vllm-api-key's secret gate out of ai.enabled (or, equivalently,
          # add it to the `keycloak-proxy-client-secret` block which is
          # already ai.enabled-independent). Apply this in Task 6 Step 1:
          # split the secret gating — vllm-api-key renders when
          # sealedSecrets.enabled (full chart), even when ai.enabled=false.
```

NOTE: values.yaml is STATIC — the template-level remote ternary for `VLLM_TRANSLATION_ENDPOINT` is added to `templates/services/backend.yaml` (Plan 3 file) in Task 8 Step 1, exactly like the `_ai/*` wrappers. The `{{ .Values... }}` line above shows the DEFAULT baked into the backend template, not values.yaml content.

- [ ] **Step 3: Render count**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: SealedSecret$"`
Expected: prints `12` (4 Plan-2 + 3 Plan-3 + 2 Plan-4 + 3 Plan-5). And with `--set ai.enabled=false`: STILL `10` — `keycloak-proxy-client-secret` must survive the AI master switch (C5 gate).

- [ ] **Step 4: Verify dual keys in vllm-api-key (Review Focus #5)**

```bash
helm template test charts/genieai-umbrella -n genieai | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  ss = next(d for d in docs if d and d.get('kind')=='SealedSecret' and d['metadata']['name']=='vllm-api-key'); \
  keys = set(ss['spec']['encryptedData'].keys()); \
  assert keys == {'VLLM_API_KEY','HF_TOKEN','HUGGINGFACEHUB_API_TOKEN','OPENAI_API_KEY'}, keys; print('PASS')"
```

Expected: prints `PASS`.

- [ ] **Step 5: Verify backend envFrom includes the proxy secret (Review Focus #5)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -B 1 "name: keycloak-proxy-client-secret" | grep -c secretRef`
Expected: prints `1`. Plus: `grep -c "name: OPEA_HOST" ` ≥ 1 (backend AI wiring rendered).

- [ ] **Step 6: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/templates/secrets/ai-secrets.yaml charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): AI-tier SealedSecrets (vllm-api-key dual-key, keycloak-proxy, kc-dataprep)"
```

---

### Task 7: NetworkPolicies for the AI tier

**Files:**
- Create: `charts/genieai-umbrella/templates/ai/networkpolicies.yaml`

**Interfaces:**
- Consumes: Plan 3 NP conventions (default-deny + explicit allow; `kubernetes.io/metadata.name` for DNS; port-scoped `ipBlock` where operator labels are unverified).
- Produces: one NetworkPolicy per enabled AI service. Wrappers egress to: arango 8529 (retriever, dataprep, chatqna), model-server Services 80 (per consumer), DNS. Model servers ingress: from wrapper peers; egress: DNS + 443 (HF model pulls) only.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/ai/networkpolicies.yaml`**

One `NetworkPolicy` per service, following the Plan 3 shape. Key edges (per-service `egress` blocks):

```yaml
{{- if and .Values.ai.enabled .Values.ai.services.retriever.enabled -}}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ai-retriever
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ai-retriever"))) | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      genieai.io/component: ai-retriever
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              genieai.io/component: ai-chatqna
      ports:
        - { protocol: TCP, port: 7000 }
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - { protocol: UDP, port: 53 }
    # Model servers + arango (port-scoped any-dest until Plan 6 label pass)
    - to:
        - ipBlock: { cidr: 0.0.0.0/0 }
      ports:
        - { protocol: TCP, port: 80 }     # in-cluster model Services
        - { protocol: TCP, port: 8529 }   # arangodb
        - { protocol: TCP, port: 8080 }   # keycloak
        - { protocol: TCP, port: 4318 }   # otel collector
    {{- /* I1 remote-GPU: wrappers must ALSO reach the external GPU node on
           443 — without this rule the remote flip works at env level and is
           then blocked at the policy layer (the half-flip RF#4 warns about,
           on the policy axis). */ -}}
    {{- if $.Values.ai.remoteGpu.enabled }}
    - to:
        - ipBlock: { cidr: 0.0.0.0/0 }
      ports:
        - { protocol: TCP, port: 443 }    # remote GPU node (TLS)
    {{- end }}
{{- end -}}
```

Full edge matrix (replicate the shape above per service):

| Service | ingress from | egress to (ports) |
|---|---|---|
| embedding | chatqna, dataprep, retriever (6000) | tei 80, DNS |
| reranker | chatqna (8000) | tei-reranker 80, DNS |
| retriever | chatqna (7000) | vllm 80, tei 80, arango 8529, DNS |
| dataprep | backend (5000) | vllm 80, tei 80, arango 8529, document-repository 80 (file fetch), backend 80 (ingestion-log), keycloak 8080 (token), otel-collector 4318, DNS |
| chatqna | backend (8888) | embedding 80, retriever 80, reranker 80, vllm 80, vllm-translation 80, keycloak 8080, document-repository 80, backend 80, otel-collector 4318, DNS |
| textgen | same-ns any (9000; no verified backend consumer in compose) | vllm 80, DNS |
| translation | same-ns any (8888; backend dials vllm-translation directly, not this wrapper) | vllm-translation 80, DNS |
| vllm / vllm-translation | wrappers (8000 / 9031) | DNS + 443 (HF pulls) |
| tei / tei-reranker | wrappers (80) | DNS + 443 (HF pulls, first boot) |

- [ ] **Step 2: Render + count**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: NetworkPolicy$"`
Expected: prints `16` (5 Plan-3 + 11 AI tier — guardrail/ui/nginx off).

- [ ] **Step 3: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/templates/ai/networkpolicies.yaml
git commit -m "feat(charts): AI-tier NetworkPolicies (default-deny + edge matrix)"
```

---

### Task 8: Remote-GPU mode

**Files:**
- Modify: `charts/genieai-umbrella/templates/ai/{retriever,dataprep,chatqna,translation,textgen,embedding,reranker}.yaml` (endpoint env ternaries)
- Modify: `charts/genieai-umbrella/templates/services/backend.yaml` (Plan 3 file — `VLLM_TRANSLATION_ENDPOINT` ternary, I3)
- Modify: `charts/genieai-umbrella/templates/ai/networkpolicies.yaml` (remote 443 egress, I1)

**Interfaces:**
- Consumes: `ai.remoteGpu.{enabled,vllmUrl,vllmTranslationUrl,teiEmbeddingUrl,teiRerankingUrl}`.
- Produces: remote mode = 0 GPU Deployments + wrapper env pointing at external URLs (bearer auth via `VLLM_API_KEY` — the OPEA/TEI wrappers and vLLM accept `Authorization: Bearer`, matching the Swarm `GPU_NODE_HOST` + `VLLM_API_KEY` contract).

- [ ] **Step 1: Ternary the endpoint envs.** Pattern per endpoint (retriever shown; apply to every wrapper that references a model server):

```yaml
            - name: VLLM_ENDPOINT
              {{- if .Values.ai.remoteGpu.enabled }}
              value: {{ .Values.ai.remoteGpu.vllmUrl | quote }}
              {{- else }}
              value: http://vllm.{{ .Values.namespace }}.svc.cluster.local:80
              {{- end }}
```

Mapping: `VLLM_ENDPOINT`→`vllmUrl`, `TEI_EMBEDDING_ENDPOINT`/`EMBEDDING_MODEL_ENDPOINT` (both names)→`teiEmbeddingUrl`, `TEI_RERANKING_ENDPOINT`→`teiRerankingUrl`, translation `LLM_ENDPOINT`→`vllmTranslationUrl`, textgen `LLM_ENDPOINT`→`vllmUrl`, chatqna `VLLM_LLM_ENDPOINT`→`vllmUrl` + `LLM_SERVER_HOST_IP`→empty (remote drives via the URL), **backend** `VLLM_TRANSLATION_ENDPOINT`→`vllmTranslationUrl` (I3), **dataprep** `DOCLING_ENDPOINT`→`doclingUrl` (non-empty only — empty keeps in-process docling, Swarm semantics) + `DOCLING_ENDPOINT_TIMEOUT` wired from `ai.remoteGpu.doclingTimeout` (M4). All URLs carry the GPU node's nginx path prefixes (see values comment). **Also add the remote-443 egress rule to networkpolicies.yaml (I1)** — Step 1 of Task 7 shows the conditional block.

- [ ] **Step 2: Fail-fast on empty remote URLs**

Add to `templates/ai/*` wrappers' top:

```gotemplate
{{- if and .Values.ai.enabled .Values.ai.remoteGpu.enabled -}}
{{- if or (not .Values.ai.remoteGpu.vllmUrl) (not .Values.ai.remoteGpu.teiEmbeddingUrl) -}}
{{- /* Wave-8 F9: gates at OUTER if-level (was nested INSIDE the base
       vllm+tei guard, so optional URLs were silently accepted when the
       two base URLs were set). Now each URL check runs independently. */ -}}
{{- $needTir := or .Values.ai.services.reranker.enabled .Values.ai.services.chatqna.enabled -}}
{{- $needVt := or .Values.ai.services.translation.enabled .Values.ai.services.chatqna.enabled .Values.services.backend.enabled -}}
{{- if and .Values.ai.remoteGpu.enabled $needTir (not .Values.ai.remoteGpu.teiRerankingUrl) -}}
{{- fail "ai.remoteGpu.enabled=true with reranker/chatqna enabled requires teiRerankingUrl" -}}
{{- end -}}
{{- if and .Values.ai.remoteGpu.enabled $needVt (not .Values.ai.remoteGpu.vllmTranslationUrl) -}}
{{- fail "ai.remoteGpu.enabled=true with translation/chatqna/backend enabled requires vllmTranslationUrl" -}}
{{- end -}}
{{- if and .Values.ai.remoteGpu.enabled (or (not .Values.ai.remoteGpu.vllmUrl) (not .Values.ai.remoteGpu.teiEmbeddingUrl)) -}}
{{- fail "ai.remoteGpu.enabled=true requires vllmUrl + teiEmbeddingUrl; doclingUrl is optional (empty = in-process docling)" -}}
{{- end -}}
{{- end -}}
{{- end -}}
```

- [ ] **Step 3: Render remote — zero GPU Deployments (Review Focus #4)**

Run: `helm template test charts/genieai-umbrella -n genieai --set ai.remoteGpu.enabled=true --set ai.remoteGpu.vllmUrl=https://gpu.example.org/vllm --set ai.remoteGpu.teiEmbeddingUrl=https://gpu.example.org/tei --set ai.remoteGpu.teiRerankingUrl=https://gpu.example.org/teir --set ai.remoteGpu.vllmTranslationUrl=https://gpu.example.org/vllmt | grep -cE "ai-vllm$|ai-tei$|ai-vllm-translation$|ai-tei-reranker$|kind: PersistentVolumeClaim" || echo "0"`
Expected: prints `0` — GPU Deployments + PVC all suppressed.

- [ ] **Step 4: Render remote — external URLs in env (Review Focus #4)**

Run: `helm template test charts/genieai-umbrella -n genieai --set ai.remoteGpu.enabled=true --set ai.remoteGpu.vllmUrl=https://gpu.example.org/vllm --set ai.remoteGpu.teiEmbeddingUrl=https://gpu.example.org/tei | grep -c "gpu.example.org"`
Expected: prints ≥ 2 (retriever + dataprep + chatqna envs).

- [ ] **Step 5: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/templates/ai/
git commit -m "feat(charts): remote-GPU mode (GPU_NODE_HOST equivalent, fail-fast on missing URLs)"
```

---

### Task 9: helm test — AI-tier reachability

**Files:**
- Create: `charts/genieai-umbrella/templates/tests/test-ai-reachability.yaml`

**Interfaces:**
- Consumes: AI Services (Tasks 3-5). Skips GPU-server checks when `ai.remoteGpu.enabled=true`.
- Produces: a `helm test` Pod curling wrapper health endpoints on Service port 80.

- [ ] **Step 1: Write the test pod** (curlimages/curl:8.10.1, same skeleton as Plan 3 Task 9):

```yaml
{{- if .Values.ai.enabled -}}
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "genieai-common.fullname" . }}-test-ai-reach
  namespace: {{ .Values.namespace }}
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  restartPolicy: Never
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: t
      image: curlimages/curl:8.10.1
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        runAsNonRoot: true
        runAsUser: 65534
        capabilities: { drop: ["ALL"] }
      command: ["/bin/sh", "-c"]
      args:
        - |
          set -eu
          ns="{{ .Values.namespace }}"
          failures=0
          check() {
            url=$1; expected=$2
            code=$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)
            if [ "$code" != "000" ] && [ "$code" -lt 500 ]; then
              echo "PASS: $url -> ${code}"
            else
              echo "FAIL: $url expected ${expected}, got ${code}"; failures=$((failures+1))
            fi
          }
          {{- /* Per-service gating (M8) + compose-verified /health paths
                 (I7 — the /v1/health_check guesses were wrong). */ -}}
          {{- if and (not .Values.ai.remoteGpu.enabled) .Values.ai.services.vllm.enabled }}
          check http://vllm.${ns}.svc.cluster.local:80/health reachable
          {{- end }}
          {{- if and (not .Values.ai.remoteGpu.enabled) .Values.ai.services.tei.enabled }}
          check http://tei.${ns}.svc.cluster.local:80/health reachable
          {{- end }}
          {{- range $name := list "chatqna" "retriever" "dataprep" "embedding" "reranker" "translation" "textgen" }}
          {{- if and $.Values.ai.enabled (dig "ai" "services" $name "enabled" false $) }}
          check http://{{ $name }}.{{ $.Values.namespace }}.svc.cluster.local:80/health reachable
          {{- end }}
          {{- end }}
          [ "$failures" -eq 0 ] && echo "PASS: AI tier reachable"
          exit $failures
{{- end -}}
```

NOTE: `/health` is the compose-verified healthcheck path for ALL OPEA wrappers (docker-compose.yaml lines 1438, 1333, 1241, 1051) and the vLLM `/health` route. If a service's actual route differs at execution time, adjust the check, not the service.

- [ ] **Step 2: Render + lint + commit**

```bash
helm template test charts/genieai-umbrella -n genieai | grep -c "test-ai-reach"
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/templates/tests/test-ai-reachability.yaml
git commit -m "test(charts): helm test for AI-tier reachability"
```

---

### Task 10: Dependency graph + k8s-native-audit + inventory updates

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml` (`dependencyGraph`)
- Modify: `docs/charts/k8s-native-audit.md` (AI-tier rows)
- Modify: `charts/genieai-umbrella/templates/hooks/pre-install-dependency-check.yaml` (`enabled.json` gains AI keys)

**Interfaces:**
- Consumes: Plan 2 dependency graph + evaluator (deps resolve against graph namespaces — AI services are SERVICE deps of backend and of each other).
- Produces: graph edges + audit rows so the pre-install evaluator validates the AI tier and every Deployment maps to an audit row (standing review rule).

- [ ] **Step 1: Extend `dependencyGraph` in values.yaml**

```yaml
dependencyGraph:
  services:
    backend:
      - keycloak
      - arangodb
      - chatqna          # OPEA_HOST=chatqna (compose-verified)
      - vllmTranslation  # VLLM_TRANSLATION_ENDPOINT dials vllm-translation-guardrail DIRECTLY
      # NOTE: textgen has NO backend consumer in compose (its only env is
      # LLM_ENDPOINT=vllm) — no backend->textgen edge; it renders as an
      # independent OPEA service.
    frontend:
      - backend
    documentRepository:
      - backend
    clamav: []
    # Plan 5 — AI tier (service→service edges; evaluator resolves the
    # namespace from the graph itself). Leaf model servers listed as KEYS
    # with empty deps (spec §5.1 shape) so dep resolution never falls
    # through to the data namespace for them.
    chatqna: [embedding, retriever, reranker, vllm, keycloak]
    embedding: [tei]
    reranker: [teiReranker]
    retriever: [vllm, tei, arangodb]
    dataprep: [vllm, tei, arangodb]
    textgen: [vllm]
    translation: [vllmTranslation]
    vllm: []
    vllmTranslation: []
    tei: []
    teiReranker: []
    # M3: NO vllmTranslation→vllm / teiReranker→tei edges — those are
    # scheduling/budget couplings (shared GPU node + HF cache), not
    # enabled-dependencies; as graph edges they false-block legitimate
    # partial configs (e.g. tei off, tei-reranker pointed at a remote
    # embed endpoint).
  data:
    postgres: [""]
    arangodb: [""]
    keycloak: [postgres]
```

- [ ] **Step 2: Extend the `enabled.json` ConfigMap** (Plan 2 Task 6) with the AI keys — same `dig` pattern:

```yaml
    {{- range $name := list "chatqna" "embedding" "reranker" "retriever" "dataprep" "textgen" "translation" "vllm" "vllmTranslation" "tei" "teiReranker" -}}
    {{- $_ := set $flat (printf "ai.services.%s.enabled" $name) (dig "ai" "services" $name "enabled" false $) -}}
    {{- end -}}
```

AND **rewire the evaluator loop**` directly; with AI nodes under `ai.services.*`, every AI service reads disabled and its edges are never checked — the negative test would silently pass-green). Three changes in the Job's Python:

```python
def svc_enabled(name):
    # services.* OR ai.services.* — AND the ai.enabled master gate is
    # already folded in by the effective-enablement dig below.
    return (enabled.get(f"services.{name}.enabled", False)
            or enabled.get(f"ai.services.{name}.enabled", False))

def dep_enabled(dep):
    if dep in graph.get("services", {}):
        return svc_enabled(dep)
    return enabled.get(f"data.{dep}.enabled", False)

for tier in ("services", "data"):
    for svc, deps in graph.get(tier, {}).items():
        if not svc_enabled(svc):        # <- loop gate rewired through svc_enabled
            continue
        ...
```

AND render **effective** AI enablement in enabled.json (the per-service dig alone ignores the master switch):

```yaml
    {{- range $name := list "chatqna" "embedding" "reranker" "retriever" "dataprep" "textgen" "translation" "vllm" "vllmTranslation" "tei" "teiReranker" -}}
    {{- $eff := and $.Values.ai.enabled (dig "ai" "services" $name "enabled" false $) -}}
    {{- $_ := set $flat (printf "ai.services.%s.enabled" $name) $eff -}}
    {{- end -}}
```

- [ ] **Step 3: Amend `docs/charts/k8s-native-audit.md`** — add rows:

```markdown
| AI | vllm, vllm-translation, tei, tei-reranker (model servers) | factory Deployments (upstream images) on GPU nodes | chart-tier | upstream model servers, no operator exists; GPU scheduling via nodeSelector + nvidia.com/gpu |
| AI | embedding, reranker, retriever, dataprep, chatqna, textgen, translation | factory Deployments (CI-built genie-ai-* images) | bespoke | the product's own OPEA wrappers — bespoke by nature |
| AI | guardrail, chatqna-ui, chatqna-nginx | factory Deployments, OFF by default | chart-tier | Swarm replicas-0 parity; enabling is a values flip |
| AI | GPU enablement | NVIDIA device plugin / GPU Operator = cluster bootstrap prerequisite | operator-native (prerequisite) | NOT a chart dep — same tier as keycloak-operator |
```

- [ ] **Step 4: Negative test — chatqna on, embedding off**

Run: `helm template test charts/genieai-umbrella -n genieai --set ai.services.embedding.enabled=false | grep -c "kind: Deployment"`
Expected: renders fine (Helm does not evaluate the dep graph) — then confirm the HOOK catches it: the pre-install dep-check Job's rendered `enabled.json` shows `"ai.services.embedding.enabled": false` while `chatqna` is `true`; the evaluator (Plan 2 Task 6 logic extended in Step 2) fails with `services.chatqna requires service.embedding`. Assert via the Job's rendered script text, not a live install (CI without GPU runs `helm template` only). **Remote-mode note**: with `ai.remoteGpu.enabled=true`, the GPU Deployments don't render but the graph still resolves them through `ai.services.*.enabled` — which stays `true` (the SERVICE is provided, externally). That is correct semantics: the dependency is on the capability, not the in-cluster pod. The PVC suppression (Task 3, M7 gate) uses render-time service flags, unrelated to the graph.

- [ ] **Step 5: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add charts/genieai-umbrella/values.yaml charts/genieai-umbrella/templates/hooks/pre-install-dependency-check.yaml docs/charts/k8s-native-audit.md
git commit -m "feat(charts): AI-tier dependency graph + audit rows + evaluator extension"
```

---

### Task 11: Final validation + README

**Files:**
- Modify: `charts/README.md`
- Modify: `charts/genieai-umbrella/README.md`
- Modify: `docs/charts/plan-defects.md` (ANNOTATE, not close, the ArangoDB-URL row: chart-side name `arangodb-single.<ns>:8529` matches Plan 2's CR, but the kube-arangodb-created SERVICE name stays unverified until first live render — row stays open until then, M9)

**Interfaces:**
- Consumes: every prior task.
- Produces: documentation checkpoint + full-render validation.

- [ ] **Step 1: Update `charts/README.md`** — status line "Foundation + Plans 2-5 complete"; chart table row `foundation + Plans 2-5`.

- [ ] **Step 2: Append AI section to `charts/genieai-umbrella/README.md`**

```markdown
## AI/ML layer

Plan 5 shipped (14 services: 4 GPU model servers, 7 CPU wrappers, 3 off-by-default):

| Group | Services | Scheduling |
|---|---|---|
| Model servers (GPU) | vllm, vllm-translation, tei, tei-reranker | `genieai.io/gpu=true` nodes + `nvidia.com/gpu` limits; shared RWX HF-cache PVC |
| OPEA wrappers (CPU) | embedding, reranker, retriever, dataprep, chatqna, textgen, translation | ordinary nodes; talk to model servers via Service DNS :80 |
| Off by default | guardrail, chatqna-ui, chatqna-nginx | Swarm replicas-0 parity — enable via values-override |

Remote-GPU mode (`ai.remoteGpu.enabled=true`): GPU Deployments suppressed;
wrappers pointed at external endpoints (Swarm `GPU_NODE_HOST` equivalent;
bearer auth via `VLLM_API_KEY`). Fail-fast when remote URLs are missing.

GPU operator / device plugin = cluster bootstrap prerequisite (NOT a chart
dependency). Cluster contract: nodes labeled `genieai.io/gpu=true` (+
optional taint, tolerated by the chart).
```

- [ ] **Step 3: Full render summary**

Run: `helm template test charts/genieai-umbrella -n genieai | grep "^kind:" | sort | uniq -c | sort -rn | head -12`
Expected: `Deployment × 16`, `Service × 16` (5 + 11), `NetworkPolicy × 16`, `SealedSecret × 12`, plus Plan 1-4 resources.

- [ ] **Step 4: Remote-mode full render**

Run: `helm template test charts/genieai-umbrella -n genieai --set ai.remoteGpu.enabled=true --set ai.remoteGpu.vllmUrl=https://gpu/vllm --set ai.remoteGpu.teiEmbeddingUrl=https://gpu/tei --set ai.remoteGpu.teiRerankingUrl=https://gpu/teir --set ai.remoteGpu.vllmTranslationUrl=https://gpu/vllmt | grep -c "^kind: Deployment$"`
Expected: prints `12` (16 − 4 GPU).

- [ ] **Step 5: Final lint + ct lint + commit**

```bash
helm lint charts/genieai-umbrella --strict
ct lint --config charts/ci/ct.yaml --charts charts/genieai-umbrella
git add charts/README.md charts/genieai-umbrella/README.md docs/charts/plan-defects.md
git commit -m "docs(charts): mark Plans 2-5 complete; AI-tier README"
```

---

## Self-Review

**1. Spec coverage** (AI/ML slice):

| Spec section | Task |
|---|---|
| §7 Group 6 (14 services) | Tasks 3, 4, 5 |
| §7 `tei_reranker` kebab-case + Swarm name preservation | Task 1 (`teiReranker` key; env `TEI_RERANKING_ENDPOINT` unchanged) |
| §8 VLLM_API_KEY + keycloakProxyClientSecret + kcDataprepClientSecret (bearer-vs-HF-token split honored; 4-key secret) | Task 6 |
| §5.1 dependency-graph extension (AI edges) | Task 10 |
| Swarm GPU_NODE_HOST remote mode (env ternaries + remote-443 egress + consumer-gated fail-fast) | Task 8 |
| §11 manifest AI entries | Task 11 README |
| GPU operator as native row | Task 10 audit rows |

Sections deferred: RAG eval harness wiring (tests/rag-benchmarks) — outside chart scope; OPEA `DEPLOY_OPEA` profile gate — `ai.enabled` master switch replaces it (values-level, no compose profiles in Helm).

**2. Placeholder scan**: only intentional `PLACEHOLDER_*_SEALED_KID` markers. No TBD/TODO.

**3. Type consistency**: factory consumes `aiService` merged dict (Task 2 one-line extension, backward compatible); SealedSecret keys = env var names (`VLLM_API_KEY`, `HF_TOKEN`, `KEYCLOAK_PROXY_CLIENT_SECRET`, `KC_DATAPREP_CLIENT_SECRET`); Service port 80 contract holds for all 11 rendered AI Services.

**4. Review Focus coverage**: all five pinned (RF1 Task 3 Step 6, RF2 Task 3 Step 5, RF3 Task 4 Step 6, RF4 Task 8 Steps 3-4, RF5 Task 6 Steps 4-5).

**5. M11 convention (count checks)**: every `grep -c "^kind: ..."` count in Plans 3-5 assumes ONLY chart-owned templates render. Enabled subchart deps (sealed-secrets controller ships a Deployment) inflate counts — use `--show-only 'templates/...'` or a component-label filter for exact assertions, as Task 4 Step 4 does.

**5. Adversarial review note**: run `/code-review` on this plan before execution — waves 1-6 caught structural errors in every plan so far.

---

## Plan Stats

- **Tasks:** 11
- **New templates:** ~20 (11 AI services + PVC + NPs + secrets + test)
- **Files modified:** 4 (values, factory, dep-check hook, audit doc)
- **Commits planned:** 11
- **Estimated review surface:** ~1300 lines

## What's next after Plan 5

- Plan 6: per-env Kustomize overlays + GitOps sync + Envoy Gateway ingress + cert-manager + deferred items (db-migrations Job, doc-repo PVC, NetworkPolicy label-verified peers)
- Plan 7: CI (charts lint/integration/scan, cosign + Kyverno real syntax, Renovate, uninstall safety, conftest secret-leak, PII smoke K8s port)
- Plan 8: documentation (site/content/en/docs/deployment/ + docs/charts/*)
