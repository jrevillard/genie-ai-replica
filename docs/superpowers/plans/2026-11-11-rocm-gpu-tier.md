# ROCm GPU Service Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the GENIE.AI GPU service tier on AMD ROCm (local Strix Halo, gfx1151) as a parallel, config-and-image-pin-driven path that never touches the NVIDIA deployment files.

**Architecture:** New compose overlay files layered with `-f` over the untouched base stacks, a new sizing env file (`env.strixhalo`, the `env.t4`/`env.rtx6000` pattern), a new ansible GPU-node playbook, additive validator/docs changes. Image pins come from a Phase-0 spike on this machine. Both topologies (single-server, split GPU node) covered; helm/K8s gets a handoff note for its separate repository.

**Tech Stack:** Docker Compose v5.5.1, Docker Swarm (Docker 29.8.2), Ansible, AMD ROCm 7 containers (vLLM, TEI), Hugo/Docsy docs, Jest (`tests/config-validator`).

**Spec:** `docs/superpowers/specs/2026-11-11-rocm-gpu-tier-design.md` (committed, `8fba413`)

## Global Constraints

- **Frozen files — never edit:** `docker-compose.yaml`, `docker-compose.gpu.yaml`, `deploy/ansible/deploy.yml`, `deploy/ansible/deploy-gpu.yml`, `env`, `env.t4`, `env.rtx6000`. (One carve-out: the healthcheck bug MR in Task 8 touches `docker-compose.gpu.yaml` on its own branch, per design decision 6.)
- Additive only elsewhere: `deploy/ansible/templates/env.j2` ROCm branches must not change rendered output for NVIDIA inputs.
- All work on branch `feat/rocm-deployment`. **Nothing merges to `main` until the whole feature passes the E2E gate (Task 13)** — sole exception: the Task-8 bug MR, which is an independent, tested NVIDIA-path fix.
- Every commit message: imperative subject, English, ends `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Spike-derived values (image tags, sizing numbers) are consumed from `docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md` — never invented downstream.
- Operator-supplied: `HUGGING_FACE_HUB_TOKEN` (gemma-3-4b-it is license-gated) provided as a session env var for spike tasks; never committed.
- Documentation in English; site docs follow `site/content/en/docs/` front-matter + internal-link rules (`node scripts/check-links.mjs` must pass).

## Review Focus

- **Overlay drift:** a future base-file vLLM flag change won't propagate to the ROCm overlay (overlays restate only the keys they must). Task 5's `docker compose config` assertions pin the merged result; when base flags change, re-run Task 5's assertions as the drift check.
- **Guided JSON regression:** the pinned ROCm vLLM build must keep `response_format={"type":"json_object"}` working or dataprep silently falls back to raw-chunk labeling. Task 6 probes it live; it is the first thing to re-check after any image re-pin.
- **Unified-memory pressure:** LLM + translation + TEI + CPU docling share 91 GB GTT; no task simulates exhaustion. Task 3 measures the split under coexistence and Task 6 runs the full service set together — treat OOM/GTT errors there as sizing failures, not bugs.
- **Swarm silently ignoring `devices:`** — the GPU tier would crashloop with no config error. Task 4's probe decides the verdict and Task 10 realizes it; the caveat, if it lands, must appear in Task 12's docs.
- **E2E venue mismatch:** `run-local-e2e.sh` defaults to the shared k8s venue; pointing it at the local ROCm stack with the wrong `KEYCLOAK_ADMIN_PASSWORD` fails confusingly. Task 13 verifies credentials against the venue before the run.

---

### Task 1: Spike readiness — device access + GTT aperture

**Files:**
- Create: `docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md` (results doc, appended across Tasks 1–4)

**Interfaces:**
- Produces: recorded host GIDs (`render`, `video`), GTT total size, confirmation that a ROCm 7 container sees gfx1151 — consumed by Tasks 2, 3, 4, 5.

- [ ] **Step 1: Record host device groups**

Run: `getent group render video | cut -d: -f1,3`
Record both GIDs in the results doc (compose `group_add:` needs numerics; GIDs are distro-specific).

- [ ] **Step 2: Prove a ROCm container sees the iGPU**

```bash
docker run --rm --device=/dev/kfd --device=/dev/dri \
  --group-add <render-gid> --group-add <video-gid> \
  rocm/dev-ubuntu:7.0.2 rocminfo | grep -E "gfx|Name.*gfx"
