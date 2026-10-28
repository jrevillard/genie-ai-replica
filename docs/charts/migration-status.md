# Helm Migration — Status

Single-page map of the migration effort: which plans shipped, which were
superseded, what remains. Companion to `plan-defects.md` (review ledger) and
the design of record ([`helm-charts-design.md`](helm-charts-design.md)).
Plan checkboxes are not a status source — evidence is the chart, the deploy
repo, the cluster, and the SDD ledgers under `.superpowers/sdd/`.

## Current state (2026-10-28)

- **Chart `genieai-umbrella` at 0.2.98**, branch `feat/k8s-migration` based
  on `main` at `179a8a8f1` and **8 commits behind `origin/main`**
  (`5786919c1`). The gap touches the frontend, the OPEA overlay
  (retriever/dataprep), the site docs and the config-validator tests —
  **nothing under `charts/` or `scripts/`**, so the chart's gates and
  renders are unaffected. The branch is rebased onto `main` before the
  MR leaves Draft.
- **No application code in the branch**: the diff touches `charts/`,
  `scripts/`, `docs/`, `deploy/`, `tests/`, `site/`, `.gitlab-ci.yml`,
  `docker-compose.yaml`, `env`, `Makefile`, `CLAUDE.md`, `CHANGELOG.md` —
  and nothing under `components/`, `genie-ai-overlay/` or `mobile/`. The
  application defects the validation work surfaced (doc-repo ClamAV host
  forwarding + issuer check + `CLAMSCAN_LOCAL_FALLBACK`, the backend's
  `OPEA_HOST` default) left as three separate MRs off `main` (!586, !587,
  !588), each with tests. That is why the laptop overlay no longer pins a
  `feat-k8s-migration` document-repository image.
- **Config parity is a gate, not a claim (0.2.61–0.2.64)**: the chart now
  configures every service the way Compose does, and `scripts/config-parity-check.py`
  compares the two renders variable by variable. The gate learned to judge
  only what it was actually given (a tier-off render used to report every
  variable of every unrendered service), to report a pair it cannot judge
  as "not judged" rather than as a match, and to verify its `notRead`
  claims against the source (a `notRead` claim that no longer holds is a
  finding, not a pass).
- **CRD blind spot closed (0.2.55–0.2.56)**: `kubeconform
  -ignore-missing-schemas` never validated a Custom Resource, and several
  operators decode their CRs strictly — `chart:crd-validate` runs the full
  render through `kubectl create --dry-run=server` against the installed
  CRDs (`scripts/validate-crds.sh`). It caught two real defects on its
  first run: `GrafanaDashboard.spec.resyncInterval` (the field is
  `resyncPeriod`, so all nine dashboards were rejected) and
  `Cluster.spec.storage.accessModes` (pruned silently; access modes
  belong under `storage.pvcTemplate`).
- **Review rounds 6-7 closed (0.2.56-0.2.60)**. Findings that mattered,
  each verified against the live cluster rather than taken on report:
  the backend's translation endpoint only defaulted in in-cluster GPU
  mode, so an external-GPU site that omitted it fell back to the 6 Gi
  in-process CPU model (the OOM path); `local-teardown.sh` passed
  `helm uninstall --keep-resources` to `kubectl delete namespace`,
  which is not a kubectl flag, so the default teardown never deleted
  anything while reporting success; the same script deleted the
  sealed-secrets namespace under `--with-operators`, destroying the key
  every committed SealedSecret is encrypted against; the bootstrap
  script's key restore parsed JSON while documenting a YAML file, after
  having already deleted the generated keys; `chart:contract`'s OTLP
  assertion was a whole-file grep the agent CR satisfied on its own;
  the NetworkPolicy cross-check compared ports in Service space where
  the datapath uses pod space; `clusterProfile=prod` was rendered by
  nothing in CI, though it is the only configuration that emits a
  PodDisruptionBudget and multiplies the backend to 3.
  Refuted with reproduction: the `ternary … kindIs "bool"` inversion
  (the sites use `not (kindIs "invalid")`, and `httpEnabled` is typed
  in the schema), and the Keycloak theme `strip-components` mismatch
  (it counts path components, so any theme name works).
- **Review round 10 closed (0.2.69)** — three parallel adversarial passes
  over the whole post-simplify diff (round 9 already shipped inside it),
  every finding verified against a render or the live cluster before
  acting. The ones that mattered:
  - *`ct install` silently rewrote the operator's kubeconfig.* Chart
    testing creates AND deletes its own kind cluster, and kind rewrites
    the file named by `KUBECONFIG` — run bare from `make test`, the
    minikube context vanished from `~/.kube/config` and the live cluster
    (Flux release, SealedSecrets) looked gone. Restored with
    `minikube start` (state intact, sealed-secrets key verified); the
    target now runs ct against a throwaway kubeconfig file, deleted on
    every exit path.
  - *`validate-crds.sh` validated green against a dead API server.* The
    `|| true` + pattern-matching filtered "connection refused" into
    silence — no matched error pattern, exit 0, "every rendered object
    validated" while the cluster validated nothing. The kubectl exit
    code is now checked alongside the output text; mutation-proven both
    ways (old code green on a simulated API death, new code red, the
    AlreadyExists-on-live-cluster path still green).
  - *The logs dashboards named the datasource by its CR name, not its
    UID.* grafana-operator's substitution is a blind case-sensitive
    `ReplaceAll`; every `DS_VICTORIALOGS` row pointed at `victorialogs`
    while the provisioned datasource's uid is `victoriametrics-logs` —
    11 mappings silently unresolved.
  - *The backend's translation egress dropped the explicit-endpoint
    shape.* Round 9's derived-endpoint gate still fired an external
    ipBlock rule for a `.svc.cluster.local` endpoint named explicitly in
    in-cluster mode; the gate now keys on the dialed endpoint not being
    cluster-local, whatever produced it (four shapes render-verified).
  - *The HTTP→HTTPS redirect lost the source port.* Envoy strips the
    `:80` on redirect for non-well-known origins, so the port-bearing
    origin the chart explicitly supports landed on 443 — connection
    refused. The redirect now carries the public port (4443 verified
    rendered; 443 for bare hosts).
  - Plus: the helm-test data-deps check reads `data.keycloak.db.secretName`
    (an operator who renamed the CNPG/Keycloak SharedSecret was tested
    against a name nothing consumes); redis and clamav honor
    `global.imagePullSecrets` and the tag-driven pull policy; the
    dep-check SA hook-weight moved to -11 with the file-path tie-break
    documented; six undeclared OPEA booleans typed in values + schema;
    the CI kubeconfig export moved before the local-path-provisioner
    wait (a cold runner's `kubectl apply` raced an unset KUBECONFIG);
    ct's install/lint flag split corrected (`release-label`,
    lintconf colon spacing, `CT_INSTALL_FLAGS`); two `resource_group`
    comments rewritten to describe the groups they actually name; the
    teardown uninstalls grafana-operator (the `--with-grafana` opt-in)
    and its operator counts stopped contradicting its loops.
  Skipped with reasons: the `DS_PROMETHEUS` mapping (resolves to the
  same datasource either way — a no-op rename), and the NetworkPolicy
  table-ization / serial install-prereqs parks carried from round 9.
- **The CRD gate had never validated anything (0.2.69 follow-up,
  `3c9f9ca`)**: `chart:crd-validate`'s cluster never had the Gateway
  API CRDs — gateway-helm ships them as a NESTED subchart, so
  `helm template` does not render them and only a real install applies
  them — and kubectl 1.33's `resource mapping not found` message
  carries no `error:` prefix, so the pattern-only filter scored the
  dead dry run as clean. Every prior green run of the job validated
  zero objects. The round-10 exit-code check surfaced it (pipeline
  14211 red); `install-prereqs.sh` now applies the bundle from the
  vendored gateway-helm tgz (the exact version the release installs)
  via server-side apply — client-side apply exceeds the 256 KiB
  last-applied annotation on these CRDs — with a skip-guard on all
  three kinds. Proven on a scratch kind cluster from zero CRDs;
  pipeline 14216 `chart:crd-validate` green with 256 objects
  genuinely validated.
- **Review loop, pass 2 (0.2.74, `bfdc6c47a`)** — the /code-review loop
  the user asked to keep running while Important findings surface. Pass 2
  returned 13 findings; 12 verified true and fixed, 1 refuted
  (local-test.sh sealedsecret `kubectl get`: a present-but-empty CRD
  exits 0, and install-prereqs installs the controller unconditionally,
  so the claimed fresh-install abort cannot happen). The four that
  mattered:
  - *The migrations hook ignored `global.imageRegistry`* — opposite
    precedence of the service factory, contradicting its own comment;
    an air-gapped mirror moved every service image and left the hook on
    the default registry (confirmed by render before and after).
  - *`helm test` never asserted the OPEA-tier Secrets* the chart mounts
    through non-optional secretKeyRefs (`vllm-api-key`,
    `kc-dataprep-client-secret`) — the CHANGELOG claimed it did; the
    test now fails the install on a missing one when the tier is on.
  - *`make test-umbrella`'s CLI `--helm-extra-set-args` REPLACES the
    ct.yaml value* (viper bound-flag semantics), so the target rendered
    the Keycloak/CNPG/Arango CRs onto a bare kind cluster and died with
    `no matches for kind`; the tier-disable flags now travel in the
    Makefile's own flag string.
  - *translation/embedding `modelId` rows had no `| default`* — an
    overlay nulling the key rendered `value: null` and the apply
    rejected the Deployment; every sibling knob already defaulted.
  Remaining nine: parity-gate efficiency (one `verify_not_read` pass,
  mutation-tested), the CHANGELOG Quickstart claim rewritten to the
  flags the render guards actually require, and six stale
  comments/strings (vmsingle Service name, grafana backendRef,
  embedding skipTlsVerify, fullname truncation reason, gpuApiKeyEnv
  aliases, allowlist secret/knob names).
