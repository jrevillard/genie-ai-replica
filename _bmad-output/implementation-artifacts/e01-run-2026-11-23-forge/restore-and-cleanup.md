# Restore and cleanup — the proof (issue #2118)

Executed by `restore-and-cleanup.sh` (this directory) over four passes on
2026-11-23; every resource this run created on the shared forge k3s is
removed and the removal is VERIFIED below. The passes were needed because
the live venue kept teaching the script (each defect is fixed in the
committed script): the reconcile race, the vtsingle workload shape, the
kubectl multi-resource delete parse, the NetworkPolicy-blocked pod IP, the
Keycloak role-mapping DELETE shape, and a leaked port-forward.

## The declared baseline and its restoration

| baseline item | state after the restore | proof |
|---|---|---|
| deploy overlay `jrevillard-forge` | back to main @ 57879c0 (pass 1 commit, pushed: `b8a003c..b25a132 HEAD -> main`) | pass 4: "nothing to commit, working tree clean / Everything up-to-date" |
| HelmRelease `genieai` | rev **76**, chart **0.2.183**, `Ready=True`, `traces.enabled: false` in the values ConfigMap | pass 4 step 2 + final check |
| ConfigMap `genieai-forge-public` | present (20 d old), `traces: enabled: false` | jsonpath over `.data.values\.yaml` |
| agentic side | `agent-service` + `genieai-genieai-umbrella-okf-server` Deployments AND Services deleted (pass 2); **no run deploy/svc/sts remain** | final get: "no run deploy/svc/sts" |
| run NetworkPolicy `e01-chatqna-vt-egress` | NotFound | final get |
| OpenTelemetry operator (helm release `opentelemetry-operator` in `genieai`) | uninstalled (pass 1); the 4 CRDs deleted; all `NotFound` | pass 4 step 4 |
| VictoriaMetrics operator (applied from `/tmp/vmop-nocrd.yaml` into `vmoperator-system`) | deleted (pass 1); `No resources found in vmoperator-system` | pass 4 step 5 + final get |
| VTSingle CR `vtraces` + its workload | workload deleted (pass 4); the CR needed an orphaned-finalizer patch (`apps.victoriametrics.com/finalizer` — its controller was already uninstalled) and is gone: `No resources found` for vtsingle | final get |
| collector workload (`genieai-collector-collector`) | deleted (pass 2); no collector pod | final get: "no run workload pods" |
| realm: `admin` role on the dataprep SA `e33a4dd8-…` | **removed, verified**: the SA's live role-mappings are `['default-roles-genie', 'dataprep-service']` | live re-query after the delete (204) |
| realm: eval user `e01-eval` | **deleted (204), verified gone** with `exact=true` re-query | live re-query |
| realm: eval client `e01-eval` | **deleted (204), verified gone** | live re-query |
| `okf-internal-secret` (SealedSecret wired for the run) | SealedSecret AND Secret NotFound — the baseline absence restored | final get |
| `keycloak-proxy-client-secret` | deleted; **the sealed-secrets controller RE-SYNCED it** (the honest-NOTE branch predicted this) — the Secret returns as the SealedSecret's own content; the pre-run "Secret absent while SealedSecret Synced" state is not reproducible by deletion and is controller-owned | live check |
| the run's port-forwards (arango, chatqna, docrepo, kc, vt + the script's own) | all killed; `no run port-forward listeners remain` | `ss` after the kills |

**Not this run's, therefore untouched:** the helm release
`opentelemetry-operator` in namespace `opentelemetry-operator-system`
(created 2026-11-03, predates the run) and the VictoriaMetrics CRD family
(`vtsingles`, `vmclusters`, … all created 2026-11-03) — both predate this
run and stay.

## What each pass taught (and what the committed script now carries)

1. **pass 1**: the ConfigMap race — the HelmRelease was annotated before the
   kustomize controller propagated the reverted values, so rev 75 upgraded
   with the OLD values and the observability tier survived. Fix (committed):
   wait for `traces.enabled: false` in the ConfigMap BEFORE annotating.
   Also: `delete deployment X service Y` makes kubectl read `service` as a
   deployment NAME — the agentic Services survived; deployments and services
   are now deleted in separate commands. Also: `--resolve` to the keycloak
   pod IP is refused by the chart's NetworkPolicies (connection refused).
2. **pass 2**: the realm revert ran over a port-forward to the pod's plain
   HTTP port; the eval user and client were deleted (204), but the role
   DELETE used the per-role URL, which 404s on this Keycloak version even
   with the correct id — the collection DELETE with the role representation
   in the BODY is the supported shape (204, live-verified). The 7c gate
   honestly refused while the role survived.
3. **pass 3**: the port-forward retry (a prior pass's leaked forward holds
   the port), the vtsingle workload is a DEPLOYMENT not a StatefulSet, and
   the orphaned VTSingle CR needs a finalizer patch once its controller is
   gone.
4. **pass 4**: everything above green; the last steps (secrets, forwards,
   realm verification) completed manually with the same commands after the
   leaked-forward refusal, and are verified in the table above.

The realm verification (post-restore, via a fresh port-forward, all three
probes): `admin gone (verified)`, `eval user gone (verified)`,
`eval client gone (verified)`.