```
Expected: a `gfx1151` agent entry. If the tag doesn't resolve, pick the newest `rocm/dev-ubuntu:7.x` that does (record the tag used).

- [ ] **Step 3: Measure the GTT aperture**

Inside the same container image: `cat /sys/class/drm/card1/device/mem_info_gtt_size` (or `rocm-smi --showmeminfo gtt`). Record bytes. If GTT is capped far below ~64 GB, flag the host-prereq path (`amdgpu.gttsize=` kernel arg) in the results doc — operator applies it before Task 6, per design constraint.

- [ ] **Step 4: Commit the results doc skeleton**

```bash
git add docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md
git commit -m "docs: ROCm spike — device access and GTT aperture on Strix Halo"
```

### Task 2: vLLM candidate matrix — winner selection

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md`

**Interfaces:**
- Consumes: Task 1 GIDs/GTT.
- Produces: `VLLM_ROCM_IMAGE` winner tag + measured per-model facts (load time, guided-JSON works y/n) — consumed by Tasks 5, 6, 9, 11.

- [ ] **Step 1: Run candidates against both deployment models**

For each candidate (order: `rocm/vllm` newest ROCm-7 tag → community Strix Halo images found in Task 1 recon → source build FROM `rocm/dev-ubuntu` + vLLM gfx1151 wheels):

```bash
docker run -d --name spike-vllm --device=/dev/kfd --device=/dev/dri \
  --group-add <gid>... -p 18000:8000 \
  -e HUGGING_FACE_HUB_TOKEN="$HF_TOKEN" \
  <candidate-tag> \
  --model ibm-granite/granite-4.1-8b --gpu_memory_utilization 0.55 \
  --max_model_len 65536 --dtype half --enforce-eager
```
Probe: `curl -sf localhost:18000/health`; `curl -s localhost:18000/v1/models`.

- [ ] **Step 2: Probe completion + guided JSON (dataprep requirement)**

```bash
curl -s localhost:18000/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"ibm-granite/granite-4.1-8b","messages":[{"role":"user","content":"Say OK."}],"response_format":{"type":"json_object"},"max_tokens":32}'
```
Pass = HTTP 200 with parseable JSON content. Repeat with `google/gemma-3-4b-it` after accepting its HF license with the operator's token.

- [ ] **Step 3: Bound the source-build fallback**

If no ready-made image passes Steps 1–2 for both models: attempt one source build against ROCm 7 within ~half a working day. If it fails or the window expires, record the blocker verbatim in the results doc and STOP — surface to the operator before any downstream task.

- [ ] **Step 4: Record the winner**

Results doc gains the matrix table (candidate × {models load, guided JSON, notes}) and the winner line: `VLLM_ROCM_IMAGE=<registry/tag>`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md
git commit -m "docs: ROCm spike — vLLM candidate matrix and winner pin"
```

### Task 3: TEI decision + dual-vLLM coexistence split

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md`

**Interfaces:**
- Produces: `TEI_ROCM_EMBEDDING_IMAGE` / `TEI_ROCM_RERANKING_IMAGE` (ROCm tag or CPU tag, decided) and the memory-split values for `env.strixhalo` — consumed by Tasks 5, 6.

- [ ] **Step 1: TEI ROCm tag attempt, CPU fallback**