- **Review loop, pass 3 (0.2.75)** — 14 findings, all verified true (no
  false positive for the first time in the loop), all fixed:
  - *The helm-test pods that probe the stateless and observability tiers
    never wired `global.imagePullSecrets`* — on a credentialed docker.io
    mirror they ImagePullBackOffed while every workload they probe
    pulled fine.
  - *`validate-crds.sh` waited for a namespace to go Active only when the
    render DECLARED a Namespace object* — the chart declares one only
    for the observability tier, so the wait was skipped on every default
    render and the race the script documents (creating inside a
    finalizing namespace) was live on every CI run.
  - *An IPv6-literal `ingress.host` derived the listener port from
    `"db8" | int` = 8 and the hostname from `[2001`* — the edge rendered
    silently wrong. Both derivations now share one helper and the render
    FAILS on an IPv6 literal instead.
  - *The clamav port knob moved only the containerPort* — the Service,
    both NetworkPolicy rules, the tcpSocket probes and the helm-test
    probe stayed on 3310 (found by rendering the override, not by the
    review). Six sites derive from the knob now; the document-repository
    egress rule follows it too.
  - *The RBAC comment claimed `helm install --create-namespace` creates
    the namespace AFTER the hooks* — helm v3.16.3
    (`pkg/action/install.go`: the CreateNamespace block precedes
    `performInstall`'s `execHook(PreInstall)`) says the opposite, and the
    site doc was right. The comment was rewritten with the source
    reference.
  - Three CHANGELOG bullets described mechanisms the shipped chart
    replaced (the dead KeycloakRealmImport migration step, the SMTP
    failure that cannot happen, the Compose streaming default flip that
    was unannounced).
  - Plus: the CORS knobs the template reads are now declared, the
    `chart:install` no-op `.real` install dance is gone, the bootstrap
    script resolves its repo path, the gateway-helm tarball failure is
    named, the collector config comment says "map" (v1beta1 rejects
    strings), and the redis policy grants the TCP-53 truncated-answer
    fallback every sibling grants.
- **Review loop, pass 4 (0.2.76)** — 14 findings, all verified true.
  Three of them were render- or install-breaking, and the CI never saw
  them because the shipped values exercise neither:
  - *A second PodDisruptionBudget broke the render* — the helper's
    trailing `-}}` stripped the newline before the next document's
    `---`, so the second PDB glued itself to the first one's last line
    (`helm template --set services.documentRepository.podDisruptionBudget.minAvailable=1`
    died with a YAML parse error). The trap the workflow doc warns
    about, in the wild.
  - *The PDB name used the component label verbatim* (`documentRepository`)
    while the Deployment is lower-cased — the API server rejects the
    mixed-case name.
  - *`ct install` could never pass*: the data tier was disabled while
    backend / frontend / documentRepository stayed on, and the
    pre-install dependency check refuses an enabled component that
    depends on a disabled one.
  - *The chatqna orchestrator never set `LLM_MODEL` on the Compose
    surface* — the code default names a model the (now changed) vLLM
    does not serve, so every chat request was a 404. The parity gate
    could not see it: it walks Compose -> chart, so a chart-only
    variable is invisible to it. Now set on both sides, and
    mutation-tested (the gate goes red on a one-token drift).
  - *The Quickstart, the local-test script and the `chart:install` job
    all installed a release whose hook Jobs could never start* — the
    operator-provided Secrets are mounted through non-optional
    secretKeyRefs and none of the three created them. They do now (the
    job seeds them, the script creates only the ABSENT ones).
  - Plus: the vllm-translation initContainer was the only tooling image
    ignoring `global.toolingImageRegistry`; the model-cache PVC read
    its own storage-class knob instead of the chart-wide one; the helm
    test spent one 60s budget per Secret and ran past helm's 5-minute
    timeout; the ArgoCD example installed with defaults the render
    guards reject; the Keycloak ClusterRoleBinding patch aborted the
    whole bootstrap when the object is absent; and the chart version
    quoted in the READMEs was stale (now a pointer to Chart.yaml —
    Flux reconciles on that number, and it drifted on every bump).
- **Review loop, passes 5-8 (0.2.77-0.2.80)** — 47 findings across four
  passes, each one checked against a render, a live cluster or the source
  before it was acted on (six were refuted that way). The ones that
  mattered:
  - *The render guards had never been exercised.* `helm lint --strict`
    downgrades every `fail()` to an INFO line and still exits 0 (helm
    3.16.3 prints `level=INFO msg="funcMap fail"` per guard), and every
    render in the pipeline switches the placeholder guard off through the
    shared fixture — so a guard that stopped firing was invisible to CI.
    `scripts/render-guards-check.sh` now renders the values each guard
    must reject and requires the render to FAIL, plus one render that
    must succeed; mutation-proven (breaking a covered guard turns the
    gate red, restoring it turns it green). The `ingress.host` guard
    lived in three templates, so the mutation of one site did not
    redden the gate — it is now one helper
    (`genieai-umbrella.ingressHost`), which also rejects an IPv6
    literal.
  - *The parity gate's `notRead` claims passed unverified from any
    directory but the repository root.* Its input paths were relative,
    so the source walk found nothing and every claim was green on a
    claim that was false. All paths are anchored on the script's own
    location now (identical output from `/tmp` and from the root).
  - *The parity gate's "other direction" loop reported each pair's OWN
    chart component as unpaired*, because it read `pair.get("chart")`
    (None when the key is absent) where the comparison loop reads the
    component name.
  - *The gateway-helm subchart installs cluster-wide admission policies
    under a fixed, release-less name.* A second GENIE release on the
    cluster collides on them, exactly like the GatewayClass — both are
    now treated as per-cluster singletons by the cluster-scope gate.
    The teardown sweep was NOT extended to them: they carry no labels,
    so the label-selected sweep can never reach them, and deleting them
    would strip the shared Envoy Gateway of its upgrade protection
    (documented where the sweep is defined).
  - *`helm lint` was the only gate that ever rendered the chart's
    guards, and it does not.* The `chart:lint` job now runs the
    render-guards gate, and `chart:parity` re-runs when the
    application source changes — the gate verifies its `notRead`
    claims against `components/` and `genie-ai-overlay/`, and those
    paths were not in its `changes` filter.
  - *The gateway-helm tarball lookup aborted the bootstrap.* A glob
    that matches nothing is passed through literally, `ls` on it exits
    2, and under `set -euo pipefail` that killed the script before the
    "run helm dependency update" fallback could say anything. Found
    with a `-f` test instead.
  - *The dashboard sync's documented remedy did not fix what it
    claimed.* A renamed or deleted source file left its copy behind,
    the check then reported drift, and re-running the script reproduced
    the identical state — the write mode now prunes the stale copies
    first.
  - *The bootstrap's deploy-repo default resolved against the caller's
    directory*, so it failed at the last step — after the destructive
    ones. Anchored on the script's own root now.
  - Plus: the OPEA endpoint's port is derived from the scheme when the
    URL carries none (an explicit port is preserved — the laptop's
    `:444` is untouched); an IPv6 literal is rejected rather than
    rendered into a URL; `services.backend.translation.backend` is
    derived from the endpoint and fails if the operator sets it; the
    OTel collector declares BOTH its OTLP/HTTP and OTLP/gRPC ports (a
    pass-6 fix had replaced the operator's default list and dropped
    4317); the ClamAV Service, both policy rules and the probes derive
    from one port value; the db-migrations Job waits for ArangoDB's
    `/_api/version` instead of assuming an open port; the PDB helper
    emits its own newline (the `---` glued itself to the previous
    document).
  Refuted with reproduction, not acted on: the reviewer's claim that
  the backend's egress to Redis was missing (the ipBlock covers it),
  and the bidirectional NetworkPolicy enumeration — the ingress-side
  flows it found (`dataprep -> embedding :6000`, `retriever ->
  embedding :6000`, `translation -> vllm-translation :8888`) are real
  only in the in-cluster GPU mode, a tier that has never run on a live
  cluster, and one of them names a port the model does not listen on.
  The asymmetry is documented in the crosscheck itself rather than
  turned into a red gate on a tier nobody has run.
- **Review loop, pass 9 (0.2.81)** — 6 findings, 6 verified true, all
  fixed. The one that mattered most was a contract, not a bug: **eighty
  template-read tuning keys were undeclared in values.yaml** — the whole
  `opea.<svc>.*` surface (reranking strategy/threshold, retriever hybrid
  weights, dataprep chunk sizes and label thresholds, per-service log
  levels, prompt overrides) plus `global.imageRegistry` and
  `observability.grafana.resources`. An operator tuning the reranker had
  to read template source to learn the knob existed, and a misspelled
  key merged into the values and was silently ignored — lint, the schema
  gate and the parity checker all green. All eighty are now declared
  with their template defaults, `scripts/values-surface-check.py` (wired
  into `chart:lint`) keeps the list complete (mutation-proven: dropping
  one declared key turns it red with the key named), and the four
  renders are byte-identical before/after except the one intentional
  comment reword. The other five:
  - *The ArgoCD example values failed the chart's own
    placeholder-completeness guard* — proven by execution (`helm
    template -f examples/argocd-values.yaml` exits 1 on
    `$(env:EMAIL_PASSWORD)`) while both example files claimed to carry
    "the minimum that passes those guards". The five `envSecrets` rows
    are there now; the example renders standalone.
  - *The chart contradicted itself on the namespace's Pod Security
    level* — the backend comment and the test pods said `restricted`,
    the model template said `baseline` (which is what the deploy repo's
    namespace label enforces: the GPU tier cannot run non-root). The
    three wrong sites now say what is enforced and that the services
    OPT INTO the restricted profile.
  - *`--set services.backend.translation=null` aborted the render with
    a nil-pointer error* instead of the chart's named guards — the
    block is normalized once (`| default dict`) and the cleared block
    degrades like every other cleared block (derived endpoint → CPU
    model, streaming default on). The strict `streamingEnabled`
    boolean guard keeps failing a PRESENT non-boolean; only the absent
    key falls back to the default — a plain `| default true` would have
    flipped an explicit `false` back on (Sprig treats `false` as
    empty).
  - *`install-prereqs.sh` silently ignored any unrecognized argument* —
    `--with-grafan` ran the full operator install, printed "skipping
    grafana-operator" and exited 0. Flags are parsed in the sibling
    scripts' loop style now; a typo dies before anything installs.
  - *The redis Service rendered `port:` with no default* — the same
    edit that the clamav Service survived; and the three NetworkPolicy
    ports were hardcoded 6379 while the Service/containers derive from
    the knob (the same split-brain the pass-7 clamav fix removed —
    folded into the same fix at the cause).
- **Review loop, pass 10 (0.2.82)** — 7 findings, 6 verified true and
  fixed, 1 refuted against the chart's own documented contract:
  - *Pass 9's own unknown-argument guard crashed on the typo it
    existed for* — `install-prereqs.sh` has no `die()`, so
    `--with-grafan` died with `die: command not found` (exit 127)
    instead of the self-documenting message. Defined.
  - *The cluster-scoped arango RBAC rendered unconditionally* — the
    ClusterRole + ClusterRoleBinding granting the shared operator
    cluster-wide CRUD on ArangoDeployment CRs ignored
    `data.arangodb.enabled`, so a release without ArangoDB installed
    the grant and removed it on uninstall — deleting RBAC a surviving
    release's operator informers were started with. Gated like every
    other arango resource. (The namespaced Role+Binding stays
    unconditional on its own documented rationale: harmless when the
    bootstrap never ran.)
  - *`podDisruptionBudget.minAvailable: 0` silently dropped the PDB* —
    sprig's `and` short-circuits on the falsy 0; the presence check is
    a nil check now. Four cases render-verified (0 renders, absent
    falls to the declared default, null disables, 1 renders).
  - *The helm-test required-Secret gate was narrower than the render
    that needs it* — `vllm-api-key` was asserted only when the OPEA
    tier was on, but the backend carries a NON-optional secretKeyRef on
    it whenever a translation endpoint is NAMED, tier on or off. The
    gate now covers the explicit-endpoint case (negative case
    verified: no endpoint, no ref, no requirement).
  - *The values-surface gate was blind to the `$svc` alias* — the
    factory's per-service reads (`$svc.podAnnotations`,
    `$svc.workingDir`, …) never matched values.yaml, so two knobs were
    undeclared and undiscoverable. The gate now checks the `$svc`
    surface against the union of the declared per-service keys and the
    `Per-service entry shape` block in values.yaml — the shape
    documentation is a gate-enforced contract now, not prose
    (mutation-proven).
  - *The clamav image tag rendered with no fallback* — a cleared tag
    produced `clamav/clamav:` and lint/kubeconform stayed green.
    Defaults to the declared `stable-debian`.
  - Refuted: "`clusterProfile=prod` silently ignores an explicit
    `data.postgres.instances`" — the override is documented at both
    declaration sites (`instances: 1  # 3 on prod via clusterProfile`,
    `# 2 on prod`) and the precedence is the stateless tier's own
    (the profile map wins over per-service replicas in
    `resolveReplicas`). Documented profile-override semantics, not a
    dead key.
