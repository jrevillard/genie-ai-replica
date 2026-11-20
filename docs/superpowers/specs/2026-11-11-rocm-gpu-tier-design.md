# ROCm GPU Service Tier — Design

Date: 2026-11-11
Branch: `feat/rocm-deployment`
Status: draft, awaiting approval

## Intent and why

GENIE.AI's GPU service tier (the `gpu-models` profile: vLLM LLM, vLLM
translation, TEI embedding, TEI reranker) currently runs only on NVIDIA
hardware. This initiative adds an **AMD ROCm deployment path**, parallel to
the NVIDIA one, targeting the local AMD Strix Halo machine (Ryzen AI MAX+ 395,
Radeon 8060S iGPU, gfx1151, 91 GB unified memory). Later, the same seam
carries an Apple Metal path; that is out of scope here.

The path must be achieved **by configuration and by pinning specific
container images** — no changes to NVIDIA-path files, no vendor logic in
shared service code — and must work under the same deployment mechanisms the
project already uses: docker compose (both topologies), Docker Swarm, and
Ansible. Helm/Kubernetes live in a separate repository; this initiative
delivers written handoff notes for it, not charts.

## Hardware target (verified on the local machine, 2026-11-11)

- AMD Ryzen AI MAX+ 395 "Strix Halo", Radeon 8060S iGPU, `gfx1151`
- 32 CPU cores, 91 GB unified LPDDR5X (iGPU shares system memory via GTT)
- In-tree `amdgpu` kernel driver; `/dev/kfd` and `/dev/dri/renderD128` present
- User in `render` + `video` groups; Docker 29.8.2, Compose v5.5.1
- `k3d-dev-cluster` kubectl context exists locally (for the future k8s work)
- Host ROCm userland: **not installed and not required** — containers carry it

## Goals

1. ROCm GPU tier deployable on the local machine under every existing
   mechanism, both topologies:
   - **Single-server**: main `docker-compose.yaml` stack with the GPU tier
     on the local iGPU.
   - **Split**: app stack on one host, GPU services on the ROCm node via the
     standalone GPU-node stack (the `docker-compose.gpu.yaml` pattern) and
     the existing `GPU_NODE_HOST` + `/llm/ /translation/ /embed/ /rerank/
     /docling/` endpoint seam.
2. **Zero risk to the NVIDIA path**: no edits to `docker-compose.yaml`,
   `docker-compose.gpu.yaml`, `deploy.yml`, `deploy-gpu.yml`, `env.t4`,
   `env.rtx6000`, or any CI job. All ROCm wiring lives in NEW files
   (compose overlays, a new env file, a new ansible playbook/vars, docs).
3. Deployment is config + image-pin driven: the only levers are which
   container images the ROCm overlay pins and which env file selects sizing.
4. The full local E2E suite (`tests/e2e/run/run-local-e2e.sh`, whole
   `tests/e2e/` tree) passes against the ROCm-deployed **single-server
   compose venue**. That one green run is the acceptance gate (operator
   decision, 2026-11-11); the split, swarm and ansible venues are proven
   by health/smoke tests, mirroring how the NVIDIA path validates them.
5. Documentation is updated: user-facing docs in `site/content/en/docs/`
   get the ROCm path; a dev-internal notes doc hands the helm/Kubernetes
   repository what it needs for the parallel ROCm values path.

## Non-goals

- No Apple Metal implementation (the vendor seam is designed so Metal slots
  in later as a third overlay + env file + notes).
- No helm charts or k8s manifests in this repo (they live in a separate
  repository; this initiative writes handoff notes only).
- No CI build jobs for ROCm images in this initiative. GPU-tier images stay
  upstream/pinned registry pulls, as they already are for NVIDIA (CI has
  never built vLLM/TEI). If the spike forces a source build, pinning the
  prebuilt result in the overlay is preferred over adding a CI job; adding
  a build job is a separate decision.
- No change to dataprep's CUDA probing code (`DOCLING_DEVICE` default
  `cuda` with CPU fallback in `genieai_dataprep_utils.py:40-91`). The ROCm
  overlay/config sets `DOCLING_DEVICE=cpu` instead; docling runs CPU-side
  (32 cores are ample) or via `DOCLING_ENDPOINT` on the GPU-node stack.

## Anti-goals (what would make this a failure even if it works)

- Any behavioral change to the NVIDIA path — including "just a default".
- Vendor-conditional branches in shared service code or shared compose
  service definitions.
- Duplicated service definitions that drift from the base files over time.
  The overlays must restate only the keys that change (image, GPU device
  access, vendor env), not copy whole service blocks wholesale.