Run the TEI ROCm image (per [TEI AMD docs](https://huggingface.co/docs/text-embeddings-inference/en/amd_gpu) tag family, e.g. `ghcr.io/huggingface/text-embeddings-inference:1.9-rocm`) with `--model-id BAAI/bge-large-en-v1.5`, same device flags; probe `curl -sf localhost:18080/health` + one `/embed` call. On gfx1151 failure, fall back to the CPU tag `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3` and record the decision (CPU is acceptable per spec).

- [ ] **Step 2: Coexistence measurement**

Start winner-vLLM + translation-vLLM (gemma-3-4b-it, `--gpu_memory_utilization` candidate from `VLLM_TRANSLATION_GPU_UTILIZATION`) simultaneously with both TEI containers running; verify all four health endpoints; record working utilization pairs and peak GTT. These numbers become `VLLM_GPU_UTILIZATION` / `VLLM_TRANSLATION_GPU_UTILIZATION` in `env.strixhalo`.

- [ ] **Step 3: Record + commit**

```bash
git add docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md
git commit -m "docs: ROCm spike — TEI decision and iGPU memory split"
```

### Task 4: Passthrough verdicts — compose + swarm

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md`

**Interfaces:**
- Produces: the compose device stanza that works (`devices:` + `group_add:` numerics) and the swarm verdict (`in-place` vs `caveat`) — consumed by Tasks 5, 9, 10, 12.

- [ ] **Step 1: Compose-form probe**

Minimal `docker-compose.yaml` (in `/tmp`, not the repo) with one `rocminfo` service using the Task-1 stanza; `docker compose up` → gfx1151 visible.

- [ ] **Step 2: Swarm-form probe**

`docker stack deploy` the same definition (single node, this machine) → check whether the container sees `/dev/kfd` + gfx1151. Verdict: swarm honors `devices:` (record `in-place`) or not (record `caveat` — swarm ROCm GPU tier routes via the standalone GPU-node stack, per design constraint).

- [ ] **Step 3: Record + commit**

```bash
git add docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md
git commit -m "docs: ROCm spike — compose and swarm passthrough verdicts"
```

### Task 5: Single-server ROCm overlay files

**Files:**
- Create: `env.strixhalo`
- Create: `docker-compose.rocm.yaml`

**Interfaces:**
- Consumes: `VLLM_ROCM_IMAGE`, TEI images, memory-split values, device stanza, swarm verdict (Tasks 2–4).
- Produces: `docker compose -f docker-compose.yaml -f docker-compose.rocm.yaml --profile opea --profile gpu-models` merged config with ROCm images + device access; env file `env.strixhalo` — consumed by Tasks 6, 10, 11, 13.

- [ ] **Step 1: Write `env.strixhalo`**

Values from Tasks 2–3 (sizing-overlay pattern of `env.rtx6000`): `VLLM_GPU_UTILIZATION`, `VLLM_MAX_MODEL_LEN`, `VLLM_MAX_NUM_SEQS`, `VLLM_DTYPE`, the translation quartet, `DOCLING_DEVICE=cpu`, `VLLM_ROCM_IMAGE=<winner>`, `TEI_ROCM_EMBEDDING_IMAGE`, `TEI_ROCM_RERANKING_IMAGE`. Header comment names the hardware and points at the spike-results doc.

- [ ] **Step 2: Write `docker-compose.rocm.yaml`**

For each of `vllm`, `vllm-translation-guardrail`, `tei`, `tei_reranker` restate ONLY: `image: ${VLLM_ROCM_IMAGE}` / TEI vars, the `environment:` list with one addition — `NVIDIA_VISIBLE_DEVICES=void` (compose merges environment BY KEY, so omitting the var is not enough; `void` neutralizes it — ROCm containers ignore it and it claims no GPU even on an NVIDIA host), `devices:` + `group_add:` from Task 4, and `healthcheck.start_period` only if Task 3 measured slower starts. Overlay header comment: base files untouched, `-f` order matters.

- [ ] **Step 3: Assert the merged config**

```bash
docker compose --env-file .env --env-file env.strixhalo \
  -f docker-compose.yaml -f docker-compose.rocm.yaml \
  --profile opea --profile gpu-models config > /tmp/rocm-merged.yaml
grep -c "NVIDIA_VISIBLE_DEVICES=all" /tmp/rocm-merged.yaml    # expected: 0 in the 4 gpu services
grep -c "NVIDIA_VISIBLE_DEVICES=void" /tmp/rocm-merged.yaml   # expected: 4 (neutralized by the overlay)
grep -A2 "^  vllm:" /tmp/rocm-merged.yaml | grep "image:"     # expected: winner tag var resolved
grep -c "/dev/kfd" /tmp/rocm-merged.yaml                      # expected: 4 (vllm, translation, tei, tei_reranker)
grep -c "DOCLING_DEVICE" /tmp/rocm-merged.yaml                # expected: 1, value cpu
```
Also run the same with ONLY the base files and confirm `git status` shows no diff to them (they are untouched by definition — this is a sanity echo, not a check).

- [ ] **Step 4: Commit**

```bash
git add env.strixhalo docker-compose.rocm.yaml
git commit -m "feat: ROCm single-server overlay — image pins and iGPU device access"
```

### Task 6: Live single-server ROCm smoke

**Files:** none created (verification task; findings appended to spike-results doc if sizing corrections are needed).

- [ ] **Step 1: Bring the stack up**

```bash
docker compose --env-file .env --env-file env.strixhalo \
  -f docker-compose.yaml -f docker-compose.rocm.yaml \
  --profile opea --profile gpu-models up -d
```
Wait for health: `docker compose --profile gpu-models ps` — all four gpu-models services `healthy`.

- [ ] **Step 2: Functional probes**

vLLM completion + guided JSON (Task 2 Step 2 command, port via `docker exec`); TEI `/embed` + `/rerank` through the overlay network; dataprep labeling path exercised by one small text ingest (POST one file via document-repository and watch `ingestion_log` for labels, not raw-chunk fallback). GTT errors here = sizing failure → adjust `env.strixhalo`, re-run Step 1.

- [ ] **Step 3: Tear down, commit any sizing corrections**

```bash
docker compose --profile opea --profile gpu-models -f docker-compose.yaml -f docker-compose.rocm.yaml down
git add env.strixhalo && git commit -m "fix: ROCm sizing corrections from live single-server smoke" # only if changed
```

### Task 7: Config-validator support for `env.strixhalo` (TDD)

**Files:**
- Test: `tests/config-validator/__tests__/config-validation.test.js`
- Modify: `tests/config-validator/validators/validate-hardware.js:46-50` (profile-name branch), `GPU_RANGES` (add `DOCLING_DEVICE: { type: 'enum', values: ['cpu','cuda'], optional: true }`), and the suite's profile list (mirror the `T4_FILE`/`RTX6000_FILE` constants at lines 42–43)

**Interfaces:**
- Produces: `config:validate` CI coverage of `env.strixhalo` — consumed by Task 13's gate run.

- [ ] **Step 1: Write the failing tests**

Mirror the existing T4/RTX6000 test blocks: `STRIXHALO_FILE = path.join(ROOT, 'env.strixhalo')`; assert profileName resolves to `STRIX HALO (iGPU unified memory)`, all values parse, `DOCLING_DEVICE` validates without an unknown-parameter warning, and an out-of-range `VLLM_MAX_MODEL_LEN` (e.g. `262144`) produces an error.

- [ ] **Step 2: Run to verify failure**

Run: `cd tests/config-validator && npm test`
Expected: FAIL — profile name resolves to `'Unknown'` / DOCLING_DEVICE warns.

- [ ] **Step 3: Implement**

Add the `'env.strixhalo'` branch in the `profileName` ternary and the `DOCLING_DEVICE` range; nothing else moves.

- [ ] **Step 4: Run to verify pass**

Run: `cd tests/config-validator && npm test`
Expected: PASS (whole suite, not just new tests).

- [ ] **Step 5: Commit**

```bash
git add tests/config-validator
git commit -m "feat: config-validator recognizes env.strixhalo ROCm profile"
```

### Task 8: Independent bug MR — gpu-node translation healthcheck port

**Files:**
- Modify (on its own branch): `docker-compose.gpu.yaml:92` — probe `http://localhost:8000/health`

**Interfaces:**
- Produces: converged static split stack; Task 9 may then DROP the healthcheck restatement if this merges first.

- [ ] **Step 1: Branch off main**

```bash
git worktree add ../genie-ai-fix-gpu-healthcheck -b fix/gpu-translation-healthcheck-port main
```

- [ ] **Step 2: Fix + verify convergence**

Probe port 8000 in the healthcheck; verify the static split stack reaches healthy with an NVIDIA GPU available (`.102` or any NVIDIA node) — `docker compose -f docker-compose.gpu.yaml ps`: `vllm-translation` healthy, `nginx-gpu` converges. If no NVIDIA venue is reachable this session, verify with `docker compose config` + the ansible-rendered template's known-good 8000 form, and say so in the MR body.

- [ ] **Step 3: Commit, push, MR**

MR to `main`, body states the convergence failure and venue evidence. This MR merges independently of the feature gate (design decision 6).

### Task 9: Split-topology ROCm GPU-node overlay

**Files:**
- Create: `docker-compose.rocm.gpu.yaml`

**Interfaces:**
- Consumes: same spike pins (Tasks 2–4); Task 8's merged fix.
- Produces: `docker compose --env-file env.strixhalo -f docker-compose.gpu.yaml -f docker-compose.rocm.gpu.yaml` ROCm GPU-node stack — consumed by Task 10 (if swarm caveat) and Task 12 docs.

- [ ] **Step 1: Write the overlay**

Same shape as Task 5 for `vllm-llm`, `vllm-translation`, `tei-embedding`, `tei-reranker`; `docling-serve` stays CPU (add `devices:` removal is unnecessary — base has none; only ensure no NVIDIA var remains). Restate `vllm-translation`'s healthcheck probing **8000** with a comment: pending Task 8's merge, after which this restatement is dropped. `nginx-gpu` untouched (it only depends on healthy services).

- [ ] **Step 2: Assert merged config + bring up + smoke**

`config` assertions mirroring Task 5 Step 3 (0 × NVIDIA var, 4 × `/dev/kfd`, winner images). Up: `docker compose --env-file env.strixhalo -f docker-compose.gpu.yaml -f docker-compose.rocm.gpu.yaml up -d`; smoke: through `nginx-gpu` with an api key from `configs/nginx-gpu/api_keys.map`, GET `/llm/health`, `/translation/health`, `/embed/health`, `/rerank/health` → 200; one `/embed` POST returns a vector. Tear down.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.rocm.gpu.yaml
git commit -m "feat: ROCm GPU-node overlay for the split topology"
```

### Task 10: Swarm verdict realized

**Files:** none created (verification task; caveat prose lands in Task 12's docs).

- [ ] **Step 1: Stack-deploy the merged ROCm single-server stack**

```bash
docker compose --env-file env.strixhalo -f docker-compose.yaml -f docker-compose.rocm.yaml \
  --profile opea --profile gpu-models config > /tmp/rocm-stack.yaml
docker stack deploy -c /tmp/rocm-stack.yaml rocm-spike
```
Watch `docker service ps rocm-spike_vllm`: either the GPU tier reaches healthy (verdict `in-place` confirmed) or it crashloops on missing `/dev/kfd` (verdict `caveat` confirmed). Tear down with `docker stack rm rocm-spike`.

- [ ] **Step 2: Record the outcome**

Append one paragraph to the spike-results doc; if `caveat`, state the routing (swarm ROCm GPU tier via the Task-9 GPU-node stack on the ROCm node).

### Task 11: Ansible — ROCm GPU node + single-server branches

**Files:**
- Create: `deploy/ansible/deploy-gpu-rocm.yml`
- Create: `deploy/ansible/group_vars/rocm_gpu_api/vars.yml` (new group, mirroring `itu_rtx_gpu_api` shape)
- Modify: `deploy/ansible/templates/env.j2` (additive ROCm branches only)
- Modify: `deploy/ansible/templates/docker-compose.gpu.yaml.j2` — NO: it stays NVIDIA. The ROCm GPU-node playbook reuses the same `.j2` with new `*_rocm_image` pins rendered from the new vars.
- Modify: `.gitlab-ci.yml` lint job (~line 3483) — additive syntax-check entry for `deploy-gpu-rocm.yml`
- Create: `deploy/ansible/inventory/rocm_gpu.ini.example`

**Interfaces:**
- Consumes: image pins + host prereqs from spike-results; Task 5/9 overlays' semantics.
- Produces: `ansible-playbook -i inventory/rocm_gpu.ini deploy-gpu-rocm.yml` that stands up the split ROCm GPU node; rendered single-server env ROCm branch for an all-in-one swarm host.

- [ ] **Step 1: Write the playbook**

Structure mirrors `deploy-gpu.yml` (tags `install/prepare/deploy`), NO NVIDIA toolkit plays. `install`: assert amdgpu loaded + `/dev/kfd` exists; ensure docker service can access devices (user in `render`/`video`, or daemon `group-add`). `prepare`: render `gpu-proxy.conf.j2`, `api_keys.map.j2`, and the ROCm image-pinned compose (same `.j2`, new `rocm` image vars defaulting per spike). `deploy`: `docker compose --env-file {{ gpu_env_file }} -f docker-compose.gpu.yaml -f docker-compose.rocm.gpu.yaml up -d`. Smoke tasks mirror lines 279–350 (`/llm/ /translation/ /embed/ /rerank/` health + 401 test).

- [ ] **Step 2: Write group_vars + inventory example**

`rocm_gpu_api` group: `gpu_public_domain`, `gpu_https_port`, image pins (`vllm_rocm_llm_image` etc. from spike results), `gpu_env_file: env.strixhalo` shipped via existing templating. Inventory example: `[rocm_gpu_nodes]` host entry.

- [ ] **Step 3: Additive env.j2 branches**

ROCm single-server branch: when a new `rocm_single_server: true` var is set, render the ROCm image pins + `DOCLING_DEVICE=cpu` into Section 10; every branch guarded so NVIDIA renders byte-identical. Verify byte-identity: render env.j2 with the `itu_rtx_test` vars before and after the change; `diff` must be empty.

- [ ] **Step 4: Syntax-check + real run**

```bash
ansible-playbook --syntax-check deploy/ansible/deploy-gpu-rocm.yml
ansible-playbook -i inventory/rocm_gpu.ini deploy/ansible/deploy-gpu-rocm.yml --limit <this-host> -c local  # or via SSH localhost entry
```
Expected: smoke tasks green against the real Strix Halo.

- [ ] **Step 5: Commit**

```bash
git add deploy/ansible .gitlab-ci.yml
git commit -m "feat: ansible ROCm GPU-node playbook and additive single-server branches"
```

### Task 12: Documentation

**Files:**
- Modify: `site/content/en/docs/deploy/gpu.md` (ROCm section: hardware prereqs incl. GTT, image pins, overlay invocations, verification)
- Modify: `site/content/en/docs/deploy/topologies.md` (ROCm rows/columns in topology + profile matrices)
- Modify: `site/content/en/docs/deploy/docker-compose-setup.md`, `install-guide.md`, `docker-swarm-setup.md` (ROCm overlay invocations; swarm verdict/caveat from Task 10)
- Modify: `site/content/en/docs/reference/env-vars.md` (GPU-profile overlays table gains `env.strixhalo`)
- Modify: `site/content/en/docs/rag-pipeline/choosing-models.md` (iGPU sizing notes)
- Create: `docs/helm-k8s-rocm-handoff.md` (dev-internal note for the external charts repo: ROCm values surface — image pins, `/dev/kfd` device plugin + node labels, env file, k3d validation steps)
- Modify: `.claude/rules/ENVIRONMENT.md` (mention `env.strixhalo` alongside `env.t4`/`env.rtx6000`)

- [ ] **Step 1: Write the site docs**

ROCm content per file above; invocation lines verbatim from Tasks 5/9/11; sizing values from the spike-results doc. Follow front-matter + `](/docs/<section>/<name>/)` link rules.

- [ ] **Step 2: Verify docs gates**

```bash
cd site && node scripts/check-links.mjs && hugo --gc --minify --destination /tmp/genie-build
npm run format:site-scripts:check
```
Expected: no broken links; hugo builds clean.

- [ ] **Step 3: Write internal note + rule edit, commit**

```bash
git add site docs .claude/rules/ENVIRONMENT.md
git commit -m "docs: ROCm deployment path — site docs, helm/k8s handoff note, rules update"
```

### Task 13: Acceptance — manual gates + full E2E

**Files:** none created.

- [ ] **Step 1: No-root runtime gate on the ROCm venue**

Bring the Task-6 stack up; run `./tests/compose-non-root/check-runtime.sh <compose-project>` — expected exit 0 (exit 2 = wrong project name; fix the name, never accept a vacuous pass). Tear down.

- [ ] **Step 2: Full E2E against the ROCm single-server venue**

Stack up again; determine the venue edge from `docker compose ps nginx` (host port from `.env`); verify Keycloak admin credentials against that venue; then:

```bash
BASE_URL=<venue-edge> KEYCLOAK_ADMIN_PASSWORD=<master-pwd> tests/e2e/run/run-local-e2e.sh
```
Expected: the run prints green (0 failing spec files). A red run: triage per the printed failures; gfx1151-model-maturity failures surface here and are escalated to the operator, not worked around silently.

- [ ] **Step 3: Wrap-up**

Summarize gate evidence in the plan file (checkboxes ticked), then hand off to the branch-finishing flow: whole-branch review, then the single merge-to-main decision — which stays with the operator until the full suite is green (global constraint).

### Task 14: vLLM reranker backend — config-gated GPU offload (added 2026-11-18, operator-approved)

Operator decision: TEI stays default and untouched; add a second reranker
backend served by a third vLLM instance on the gfx1151 GPU, selected purely
by env config. SPIKE-01's finding drives this: the TEI ROCm image fails on
gfx1151 (Instinct-only kernels), so the reranker is the one service stuck on
CPU with a 16.3 GiB RSS spike at GPU-sized batch knobs.

- [ ] **Step 1: Spike — vLLM pooling/rerank on gfx1151**

`vllm serve BAAI/bge-reranker-v2-m3` on the pinned `rocm/vllm` image,
`--gpu-memory-utilization 0.05 --max-model-len 8192`, port 8010. Criteria:
`/health` 200; `POST /v1/rerank` returns `{"results": [{"index","score"}...]}`
sorted descending; GTT delta ≈ 2 GiB. Record in the spike-results doc. If
pooling fails on this image, STOP — report to operator, keep CPU TEI.

- [ ] **Step 2: TDD — backend switch in the reranker component**

`RERANKER_BACKEND=tei` (default) | `vllm` + `RERANKER_VLLM_ENDPOINT` +
`RERANKER_VLLM_MODEL`. vLLM path posts `{model, query, documents}` to
`/v1/rerank` and normalizes `results[]` to the TEI-shaped
`[{"index","score"}]` list — all five strategies downstream unchanged.
TEI-specific behavior (truncate=False strict 422, RerankerInputTooLongError)
stays on the TEI path only; vLLM truncates silently at model max (span attr
`reranker.backend` records which ran). Red/green in
`genie-ai-overlay/tests/test_reranker.py` (mocked comps conftest).

- [ ] **Step 3: Compose + env + validator + docs**

`vllm-reranker` service in `docker-compose.rocm.yaml` and
`docker-compose.rocm.gpu.yaml` (same devices/group_add/NVIDIA-void pattern);
`env.strixhalo` sizing pins (RERANKER_BACKEND=vllm, endpoint, utilization,
max_model_len 8192); config-validator GPU_RANGES entries (TDD — red test
first); docs: env-vars overlay tables, choosing-models Profile E, spike
results. NVIDIA-path behavior byte-identical (backend default tei, no
base-file edits).

---

## Self-Review

- **Spec coverage:** spike-first pinning (Tasks 1–4), overlays + env file (5), live smoke (6), validator (7), bug MR carve-out (8), split topology (9), swarm (10), ansible both topologies (11), docs incl. helm/k8s handoff + ENVIRONMENT.md rule (12), no-root gate + full E2E + merge gate (13), vLLM reranker backend (14 — Task-8-shaped carve-out, additive only). Docs inventory from the spec maps to Task 12 file list. All seven design decisions trace to tasks.
- **Step scan:** spike tasks are command+criteria steps (exploratory by nature, each with a record/commit deliverable); config tasks pin exact files, keys, and assertion commands; TDD task has full red/green cycle; no TBD lines.
- **Type consistency:** image var names (`VLLM_ROCM_IMAGE`, `TEI_ROCM_EMBEDDING_IMAGE`, `TEI_ROCM_RERANKING_IMAGE`), profile name string `STRIX HALO (iGPU unified memory)`, group name `rocm_gpu_nodes`, file names consistent across tasks.
- **Review Focus:** drift → Task 5 assertions; guided JSON → Task 6 Step 2 + re-pin protocol; memory pressure → Task 3 Step 2 + Task 6; swarm silent-ignore → Tasks 4/10; venue creds → Task 13 Step 2.
- **Proportion:** plan ≈ spec length; commands and assertions carry the decisions, no transcripted service definitions.