- **Review loop, pass 11 (0.2.83)** — 5 findings, all verified true, all
  fixed. Two were behavioral contracts the static gates cannot see:
  - *The helm-test required-Secret gate was INVERTED for the Keycloak
    proxy-client Secret* — asserted only when the convergence Job was
    DISABLED (the one configuration where the backend's `optional: true`
    envFrom and the absent realm import consume nothing, so a valid
    install shape failed helm test), while the Secrets the Job
    hard-requires when ENABLED — the bootstrap admin credentials and
    every `envSecrets[].secretName`, all mounted through NON-optional
    secretKeyRefs — were never asserted: a missing admin Secret passed
    the test green and died as a CreateContainerConfigError on the
    post-install hook. The gate now derives the names from the values
    (`bootstrapAdmin.userSecret` + each `envSecrets[].secretName`) when
    convergence is on, so an operator who renamed anything is tested
    against the Secrets the Job actually reads.
  - *Clearing `opea.gpu.paths.docling` produced the bare nodeHost, not
    the empty endpoint* — the external branch concatenated
    `nodeHost + paths.<key>` unconditionally, so the documented remedy
    for "no remote docling-serve" handed the app a URL whose every
    conversion POST 404s, and the documented in-process fallback keyed
    on an empty endpoint that could no longer render. An empty path now
    renders an empty endpoint (byte-identical on every non-empty
    default, both GPU modes).
  - *`convergence.backoffLimit: 0` silently rendered 2* — Sprig's
    `| default` treats 0 as empty; the same falsy-zero trap the PDB
    `minAvailable` fix removed. Nil check now (0 / 5 / absent all
    render-verified); the sweep for other numeric `| default` sites
    found no other knob where 0 is a legal value (ports and instance
    counts have no valid 0).
  - Two gate-quality fixes on `values-surface-check.py`: the `$svc`
    scan ran twice per invocation (dict computed once now), and
    `shape_block_keys` only ended the block on a non-comment line, so
    a blank line followed by unrelated commented examples would have
    folded foreign keys into the accepted `$svc` surface — it stops at
    the first blank line now (mutation-proven).
- **Review loop, pass 12 (0.2.84)** — 10 findings: 8 verified true and
  fixed, 1 re-refuted, 1 consolidated into a gate restructure. The
  structural outcome first: **the CI render fixtures are now one source**
  — `charts/ci/render-base-flags` carries the complete documented
  minimum (deployment data, the client-secret tickets AND the five
  convergence envSecrets rows; the `failOnPlaceholderSecrets=false`
  bypass is GONE, so every CI render now runs the placeholder guards
  ON), `render-full-flags` carries the tier extras, and the six
  previously-inline `--set` blocks (four in chart:lint, two in
  crd-validate) cat the fixtures. `render-guards-check.sh` sources the
  fixture too, substituting its own host — a flag added there arrives in
  every gate automatically. On top of that:
  - *The parity gate's `secretProvided` category was a suppression
    nobody checked* — it short-circuited before any presence
    assertion, so a refactor deleting the Secret wiring left the gate
    green. The allowlist entries are structured objects now
    (`{why, secret, via}`), and the checker asserts the wiring: an
    `envFrom` entry must find its Secret among the rendered mounts, a
    `secretKeyRef` entry must find its env row — mutation-proven
    (removing `keycloak-proxy-client-secret` from the backend's envFrom
    turns the gate red with the wiring named).
  - *The tools init container downloaded kubectl/jq with single-shot
    curls* — one transient failure failed the hook Job and aborted the
    whole helm upgrade, for the drift hook whose script ends `exit 0`
    precisely so it can never block. Three-attempt retry now.
  - *The five OPEA services had no startupProbe* — liveness only
    (60s + 3×30s) against a cold docling/torch import chain; the
    kubelet killed pods mid-import on a contended node. Startup
    probes (300s window) on dataprep/retriever/reranker/embedding and
    the hand-written translation Deployment — all six verified
    rendered.
  - *`local-test.sh` permanently mutated the kubeconfig
    current-context* and never restored it — every other kubectl
    session on the machine silently targeted minikube afterwards. The
    previous context is saved and restored through a trap now.
  - *The NetworkPolicy crosscheck reported a port-less egress rule as
    BLOCKED against any concrete ingress port* — a rule with no
    `ports:` legally declares every port; `covers()` now admits it on
    any declared destination port (five-case unit-checked; the print
    says `:any`).
  - *The browser CSP carried the cluster-internal Keycloak URL* — a
    source no browser can resolve, in an otherwise https set; the SPA
    reaches Keycloak through the same-origin `/auth` edge route that
    `'self'` already covers. Dropped; the internal URL stays on the
    server-side consumers that can actually resolve it.
  - *`compose_default` only interpreted whole-value interpolation* — a
    value like `URL=${HOST}:8080` was compared as literal `${...}`
    text no container ever sees. Embedded interpolations resolve
    against the committed `env` template now (unset → empty, the
    Compose semantics).
  - *`install-prereqs.sh` carried five hand-copies of the same
    install-and-wait body* — one parameterized `helm_install_operator`
    now; both paths stub-verified (the skip gate and the extra-`--set`
    passthrough).
  - Re-refuted: "`clusterProfile=prod` tramples an explicit
    `data.postgres.instances`" — the reviewer's own cited precedent
    (`resolveReplicas`) has the SAME profile-wins precedence, and the
    values comments document the override at both declaration sites.