## Constraints

- **gfx1151 is not on upstream vLLM's supported-GPU list** (verified
  2026-11-11; see r/ROCm threads and the kyuz0/amd-strix-halo-vllm-toolboxes
  project). The vLLM ROCm image is therefore gated by a Phase-0 spike on
  this machine before anything is pinned.
- dataprep requires OpenAI-compatible `response_format={"type":"json_object"}`
  (guided JSON) from the LLM for chunk labeling. The spike must verify the
  candidate ROCm vLLM build supports it, or labeling falls back per chunk.
- The translation service is a second vLLM instance on the same GPU
  (gemma-3-4b-it today). On an iGPU with unified memory,
  `gpu_memory_utilization` semantics differ from discrete VRAM (GTT share vs
  fixed VRAM). The spike measures a workable split for LLM + translation.
- Docker Swarm device passthrough for `/dev/kfd` + `/dev/dri` has different
  mechanics than the NVIDIA env-var approach (`NVIDIA_VISIBLE_DEVICES`).
  The spike validates the compose `devices:` / `group_add:` form under both
  `docker compose` and `docker stack deploy`. **Accepted outcome if swarm
  ignores `devices:`** (settled call, 2026-11-11): a documented caveat —
  the swarm ROCm GPU tier then runs via the standalone GPU-node compose
  stack on the ROCm node, keeping the overlay-only story intact.
- TEI ships official ROCm images (targets Instinct dGPUs). On gfx1151 they
  may or may not work; the CPU TEI image is an acceptable fallback
  (bge-large embed + bge-reranker are small models, 32 CPU cores). Spike
  decides; the overlay pins whichever wins.
- Host-side prerequisites (settled call, 2026-11-11): if the spike shows
  the shipped host config blocks vLLM's memory claims — Strix Halo's GTT
  aperture is commonly capped below the 91 GB (`amdgpu.gttsize=` kernel
  arg / BIOS UMA buffer), or the ROCm 7 userspace needs a matching DKMS —
  these are **documented host prerequisites the operator applies**, with
  the measured values recorded in `env.strixhalo` and the docs. Nothing
  on the host is mutated silently by tooling.
- Spike preconditions (verified 2026-11-11): no `.env` exists yet on this
  machine, so `HUGGING_FACE_HUB_TOKEN` must be provided before the spike
  runs; disk is ample (~862 GB free; candidate ROCm vLLM images are
  10–20 GB each, models ~26 GB).

## SUPERSEDED: the vendor axis collapsed into the base files (2026-11-19)

The MR review rejected the two-overlay shape: an overlay is an UNRENDERED
file (the config-validator suite parses the base files only), so a merge
tag, an environment merge or a service name in it reached the branch
unchecked, and the compose-CLI version floor (`!override`, 2.24.4)
contradicted the documented 2.20+. The vendor axis now lives in the BASE
compose files as interpolated values — image pins
(`VLLM_IMAGE` / `TEI_EMBEDDING_IMAGE` / `TEI_RERANKING_IMAGE`), device
paths (`GPU_DEVICE_KFD` / `GPU_DEVICE_DRI`, defaults `/dev/null` +
`/dev/zero`, paths that exist on every host), group GIDs
(`nobody`/`nogroup` defaults), an explicit `entrypoint: ["vllm","serve"]`
— and the pooling services sit behind the `rocm-models` compose profile
(absent from the resolved config unless activated). The decisions below
record the ORIGINAL design; every "overlay" reference in them now means
the collapsed shape: the values render from `env.strixhalo` +
`--profile rocm-models`, and the NVIDIA-inertness contract is pinned by
`tests/config-validator/__tests__/rocm-compose-render.test.js`, which
renders BOTH shapes of the same files. The ansible path collapsed with
it: one playbook (`deploy-gpu.yml`, host group `rocm_gpu_nodes`), vars
via `vars/rocm_gpu_nodes.yml` + `vars_files` (not group_vars/, which
resolves by inventory group name and had silently mismatched).

## Decisions (operator, 2026-11-11)

1. **vLLM image sourcing: spike first, then pin.** Phase 0 validates
   candidate images (`rocm/vllm` ROCm 7 builds, community Strix Halo
   images, source build as fallback) on this machine; the winner's exact
   tag is pinned in the ROCm overlay before deployment work proceeds.