- **Review loop, pass 13 (0.2.85)** — 5 findings, all verified true, all
  fixed:
  - *`local-test.sh` could never succeed* — it rendered no
    `convergence.envSecrets` rows and created none of the Secrets they
    name, so the post-install convergence Job hit the exact unresolved-
    placeholder kcc failure the chart's own sentinels document and
    `helm install --wait` aborted at STEP 3, before any verification.
    The four Secrets and the five rows (the README quickstart's set,
    which CI's chart:install already carried) are wired in now.
  - *The Quickstart's `openssl rand -base64 24` violated the realm's
    own password policy* — the base64 alphabet carries no special
    character, and a 24-byte draw yields none ~47% of the time, so the
    convergence Job rejected genie-admin's credential and the install
    failed far from the generator. The documented command now appends a
    suffix satisfying `specialChars(1)` (and the rest of the policy),
    with the arithmetic in the comment.
  - *`KEYCLOAK_LOCALE` was the one env row with no default* — an
    overlay clearing `defaultLocale` rendered `value: ""`, which
    Kubernetes drops (omitempty), leaving `$(env:KEYCLOAK_LOCALE)`
    unresolved and kcc failing the import; every sibling
    (passwordPolicy, theme, EMAIL_*) carried a default or sentinel for
    this exact trap. Defaults to the declared `en`.
  - *`translation.probeTimeoutSeconds: 0` silently dropped the env
    row* — the falsy-zero class again (the convergence `backoffLimit`
    fix's twin); presence is a nil check now, and an explicit 0
    renders.
  - *Ten NetworkPolicy comments claimed VictoriaMetrics was actively
    scraping the Services* while `vmsingle.yaml` documents the
    VMServiceScrape CRs as deliberately inert (no serviceScrapeSelector;
    no workload serves /metrics — they export over OTLP). All ten now
    state the pre-wired-but-inert design, and redis's adds the port
    caveat (6379 speaks RESP — a real scrape needs a redis_exporter
    sidecar first), so the next reader does not debug a scrape the
    design renders impossible.
- **Review loop, pass 14 (0.2.86)** — 9 findings, all verified true, all
  fixed. The one that ran deepest was my own pass-12 crosscheck fix,
  which had patched the wrong layer:
  - *A port-less NetworkPolicy rule never declared a flow at all* —
    `rule_ports` returned an empty set (not None) for a rule with no
    `ports:` block, so the any-port class was invisible one layer before
    the `covers()` check I had "fixed": no flow, no assertion, no
    report. Fixed at the constructor; and an any-port flow a
    port-specific peer only partially admits is now neither silently
    permitted (the pass-12 bug) nor falsely blocked (the pre-12 bug) —
    it prints an ADVISORY line naming the admitted ports. Mutation:
    a port-less backend→redis rule renders `ADVISORY … the ingress side
    admits [6379]`.
  - *`KEEP_RESOURCES=true` destroyed what it promised to keep* —
    `helm uninstall --keep-resources` kept the PVCs and the very next
    `kubectl delete namespace` cascaded them, while the log said "PVs
    are kept". The flag now also skips the namespace deletion (the only
    way volumes survive) and says so.
  - *`services.redisCache.port` stopped at the Service* — the backend's
    TRANSLATION_CACHE_PORT, the backend egress rule and the
    reachability test hardcoded 6379, so an override produced a cluster
    where every pod was green and the translation cache timed out.
    All four sites derive from the knob (render-verified with 6380).
  - *backend/frontend read raw `.Values.ingress.host`* — bypassing the
    `ingressHost` helper's `required` fail, so a render with Keycloak
    (the transitive guard carrier) disabled shipped `CORS_ALLOWED_ORIGINS:
    https://` and an empty-host issuer. Both go through the helper; the
    guard now fires with Keycloak off.
  - *The PII smoke passed an unrewritten chart config through when the
    placeholder marker was absent* — the collector then dialed the
    in-cluster VL hostname inside an isolated docker network and the
    failure read as an OTTL problem. chart:contract asserts the marker
    exists after its hostname rewrite, and the smoke fails fast naming
    the mismatch.
  - *The parity doc corpus ignored values.schema.json* — a knob
    documented only in its descriptions failed the documented-knob
    check. `.json` is in the corpus.
  - *`chart:install` was pinned to the branch name* — it would have
    vanished from push pipelines the day the branch merged. The rule
    also matches the default branch now.
  - *The bootstrap `--help` printed a hardcoded line window* — derived
    from the `set -euo` marker now, so header edits cannot truncate it.
  - Plus the unbalanced-parentheses comment on `clusterProfile`, the
    first knob block an operator reads.
- **Review loop, pass 15 (0.2.87)** — 11 findings: 9 verified true and
  fixed, 1 removed outright (stronger than reported), 1 refuted:
  - *A cleared `probes` block crashed the render* — the factory read
    `$svc.probes.readiness` unguarded and clamav read
    `$probes.readiness.tcpSocket` after normalizing only the top level,
    so `--set services.frontend.probes=null` died with a nil-pointer
    error while every other clearable block degraded gracefully.
    Normalized at both levels; all four services render probe-free on
    the cleared block and unchanged on the defaults.
  - *The reachability test counted a connect TIMEOUT as PASS* — curl
    exit 28 (the SYN dropped, which is exactly what a NetworkPolicy
    drop looks like) printed "tcp open", making the test structurally
    unable to fail on the defect class it exists to catch. Only exit 0
    passes now; 28 gets its own failure message naming the drop.
  - *`services.frontend.cspConnectSrc` was documented as feeding the
    backend's CSP header* — it never did; the knob shapes the browser's
    connect-src via VUE_APP_CSP_CONNECT_SRC and the backend header
    carries only the derived set. Documentation fixed.
  - *prod scaled frontend and documentRepository to 2 replicas with
    `podDisruptionBudget: null`* — a voluntary disruption could take
    both replicas of either service at once, defeating the
    zero-downtime the replica bump exists for. Both declare
    `minAvailable: 1` (prod renders three PDBs, dev none).
  - *The observability test pod was labeled `component: observability`*
    while every policy's ingress peer names `component: test` — it
    worked only while the storage pods carried no ingress policy at
    all. Relabeled.
  - *The dep-check Role granted get/list on the Keycloak operator's
    CRs with zero consumers* (the Job runs with
    `automountServiceAccountToken: false`) — removed, with the
    no-speculative-grants rule stated where the "for completeness"
    comment used to invite them back.
  - *The backend's egress rule admitted translation pod port 9031* —
    the Service's external port; post-DNAT nothing listens there.
    Pod-space 8888 only.
  - *`local-test.sh` died on `kubectl get sealedsecret`* on any cluster
    without the CRD — the chart has shipped no SealedSecrets for many
    rounds. The listing is CRD-guarded now.
  - *`opeaNetworkFromUrl` sniffed the port over the whole URL* — a
    colon in the path or query (`?from=en:1`) became the egress port.
    The port comes from the authority segment now (five URL shapes
    render-verified).
  - *The tools init downloaded jq for zero consumers* — stronger than
    the finding claimed: not just the test pods, NOTHING in any hook
    or test shells out to jq. Removed (kubectl only), mirror docs
    updated.
  - Refuted: the render-guards `pipefail`-under-sh claim — the shebang
    is `#!/usr/bin/env bash` at HEAD.
- **Review loop, pass 26 (0.2.98)** — the `/code-review` of the whole
  branch (7 findings), the `/simplify` sweep (reuse, simplification,
  efficiency, altitude) and the `/test-audit` of the new gates. The
  findings that mattered were the ones about the gates the pass-25 batch
  had just written: a gate that asserts a contract it does not hold is
  worse than no gate.
  - *The vLLM policy locked out the translation model's own
    initContainer* — `vllm-translation` waits for `vllm:8000/health`
    before it starts, and the `vllm-model` policy admitted only
    chatqna/retriever/dataprep. On an enforcing CNI the init was
    blocked by the very policy that guards the model pods: an
    `Init:0/1` loop with nothing in the vLLM logs, and no translation
    model at all. The peer is admitted now.
  - *The keycloak smoke probe asserted nothing* — `local-test.sh` ran
    an unlabelled probe pod in the caller's namespace, which the
    keycloak policy (named same-namespace peers) never admits; the
    timeout produced HTTP 000 and `|| true` swallowed it. The probe
    runs in the chart's namespace with the test label, the policy
    admits the test component, and the failure is fatal.
  - *The version gate's verdict depended on the checkout* — in an MR
    pipeline the checkout is the merge result, whose history
    interleaves the target branch's commits with this change's, so an
    unrelated bump on the other side laundered an unbumped change
    here. The comparison is now anchored on the diff base and on the
    change's own side of the merge, and the library chart
    (`charts/genieai-common`) is watched too: it renders INTO the
    umbrella, but Flux reconciles the umbrella's version.
  - *The "silent drop" assertion forgave too much* — one owned row
    forgave every other row of the group, and a workload stripped of
    ALL its rows was exempt (the check asked "does the workload still
    have an env row", not "does the workload still exist"). Drops are
    now judged per workload, and the workload's survival is read from
    the rendered objects.
  - *The env-types branch splitter mishandled the chart's own style* —
    a dash-trimmed `{{- else -}}` was read as a value, and a
    multi-line action was truncated at its first balanced line. The
    splitter is three regexes now, and a Go template comment inside an
    action is no longer a value.
  - *The two CI "prod" renders were not the same surface* — one named
    `gpu.ci-render.local:444`, the other `gpu-node:444`. One value
    everywhere now, documented in `charts/ci/README.md`.
  - *The local render was not CI's render* — `charts/Makefile` restated
    CI's fixture and had dropped the convergence envSecrets rows, the
  dummy client secrets and `ingress.enabled`. It reads the fixture now.
  - *A duplicated derivation* — the redis-cache template derived the
    optional-PVC block twice; the second copy could drift from the
    first and mount a claim nobody creates.
- **Review loop, pass 25 (0.2.97)** — 8 findings from the `/code-review`
  skill, all verified true, all fixed. The pass attacked the gates the
  previous passes had just rewritten, and it was right to: three of the
  findings were holes in a gate that had passed every run.
  - *The docling endpoint default contradicted the documented
    contract* — Compose leaves `DOCLING_ENDPOINT` empty and dataprep
    then uses its in-process converter, but the chart shipped
    `/docling` as its default: every ingestion pointed at a path
    nothing in the chart serves. The default is empty now (the
    endpoint is opt-in), and the parity allowlist row moved from
    `mayDiffer` to `codeDefault` — the chart applies the code's
    default, so it must leave the key unset.
  - *The `mayDiffer` branch of the parity gate asserted nothing* — it
    accepted a chart value that was EMPTY under the claim that the
    two deployments may differ. It now asserts the chart renders a
    non-empty value.
  - *The probe-timeout comment promised what the value cannot buy* —
    it read "an explicit 0 is a legal 'fail the probe immediately'
    budget", but the application parses the value with a minimum of 1
    and falls back to its own 30 s default. The comment says what a 0
    actually does.
  - *The env-types static half matched the WHOLE action* — a
    conditional row passed whenever ANY branch mentioned `quote`, so
    the branch that actually rendered could hand the API server a
    number. The check is per branch now, and a branch made only of
    literal text is judged by what YAML reads it as.
  - *The cleared-block sweep ignored DROPPED env rows* — it compared
    the rows present in both renders, so a block that removed a row
    from a workload it does not configure was a compliant degradation.
    A drop is now judged: the block must own it (its path names the
    workload, or the row pointed at a resource the block removed), and
    the rows that vanish together are judged as one group.
  - *The NetworkPolicy cross-check could not see an ingress peer with
    no policy of its own* — the helm-test probes are admitted by the
    backend and the doc-repo, and their egress is declared nowhere; a
    namespace-wide default-deny would lock them out silently. A narrow
    assertion reports the pair now (it is decidable: such a peer is
    unrestricted unless a namespace-wide policy isolates its egress).
  - *The prereqs installer called sealed-secrets a chart
    requirement* — the chart renders no SealedSecret; the deploy
    repo's overlays carry them. The header now says whose
    requirement the operator is.
  - *The chart's version IS its artifact identity, and nothing
    enforced the bump* — Flux reconciles `spec.chart.spec.version`,
    so a push that changes the chart without moving it installs
    nothing (the release reports "in-sync with desired state"). 114
    commits of this branch changed the chart without a bump.
    `scripts/chart-version-check.py` fails the pipeline when the
    content moves without the version.
- **Review loop, pass 24 (0.2.96)** — 7 findings from the `/code-review`
  skill, all verified true, all fixed. The review attacked the gates the
  previous passes had just rewritten, and it was right to.
  - *The model Deployments rendered `%!s(<nil>)` into their container
    arguments* — vllm, vllm-translation, tei and tei-reranker read the
    model id and the tuning knobs of a clearable block without a
    fallback, and Helm's `null` DELETES the chart's own defaults. A
    cleared model block produced a green install whose pod crash-loops
    on `--model "%!s(<nil>)"`, with the values key nowhere in the
    output. Each read carries its chart default now, like the sibling
    orchestrators already did.
  - *The pass-23 guard broke the documented docling configuration* —
    dataprep states the contract in the template: an empty docling
    endpoint is the signal that it uses its in-process converter, so
    `opea.gpu.paths.docling` MAY be cleared. The guard now exempts
    that key; every other path still fails by name.
  - *The cleared-block sweep never rendered the in-cluster GPU tier* —
    the model Deployments exist ONLY in that mode, so the sweep
    asserted nothing about the blocks they read, and the finding above
    landed green in CI. The sweep now runs on THREE surfaces.
  - *The "no silent empty" assertion was narrower than its promise* —
    it inspected env rows and only emptiness, so the engine's debug
    output (`%!s(<nil>)` in an argument, `<nil>` in an env value)
    passed as a compliant degradation. The sweep now refuses a render
    that carries either marker, wherever it appears.
  - *Clearing `services.clamav` rendered `value: <nil>`* for
    VIRUS_SCANNING — `and nil false` is nil, and `| toString` prints
    the debug text. The switch is coerced to a bool, so a cleared
    ClamAV tier renders `false` (what the application reads).
  - *The env-types static half skipped the library helpers* — it
    scanned `templates/**/*.yaml` and not the `.tpl` files, which is
    where the shared env rows live. It scans both now.
  - *The GPU helper's header advertised a docling entry the code does
    not implement* — the chart renders no docling Deployment in any
    mode, and the branch below the header returns an empty endpoint.
    The header now says so.
  - The render-guards script gained the case for the new path guard,
    and its carve-out list names the two guards an operator cannot
    reach (the schema types `streamingEnabled` before the chart can
    reject it; the realm-file guard checks a file of the chart).
- **Review loop, pass 23 (0.2.95)** — 5 findings, all verified true, all
  fixed. The pass attacked the gates pass 22 had just rewritten, and it
  was right to: the "degraded" bucket asserted only that the render did
  not fail, so a degradation that EMPTIES a value the pods dial passed
  as compliant.
  - *Clearing `opea.gpu.paths` emptied every GPU endpoint* — the
    external-mode endpoint is nodeHost + path, and a missing path
    rendered an empty URL that the orchestrators dial: a release that
    installs cleanly and answers no request. The helper's own docstring
    says an empty endpoint must be a named install-time error (the
    nodeHost guard does exactly that); the path had no such guard. It
    fails by name now, naming the key.
  - *`observability.collectorPort` and `collectorCRName` had no
    default at two of their five read sites* — clearing the port
    produced a YAML parse error naming a template, and clearing the CR
    name produced a CR with no name (the API server rejects it). Both
    reads now carry the same default their siblings carry.
  - *The gate's failure classifier asserted nothing in its "compliant"
    branch* — it counted every error that was not an engine crash as a
    named guard, so a YAML parse error (the collectorPort case above)
    passed as the contract being honoured. The classifier now asserts
    the POSITIVE form: a guard names the values key
    (`execution error at (<file>:<line>): <message>`), and anything
    else is a defect.
  - *The gate could not see a degraded render that empties a value* —
    the sweep now compares the cleared render with the baseline and
    fails when an environment row present in both goes from a
    populated value to an empty one. It catches the whole class (the
    mutation test reproduces the finding exactly: ten rows emptied,
    each named).
  - *The render-guards coverage claim was false* — six operator
    reachable guards had no case (the derived translation backend, the
    identity tier without its database, a service with no image
    repository, the OPEA tier with no dependency-graph entry, Grafana
    with no storage component, and a convergence row with an empty
    value). The script now has a case for each of them, so the claim
    it makes is the one it can support.
  - *`global` was the one block still crashing, and the exemption's
    stated harm did not exist* — the reason cited the tools init
    container being handed an empty architecture, but the chart's
    default for that knob IS empty (the init container detects the
    architecture at runtime) and every other global knob degrades to a
    default. The block is normalized like the rest and swept: the
    sweep now covers 117 blocks with NO exemption at all, and the
    exemption mechanism stays in the script for the day one is needed.
- **Review loop, pass 22 (0.2.94)** — 3 findings, all verified true, all
  fixed. The first one turned this loop's own gate inside out.
  - *The clearable-blocks gate could not see a block it did not know* —
    the sweep matched blocks by NAME (a hand-written list of 42), so
    every optional block outside that list was never swept and still
    crashed the render with a nil pointer naming only the template:
    `data.keycloak.bootstrapAdmin` (values.yaml itself documents it as
    ignorable), `services.clamav.cache` (the same shape as the
    redis/doc-repo `pvc` blocks pass 21 fixed) and `ingress.cors`. The
    gate is now STRUCTURAL — every dict-valued node of values.yaml,
    swept on BOTH render surfaces (the baseline and the full tier, so
    the OPEA and observability templates are actually exercised) — and
    the structural sweep found FORTY-FIVE blocks whose clearing crashed
    the template engine, not three: the identity CR's six sub-blocks,
    the edge tier's `tls`/`cors` blocks, the four observability signal
    blocks, the six OPEA service blocks, the five service entries, the
    pluggable storage class, the convergence block, and the tier roots.
    Every one of them now degrades to the chart's documented default,
    or fails with a message naming the values key. Only `global` is
    exempt (it holds the chart's own cluster-wide defaults: clearing it
    DELETES them, which is a destructive edit, not a configuration —
    `global: {}` is the documented way to drop an override).
  - *A cleared block now degrades, and the rule is written down* —
    Helm's `null` DELETES a key, so `services.backend: null` removes
    the switch too: the service stops rendering, which is the same
    meaning as `enabled: false`. That semantic is documented in
    values.yaml, and every block is read through a normalized binding
    (`$x := .Values.<block> | default dict`, parent first) so a cleared
    block can never crash the engine. The renders are byte-identical
    before and after the refactor (baseline and full surface).
  - *The values-surface resolution followed ONE hop* — a variable bound
    from ANOTHER variable (`$convergence := $keycloak.convergence`) was
    invisible to the scan, and the chart's most operator-facing block
    (`data.keycloak.convergence` — every overlay hand-writes five
    `envSecrets` rows under it) is read exclusively through such
    chains: a typo'd leaf there passed lint, every render and the
    schema gate, and reached the cluster as a silently-empty value. The
    resolution is now transitive and order-sensitive (the nearest
    preceding binding of a name wins, as in Go templates). The refactor
    it enabled initially DROPPED the coverage from 272 resolved reads to
    90 — the resolver could not follow the new normalized bindings —
    which is the failure mode the gate exists to catch, in the gate
    itself; it resolves 306 reads now, with none of the previous set
    lost.
  - *The env-types static scan could not see a value with a trailing
    comment or a wrapped expression* — the scanner matched a
    `value: {{ ... }}` that ENDED the line, so a row documented with a
    trailing comment (the natural way to document a knob) escaped the
    static half entirely. The scanner now balances the braces of the
    action, so it sees the whole expression whatever its shape.
- **Review loop, pass 21 (0.2.93)** — 4 findings, all verified true, all
  fixed, plus the gates the pass's own notes asked for.
  - *A non-numeric replica count rendered `replicas: 0`* — the resolver
    coerces with sprig `int`, so `--set services.backend.replicas=2O`
    (letter O) scaled the service to ZERO with every gate green:
    `replicas: 0` is the documented way to scale a tier off, so the
    resolver cannot reject the zero itself — but the TYPE belongs to
    the schema, which now types every `services.<svc>.replicas` and the
    `clusterProfileReplicas` leaves as integers (`minimum: 0`, so the
    documented scale-off still renders).
  - *The pass-20 validation was bypassed by two earlier readers* — the
    shape validation of the operator's convergence rows lived in the
    EMITTER, so the placeholder-completeness guard and the helm test
    read the rows raw first: a scalar row (the classic missing-dash
    YAML mistake) crashed the render with a raw Go-template error in
    whichever template read it first, naming neither the values key nor
    the row. The validation is now ONE helper every consumer goes
    through.
  - *The envVar was emitted unquoted* — a numeric one passes a
    non-empty check, renders as a YAML integer (or, as an int, as
    `%!s(int64=123)` and a YAML parse error), and the API server
    rejects the EnvVar name at apply time. It is quoted, and its shape
    is checked (an environment variable NAME), with the row index in
    the message.
  - *The in-cluster vLLM tuning args were template literals* — Compose
    exposes `VLLM_GPU_UTILIZATION`, `VLLM_MAX_MODEL_LEN`,
    `VLLM_MAX_NUM_SEQS`, `VLLM_DTYPE` and their
    `VLLM_TRANSLATION_*` siblings, and the `env.t4` / `env.rtx6000`
    GPU profiles exist ONLY to set them (the T4 profile drops the
    context length to 2048 because 65536 does not fit 16 GB). The
    chart hardcoded 0.55 / 65536 / 64 / half and 0.3 / 2048 / 16 /
    auto, so a 16 GB site in in-cluster mode could not bring the model
    up at all, and the only recourse was editing the chart template.
    Eight values knobs now carry the same defaults.
- **Two gates added around the pass's own notes, and the fixes they
  found**:
  - `scripts/clearable-blocks-check.py` — the chart's contract is that
    a CLEARED block degrades (the per-service shape block says its
    knobs are optional; `services.backend.translation: null` is
    documented), and a block that is not clearable fails the render in
    the template that needs it. A nil-pointer crash names neither. The
    sweep (42 clearable blocks, one render each) found three unguarded
    reads the passes had missed: the optional `pvc` block of the
    doc-repo and of redis, and the convergence block of the Job and of
    the realm Secret. All four templates normalize now. Mutation
    tested: re-unguarding the redis `pvc` turns the gate red with the
    block named.
  - The `values-surface` gate now RESOLVES a normalized variable back
    to its values path (`$keycloak.enabled` is read as
    `data.keycloak.enabled`): the normalizations this loop introduced
    had made their leaves invisible to the scan, and the coverage the
    gate claims would have shrunk with every one of them. The
    extension immediately found two real gaps — `image.pullPolicy`
    undeclared for clamav and redis, whose own templates read it — and
    the seven `smtp` leaves, which CANNOT be declared (the block's
    nullness IS the switch; declaring a leaf would make the render
    believe a mail server exists) and are allowlisted with the reason.
  - The env-types gate grew a STATIC half: every env row that bypasses
    the service factory must quote or stringify its value, so a new
    hand-rendered row is covered structurally and not only through the
    knob list.
- **Review loop, pass 20 (0.2.92)** — 2 findings, both verified true, both
  fixed. Both are the same shape: a place where the chart accepted an
  operator mistake without naming it.
  - *The operator-facing convergence rows had no shape validation* —
    `data.keycloak.convergence.envSecrets` is the ONE row list an
    operator hand-writes (five rows per overlay), and a typo'd key
    (`envvar` instead of `envVar`) rendered `name: null`: the API
    server rejects the whole Job at apply time with "spec.template.spec.
    containers[0].env[N].name: Required value", naming neither the
    values key nor the row. The placeholder-completeness guard did not
    cover it — it only catches a broken row whose variable the realm
    file references, so an extra or misspelled row passed every gate.
    The rows are validated now (a row must be a map carrying a
    non-empty `envVar`, `secretName` and `secretKey`), with the row
    INDEX in the message. The rendered Job is byte-identical to the
    previous one (the validation only rejects what was already broken).
  - *The helm TEST templates read clearable blocks unguarded* — the
    chart's contract is that a cleared block degrades to the derived
    behaviour, and `services.backend.translation: null` is even
    documented as the supported way to reset it; the test template read
    it unguarded, so the documented configuration crashed the render
    with "nil pointer evaluating interface {}.endpoint" naming the
    TEST POD instead of the values key. The two test templates
    (test-namespace, test-stateless-reachability) normalize their
    blocks now, like every other template. A block that is NOT
    clearable (the service blocks themselves) still fails the render —
    but in the template that actually needs it, not in a test pod.
  - *Two cases added to the render-guards script* (20 now): the
    convergence row with a typo'd key, and a POSITIVE case — a cleared
    translation block must still render, which is the contract the
    second finding broke.
- **Review loop, pass 19 (0.2.91)** — 5 findings, all verified true, all
  fixed. The headline: **the stringification had two layers and the gate
  only tested one of them.**
  - *One env row was outside both layers* — the translation orchestrator
    hand-renders its env block (it does not go through the service
    factory, because the factory prefixes the image with the registry),
    so its `LLM_MODEL_ID` reached the manifest exactly as the operator
    typed it: `--set opea.translation.modelId=3.1` rendered
    `value: 3.1`, a YAML FLOAT, and the API server rejects the whole
    Deployment with "cannot unmarshal number into Go struct field
    EnvVar.value of type string". It is quoted and stringified now —
    the only raw env value left in the chart.
  - *The env-types gate could not fail on that class* — every knob in
    its list fed a row that goes through the factory, whose `envRows`
    normalization stringifies it anyway (the per-row `| toString` is a
    second layer, not the load-bearing one — measured: removing it
    leaves the gate green). The list now names the knobs consumed by
    the rows OUTSIDE the factory, and the docstring says which layer
    the gate actually tests. Mutation-tested: unquoting the
    translation row turns the gate red with the offending row named.
  - *The keycloak membership gate missed chatqna* — it read
    `KEYCLOAK_URL` only, and chatqna's `KEYCLOAK_URL` is the PUBLIC
    issuer while its JWKS fetch goes in-cluster through
    `KEYCLOAK_INTERNAL_URL`. The client list is now derived from the
    URL itself (the in-cluster keycloak Service), not from an env var
    name. Mutation-tested: dropping the chatqna peer from the policy
    now fails with `BLOCKED chatqna -> keycloak :8080`.
  - *The port validation sat at a TLS-gated consumption site* — both
    consumers of `ingressPublicPort` (the https listener and the
    http→https redirect) render only when `ingress.tls.enabled=true`,
    which is OFF by default: in the default topology a malformed port
    reached the issuer, the CORS origin, both CSP connect-src sets and
    the X-Forwarded-Host header with no error anywhere, and a browser
    cannot dial port 443x. The validation moved to `ingressHost`, the
    parse site every consumer reaches (where the IPv6 sibling already
    lived).
  - *Four operator-reachable guards had no case* — the render-guards
    script claimed to exercise the chart's guards, and the external
    GPU mode without a node host (the first error an operator
    following the OPEA quickstart hits), the unknown `opea.gpu.mode`,
    the IPv6-literal GPU node host and the unknown `data.arangodb.mode`
    were not exercised: every CI render that enables the tier passes a
    node host, so a regression inverting or deleting those conditions
    shipped green. Seven cases added (18 now), including the port
    RANGE branch and the namespace / dependency-graph guards. The
    script now names the guards that remain uncovered and why (they
    are unreachable from values: Helm's coalesce keeps the chart's
    table over an operator's scalar, the templates build the env rows
    themselves, and the schema rejects a zero instance count first).
- **Review loop, pass 18 (0.2.90)** — 5 findings, all verified true, all
  fixed, plus the gates that protect pass 17's fixes. The headline:
  **the keycloak NetworkPolicy was invisible to the flow gate.**
  - *The chart renders a policy for the keycloak-operator's pods, and
    the cross-check could not see it* — `component_of()` read
    `genieai.io/component` and the bare `app`, while the keycloak policy
    selects by `app.kubernetes.io/instance: keycloak` +
    `managed-by: keycloak-operator`. The whole ingress list (the
    backend's realm-token validation, the doc-repo's JWKS fetch,
    chatqna, dataprep, the convergence Job) was therefore outside the
    gate: dropping the backend from that list changed nothing the
    script could see. A flow-based gate CANNOT catch that — the peer
    list IS the declaration — so the expectation is now derived from
    the RENDER: every workload carrying a KEYCLOAK_URL that points at
    the in-cluster keycloak Service must be admitted by that policy, on
    the port it dials. The reviewer's own mutation (drop the backend
    peer) now fails with `BLOCKED backend -> keycloak :8080`, and so
    does a port swapped for 9090.
  - *`instances: 0` rendered as 1* — the resolver coerced a zero to
    one, so an operator pinning 0 got a running database they did not
    ask for. The schema now types both counts (`minimum: 1`, with a
    named path) and the resolver fails with the tier's name instead of
    coercing.
  - *A non-numeric port in `ingress.host` rendered `port: 0`* — sprig's
    `int` is lenient ("443x" → 0), and the API server rejects the
    Gateway with "spec.listeners[1].port: Invalid value: 0", naming a
    CR field instead of the values key. The derivation site now
    validates the port (numeric, 1-65535) and fails by name, like its
    IPv6 sibling.
  - *A nil environment value became the text "<nil>"* — the map path
    (the operator's `services.<svc>.env`) stringified it; the list path
    already rejected it. Both now fail with the variable's name.
  - *The model Deployment's comment contradicted its code* — it said
    "Empty = no node constraint" while an empty map renders the
    `gpu=true` default. There is deliberately no "no constraint"
    configuration (the model pods need a GPU), and the comment now
    says so.
  - *Gates around pass 17* — `scripts/instance-count-check.py` renders
    the three configurations the instance precedence must hold (dev,
    prod, prod with an operator override) and fails when one drifts
    (mutation-tested against the old hardcoded behaviour);
    `chart:contract` now asserts the SPA's connect-src starts with the
    backend's derived set (mutation-tested against the old
    single-origin policy); the render-guards script exercises the env
    map/list and nil-value guards; the schema gate rejects a duplicate
    key in `values.schema.json` (`json.load` keeps the last one and
    says nothing).
- **Review loop, pass 17 (0.2.89)** — 13 findings, all verified true, all
  fixed, plus the two brittleness notes the reviewer appended. The
  headline: **every environment value the chart rendered was a string by
  luck, not by construction.**
  - *16 derived env rows rendered raw values* — `v1.EnvVar.value` is
    typed `string`; an operator tuning a numeric knob (`--set
    opea.chatqna.retrieverArangoSearchStart=1`) produced `value: 1`, and
    the API server would reject the whole Deployment with "cannot
    unmarshal number into Go struct field EnvVar.value of type string"
    — minutes after the install, naming a template field rather than
    the values path the operator typed. Every row now stringifies at
    the render boundary.
  - *The factory rendered whatever shape it was handed* — `toYaml
    $svc.env` emitted a YAML MAPPING when a caller skipped the map→list
    conversion, which the API server rejects with a schema error naming
    neither the service nor the key. The new `envRows` helper is the
    boundary: a map env, a row without a name, a row with neither
    value nor valueFrom, and a nil value are all render-time errors.
    Both guards were mutation-tested (each renders red when its defect
    is reintroduced).
  - *A gate for the class* — `scripts/env-types-check.py` renders the
    chart twice (defaults, then the numeric and boolean knobs
    overridden to numbers) and requires every env value to be a
    string. The defaults are strings, so the second render is the one
    that catches it.
  - *The prod profile discarded the operator's instance counts* — the
    Keycloak CR and the CNPG Cluster hardcoded 2 and 3 on prod, so
    `data.keycloak.instances: 5` was ignored with no warning, no
    error, and a green render. The counts now resolve through
    `clusterProfileInstances` (a values map, like
    `clusterProfileReplicas`) with the ORDER INVERTED for the data
    tier: an explicit `data.<tier>.instances` wins over the profile,
    because it is the count the operator sized the database for. The
    chart declares `instances: null` so "unset" stays distinguishable
    from "the operator pinned 1".
  - *The frontend's CSP was stricter than the chart documents* —
    `VUE_APP_CSP_CONNECT_SRC` carried only the public origin, so a
    browser on a non-default port (the laptop port-forward,
    `https://genieai.local:4443`) had its own same-origin /api calls
    blocked: "https://genieai.local" does not match the page origin
    "https://genieai.local:4443", and 'self' is the only source that
    matches whatever origin the page was served from. Both policies
    now derive from ONE helper (`cspConnectSrc`).
  - *An empty env value is dropped by the API server* —
    `DOCLING_ENDPOINT: ""` is `omitempty`, so the row was rendered,
    declared a variable the kubelet never set, and the comment claimed
    it was "always set, like Compose". The row is now rendered only
    when there is a remote docling target, and the comment states
    what the cluster actually does.
  - *The GPU node label was a literal* — the four in-cluster model
    Deployments hardcoded `nodeSelector: gpu: "true"`; a cluster
    labelling its GPU nodes the NVIDIA way would leave them Pending
    with "node(s) didn't match Pod's node affinity/selector" and no
    gate in the repository able to see a scheduling decision. The
    label is now `opea.models.nodeSelector`, declared EMPTY on
    purpose: Helm MERGES values maps, so a chart default of
    `{gpu: "true"}` would survive an overlay declaring
    `{nvidia.com/gpu.present: "true"}` and the pods would need a node
    carrying BOTH labels.
  - *The rest* — the namespace guard no longer accepts
    `namespace: ""` (58 of 74 objects rendered with an empty
    namespace); the Grafana `admin_user` is quoted, as the file's own
    rule demands; the theme-regeneration script fails on a tar error
    instead of writing a valid-but-empty tarball that the documented
    remedy reproduces; the NetworkPolicy cross-check indexes the model
    Services (selector `app:`) so their ports are translated from
    Service space to pod space; the helm-test helper prints `000`, not
    `000000`; the teardown script refuses an unmapped namespace.
  - *The two brittleness notes fixed* — the parity floor was one
    below the count it guards (171 vs 172 compared), so a single
    reclassification was invisible; it is now 172. And `chart:lint`'s
    prod render did not enable the OPEA tier while
    `chart:crd-validate`'s did: two jobs calling their render "the
    prod one" must render the same thing.
- **Review loop, pass 16 (0.2.88)** — 6 findings, all verified true, all
  fixed. The headline is **a regression of pass 15's own fix**, caught by
  measurement rather than by reading:
  - *The pass-15 reachability rewrite inverted the gate* — it counted a
    connect TIMEOUT as FAIL, on the reasoning that a timeout is what a
    NetworkPolicy drop looks like. Measured against a socket that
    accepts and holds (what Redis does): `curl telnet://` exits **28**
    on a perfectly healthy open port, because curl waits for data the
    service never sends — the same code as a dropped SYN. The gate
    would have failed `helm test` on every default install. The TCP
    probes moved to the busybox/nc pod (`nc -z`: 0 on an open port even
    a silent one, non-zero on a closed or dropped one — both measured),
    the curl-based probe is gone, and the pod was renamed
    `-test-tcp-reach` (it now probes clamav AND redis).
    *The lesson is the metric one: the assertion was tightened without
    measuring what a healthy peer returns.*
  - *`partial_admission` was dead code* — a documented helper the
    advisory path had inlined instead. Deleted.
  - *Two texts still promised the jq download* — the site doc's
    air-gapped paragraph and the tools-init docstring. Both corrected
    (jq has no consumer anywhere).
  - *The `check` helper's documented convenience form could never pass*
    — `check <host> <port> <expected>` bound the status to the path and
    the expected value to nothing. Both forms work now.
  - *A YAML null in Compose dict-form environment became the literal
    text "None"* — an unset variable is the empty string. Fixed (both
    forms agree).
- **Review round 9 closed (0.2.67)** — three parallel adversarial passes
  over the whole final diff (core/data/services, edge/observability/OPEA,
  CI/scripts), every finding verified against a render or a live cluster
  before acting, every fix mutation-tested where the fix is an
  assertion. The ones that mattered:
  - *The backend's translation egress gated on the wrong value.* The
    rule watched the raw `services.backend.translation.endpoint` while
    the backend dials the DERIVED endpoint (opea external mode, no
    explicit value) — the mandatory GPU startup probe had no egress to
    answer it and the backend refused to start. CI renders green
    because the crosscheck skips ipBlock rules; nothing installs. The
    rule now gates on the derived endpoint and takes its CIDR and port
    from the URL, through the orchestrators' own helpers — the laptop's
    rule tightened from `0.0.0.0/0` on 443+444 to `/32` on 444,
    re-validated live (GPU health answers through it).
  - *The in-cluster model tier requested one exclusive GPU per pod* —
    four pods on the documented single-GPU node, three of them Pending
    forever. The utilization args (0.55 + 0.30) ARE the sharing
    mechanism; the default now carries no GPU resource.
  - *The NetworkPolicy crosscheck was blind to the model tier* — it
    resolved only `genieai.io/component` peers, and the four model
    policies select by bare `app:`. Fixing THAT exposed a port-space
    bug in the checker itself: ingress rules were translated through
    the SOURCE's Service mapping. Both label classes now
    mutation-proven.
  - *The parity gate could not notice its own allowlist growing*:
    mayDiffer rows counted toward the floor, and a rendered-but-envless
    service was reported "not rendered". Floor re-based to the honest
    count (171), both mutations proven.
  - *The dashboard tier columns named what a dashboard is ABOUT, not
    what its panels query* — a logs-only Grafana rendered two empty
    folders; 28 panel references reached Grafana as a literal `${ds}`
    datasource. Plus the grafana admin user (`__admin__`, no knob),
    the unbound http listener (no redirect, no ACME http-01), the
    doc-repo's bring-your-own-volume mount drop, the mutable-tag pull
    policy, the local-test dependency-update `cd`, the teardown's
    release-name default, and the bootstrap discarding both post-Flux
    signals.
  Refuted with reasoning: the `keycloak-proxy-client-secret` helm-test
  gating (the kcc Job's non-optional secretKeyRef fails the install
  loudly when the Secret is missing; the check covers exactly the
  convergence-off case), and the placeholder-guard single-flag design
  (inherent to CI's no-rows renders; the message says what it accepts).
- **Review round 8 closed (0.2.61–0.2.66)** — the adversarial pass over the
  whole diff, then the re-review of its fixes. What it changed:
  - *The GPU egress named its destination.* The six OPEA NetworkPolicies
    each carried a hand-written `ipBlock 0.0.0.0/0` on 443/444; they now
    derive the CIDR and the port from `opea.gpu.nodeHost` (a literal IPv4
    becomes a `/32`, a hostname resolves through `opea.gpu.allowedCIDRs`).
    `opea.gpu.skipTlsVerify` is also no longer inferred from the URL
    scheme — an operator says it, and the chart's default is `false`.
  - *The operator RBAC stopped over-granting.* The chart's ClusterRole
    handed the arango operator cluster-wide access to core resources
    (secrets, configmaps, serviceaccounts, services, endpoints,
    statefulsets) on top of the six cluster-wide roles the bootstrap
    already ships. Only the `database.arangodb.com` rules need cluster
    scope; the core-resource rules are gone, and ArangoDB was reinstalled
    live to prove the trimmed role still lets the operator reconcile
    (pod Ready, AQL answers).
  - *The dependency graph learned the OPEA tier.* The pre-install
    dependency check evaluated only services and data; an OPEA dependency
    was silently invisible, and the render guard failed only when the
    OPEA tier was on with no graph node at all.
  - *One `services.backend.env`.* The values file declared the backend's
    environment twice, and Helm's map merge let the second win — the
    operator's rows replaced the chart's defaults instead of joining
    them. A render guard now fails on a duplicate key.
  - *Mail stopped being optional.* `verifyEmail` and
    `resetPasswordAllowed` sat at `false` in the chart while Compose
    ships `true`; the chart now matches Compose and refuses to render
    without a mail server. The laptop cluster runs a mail **sink**
    (mailpit, in the deploy overlay) so a validation run never sends real
    mail; a deployment that owns a mailbox names its own relay and keeps
    the same chart defaults. The realm now converges to
    `verifyEmail: true` / `resetPasswordAllowed: true` /
    `registrationAllowed: true`, verified live with a full SMTP
    transaction readable in the sink.
  - *The ArangoDB database is the operator's call.* The chart was
    overriding the database name; the operator decides it.
  - *A `#` inside a folded YAML scalar is not a comment.* Two CI steps
    carried their explanation inside the command's folded scalar, so the
    text reached `helm` as an argument and the job failed on a message
    that read like a chart error. The comments moved above the step.
- Chart `genieai-umbrella` at **0.2.98** on `feat/k8s-migration`; deployed on
  the laptop minikube via Flux from `genie-ai-deploy` (`overlays/jrevillard-laptop/dev`).
- Rebased onto `main` at `179a8a8f1` (the tip that carries !586, !587,
  !588) — the branch is 0 commits behind `main`.
- **Edge tier shipped (0.2.21–0.2.26)**: Envoy Gateway as a chart dependency
  (`envoyGateway.enabled`, default on, disable-able), Gateway API Gateway/
  GatewayClass/HTTPRoute/Certificate/SecurityPolicy templates, **nginx
  REMOVED from the data path** (roundtable decision — Envoy routes
  everything; the compose nginx remains the compose path's aggregator and is
  out of scope for the chart). Port-bearing `ingress.host` (e.g.
  `genieai.local:4443` for a sudo-less laptop browser origin); TLS via
  cert-manager (selfsigned issuer on the laptop); issuer verified coherent
  with the port. Live-validated in a browser.
- **Keycloak theme at runtime (0.2.28)**: stock operator image +
  `files/keycloak-themes.tgz` (reproducible tar of `configs/keycloak/themes`)
  → ConfigMap → `spec.unsupported.podTemplate` initContainer untar →
  `/opt/keycloak/themes/genie`; checksum annotation rolls pods on tarball
  change; CI `chart:lint` guards source↔tarball drift by content hash.
  Zero image builds — same runtime-injection model #998 chose for compose.
- **Realm parity + required deployment data (0.2.29–0.2.32)**:
  registration/verifyEmail/resetPassword default to the compose values;
  `data.keycloak.adminEmail`, `ingress.host` (no more `genieai.local`
  fallback) and `smtp.{from,host,user}` (once smtp is set) are required at
  render time — deployment data no longer ships as chart defaults.
- **Full-stack browser validation + edge fixes (0.2.33–0.2.38)**: login →
  dashboard → FR streamed chat → ingestion → RAG-with-citations all green
  through the edge. Bugs fixed live on the way: https listener port derived
  from `ingress.host` (single source of truth, no duplicate knob, 0.2.35);
  Keycloak backchannel discovery returned portless URLs (Envoy forwards Host
  without the port and `backchannelDynamic` rebuilds token/jwks/userinfo from
  it) — fixed by pinning `X-Forwarded-Host` via HTTPRoute
  RequestHeaderModifier on `/auth/` (0.2.36); SSE chat killed by Envoy's 52 s
  default route timeout — `timeouts.backendRequest: 1h10m` on `/api/`
  (anchored to the backend `CHATQNA_STREAM_TIMEOUT` budget, 0.2.37–0.2.38).
- **Traces tier live (0.2.39–0.2.41)**: VictoriaTraces single-port reality
  (`-httpListenAddr=:10428`, OTLP ingest under `/insert/opentelemetry`) —
  collector exporter endpoint fixed through three iterations. All six
  services now emit spans with attributes into VT (chatqna/retriever/
  reranker RAG chain with traceparent linkage, dataprep ingest taxonomy
  `ingest/chunking/llm.context_batch/llm.context_chunk/llm.label_batch`,
  backend + document-repository Express/auto-instr spans after
  `ENABLE_OBSERVABILITY` reached the two Node services, 0.2.43).
- **Metrics OTLP sink (0.2.42)**: with `observability.metrics.enabled=false`
  the OTLP receiver had no `/v1/metrics` route and every instrumented pod
  retried metric export forever on 404 — a `nop`-exporter pipeline now
  accepts and discards. (Model-client timeout policy itself is overlay-side,
  MR !568.)
- Full validation set green on 0.2.32 (2026-10-18): health via edge, FR
  streamed chat, upload → ClamAV → dataprep ingestion, RAG answer with
  citations from a freshly ingested doc, genie-themed login page. Re-run on
  0.2.43 (2026-10-19) with the observability assertions added (VL enriched
  rows, VT spans per service). Re-run on 0.2.66 (2026-10-22) after the
  review fixes: pre-install dependency check PASS, ArangoDB Ready with the
  trimmed ClusterRole (AQL answers), FR chat streamed with
  `is_grounded: true` citing the ingested file, `clamav.scan.complete` OK
  in 108 ms against the cluster's clamd, realm converged to
  `verifyEmail: true` / `resetPasswordAllowed: true` /
  `registrationAllowed: true` with the mail sink, and a full SMTP
  transaction readable in the sink's API.
- GPU tier is a binary choice: `opea.gpu.mode=external` (remote OpenAI-compatible
  API) or `in-cluster` (model Deployments behind `gpu=true` nodeSelector).
  Laptop runs external; in-cluster is render-validated only (no GPU locally).

## Plan map

The campaign ran as eight written plans plus three design specs. Those were
**working documents** — they described the shape of the work before the work
existed. The durable record is the chart itself, this status map, the design
of record ([`helm-charts-design.md`](helm-charts-design.md)) and the review
ledger ([`plan-defects.md`](plan-defects.md)); the plan set is not committed,
and the rows below name each plan and its outcome.

| Plan | Status |
|---|---|
| 1 — foundation | ✅ shipped |
| 2 — data layer | ✅ shipped (Arango, CNPG, Keycloak CRs live) |
| 3 — service tier (group 5) | ✅ shipped |
| keycloak v2beta1 rework | ↩️ superseded by the convergence plan |
| keycloak config convergence | ✅ shipped (realm converged via kcc job) |
| installable Phase 1 (app contract) | ✅ shipped (chart 0.1.30 Ready; secrets surface, per-image securityContext, nginx `/auth/`, issuer pin, migrations job, dev-secrets) |
| 5 — AI/ML tier | ↩️ superseded by the OPEA-tier plan |
| OPEA tier (Phase 3) | ✅ shipped (six orchestrators, four in-cluster model templates, NetworkPolicies, endpoint helpers; final review pass integrated at 0.1.61) |
| deploy repo | ✅ shipped (`genie-ai-deploy`, Flux, per-laptop overlay) |
| 7 — CI | 🟡 mostly (`chart:lint` + `chart:contract` green on every push — contract runs the PII smoke on the chart-rendered collector config; `chart:install` exists but is **manual-only** — a full install with prereqs takes ~30 min on the runner's kind, same posture as the compose E2E suite; residual: `ct` full suite, kind+Calico NetworkPolicy gate) |
| 8 — docs | 🟡 partial (`charts/README.md`; per-env overlay docs not written) |
| 4 — observability | ✅ shipped (charts 0.2.0–0.2.20: VLSingle baseline + collector gateway + filelog agent + Grafana CRs + VMServiceScrapes; live-validated on the laptop — admin logs 200, PII smoke green on the chart-rendered config; 0.2.20 scopes the filelog agent to the stack namespaces after foreign-ns zap-JSON rows broke the admin TYPE column; metrics/traces/grafana opt-in flags are render-validated only) |
| 6 — per-env ingress | ✅ Phase 2 shipped as charts 0.2.21–0.2.26 (Envoy Gateway dependency, Gateway API templates, nginx removed from the data path, port-bearing host, TLS); per-env overlay knobs are the `ingress.*` values consumed by the laptop overlay |

## Supersessions (why two plans were replaced)

- **keycloak-v2beta1 rework → convergence (2026-10-13):** the rework planned a
  client-CR-based GitOps surface (`KeycloakOIDCClient` × N). Research showed
  realm-level settings still needed an imperative pass; the convergence plan
  ships a post-install kcc job that pins the issuer/origin/policies and
  leaves clients to the realm import. Simpler, validated live.
- **ai-ml → OPEA tier (2026-10-15):** the original plan modeled the AI tier as
  chart-internal `ai.*` services. The shipped design keeps the compose
  topology (six OPEA orchestrators) with the GPU backend as a binary external/
  in-cluster choice — one template set, two endpoint worlds.

## Remaining phases

1. **Merge `feat/k8s-migration` → main** (MR !520 open, Draft; the
   description is being reworked to cover the whole branch rather than its
   first week). The application fixes the validation work surfaced are
   already on `main` (!586, !587, !588), so nothing has to be un-pinned
   from the laptop overlay at merge time.
2. **Final whole-MR review** — ✅ round 9 (above): three parallel
   adversarial passes over the whole final diff, findings verified and
   fixed, refutations reasoned. Post-merge, the standing backlog is the
   residual list below, not the diff.
3. **Documentation pass** (in progress 2026-10-22):
   - ✅ `site/content/en/docs/deploy/kubernetes.md` exists; its Access and
     Configuration sections describe the edge (Envoy) path, and the
     exposure-scenario section is in.
   - ✅ Root `CLAUDE.md` + `.claude/rules/K8s-WORKFLOW.md` — the
     port-forward, image count and validation-set bits are current, and
     the chart-version rule explains that the version is the artifact
     identity Flux reconciles on (a content change under an unchanged
     version is reported "in-sync" and never installed).
   - ✅ `charts/README.md` + `charts/genieai-umbrella/README.md` — refreshed
     against 0.2.66 (ingress/envoyGateway/theme values, namespace
     ownership, the four real CI gates, `ct lint`/`ct install` named as
     the gap).
   - ✅ The agent working documents under `docs/superpowers/` are gone; the
     design of record moved to `docs/charts/helm-charts-design.md` and
     every citation was repointed.
   - ✅ The genie-ai-deploy README carries the overlay/SealedSecret model,
     the two laptop overlays and the mail sink.
4. **CI gap (plan 7 residual)** — ✅ `chart:contract` shipped (renders with
   overlay-shaped values, runs `PII_SMOKE_CONFIG=<rendered>
   tests/otel-collector/run-pii-smoke.sh`, asserts operator Service names);
   `chart:install` settled as **manual-only** (full install ≈ 30 min on the
   runner's kind — not tenable per push; same posture as the compose E2E
   suite). The deploy repo's own CI now renders the laptop overlay
   (`dry-run:jrevillard-laptop/dev`) instead of only parsing the Flux
   CRs. Residual: `ct lint`/`ct install` full suite, kind+Calico
   NetworkPolicy install gate, dashboards for chart test results.

Observability residuals (tier ✅ shipped 2026-10-15): whole-tier adversarial
review pending; ✅ VT OTLP ingest verified live (0.2.41, traces tier on on
the laptop); `${p}`/`${s}` OTTL capture-group refs are eaten by confmap in
collector 0.152 (replacement drops boundary chars) — same latent behavior in
the compose config, kept verbatim; backlog.

## Parked / backlog

- **arango-operator ClusterRole over-grant (2026-10-19 review)**: ✅ closed
  in 0.2.65 — the core-resource rules are gone, only the
  `database.arangodb.com` rules kept cluster scope, and ArangoDB was
  reinstalled live to prove the operator still reconciles with the
  trimmed role.
- **chatqna event-loop blocking (2026-10-25 live validation)**: the
  uvicorn event loop is blocked for the whole duration of a query
  (retrieval → rerank → LLM, 60-90 s on the shared GPU) — `/health`
  stops answering, which is why the HTTP liveness probe killed the pod
  mid-stream (0.2.70 moved the liveness to an exec probe as the chart
  stopgap). The app-side fix (MR to `main`): serve `/health` from the
  threadpool so it answers while the loop is busy — it restores both
  the availability during queries AND a hang bound the exec probe
  cannot provide (a python-level deadlock with a live bash never
  restarts today). Related: the ArangoDB database loss observed the
  same day (datadir empty after a minikube restart, migrations
  re-applied manually) — cause unexplained, watch for a repeat.
- **The flow gate cannot see the egress side of an ipBlock rule**
  (2026-10-28 review, pass 18): the cross-check declares a flow from
  the SOURCE's egress naming a peer, so a rule with an `ipBlock` peer
  (the chart's deliberate compromise for the operator-managed
  destinations: arangodb, keycloak, the collector, VictoriaLogs)
  declares nothing — and a port dropped from that rule's port list
  (the backend's egress losing 6379 would strand the translation
  cache) changes nothing the gate can see. Measured on the current
  renders: every in-cluster dial the workloads make IS covered by the
  egress port lists, so there is no live defect — only the blind spot.
  Closing it needs an expectation derived from the render (which
  workload dials which in-cluster Service on which port) translated
  into POD space, and the chart's Services use a NAMED targetPort
  (`targetPort: http`), so the translation has to resolve the named
  container port through the Deployment — a real piece of work, not a
  one-liner.
- **RWO PVC + replicas>1**: `clusterProfileReplicas.prod` runs
  documentRepository ×2 against one ReadWriteOnce PVC with no node
  pinning — multi-attach risk on multi-node prod (single-node minikube
  masks it). Same shape: redis-cache + clamav cache PVCs. Needs either
  ReadWriteMany storage, a Read-only replica pattern, or anti-affinity
  + single-writer documentation.
- OPEA images hardcode tag `main` in templates → lift to values when
  branch-tagged images are needed (laptop uses registry `main` today).
- Translation orchestrator image `docker.io/opea/translation:1.3` hardcoded;
  document or expose as a value.
- `otlpEndpoint` helper assumes the OTel-operator `<cr>-collector` Service
  naming; sites without the operator need a `collectorService` override.
- GPU egress NetworkPolicies use broad `ipBlock 0.0.0.0/0` on 443/444: ✅
  closed in 0.2.65 — the destination is derived from `opea.gpu.nodeHost`
  (literal IPv4 → `/32`, hostname → `opea.gpu.allowedCIDRs`) and the port
  from the URL.
- SealedSecrets consolidation in the deploy repo (nine single-key secrets →
  one); dead `secrets.sops.yaml` template cleanup; arango RBAC leftovers in
  `namespace.yaml` (the ClusterRole trim landed in 0.2.65; the rest of the
  file is untouched).
- In-cluster `docling` endpoint resolves to a Service the chart does not
  render (no docling model template); in-cluster mode needs either the
  Deployment or a fail-fast guard.
- Issue #1064 (compose-side ClamAV dual-mode + env mismatch) — the k8s side
  is fixed here; the image/compose side stays open upstream of this branch.
- filelog agent has no `file_storage` extension: every restart with
  `start_at: end` drops the logs emitted during the restart window (no
  duplicates possible; scoping `include` in 0.2.20 did not change this).
  Add `file_storage` + wire it into the receiver if that gap ever matters
  operationally.
- **The Grafana and metrics tiers had never been turned on** — both are
  chart-default off, so their CRs were only ever validated against the
  schema gate. Turning them on exposed four defects that no static gate
  could see, all now fixed: `GrafanaDashboard.spec.resyncInterval` (the
  field is `resyncPeriod`); the `/grafana` backendRef naming the CR
  instead of the `<cr-name>-service` the operator creates; the collector
  image carrying no prometheus exporter at all (the `k8s` distribution),
  which crash-looped the collector and took logs and traces down with it;
  and the collector's egress to VMSingle written against the Service
  port 8428 while the pod listens on 8429, so every remote-write batch
  timed out. The laptop overlay now runs all three tiers.
- **No application service exposes a Prometheus `/metrics` endpoint** —
  measured on all eleven (backend, doc-repo, frontend, redis, the six
  OPEA orchestrators, and the storage CRs). They export over OTLP, so
  the chart's VMServiceScrape CRs are inert; they are kept with that
  written down. Two silent vm-operator gates apply if they are ever
  revived: `VMSingle.spec.ingestOnlyMode` defaults to true (nil
  deref) and skips the whole scrape-config builder, and pairing a
  VMServiceScrape with a VMSingle needs
  `VMSingle.spec.serviceScrapeSelector` — a selector on the scrape
  object's OWN labels, not on its target Service.
- Dataprep vendored `llm_transformer` (sync langchain in `to_thread`) has no
  effective request timeout; long ingestions can pin threads on a stalled
  upstream (observed once against the shared GPU node; pod restart recovered).
- **Five deeper fixes the review passes named and this branch did not take**
  (each is a refactor, not a defect; each would remove a heuristic the gates
  currently carry):
  - *Route the hand-rendered env blocks through the factory's emitter*
    (`genieai-umbrella.envRows`). About forty rows hand-render their value
    today, each carrying its own `| quote`; the env-types gate then needs a
    Python-side Go-template parser to police them, plus a hand-synced
    `TYPE_OVERRIDES` list. Emitting them through the shared boundary makes
    "every env value is a string" structural and deletes both.
  - *Index the NetworkPolicies by the pods their selector matches* (the render
    carries every workload's labels). The peer-reachability check then needs
    no namespace-wide special case, and a policy selecting pods by a label
    shape the component index does not know stops reading as "unrestricted".
  - *Own the dropped-row ownership by component identity* (the values-key to
    component map `config-parity-check.py` already carries) instead of by
    substring matching a path segment against a workload name.
  - *One table of GPU targets* (key, in-cluster service and port, default
    external path, required?) from which the helper's branches, the values
    defaults, the failure message and the parity entry all derive. The
    docling exception is a fact about the deployment topology, and it is
    currently written out in five places.
  - *A shared `scripts/chartci.py`* for the gate scripts: the fixture reader,
    the `helm template` wrapper, the workload-kind list and the YAML loader
    are written four times over, with three different return shapes.