2. **Compose integration: overlay files only.** New files
   `docker-compose.rocm.yaml` (main-stack overlay) and
   `docker-compose.rocm.gpu.yaml` (GPU-node stack overlay) layered with
   `-f` on top of the untouched base files, plus a new `env.strixhalo`
   sizing overlay (the `env.t4`/`env.rtx6000` pattern). The base files are
   never edited. Compose per-key merge replaces exactly the keys that
   differ (image, device access, vendor env).
3. **Helm/Kubernetes: deferred with notes.** The helm charts/k8s scripts
   live in a separate repository. This initiative delivers a dev-internal
   handoff note describing the ROCm values surface (image pins, device
   plugin / `/dev/kfd` passthrough, node labels, env file) so that
   repository can add `values-rocm.yaml` in its own cycle.
4. **Acceptance: full local E2E suite green** against the ROCm-deployed
   single-server compose venue (`run-local-e2e.sh` over the whole
   `tests/e2e/` tree); smoke tests for the other venues.
5. **Spike execution: run it here, source-build fallback allowed.** The
   spike runs on this machine once an operator-provided
   `HUGGING_FACE_HUB_TOKEN` is in `.env` (gemma-3-4b-it is license-gated
   on HF; granite-4.1-8b is open). If no ready-made image serves both
   models with guided JSON, a source build against ROCm 7 is attempted
   within a bounded window (~half a working day) before reporting back.
6. **The `docker-compose.gpu.yaml` healthcheck bug is fixed in a separate
   NVIDIA-path MR.** (`vllm-translation` serves `--port 8000` at line 80
   but its healthcheck probes `localhost:5001/health` at line 92; nginx-gpu
   waits on it `service_healthy`, so the static split stack can never
   converge. The ansible-rendered template probes 8000 and is fine.) The
   ROCm overlay stays purely vendor-keyed and does not restate NVIDIA
   service keys to repair NVIDIA bugs.
7. **Ansible covers BOTH topologies for ROCm.** Besides
   `deploy-gpu-rocm.yml` (split), single-server ROCm under ansible+Swarm
   gets additive plumbing: ROCm branches in `templates/env.j2` and new
   ROCm image-pin vars in a new `group_vars` file. Additive only — the
   NVIDIA rendering path is byte-for-byte unchanged for NVIDIA inputs.

## Why the overlay file set is the cleanest shape (2026-11-19; SUPERSEDED 2026-11-19, same day)

> **Superseded.** The MR review rejected the overlay shape — an
> unrendered file, and a 2.24.4 compose floor against a documented 2.20+
> — and the vendor axis collapsed into the base files as values + the
> `rocm-models` profile (see the SUPERSEDED block at the top of this
> spec). The section below is kept as the decision record: it is the
> measured reasoning that led to the overlay shape and, via the review's
> objections, to the collapse. Do not re-litigate either direction
> without new facts; the collapsed shape's contract is pinned by
> `rocm-compose-render.test.js`.

The MR adds two compose files to a repo that had two. A reviewer asked
for a single compose file. The measured answer — why the overlay set is
the cleanest shape rather than a workaround — is recorded here so the
next agent does not re-litigate it without new facts.

### What a parameter cannot express

> **Corrected 2026-11-20 (MR !968 review).** The table below is the
> original 2026-11-11 measurement and the *list-interpolation* half of it
> still holds — `devices: ${DEVICES:-}` (the LIST as a whole) is rejected
> with `services.probe.devices must be a array`. But the section's
> conclusion overclaimed: interpolating the two scalar PATHS *inside* the
> list parses fine (`devices: ["${KFD_DEV:-/dev/null}:${KFD_DEV:-/dev/null}"]`
> renders as a device entry), so the vendor axis **can** be expressed as
> values in the base file. A device path that does not exist on the host is
> a hard error, not a tolerated one — the daemon stat's every path before
> it creates the container (`docker run --rm --device
> /dev/does-not-exist:/dev/does-not-exist alpine:3 true` → "error
> gathering device information while adding custom device"), so a base-file
> row needs a path that exists everywhere (`/dev/null` qualifies). The
> vendor axis is nonetheless kept OUT of the base file for SAFETY reasons
> (a device row and a parameterized image row would change the NVIDIA
> render on a service that never asks for a GPU device, and the vendor-only
> services would have to live in that file under a vendor-specific
> profile). The current, measured wording is in the
> `docker-compose.rocm.yaml` header and `site/content/en/docs/deploy/gpu.md`
> § "What a parameter cannot express".

Compose has no conditional structure. Every vendor difference on this
path is structural:

| Difference | Measured reason a parameter cannot carry it |
|---|---|
| `vllm-embedding` / `vllm-reranker` exist only on ROCm | a service either exists or it does not; there is no per-vendor service definition |
| `devices: /dev/kfd + /dev/dri` | compose REJECTS an interpolated device list: `services.probe.devices must be a array` (probed with `devices: ${DEVICES:-}`). The paths also do not exist on an NVIDIA host |
| `group_add: [render, video]` | same list-typed problem; the GIDs are host-specific (`getent group render`) |
| the ROCm image's serving entrypoint | the NVIDIA image's entrypoint is `vllm serve`; the ROCm image has `ENTRYPOINT=null, CMD=["/bin/bash"]` (probed with `docker image inspect`), so the base file's flags-only `command:` has nothing to attach to |

What a parameter CAN carry — and does: every image pin, port, model id,
sizing knob and GID flows through the env files. Hence the profile is
one env file (`env.strixhalo`, the fourth member of the existing
`env` / `env.t4` / `env.rtx6000` family) plus one overlay per topology.

### What the overlay actually carries (measured)

The overlay states the VENDOR difference and nothing else. `entrypoint`
and `command` are SEPARATE compose keys, so for the four vLLM instances
the overlay restates only `entrypoint: ["vllm", "serve"]` and the base
file's flag block merges in unchanged. Proof: the merged render's
effective argv (entrypoint + command) is **identical before and after**
that change for all 49 services in both topologies.

Consequences of the entrypoint/command split:

- the base file is the single source of truth for the vLLM flags — a flag
  change reaches ROCm with no second edit (the previous full-command
  restatement was a drift hazard the file's own comment named);
- the overlay shrank by ~50 lines of duplicated flags;
- `environment:` merges BY KEY, so restating a key with an identical
  value is duplication, not override — the TEI blocks now restate only
  `NVIDIA_VISIBLE_DEVICES=void`, the one key that genuinely differs.

### Why not fold ROCm into the base file

The base file is what every deployment loads. Folding ROCm-only services
and `/dev/kfd` mounts into it puts a broken-on-NVIDIA service definition
into every NVIDIA deployment's config, and makes the NVIDIA render — the
artifact the NVIDIA-safety gates compare — differ on every ROCm change.
The overlay model is what lets the contract *"an NVIDIA deployment
cannot observe a behavior change without setting a new env var"* be
PROVED: the NVIDIA render is byte-identical whether or not the overlay
exists. The branches' NVIDIA-file edits are additive passthroughs with
inert defaults (`${VAR:-tei}`, `${VAR:-}`, `${VAR:-600}`).

### Why two overlay files and not one

The two overlays stack on two DIFFERENT base files: the main stack
(`docker-compose.yaml`) and the standalone GPU-node stack
(`docker-compose.gpu.yaml`). The GPU-node stack has its own services
(`vllm-llm`, `tei-embedding`, `nginx-gpu`, …), its own `gpu_network` and
its own port plan. A single overlay cannot serve both without
restating the other topology's services — measured service-key overlap
between the two ROCm overlays is exactly ONE key (`vllm-reranker`).

### The consolidation question that remains open

Folding the ROCm content into the base file behind compose `profiles:`
is feasible (probed: profiles UNION across an overlay — an overlay
`profiles: [rocm]` on a base service already carrying `[gpu-models]`
yields BOTH, and an overlay-only service starts only when its profile is
enabled). It is tracked in issue #2014 with the trade-offs; it belongs on
`main`, under its own review cycle, because it rewrites the file every
NVIDIA deployment loads.

## New artifacts (all additive, nothing existing edited)

| Artifact | Purpose |
|---|---|
| `docker-compose.rocm.yaml` | Overlay on the main stack: repins the 4 `gpu-models` services to ROCm images, replaces `NVIDIA_VISIBLE_DEVICES` env with ROCm device access (`devices: /dev/kfd /dev/dri` + `group_add`), leaves everything else merged from base |
| `docker-compose.rocm.gpu.yaml` | Overlay on the standalone GPU-node stack (same shape, for the split topology) |
| `env.strixhalo` | Sizing overlay for Strix Halo (the `env.t4`/`env.rtx6000` pattern): model window, memory-utilization split, TEI caps, `DOCLING_DEVICE=cpu`; values measured by the spike |
| `deploy/ansible/deploy-gpu-rocm.yml` | GPU-node playbook for ROCm: driver/driver-version check, `render`/`video` group + `/dev/kfd` access for the docker service, renders the ROCm GPU stack, runs its smoke tests. NO NVIDIA toolkit install (that stays NVIDIA-play-only) |
| `deploy/ansible/templates/env.j2` additions | ROCm branches for single-server ansible+Swarm (decision 7): additive keys only, NVIDIA rendering unchanged |
| `deploy/ansible/` vars additions | ROCm GPU node group + image pins (new group_vars file; `all.yml` untouched or extended additively with new keys only) |
| `env.strixhalo` docs updates | see Documentation below |
| `docs/` dev-internal note | helm/K8s repository handoff note (ROCm values surface, device plugin guidance, k3d validation steps) |

## Branch and merge strategy (operator, 2026-11-11)

**Nothing merges to `main` until the whole ROCm feature is working and
tested.** All feature work accumulates on `feat/rocm-deployment`
(intermediate commits or stacked MRs targeting that branch); the single
merge to `main` happens only after the acceptance gate (full E2E suite
green on the ROCm single-server compose venue). The one carve-out is the
pre-existing `docker-compose.gpu.yaml` healthcheck bug (decision 6): it is
an independent NVIDIA-path fix and may go as its own small, tested MR on
its own schedule — it changes nothing about the ROCm feature's merge gate.

## Documentation to modify (operator flagged: docs are in scope)

User-facing (`site/content/en/docs/` — canonical, published):
- `deploy/gpu.md` — primary GPU-tier doc: add a ROCm section (hardware,
  image pins, overlay usage, verification)
- `deploy/topologies.md` — topology matrix gains the ROCm column/rows
  (single-server + split on ROCm)
- `deploy/install-guide.md`, `deploy/docker-compose-setup.md`,
  `deploy/docker-swarm-setup.md` — ROCm examples and overlay invocations
- `deploy/a40-install.md` stays NVIDIA-only; a sibling ROCm install
  walkthrough lands in `gpu.md` or a new `rocm-install.md`
- `reference/env-vars.md` — the "GPU profile overlays" table gains
  `env.strixhalo`
- `rag-pipeline/choosing-models.md` — model sizing notes for the iGPU tier
- Docs-link check must pass: `node scripts/check-links.mjs` (CI gate
  `config:docs-links`); Hugo build verified locally before merge (no MR
  build-check exists for the site)

Dev-internal (`docs/`):
- helm/K8s handoff note (see New artifacts)
- `.claude/rules/ENVIRONMENT.md` — port/section tables mention the ROCm
  env file alongside `env.t4`/`env.rtx6000`

## Deployment topologies covered (operator instruction: consider all)

1. **Compose, single-server, ROCm iGPU** — `docker compose --env-file .env
   --env-file env.strixhalo -f docker-compose.yaml -f docker-compose.rocm.yaml
   --profile opea --profile gpu-models up -d`
2. **Compose, split, ROCm GPU node** — ROCm node runs the standalone GPU
   stack with the ROCm overlay; app stack wires via `GPU_NODE_HOST` +
   endpoint URLs (the existing Section-14 pattern, unchanged)
3. **Docker Swarm** — node labeling unchanged (`gpu=true` is vendor-neutral);
   the GPU-tier services get their device access from the overlay merge; no
   NVIDIA toolkit on the ROCm node
4. **Ansible** — `deploy-gpu-rocm.yml` for the ROCm GPU node; the Swarm
   app playbook needs no ROCm changes (app side is already vendor-neutral)
5. **Helm/Kubernetes** — deferred; handoff note only (separate repo)

## Spike (Phase 0) — success criteria

Run on the local Strix Halo before any repo artifact is written:

1. A ROCm vLLM container serves the deployment models
   (`ibm-granite/granite-4.1-8b` + `google/gemma-3-4b-it`) on gfx1151:
   `/health`, `/v1/models`, one completion each, and
   `response_format={"type":"json_object"}` works (dataprep requirement).
2. LLM + translation instances coexist on the iGPU with a measured
   memory split recorded for `env.strixhalo`.
3. TEI on ROCm image (or CPU fallback) serves `BAAI/bge-large-en-v1.5` and
   `BAAI/bge-reranker-v2-m3`.
4. Compose device passthrough works (`devices:` + `group_add:`); the swarm
   form of the same is tested or its limitation documented.
5. The winning image tags + measured sizing values are recorded in the
   implementation plan before Phase 1 starts.

## Explicitly left to the builder

- Exact winning image tags and their sources (spike output)
- The precise overlay diffs per service (minimum restated keys)
- Ansible ROCm play structure and var naming (follows existing
  `deploy-gpu.yml` style)
- Doc prose and placement within the listed files
- The TEI rocm-vs-CPU decision (either is acceptable if documented)
