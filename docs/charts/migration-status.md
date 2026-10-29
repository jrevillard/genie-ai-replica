# Helm Migration — Status

Single-page map of the migration effort: which plans shipped, which were
superseded, what remains. Companion to `plan-defects.md` (review ledger) and
the design of record ([`helm-charts-design.md`](helm-charts-design.md)).
Plan checkboxes are not a status source — evidence is the chart, the deploy
repo, the cluster, and the SDD ledgers under `.superpowers/sdd/`.

## Current state (2026-10-29)

- **Chart `genieai-umbrella` at 0.2.130**, branch `feat/k8s-migration`
  **rebased onto `origin/main` (2026-10-29, 511 commits replayed clean,
  the vendored `charts/*.tgz` regenerated away before the replay)**. CI
  green on the rebased tip (pipeline 14913). The MR !520 stays Draft.
- **The dev node was rebuilt at 12288 after the 8 GiB profile died of
  its own memory budget (0.2.130, 2026-10-29)**. A rolling upgrade (old
  and new ReplicaSet resident at once) plus a parallel image build
  pushed the minikube container into the **docker** OOM killer — the
  apiserver died mid-deploy. Recreating the container (minikube's
  resize path) loses `/etc/kubernetes`: static pod manifests live in
  the container layer while etcd, the PKI and the PVC data live in the
  docker volume — the cluster cannot be revived in place. All 28
  non-regenerable Secrets (the sealed-secrets key with its
  `sealedsecrets.bitnami.com/sealed-secrets-key=active` label, the
  flux-git-auth PAT, the whole `genieai/` set) were decoded out of the
  surviving etcd — k8s storage protobuf (`k8s\x00` magic + Unknown
  wrapper + core/v1.Secret wire format), read with a scratch `etcd`
  started inside the dead node's container from the node's own etcd
  binary — and the bootstrap script rebuilt the cluster end to end from
  them. Fixes folded in: the script's `MEMORY` 10240→12288 (the profile
  records it; later `minikube start` keeps it — a `--memory` flag on an
  existing profile is ignored), and the runbook's memory section
  rewritten: the Xenova CPU-fallback story no longer applies to the
  laptop overlay (a named translation endpoint is mandatory since
  main's !578/!584 — the backend refuses to start rather than fall
  back), so the node died of upgrade concurrency, not of a translation
  fallback. The `--capture` mode of the bootstrap script is now the
  documented pre-`delete` gate; the etcd protobuf pull is the emergency
  path, not the plan.
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
    quoted in the READMEs was stale (now a pointer to Chart.yaml — the
    number the deploy repo names, and it drifted on every bump).
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
- **The wall passed; the next hook broke (0.2.128)** — the 0.2.127
  upgrade created release v12 and applied every workload (the 1 MiB fix
  verified live), then failed on a SECOND chart bug the first live run
  in 93 versions exposed: the db-migrations hook's wait-for-arango
  probe curls `/_api/version` anonymously and `curl -sf` fails on the
  401 an auth-enabled ArangoDB answers — the probe can never see the
  200 it waits for, so every upgrade attempt died in Init:Error. The
  manual migration job (3 days old, Completed) proves the migrations
  themselves work. Fixed at the source: the init container carries the
  same arango-root-secret credentials the migration run uses and the
  probe curls with `-u` (live-verified from inside the stuck pod:
  anonymous 401, authed 200). No other anonymous probes exist.
- **The 1 MiB wall and the genieai-assets cargo chart (0.2.127)** — the
  first live-validation attempt on minikube (restarted for the operator's
  sequence) failed the upgrade with `Secret "sh.helm.release.v1.genieai.v12"
  is invalid: data: Too long: may not be more than 1048576 bytes`, and the
  investigation that followed rewrote three wrong models before landing:
  - *Wrong model 1 — "the release Secret stores the chart archive"*: the
    real v11 payload (read from the cluster) stores NO chart archive and
    NO dependencies at all — helm-controller persists the PARENT chart's
    files + templates, the rendered manifest, and the hooks. The gateway-
    helm vendored CRDs, first blamed, never ride.
  - *Wrong model 2 — "the dashboards grew"*: their stored bytes are
    identical between v11 and HEAD. Nothing moved but two things.
  - *The actual delta*: the theme tarball (stale 122 KB copy in v11,
    re-synced to 384 KB by 0.2.71) now rides TWICE — once as `chart.files`
    and once as the rendered ConfigMap — ~700 K chars, ~+525 KB stored;
    everything else in the manifest grew by 4 K chars. The re-sync that
    fixed the stale-copy defect is what breached the wall: fixing one
    defect surfaced the next.
  - *The fix the operator approved*: `charts/genieai-assets`, a cargo
    dependency (files only, zero templates, zero values) holding the
    theme tarball, the realm, the dashboards and the alerting. The
    umbrella reads them through `.Subcharts.genieai-assets.Files` (via
    `index` — hyphenated names cannot be field-accessed). Dependency
    content is not persisted, so the assets ride ONCE (the render) while
    their source bytes sit outside the snapshot. The render is
    byte-identical to 0.2.126 (verified by `cmp`); the predicted snapshot
    is 837 KB against the 1 MiB cap (v11 was 820 KB). The drift guards
    and sync targets (sync-chart-dashboards.sh, regen-keycloak-theme.sh,
    the CI realm/theme checks, the K8s-WORKFLOW copies table) now point
    at the assets chart, with an explicit do-not-move-back warning.
  - *Not done, deliberately*: moving Envoy Gateway to the bootstrap (the
    first fix proposed, withdrawn — the vendored CRDs never ride the
    snapshot; its cost there is ~40 KB of rendered objects), splitting
    the umbrella into per-tier charts (real architecture evolution,
    recorded with tripwires: independent release cadence, separate team
    ownership, or the wall returning), and slimming the brand images
    (both logo formats are needed).
- **Deferred items resolved on the operator's ruling (0.2.126)** — the
  review loop closed at run 33 (0 findings); the user ruled on each
  deferred item afterwards:
  - *The deploy repo's `<pays>` vocabulary is gone* — 72 sites across
    14 files (README, .sops.yaml, CI comments, sops script help, both
    overlays, the flux-system kustomizations), every one a comment, a
    README line, or a documented-recipe placeholder; zero functional
    code carried the word (verified per file before renaming). Zero
    residual; all touched YAML re-parsed; all touched shell re-checked
    with `bash -n`. MR !2 (genie-ai-deploy), merged after its pipeline
    went green.
  - *The compose redis healthcheck asserts PONG now* (MR !624, target
    main) — the same bare `redis-cli ping` the chart fixed in pass 15,
    same defect class: with `--appendonly yes` a restart answers
    "-LOADING ..." while the AOF loads and redis-cli exits 0 — docker
    declares the cache healthy while it rejects every GET.
    Mutation-tested against a live redis: the bare probe on a
    requirepass server prints "NOAUTH ..." and exits 0 (healthy — the
    bug); the reply assert exits 1; the authed green path exits 0 on
    PONG.
  - *The chart's `global` values block is CLOSED and fully typed*
    (0.2.126): the four untyped keys (imageRegistry, imagePullSecrets,
    toolingImageRegistry, imagePullPolicy) joined the schema and
    `additionalProperties: false` rejects unknown keys NAMING them —
    the pre-closure behavior accepted a typo'd key as nil, and a
    typo'd `imagePullSecret` (13 read sites) silently dropped every
    pull credential for a fleet-wide ImagePullBackOff discovered in
    the cluster, not at render. gateway-helm (the one subchart the
    block coalesces into) ships no schema and reads no global.* key —
    verified in the vendored tgz before closing. Four new render
    guards (typo rejected naming the key, scalar row rejected naming
    the path, out-of-enum policy rejected, all six keys rendering
    together); the closure itself mutation-proven — schema reopened,
    the typo renders (rc=0); restored, rejected naming the key.
    Honest accounting: two of those guards first FAILED on CI after
    passing locally — their needles quoted my helm v4.3.0's schema-
    error phrasing while CI's helm-kubectl:3.16.0 words the same
    rejection differently, and the guards file's own convention (pin
    the key name, never the wording) applied to its own new cases.
    First CI failure of the whole review loop, and it was the local/
    CI helm version skew, not the chart.
  - *The two declined tripwires stay declined, now against the
    operator's simplicity bar*: the securityContext helper (4 blocks
    share ~3 lines and differ everywhere else — a parameter list as
    long as the YAML it replaces) and a requiredSecrets list (a
    render-time check cannot know which Secrets exist — SealedSecrets
    materialize post-install — and the missing-Secret failure already
    names the Secret exactly at pod start). The doc-linter tripwire:
    declined by the operator.
- **Review loop, pass 55 (0.2.125)** — the thirty-third `/code-review`
  found 0 findings on the run-32 delta (the split guard verified by
  branch matrix: each get×python3 outcome produces its own message,
  TMP cleaned on every failure path). Its one out-of-scope note was
  adopted: `python3` joined the script's tool check — both the capture
  tls-check and the restore's apply_clean require it, and a machine
  without it got a misleading "hollow key" diagnosis instead of the
  missing-tool error. The review loop's exit condition is met.
- **Review loop, pass 54 (0.2.125)** — 1 finding from the thirty-second
  `/code-review` (which verified all ten run-31 fixes closed): the
  compound `kubectl get && python3` guard collapsed a transient GET
  failure and a hollow key into one message asserting the specific
  cause "carries no tls.key/tls.crt data" — a cause the branch never
  established. Split into sequential guards, each naming its actual
  failure. No chart content changed (no version bump).
- **Review loop, pass 53 (0.2.125)** — 10 findings from the thirty-first
  `/code-review`, all on the run-30 surfaces (the capture mode, this
  ledger, .gitignore). No chart content changed (no version bump). All
  ten verified true and fixed (grouped below where one fix closes
  several) — the capture mode's fail-loudly contract had covered one of
  its three artifacts:
  - *A missing flux-git-auth or issuer WARN-skipped and exited 0* — the
    PAT is unrecoverable once the cluster is deleted; a green exit over
    its absence is the exact silent-path class the mode was built to
    close, one artifact over. And the die on the key fired FIRST, so
    the anomalous-key scenario also lost the PAT: the capture now
    attempts ALL three artifacts even when one is missing, collects
    the failures, and dies at the END naming them.
  - *The die on a failed key query was unreachable* — under `set -e`,
    `VAR=$(kubectl …)` exits inside the assignment, so the crafted
    "is the controller running" message never printed for exactly the
    scenarios it named (the run-30 commit's "verified live" claim
    described the kubectl raw-error path). Queries moved into
    `if VAR=$(…)` conditionals, where failure is catchable.
  - *A failed capture left zero-byte files behind* — the shell
    truncates the redirect target before kubectl runs, so the restore
    path's `[ -f ]` guards passed and `apply_clean` died in
    `json.loads('')` mid-bootstrap. Every artifact is written to a
    temp name and moved into place only on success.
  - *The active key was `.items[0]` with no count or content check* —
    two labeled-active keys (the restore loop labels every
    sealed-secrets-key* Secret active) made the capture an
    alphabetically-first guess, and a labeled-but-hollow Secret
    captured green and restored into the keyless catastrophe. The
    capture now requires EXACTLY one key and verifies tls.key/tls.crt
    are present.
  - *The captured PRIVATE key and PAT were written world-readable* —
    umask-default 0644 on the artifact whose whole point is being
    secret. The capture dir is chmod 700 and the files are written
    under umask 077.
  - *.gitignore covered the key's filename but not the PAT's* —
    `--capture .` left flux-git-auth.json untracked-and-unignored, one
    `git add -A` from publishing the GitLab PAT. Covered now.
  - *A bare `--capture` died with bash's `$2: unbound variable`* —
    every value-taking flag now carries `${2:?…}` with a message
    naming the flag and what it expects.
  - *This ledger carried a truncated duplicate pass-51 heading* — an
    inserted fragment ("… — 7 findings from the twenty-seventh",
    never completed) split the pass-52 entry's bullet list in two,
    leaving two consecutive pass-51 headings. Deleted; pass-52's
    bullets read continuously again.
- **Review loop, pass 52 (0.2.125)** — 13 findings across runs 28 and 29
  of the `/code-review`, across four surfaces: the bootstrap runbook,
  the bootstrap script, deploy/environments/README.md and this ledger.
  No chart content changed (no version bump).
  - *The deepest one is functional, and it was mine*: run 29's
    capture-by-label emitted a SecretList the restore's `apply_clean`
    cannot clean per item — the kept `resourceVersion` is rejected on
    the apply-create, AFTER the script has deleted the generated keys:
    the keyless-cluster catastrophe, one pass after claiming to have
    closed it. The whole capture/restore contract now lives in ONE
    place: the script grew a `--capture <dir>` mode that writes exactly
    the files the restore consumes (ACTIVE key as a single-Secret
    document — the shape apply_clean cleans), fails loudly when the
    active key is missing, and the runbook's step 1 is its invocation.
    The capture writes to ~/.genieai-sealed-secrets (the cluster's
    PRIVATE key was previously redirected into whatever directory the
    operator sat in — one git add -A from being published; .gitignore
    now also covers the filename).
  - *The rotation caveat moved BEFORE the delete* — "must be re-sealed"
    is impossible after `minikube delete` (kubeseal --re-encrypt needs
    a controller holding both keys); the runbook now commands the
    re-seal at step 1, and the self-contradicting sealed-with sentences
    are gone.
  - *The run-27 commit title said "the 6 findings" while its report
    carried 7* (5 fixed + 1 deferred + 1 refuted) — the ledger's
    corrected count (7) is the true one; the pushed commit title
    undercounts and cannot be rewritten without a force-push.
  - *The run-27 fix shipped uncommitted* — the `git add` named
    `migration-status.md` and missed the sibling file the same edit
    touched (`docs/charts/laptop-cluster-bootstrap.md`), so origin
    carried a ledger asserting work its tree did not contain.
    Committed.
  - *The runbook's capture command used the positional
    `sealed-secrets-key*` selector the script's own comment documents
    as never matching* — following the doc produced an empty key file
    and ended in the keyless-cluster catastrophe the doc exists to
    prevent. It captures by the ACTIVE label now.
  - *The capture loop numbered files the restore step never named* —
    step 1 wrote `sealed-secrets-key-N.json`, step 2 still passed
    `key.json`; and counter-naming destroyed the mapping to the actual
    secret identities. Both steps now share one name,
    `sealed-secrets-key-active.json` (the script's help example
    aligned), and the doc states the archive-only status of non-active
    keys (the restore cannot revive a rotated-out key; such
    SealedSecrets need re-sealing).
  - *The SOPS row referenced the recovery script without its repo
    prefix* — `scripts/sops-install-cluster-secret.sh` exists only in
    genie-ai-deploy. Prefixed like its sibling cell.
  - *Three `<pays>` sites survived pass 51's sweep in
    deploy/environments/README.md* — the file the aligned
    charts/README.md bullet points at; the third consecutive
    stopped-short event (grep scope, one directory, the referenced
    file). Aligned.
  - *The bootstrap script's `--env` flag was parsed and never read* —
    the deployed overlay env is decided by the deploy repo's
    clusters/<overlay>/flux-system kustomization, so `--env prod`
    silently bootstrapped dev. The dead flag is removed.
  - *Ledger hygiene* — pass 51's dispositions summed to 8 for 7
    findings and carried a phantom site-grammar bullet; its
    deploy-repo-deferral correction promised a pass-52 finding no entry
    carried; its run-25 verdict phrase ("the run-25 fix itself verified
    true") said the opposite of its own first bullet. All three fixed,
    and this entry records what run 28 actually fixed.
- **Review loop, pass 51 (0.2.125)** — 7 findings from the twenty-seventh
  `/code-review`: five fixed, one deferred to the operator (the deploy
  repo's `<pays>` vocabulary — recorded in the pass-50 entry's
  correction below), and one refuted. (Correction, pass 52: the
  original entry said "six fixed, one refuted, one deferred" — eight
  dispositions for seven findings — and carried a phantom site-grammar
  bullet for a fix that landed in pass 50; both dropped here.)
  - *The `<pays>` grep was run over charts/genieai-umbrella/ only* —
    six live sites survived it: charts/README.md, the site doc's
    "per-pays overrides" (twice), the bootstrap doc's "pays that use
    SOPS"/"a future pays", and the bootstrap script's `--pays` flag /
    `$PAYS` variable. All aligned on the cluster vocabulary now. The
    script rename is the one functional change: `--pays` → `--overlay`,
    `$PAYS` → `$OVERLAY` — named for what the value selects (the deploy
    repo's overlay directory), NOT `--cluster`, which the script
    already takes for the minikube profile (the first rename attempt
    created a second `CLUSTER=` assignment that clobbered the profile —
    caught before any push by re-reading the parser). (A seventh site —
    deploy/environments/README.md, the file the aligned charts/README.md
    bullet points at — survived even this sweep; pass 52.)
  - *The Nexus parenthetical moved to the wrong cell in the pass-50
    enumeration* — it annotated scheme+port+prefix; the actual Nexus
    pin is scheme+prefix without port. Back on its cell.
  - *Chart.yaml's description dropped the load-bearing "typically"* —
    "consumed via Flux" asserted the sole delivery path while the repo
    ships an ArgoCD example and documents direct installs. Restored.
  - *Two cosmetic residues* — the site doc's own rewrap widow ("the")
    and the pass-50 ledger entry citing a line number that drifted the
    moment it was written (the citation is dropped; the prose locates
    the fix).
  - *Refutation withdrawn (pass 52): the quoted sentence IS ledger
    text* — "the run-25 fix itself verified true" sat in the pass-50
    entry's own intro (it summarized the run-26 reviewer's verdict on
    the 0.2.124 delta, not on run 25's fix, which is exactly what the
    entry's first bullet records as misapplied). The intro is reworded;
    the refutation's "the ledger carries no such sentence" was checked
    against the wrong string.
- **Review loop, pass 50 (0.2.124)** — 6 findings from the twenty-sixth
  `/code-review`, all comment/enum residue (the reviewer's own verdict
  covered the whole 0.2.124 delta; run 25's subject-verb fix itself had
  landed on the wrong comment, as this entry's first bullet records).
  - *The subject-verb fix was applied to the wrong comment* — the
    already-grammatical top-of-spec comment was reworded while the
    actual "are discoverable" slip survived one paragraph below. The
    slip is fixed, and the widow line beside it rewrapped.
  - *The pin-inventory enumeration omitted scheme-less port+prefix and
    padded the count with the uppercase-scheme variant* — a case
    variant of one cell, not a cross-product cell. The enumeration
    names all eight cells now.
  - *Chart.yaml's own comment read "the two version on independent
    axes"* — plural fixed; and its description carried the French
    placeholder `overlays/<pays>/<env>/` (a Language-Policy violation
    describing a layout that does not exist) — rewritten in English
    with the real `overlays/<cluster>/<env>/` shape. The same French
    placeholder survived in examples/argocd-application.yaml — found by
    grepping the class, not by the review. (Correction, pass 51: the
    grep was run over charts/genieai-umbrella/ only; six live sites in
    charts/README.md, the site doc, the bootstrap doc and the bootstrap
    script survived it, and the deploy repo carries its own
    `<pays>` vocabulary — a naming decision deferred to the operator,
    since "pays" was the historical term for the country deployments
    the repo grew around.)
  - *The site doc's grammar shorthand lagged on the prefix shape* —
    `[/prefix]` against the other three surfaces'
    `[/multi/segment/prefix]`. Aligned.
  - *A missing blank line between two pin blocks* — the file's uniform
    separation restored.
- **Review loop, pass 49 (0.2.123)** — 6 findings from the twenty-fifth
  `/code-review`: five fixed, one declined as machinery (tripwire
  recorded).
  - *The cross-product pin claim was 2 shapes short* — scheme-less
    port+prefix and scheme+port+prefix (the realistic
    Nexus-with-port topology) had no pin while the comment claimed the
    full cross product. Both pinned verbatim; the comment now
    enumerates all eight combinations and the claim is true.
  - *The site doc still over-stated the download set* — "its helm-test
    Pods" named all five; only test-namespace and test-data-deps
    download. It names the two now.
  - *The schema description's grammar shorthand lacked the port bound*
    — the fourth grammar mention the run-24 sweep missed (drift beside
    the prose that states it). Aligned.
  - *A subject-verb slip one paragraph below the freshly corrected
    comment* — "kubectl … are discoverable" → singular.
  - *A one-word widow line in the rewritten values comment* — rewrapped.
  - *Declined: a doc-lint deriving the four grammar mentions from the
    schema* — the class (four prose surfaces hand-synced with the
    regex) is real and has cost two runs, but a prose-derivation linter
    is machinery the branch's KISS rule keeps as a ledger item; the
    tripwire is the next grammar refinement costing more than one
    pass.
- **Review loop, pass 48 (0.2.122)** — 4 findings from the
  twenty-fourth `/code-review`, all residue of the classes this ledger
  already tracks.
  - *The "binaries" plural survived in three more spots* — the tools
    paragraph's first half, the hook template's comment, and a
    "ships those binaries preinstalled". Singular/kubectl-only now,
    matching the sibling sentences the pass-46 fix aligned.
  - *"Hook + test-pod init containers" named the pre-install Job
    implicitly* — the chart has TWO hook Jobs and one of them
    (dependency-check) downloads nothing; an air-gap operator auditing
    values.yaml or charts/README.md would over-open the firewall for a
    download the pre-install never performs. Both surfaces name the
    real consumers (the phrase the site doc already carried).
  - *The 1-65535 port bound existed only in the schema description* —
    the three grammar mentions (values.yaml, chart README, site doc)
    enumerated the sibling constraints but not the numeric bound. All
    three carry `[:port 1-65535]` now.
  - *The delivery pins covered 5 of the documented cross-product* —
    scheme-less+port and bare-host had no pin. Both pinned verbatim;
    the mutation proof for the class was re-run on the default
    (mangling `dl.k8s.io` turns the default pin red).
- **Review loop, pass 47 (0.2.121)** — 4 findings from the twenty-third
  `/code-review`, all documentary or validation-boundary tail (no
  functional defects — the reviewer's own verdict).
  - *The mirror's port clause admitted out-of-range ports* —
    `:99999` and leading-zero `:08443` passed the render and failed at
    pod runtime, inverting the chart's guard philosophy for its own
    key. The clause bounds to 1-65535 (the classic regex decomposition,
    leading zeros rejected); a guard fires on a transposed-digit
    `:84430` (mutation-tested: reverting to unbounded digits turns it
    red).
  - *The published docs named the wrong pods* —
    site/.../kubernetes.md said the "pre-install and helm-test Pods"
    curl-download kubectl; the pre-install Job runs python with no init
    container. It names the real consumers now (the pre-upgrade
    cluster-profile hook and the two helm-test pods) — the sixth
    documentary surface of the mirror contract.
  - *The umbrella README's air-gapped section missed the
    no-trailing-slash rejection 0.2.120 introduced* and still said
    "binaries" plural (jq is long gone). Both fixed — an operator
    upgrading with a pre-existing trailing-slash mirror now has a
    published statement of the constraint.
  - *The delivery-pins comment enumerated 4 of the 5 pinned shapes* —
    the scheme-ful host:port case was missing, the same incompleteness
    class the enumeration was written to remove. All five named.
- **Review loop, pass 46 (0.2.120)** — 4 findings from the twenty-second
  `/code-review`, the mirror contract's documentary and coverage tail.
  - *The delivery pin covered one of the two motivating shapes* — the
    scheme-ful Nexus topology (`https://nexus.internal/repository/k8s-
    releases`) that motivated pass 45's multi-segment fix had no
    contains-case; the scheme-less one was pinned. Both are now, and
    the "covers every documented shape" comment enumerates what is
    pinned instead of claiming an exhaustiveness it did not have.
  - *The fifth documentary surface still said "kubectl and jq"* —
    charts/README.md (the pass-45 fix caught the umbrella README and
    values.yaml, not this sibling). It says kubectl only now.
  - *values.yaml's own comment lagged two revisions behind* — still
    `[/prefix]` (single-segment reading) and a hardcoded
    `/linux/amd64/` path (the real path is `<arch>`, detected at
    runtime or forced by `global.toolingArch` — the arm64 minikube
    this chart explicitly supports would 404 against the documented
    mirror). Both aligned.
  - *The pattern's trailing `/?` admitted the double-slash trap* — a
    trailing slash in the mirror renders into
    `.../k8s-releases//release/...`, which Nexus/Artifactory and strict
    routers 404 after three retries and an aborted helm upgrade. The
    trailing slash is rejected at render now; a guard case fires on
    it (mutation-tested: restoring the `/?` turns the case red).
- **Review loop, pass 45 (0.2.119)** — 7 findings from the twenty-first
  `/code-review`: six fixed, one declined (generic Helm surface).
  - *The mirror pattern admitted at most ONE path segment* — the
    canonical Nexus/Artifactory air-gapped topology
    (`https://nexus.internal/repository/k8s-releases`) failed the
    render with no workaround, while values.yaml advertised
    `[/prefix]` unqualified. The prefix is multi-segment now, and a
    delivery case pins it verbatim in the init shell
    (mutation-tested: reverting to the single-segment pattern fails
    the case).
  - *The chart README's air-gapped section was two properties stale* —
    it still told operators the mirror takes "no scheme" and to serve
    a `/jq/...` path nothing downloads (jq left the tools-init
    container several passes ago). It names the shipped shape now —
    the fourth documentary surface the pass-20 alignment missed.
  - *The delivery pin covered one shape only* — the default
    (`https://dl.k8s.io`) and the scheme-less air-gapped form had no
    contains-case, so a regression making the scheme group required or
    dropping the default would land green. Both pinned verbatim, plus
    an uppercase-scheme case (the regex admits it for RFC 3986's
    case-insensitive scheme names, which the pattern now spells out —
    a plain `https?` rejected `HTTPS://` outright).
  - *The two negative mirror cases pinned only the key name* — the
    schema error embeds the whole pattern, so a clause-specific needle
    would pin the pattern TEXT and break on every refinement; the
    comment at the cases states that trade-off and the distinct inputs
    are the discrimination. The scheme-position case's label no longer
    mis-describes its input (`https:mirror` carries the offending
    colon in scheme position, not the port).
  - *Declined: closing the schema's global block with
    additionalProperties* — the typo'd-mirror-key class is real, but
    the block deliberately leaves `imageRegistry`/`toolingImageRegistry`
    and the pull-secret keys untyped; closing it means typing the
    whole `global` surface, a chart-wide contract this branch's KISS
    rule keeps as a ledger item.
- **Review loop, pass 44 (0.2.118)** — 4 findings from the twentieth
  `/code-review`, all sharpening the pass-42/43 mirror contract.
  - *The mirror pattern still admitted two shapes outside its own
    contract* — the host charset allowed a colon anywhere, so the
    undocumented `https:mirror` form the pass-43 commit message itself
    named as misleading still rendered, and ANY scheme (`file://`)
    matched the optional-scheme group. The host admits a colon only
    before a numeric port and the scheme only http(s) now; guard cases
    fire on both.
  - *The values.yaml comment contradicted the schema* — it still said
    "(no scheme)" while the schema (and the pass-43 guard) made the
    scheme optional. All three documentary surfaces name the same
    shape now.
  - *The scheme-ful guard proved acceptance, not delivery* — expect_ok
    alone would pass a template that mangled the value in transit (a
    re-prefixed BASE, dropped quoting). The case pins the path:
    `BASE="https://mirror.internal:8443"` must appear in the rendered
    init containers — mutation-tested by re-prefixing BASE in
    _tools-init.tpl (guard red, restored).
  - *The 253-bound case's value tripped the label check too* — 254
    characters in one label fails BOTH checks, so the case discriminated
    only by message text. The value is 4×63-char labels + 3 dots (255
    chars, every label legal) now: it fails the total bound alone —
    mutation-tested by deleting the 253 check (guard red, restored).
- **Review loop, pass 43 (0.2.117)** — 4 findings from the nineteenth
  `/code-review`, all in the pass-42 validation surface.
  - *The mirror pattern was a regression* — it enforced "no `//`"
    instead of "no scheme": the scheme-ful `https://mirror.internal:8443`
    the 0.2.115 chart accepted (and the docs suggest, and the chart's
    own default exemplifies) failed the render, while the undocumented
    `https:mirror` form passed. The pattern admits an optional scheme
    now; a guard case proves the scheme-ful form renders.
  - *The Secret-name shape lived in two copies and they had already
    diverged* — pass 42's regex in validatedConvergenceEnvSecrets
    re-implemented validatedSecretName and silently missed the 253/63
    bounds added to the other copy in the same commit. The helper is
    the ONE place now: the convergence rows include it (for its fail
    side-effect — the return value is captured and discarded, or the
    include prints the name into the rows' JSON; the first attempt did
    exactly that and broke every guard).
  - *The length bounds had no guard case* — deleting either check left
    the suite green, the same coverage hole pass 42 closed for the
    charset. One case per check (253 total, 63 per label), both
    mutation-tested; the convergence case's needle pins the values key
    now, so a re-narrowing cannot masquerade as another guard firing.
  - *Inside the helper's label loop `.key` was a string* — the range
    rebinds `.`, so the message field crashed the render instead of
    failing by name. The key is bound before the loop.
- **Review loop, pass 42 (0.2.116)** — 7 findings from the eighteenth
  `/code-review`: six fixed, one structural cleanup absorbed into the
  same fix.
  - *The convergence rows' `secretName` still reached the shell raw* —
    the helper this pass built claims to extend "the discipline
    validatedConvergenceEnvSecrets applies to the convergence rows",
    but that helper's regex covered only `envVar`: the row's
    secretName rendered verbatim into the pod's `sh -c`. The shape
    check moved INTO validatedConvergenceEnvSecrets (all three row
    consumers route through it), and a guard case fires on a
    metacharacter-bearing row.
  - *Two global tooling keys were interpolated into the tools-init
    container's shell raw* — `kubeletToolsMirror` (into
    `BASE="..."`, where `$(...)` executes) and `toolingArch` (into the
    kubectl URL path), neither constrained by the schema. The schema
    gains a `global` block: an enum for the architectures the download
    URL accepts, and a mirror pattern admitting no shell
    metacharacters. Two guard cases fire on violations.
  - *The new validation helper was exercised on one row only* —
    unwrapping the db.secretName or admin userSecret interpolations
    landed green. A guard case per row now: unwrapping any ONE of the
    three is red.
  - *The guard script's header stated a false mechanism* — no CI
    render passes `failOnPlaceholderSecrets=false`; the placeholder
    guards are satisfied by the fixture's lint-dummy clientSecrets and
    complete envSecrets rows. The header states the real mechanism
    (same false-reason class the pass-41 _tests.tpl fix closed).
  - *The render mechanics lived in four copies* — the helpers now
    share `render_capture`, and the SIGPIPE rationale (grep -c, never
    -q) sits beside the count logic it protects; the empty-count
    direction is fail-safe (no evidence fails the guard, both ways).
  - *The Secret-name shape check enforced the charset but not the
    DNS-subdomain bounds* (253 total, 63 per label) while claiming the
    Kubernetes shape. The length checks joined the regex.
- **Review loop, pass 41 (0.2.115)** — 7 findings from the seventeenth
  `/code-review`: six fixed, one declined as machinery (tripwire
  recorded).
  - *The new assertion branches were exercised by no CI render shape* —
    every CI render had keycloak+convergence on and no ingress.tls or
    translation endpoint, so a regression re-narrowing the admin
    assertion or dropping the TLS operand landed green. Three new
    render guards (and a positive-output pair of helpers,
    `expect_render_contains` / `expect_render_lacks` — the existing
    guards could only assert failure): convergence-off still asserts
    the admin Secret; the TLS Secret is asserted when set; no vllm
    assertion without a consumer. Two self-found defects shaped them:
    the helpers' first version grepped with `-q`, and under the
    script's own pipefail the early exit SIGPIPEs the 700 KB render's
    writer — the pipeline reports 141 and a MATCH is counted as a miss
    (`grep -c` reads the whole input); and the first needle
    (`keycloak-admin-credentials`) matched the Keycloak CR's own
    manifest line, so re-narrowing the assertion left the guard green —
    the needle must be the assertion ROW. Both cases mutation-tested
    (re-narrowing the admin assertion fails the guard; dropping
    `backend.enabled` from the vllm branch fails the lacks guard).
  - *Operator-supplied Secret names reached the test pods' shell raw* —
    three interpolations bypassed the validation the convergence rows
    go through. New `genieai-umbrella.validatedSecretName` (the
    Kubernetes Secret-name shape; a violation fails the render naming
    the values key), applied to all three; a guard asserts it fires.
  - *The _tests.tpl header stated a false reason for living in _lib* —
    helm lint renders first and parses the OUTPUT; a `define` in a
    .yaml template is legal. The observed breakage was the trimming
    dash on the include (the pass-40 entry records it), not the
    location. The comment states the real mechanism (convention +
    whitespace interactions).
  - *The prose `<no value>` was silently stripped at render* — helm
    post-processes that literal out of rendered output, so the
    deployed pod's comment read `not a literal ""`. Reworded without
    the sequence.
  - *Dead `$global` binding in test-namespace.yaml* — both its readers
    moved into the scaffolding helper's own `$g` in pass 40. Deleted.
  - *The ledger's Current state heading claimed 2026-10-28* while the
    state it heads was committed on the 29th. Updated.
  - *Declined (KISS): a shared container-securityContext helper for
    the four test pods* — the scaffolding helper covers the two
    kubectl pods; the curl/busybox pods in test-observability and
    test-stateless-reachability re-declare the restricted profile.
    Real duplication, but a second helper layer for a posture that has
    not changed in the branch's life is machinery; if a posture change
    or a fifth test pod appears, the helper item activates.
- **Review loop, pass 40 (0.2.114)** — 4 findings from the sixteenth
  `/code-review`, all in the required-Secrets contract's assertion half.
  - *keycloak-admin-credentials was asserted narrower than its
    consumer* — the assertion sat under the convergence Job's toggle,
    but the Keycloak CR names the Secret unconditionally within the
    identity tier: a keycloak-on/convergence-off install consumed the
    Secret with nothing asserting it (the exact drift class pass 15
    closed for redisCache, reopened one block over). The assertion
    moved under `keycloak.enabled` alone; the convergence envSecrets
    rows stay under their own toggle.
  - *The pre-baked Gateway TLS Secret was never asserted* —
    `ingress.tls.secretName` is the operator-pre baked certificate the
    Gateway's certificateRefs point at (with it set, no cert-manager
    Certificate renders and nothing else materializes the Secret). It
    joins `required_secrets` and the gate, matching the test's own
    contract for operator-provided Secrets.
  - *The vllm-api-key assertion could fire with no consumer* — the
    mirror image of pass 15's gap: with the backend disabled but a
    translation endpoint named, the test demanded a Secret nothing in
    the render consumes. The gate operand and the assertion branch
    both require `backend.enabled` now.
  - *The two test pods re-declared ~40 lines of scaffolding* — bound
    once as `genieai-umbrella.testPodScaffolding` in
    `templates/_lib/_tests.tpl`. The
    byte-compare against the 0.2.113 render shows the only spec change
    is the data-deps container's name (`t` → `test`); the first
    attempt, included with a whitespace-trimming dash, glued the
    preceding line to `spec:` and broke the YAML parse — caught by
    lint before any push. (Correction, pass 41: the file lives in
    _lib by convention — lint renders first and parses the OUTPUT, so
    a `define` inside a .yaml template is legal; the dash was the
    whole defect.)
- **Review loop, pass 39 (0.2.113)** — 4 findings from the fifteenth
  `/code-review`: three fixed, one declined as machinery (with a
  mitigation).
  - *The block comment above the gate stated the OLD contract* —
    "gated on at least one data tier … all data tiers disabled has
    nothing to check", one line above the gate pass 38 widened with
    redisCache. The comment now states the real contract and the rule:
    every condition that adds a Secret to `required_secrets` must join
    the gate's `or` list.
  - *The gate was still narrower than its assertions* — `$opea.enabled`
    and the `$translation.endpoint` branch (vllm-api-key,
    kc-dataprep-client-secret) did not join it: an opea-only or
    endpoint-only shape rendered mandatory secretKeyRefs and no test
    Pod. Latent today (the dependency graph blocks those shapes at
    install) but the graph is an operator knob. Both conditions joined;
    mutation-tested (dropping `$opea.enabled` from the gate removes the
    Pod from the opea-only render; restoring it brings it back).
  - *Declined (KISS): a template-side `$requiredSecrets` list that the
    gate and the script both derive from* — the reviewer's structural
    fix for the recurring gate/assertion drift (runs 37→38→14→15). It
    is real machinery: a helper building a list with reasons, a gate on
    its emptiness, comments emitted from it. The mitigation chosen
    instead is the contract comment naming the two halves and the rule
    for adding a Secret — the next author reads the rule at the site of
    the mistake. If a fifth drift instance appears, the machinery item
    activates.
  - *`failed=0; if [ -n … ]` was a two-hop copy* — collapsed to the
    single `if [ -n "$missing" ]` branch.
- **Review loop, pass 38 (0.2.112)** — 3 findings from the fourteenth
  `/code-review`, all in the comment-accuracy and coverage classes.
  - *Three copies of the exact phrase pass 37 declared false survived* —
    "the knob the Service follows" on the chatqna→backend rule and both
    dataprep egress rules (backend, document-repository), one rule
    below the instance pass 37 fixed in the same file. All three say
    "publishes the factory's fixed 80, targets the pod by name" now.
    Comments never render — no gate sees them; the sweep is manual and
    a whole-file grep is the minimum, not spot fixes.
  - *The rewritten required-secrets comment replaced one impossible
    claim with another* — pass 37's version said the check is
    "pre-install": the chart's actual pre-install hook validates only
    the dependency graph, this Pod is `helm.sh/hook: test` (runs on
    `helm test`; the Flux HelmRelease enables no tests), and
    CreateContainerConfigError happens at container start, not
    scheduling. The comment states the real mechanism (a `helm test`
    failure naming the missing Secret vs a generic `--wait` timeout).
  - *The translation-cache-password assertion was gated on the data
    tiers* — the test Pod rendered only when a data tier was enabled,
    so a stateless-only install (redisCache on, data off) asserted the
    Secret nowhere. `$redisCache.enabled` joins the Pod's gate —
    mutation-tested: with the gate reverted the stateless-only render
    carries no test Pod; with it, the Pod renders and asserts the
    Secret.
- **Review loop, pass 37 (0.2.111)** — 6 findings from the thirteenth
  `/code-review`: five fixed here, one belongs to a compose-side MR.
  - *The comment sweep of runs 11–12 missed the chart's own values
    file* — the redisCache block still documented the probes as bare
    `redis-cli -p <port> ping`, the exact never-could-fail command
    0.2.110 removed from the template. The block describes the PONG
    assert and why it exists now.
  - *The "the knob the Service follows" phrasing was false for the
    k8s Services* — it was true for redis/clamav (whose Service ports
    follow the knob) but was generalized to the factory surfaces where
    the Service publishes the fixed 80 and only the targetPort follows
    the knob. documentRepository.yaml and the opea doc-repo rule say
    "publishes the factory's fixed 80, targets the pod by name" now.
  - *One knob-port comment survived in the OPEA tier* — chatqna's env
    doc said "targetPort 3001/3000"; it names the knobs now (comments
    never render, so no gate can catch this class — the sweep is
    manual and readers find what sweeps miss).
  - *The required-secrets justification described an impossible
    state* — it claimed a missing redis Secret breaks the cache
    silently while a TCP probe passes; with the NON-optional
    secretKeyRef the pod sits in CreateContainerConfigError and no
    probe runs at all. The justification states the real mechanism.
    (Correction, pass 38: the check is `helm test`-scoped, not
    pre-install, and it was gated on the data tiers — a stateless-only
    install asserted nothing. Both fixed in pass 38.)
  - *The PONG command was copy-pasted into three probes* — bound once
    as `$redisProbe` next to `$redisPort`, the in-file idiom this file
    already established. The byte-compare against the 0.2.110 render
    caught the first attempt: `printf %s` on an int64 rendered
    `%!s(int64=6380)`; the binding stringifies now and the probe
    commands are byte-identical to the previous release.
  - *Compose ships the same broken healthcheck* —
    `docker-compose.yaml` runs the bare `redis-cli ping` against a
    `--requirepass` + `--appendonly yes` redis: on restart during an
    AOF load the container reports healthy while unable to serve (and
    in Swarm it is never replaced). Compose is read-only for chart
    work on this branch — the fix belongs to a dedicated compose MR
    off `main`.
- **Review loop, pass 36 (0.2.110)** — 7 findings from the twelfth
  `/code-review`. The theme: the fix that could not fix, and the
  comments that outlived their numbers.
  - *redis-cli exits 0 on every server error reply* — verified
    empirically on the chart's image: during a real AOF load
    (`loading:1`) and on NOAUTH, `redis-cli ping` prints the error and
    exits 0. The run-11 crash-loop fix therefore never could fire: the
    bare `redis-cli ping` probe SUCCEEDED while the server could not
    serve (and would have passed on NOAUTH too). All three probes
    assert the reply now — `test "$(redis-cli -p <port> ping)" = PONG`
    — mutation-tested on the real image (error reply → exit 1, so the
    startup probe's 5-minute window actually opens during a load).
  - *The vm-operator peer comment still said 6379* — knob-following
    number in the same file the pass-35 binding "de-hardcoded"; the
    block only renders with observability metrics on, so neither the
    default render nor the pass-35 mutation saw it. The number is gone
    (the rules carry the port).
  - *Three more knob-port comments survived run 11's sweep* —
    documentRepository → backend "pod port (3000)", frontend → backend
    "(3000)", backend → document-repository "pod port 3001". Same
    contradiction under override as the chatqna/dataprep comments run
    11 fixed; numbers replaced with the knob name, the phrasing
    documentRepository.yaml already used elsewhere.
  - *The chatqna header listed "translation 9031"* — the egress rule
    beneath dials the POD port 8888 (the Service maps 9031 to it); a
    reader grepping the rendered policy for 9031 found nothing. The
    header says 8888 now.
  - *"Ingress from backend ONLY" headers contradicted the peers
    beneath* — both redis (helm-test + vm-operator peers) and clamav
    (helm-test peer) shipped an ONLY that the rendered from-clauses
    deny. The headers name the peers.
  - *The pass-35 minikube story described a cluster state that exists
    in no wired cluster* — the minikube cluster's GitRepository tracks
    deploy-repo `main`, which carries a README only; only the laptop
    cluster consumes `feat/deploy-repo`. The ledger entry is corrected
    in place; the label fix stands as repo hygiene.
  - *Declined (KISS): a shared `redisPort` helper* — the finding
    proposed a `genieai-umbrella.redisPort` library helper for the
    three remaining `$svc.port | default 6379` dialer reads
    (backend.yaml ×2, the reachability test ×1). Three sites of a
    stable default; the finding itself concedes no runtime risk. The
    helper is machinery, not a defect — ledger item if a fourth site
    appears.
- **Review loop, pass 35 (0.2.109)** — 5 findings from the eleventh
  `/code-review`, one in the deploy repo. The theme: pass 34's own
  context, again.
  - *The deploy repo has TWO overlays, and only one got the label* —
    the 0.2.108 bump updated `jrevillard-laptop` but left
    `overlays/minikube/dev` at 0.2.107, while both track the branch
    HEAD. (Correction, pass 36: the mismatch lives in the repo, not in
    a cluster — the minikube cluster's GitRepository tracks deploy-repo
    `main`, which carries no overlays yet; only the laptop cluster
    consumes `feat/deploy-repo`. The fix is repo hygiene that matters
    when the branch merges.) Both overlays move together from now on.
  - *Redis could be killed mid-load* — no startupProbe: with
    `--appendonly yes` redis answers PING with `-LOADING` until the
    dataset is in memory, and on a PVC-backed /data a grown AOF can
    outrun the liveness budget (~2 min) — the pod restarts into the
    same load, a crash loop. A startup probe (30 × 10 s) suspends
    readiness and liveness for a 5-minute load window, the same
    mechanism clamav's startup probe gives the signature download.
  - *The README claimed probes live on values.yaml; redis's do not* —
    its probes are rendered by the hand-written template, and neither
    the redisCache values block nor the README said so. Both now name
    the exception (clamav's block carried the caveat already).
  - *Rendered NetworkPolicy comments hardcoded knob-following ports* —
    the chatqna/dataprep policy comments named "document-repository
    (3001), backend BFF (3000)"; under a `services.*.port` override the
    shipped manifest carried a comment contradicting the rule beneath
    it. The numbers are gone from the comments (the rules carry the
    ports; the constants that remain are template-fixed).
  - *The redis port was spelled out nine times* — the same
    `$svc.port | default 6379` expression in the --port flag, the
    containerPort, the Service, the NetworkPolicy and the probes, while
    clamav.yaml binds its port once. A single `$redisPort` binding now
    feeds every site — mutation-tested: changing the binding moves all
    ten rendered occurrences and leaves zero stale 6379. (Correction,
    pass 36: the claim covers the rendered occurrences of the
    expression; a static comment in the metrics-only vm-operator peer
    still said 6379.)
- **Review loop, pass 34 (0.2.108)** — 4 findings from the tenth
  `/code-review`. The theme: pass 33's own leftovers.
  - *The redis probes still dialled 6379* — pass 33 moved the
    listener (`--port`), the containerPort, the Service and the
    backend's `TRANSLATION_CACHE_PORT` with `services.redisCache.port`,
    but the readiness/liveness commands stayed `redis-cli ping`,
    which dials the hardcoded default 6379: an override rendered green
    and the pod never went Ready. The probes take the knob now
    (`redis-cli -p <port> ping`) — unlike clamd, redis-server takes
    its port as a flag, so the chart honours the override instead of
    rejecting it.
  - *Two `clamavPort` references survived the knob's deletion* — the
    env-types gate's fixture still overrode
    `services.documentRepository.clamavPort`, a key no template reads
    (the row asserted nothing), and the chart README still documented
    it as a knob. The fixture exercises the document-repository's PORT
    row now, and the README points at `services.clamav.port`.
  - *The per-service shape contract described only the factory* —
    "the Service always listens on 80" is false for the two
    hand-written Services (redisCache and clamav expose their Service
    ON this port). The block states the factory case and names the
    exceptions.
- **Review loop, pass 33 (0.2.107)** — 10 findings from the ninth
  `/code-review`. The theme: a knob the chart moves but nothing honours.
  - *The chart moved the port plumbing but never the LISTENER* —
    `services.<svc>.port` moved the containerPort, the Service
    targetPort, the NetworkPolicy and the probes, while the process
    stayed on the image's own default (`process.env.PORT || 3000` for
    the backend, 8090 for the frontend's nginx, 3001 for the
    document-repository): an operator who moved a port rendered green
    and got a pod that never went Ready. The factory now sets `PORT`
    from the service's port (redis takes `--port`), so the knob moves
    the listener too. The exception is enforced rather than silent:
    clamd takes its port from clamd.conf, which the image fixes (its
    entrypoint honours no port variable — /init reads only
    `CLAMAV_NO_*`), so the render REJECTS a `services.clamav.port`
    other than 3310 by name. The five ports are schema-typed integers
    now — a string reached `containerPort` and the API server would
    have rejected the Deployment.
  - *The document-repository's `clamavPort` could only break the scan*
    — it fed `CLAMSCAN_PORT` while the NetworkPolicy admitted the clamav
    pod's port (derived from `services.clamav.port`) and clamd took its
    port from clamd.conf: a different number dialled a port nothing
    serves and the policy forbade the one that was served. The knob is
    gone; `CLAMSCAN_PORT` follows `services.clamav.port`, the one port
    the chart carries. (An external `clamavHost` remains a documented
    gap: the default-deny egress admits no external scanner.)
  - *The schema stated the replica precedence backwards* —
    `clusterProfileReplicas` claimed the profile wins over
    `services.<svc>.replicas`, the order the chart inverted two passes
    ago. The description now states explicit → profile → 1, the same
    order the per-service descriptions and values.yaml already state.
  - *The dependency-graph guard named a values path that does not
    exist* — "dependencyGraph.<tier>.<node>.deps must be a list", but
    the node IS the list; an operator who followed the message set a
    key under a list, Helm turned the node into a map, and the guard
    fired again with the same message. The message names the node and
    shows the working shape now.
  - *Stale documentation that contradicted the chart* — the chart
    README's Required-Secrets table still listed `huggingface-hub-token`
    and `email-password` (both removed in pass 32) and omitted
    `keycloak-convergence-credentials`, which the shipped overlay
    creates; the parity allowlist excused the dataprep's
    `HUGGINGFACEHUB_API_TOKEN` with a reason naming the dead Secret;
    the instance-count checker's docstring still described the two
    tiers' precedence as inverted (both are explicit-first); the
    laptop overlay's `valuesFrom` comment promised an inline
    `values:` block the same file says does not exist.
  - *The project's own defect ledger mandated the change pass 32
    reverted* — `plan-defects.md` rows Wave-6 #15 and Wave-9 #8 told
    the next agent to re-add `email-password` to the backend's secrets
    list, re-introducing the `password` env var the pass closed. Both
    rows carry a SUPERSEDED banner now.
- **Review loop, pass 32 (0.2.105)** — 12 findings from the eighth
  `/code-review`, four of them in the deploy repo. The theme: a value
  the chart (or the overlay) reads, but nobody honours.
  - *Three realm knobs declared `true` fell back to `false`* —
    `verifyEmail`, `resetPasswordAllowed` and `registrationAllowed`
    are declared `true` in values.yaml, but their render-time fallback
    was `false`, so an overlay that CLEARS a knob (`null` deletes it)
    got the opposite of the documented default. Worse, the two mail
    knobs' guard read the same nil, so clearing one STOPPED the guard:
    the render succeeded with no mail server and the realm imported
    with verification and password reset off. The fallback now matches
    the declaration, and the guard reads the knob through the same
    helper (Sprig's `default true` cannot express it: `false` is
    empty, so an explicit false would read as true).
  - *The backend declared two Secrets nobody creates* —
    `huggingface-hub-token` and `email-password` appear in no
    deployment surface, and no backend code reads the keys they would
    mount (`envFrom` injects EVERY key of a Secret under its own name,
    so an `email-password` Secret with a `password` key would land in
    the process as an env var named `password`). The registry token is
    the OPEA tier's business (`HF_TOKEN` from `vllm-api-key`), the
    SMTP password belongs to the convergence Job. Both rows deleted.
  - *The clamav probe port was a dead knob* — the probes dial the
    LISTENER, so the port is DERIVED from `services.clamav.port`; the
    template's merge gave precedence to the destination and the
    operator's number was discarded in silence. The port is derived
    now, and a number that contradicts the derivation is REJECTED by
    name (the chart's rule for a value it cannot honour). values.yaml
    declares an empty `tcpSocket` — a declared number would always win
    over the derivation, because Helm merges the chart's values with
    the overlay's and the template cannot tell them apart.
  - *The doc claimed values the shipped overlays do not carry* — a
    `valuesFrom` Secret (the laptop overlay has none: its secrets are
    SealedSecrets), inline values that carry "only the per-pays
    overrides" (the shipped inline block was a chart-wide guard
    switch), 900s install timeouts (the overlay raises them to 60m /
    2700s after two installs hit the 5-minute default and a cold pull
    outran 15 minutes), a `email-password` Secret that exists nowhere,
    and "the chart renders NO Namespace" (it renders `<ns>-obs`).
  - *The laptop overlay switched the placeholder guard off for
    nothing* — its render passes with the guard ON (the overlay
    declares all three client secrets and all five convergence rows),
    and the switch was disarming the half of the guard that fails the
    render when a realm placeholder has no row to resolve it from. The
    switch and its false comment (SOPS-decrypted secrets: the laptop
    uses SealedSecrets) are gone.
  - *Refuted: `RETRIEVER_ARANGO_FILTER_STRATEGY` is not read by the
    branch's code* — the chart renders the name Compose uses AND the
    name `main` reads (`0bf445ce9`); the branch's in-tree overlay is
    12 commits behind and still reads the old name. The deployed image
    comes from the registry (built from `main`), so the setting works;
    the branch's rebase closes the source drift.
  - *Deferred to the deploy repo's queue* (`docs/plan-defects.md`
    P14–P18): the minikube TEMPLATE overlay's `valuesFrom` Secret
    namespace, its missing Flux wiring, the plaintext seed the Agent
    applies next to the encrypted one, and a values key the chart does
    not read. Fixing them needs the SOPS lifecycle decided, not a
    one-line edit — and wiring an overlay whose secrets are placeholders
    would install a release with placeholder credentials.
  - *Deferred: the parity gate does not check that a COMPARED variable
    is read by the code* — it checks that the two surfaces agree, and
    that the `notRead` claims hold; a variable both surfaces set and
    no code reads passes. The machinery exists (the same source walk),
    and the obstacle is the one the deferred verifier item names: the
    walk must know what the shipped RUNTIME reads, not what the source
    tree mentions (the frontend's `VUE_PROXY_HOST` is read by
    `server.js`, which the image never executes).
  - *The chart's version was NOT the artifact identity, and the repo
    said it was* — the reviewer's reading was right and the branch's
    own rule was wrong: the HelmRelease CRD says
    `spec.chart.spec.version` is "ignored for charts from v1.GitRepository
    and v1beta2.Bucket sources" (helm-controller v1.1.0), and the
    controller's install decision is the SOURCE's artifact digest — the
    chart's GitRepository tracks the branch tip, deliberately not a
    commit pin ("the bump routinely got forgotten, and flux kept
    rendering an old chart"). So a chart push reaches the cluster with
    or without a version bump; the bump is the deploy repo's LABEL of
    what is deployed, and the rule, the gate's docstring and the
    workflow file now say so instead of teaching a false mechanism.
- **Review loop, pass 31 (0.2.104)** — 10 findings from the seventh
  `/code-review`. The theme of the pass: the values a deployment reads
  through a path the chart does not own.
  - *The Keycloak context path was concatenated with no shape check* —
    `data.keycloak.httpRelativePath` lands in every Keycloak URL
    (":8080<path>") and in the HTTPRoute's path rules. A path without
    its leading slash rendered "…:8080auth" and the route path
    "auth/", a URL no client can dial, with the values key nowhere in
    the error. The shape (leading slash, no whitespace) is checked at
    the single source now.
  - *The Keycloak CR carried no pull credentials* — the operator owns
    that StatefulSet, so the chart could not write its pod spec, and an
    air-gapped mirror could pull neither the Keycloak image nor the
    theme-unpack init's busybox: the whole identity tier stayed in
    ImagePullBackOff, with a pull error naming no values key. The
    credentials go in the CR's TOP-LEVEL `spec.imagePullSecrets`, not
    in the podTemplate: the operator overwrites the template's value
    with that field's (`withImagePullSecrets(spec.getImagePullSecrets())`
    in `KeycloakDeploymentDependentResource`) and warns on the CR
    status that "The imagePullSecrets of the keycloak container cannot
    be modified using podTemplate". Both facts are upstream's, read at
    keycloak/keycloak 26.8.0 — the podTemplate placement renders,
    lints and passes kubeconform, and is silently dropped.
  - *Grafana's `root_url` read `ingress.scheme` as a raw chain* — the
    one file that skipped the parent-first binding, so a CLEARED
    ingress block crashed the template engine instead of failing
    through the helper, by name.
  - *The named translation endpoint's egress port is a Service port,
    the policy matches a pod port* — a NetworkPolicy's egress port is
    matched after DNAT, against the pod's port, while the rule carries
    the URL's port (the Service's). The chart cannot read an
    operator-named Service's `targetPort`, so the constraint
    (`targetPort` == `port`) is documented in the rendered policy and
    in the operator doc.
  - *The doc stated the replica precedence backwards* — it claimed
    `clusterProfileReplicas` wins over `services.<svc>.replicas`, the
    order the chart inverted when the explicit value moved first. Both
    tiers now read explicit → profile → 1, and the doc says so.
  - *The doc called the translation endpoint an optional CPU-skip
    switch* — a named GPU API is MANDATORY (the backend waits for it
    at startup and refuses to come up without it); only an UNSET
    endpoint means the in-process CPU model translates.
  - *The two newest guards had no render-guard case* — and the
    suite's own header claimed the dependency-graph guard was
    unreachable, which it is not: a mistyped `--set` leaves a map
    behind and the guard fires. Three cases now (the third colon
    segment, the map shape, the non-string element), each
    mutation-tested against its own guard.
  - *The ledger named a stale base commit* — `179a8a8f1` where the
    merge-base is `18d02f094`.
  - *The document-repository read one values block under two names* —
    the crawl CIDR rule ranged over `$svcDocRepo` and tested
    emptiness on `$servicesDocumentRepository`, two aliases of the
    same map: the day one of them changed, the rule would have
    admitted `0.0.0.0/0` alongside the operator's CIDRs. One name
    now.
  - *The namespace comment said the chart renders no Namespace* — the
    observability tier renders one (`<ns>-obs`, the only namespace the
    chart owns: it holds the filelog DaemonSet and nothing that
    outlives the release). The release namespace stays the deploy
    repo's, and the comment says which is which.
  - *The changelog rewrote a RELEASED entry* — the branch's Compose
    default flip (`STREAMING_TRANSLATION_ENABLED` 0 → 1) was
    documented by editing the `[2.0.0]` section, claiming of a July
    release a behaviour change that ships now. Every released section
    is byte-identical to `main` again, and the flip is documented under
    `[Unreleased]`.
- **Review loop, pass 30 (0.2.102)** — 7 findings from the sixth
  `/code-review`, three mutation-confirmed by the reviewer before the
  fix. The theme of the pass: values that reach a browser or a hook.
  - *`ingress.host` validated only the first colon segment* —
    `genieai.local:4443:999` passed the guard and flowed verbatim into
    the OIDC issuer, the CORS origin, both CSP connect-src sets and
    `KC_PUBLIC_ORIGIN` (the reviewer rendered it). A third segment now
    fails by name.
  - *The theme-unpack init bypassed `global.toolingImageRegistry`* —
    the chart's own `themeUnpackImage: busybox:1.36` made the `|
    default` unreachable, so an air-gapped mirror routed every tooling
    image except the one inside every Keycloak pod, which still pulled
    docker.io and held the whole identity tier in ImagePullBackOff.
    The knob is null by default and derives through the registry; an
    explicit value wins verbatim.
  - *The dependency-graph type guard accepted what it should have
    rejected* — it named string and bool, so an int or the
    `{deps: null}` shape a mistyped `--set` leaves behind rendered
    into dependency-graph.json and crashed the pre-install hook with
    a Python TypeError naming no values key. Only a slice of strings
    is accepted now.
  - *The keycloak smoke's no-code path died under pipefail* — grep
    finding nothing killed the script silently instead of reaching
    the named FAIL. The extraction tolerates it now.
  - *The clamav startupProbe rendered the raw block while its
    siblings rendered the bound copy* — correctness rested on two
    names aliasing one map, and the natural dead-variable cleanup
    would have stranded the probe on the old port. The bound binding
    renders now.
  - *The Grafana root_url read the ingress host as a raw chain* — the
    one file that skipped the normalization convention, with an
    else-branch no render could reach. It goes through the shared
    helper now.
  - *The cluster-scope check carried a dead allow-list entry* — `envoy`
    was exempted by KIND upstream, so the NAME entry could only have
    re-permitted a future cluster-scoped object literally named
    `envoy`. Removed.
- **Review loop, pass 29 (0.2.101)** — 7 findings from the fifth
  `/code-review`, three verified by render. Two were leftovers of the
  run-4 fix itself — the review passes now audit each other's patches,
  which is exactly what the loop is for.
  - *The OPEA policies still hardcoded the app-tier ports* — run 4
    derived the services-tier policies from `services.<svc>.port` and
    missed this sibling file: an override moved the Service and the
    tier's own policy while chatqna/dataprep egress still admitted the
    default port, dropping their calls to the BFF and the doc-repo
    under default-deny. Derived now, through a parent-first port map.
  - *The convergence Job rendered cleared realm knobs as null* —
    `KC_REALM`, `KC_CLIENT_ID`, `KC_GRAFANA_CLIENT_ID` and
    `GENIE_ADMIN_USERNAME` read the values with no default, and Helm's
    null DELETES the declared one: `| quote` of nil rendered
    `value: null`. Each carries its values.yaml default now.
  - *The values-surface gate collected only literal `$svc.` chains* —
    the reads through the templates' own bindings
    (`$servicesRedisCache.port`, `$svcBackend.port` — several born in
    run 4) never entered its candidate set, and the typo-guard reported
    "all declared" over reads it had never collected. It resolves every
    alias a template binds now; the candidate set grew from 24 to 33.
  - *The keycloak smoke captured kubectl's own creation line* —
    `pod/kc-probe created200` never matched the 200|401 case, failing
    the merge decision on a healthy cluster. The code is read from the
    trailing number.
  - *A stale comment still documented the old replicas precedence* —
    values.yaml said the profile map wins over `services.<svc>.replicas`,
    the exact misreading that produced the pass-27 bug. Same order as
    the data tier now, stated once.
  - *The env-types `#` strip guard blocked continuation lines* — a
    multi-line action's trailing comment was swallowed into the
    capture. Balance alone decides now (probed on both shapes).
  - *The doc-repo's scanner port was a second manually-synced knob* —
    `documentRepository.clamavPort` declared 3310 beside
    `services.clamav.port` and the operator had to move both. It is
    null by default and follows the listener; its own value remains
    for an external scanner.
- **Review loop, pass 28 (0.2.100)** — 7 findings from the fourth
  `/code-review`, each verified against the render or the source before
  the fix. One was a fleet-wide chart defect, one a graph gap, five
  gate/correctness details.
  - *The NetworkPolicies hardcoded the container ports of services
    whose `port` is a documented knob* — frontend (8090), backend
    (3000) and document-repository (3001) policies, plus the OPEA
    policies' cross-references, admitted only the default port while
    the Service and the probes followed the knob. Overriding the port
    stranded the tier behind its own default-deny. The policies derive
    the port from the knob now, like clamav and redis already did —
    and the first sweep caught the new reads reading a NIL parent
    (the pass-22 rule: bind the block, then read the leaf), which the
    render-guards suite confirmed with two nameless failures before
    the fix.
  - *The data-deps test interpolated `data.keycloak.db.secretName`
    raw* — a cleared block rendered `<no value>` into the required
    Secret list while the CNPG Cluster and the Keycloak CR degraded to
    the default name. The test carries the same default now.
  - *The dependency graph omitted chatqna's edges to embedding and
    translation* — both Services sit in its rendered env rows, so the
    pre-install dep-check never validated them.
  - *The reachability check defaulted a missing policyTypes to
    Ingress+Egress* — Kubernetes infers the types from the rules, so
    an ingress-only policy without the field read as egress-isolating
    and the check reported reachable pairs as blocked.
  - *The parity comparison stringified Python booleans* — a values-file
    `true` compared as `True` against Compose's "true": two surfaces
    that agree reported as a GAP.
  - *The env-types capture stripped a `#` inside the action* — a URL
    fragment or a quoted default corrupted the brace count and the
    following lines were swallowed into one garbled expression. The
    strip applies only when the braces still balance after it.
  - *A scheme-less GPU node host rendered a broken endpoint and an
    egress rule admitting the wrong port* — the port comes from the
    URL's authority, which only a URL with a scheme carries. Both the
    endpoint derivation and the egress rule now fail by name, and the
    render-guards suite gained the case (the IPv6 case now carries the
    scheme it needs to reach the check it tests).
- **Review loop, pass 27 (0.2.99)** — 7 findings from the third
  `/code-review` of the branch, each verified by render or mutation
  before the fix. Two were chart behaviour, five were gate holes.
  - *The profile silently overrode an explicit `replicas`* —
    `clusterProfile=prod` + `services.backend.replicas: 0` (the
    documented scale-off) rendered **3 replicas and a
    PodDisruptionBudget for them**. The helper's own docstring said 0
    was the documented way to switch a tier off, and then the profile
    lookup discarded it. The order is now the data tier's: the explicit
    value, then the profile, then 1. `services.<svc>.replicas` is null
    by default — that is what keeps "unset" (the profile applies)
    distinguishable from "the operator pinned a count" (it wins).
  - *The per-service surface check forgave any sub-key of a declared
    block* — `$svc.podDisruptionBudget.typoKey` passed because the
    parent dict was declared. A parent declared as a DICT enumerates
    its children in the surface, so a sub-key read that is not among
    them is now a finding; only a parent declared null (the optional
    shape) forgives.
  - *A dashed Go template comment inside an env value was read as a
    value* — `{{- /* note */ -}}` is the chart's house style, and the
    scanner stripped only the undashed form, flagging the comment as an
    unquoted value. Both forms strip now.
  - *The notApplicable category had a live claim the source
    contradicts* — `frontend.VUE_PROXY_HOST` is read by `server.js`
    (line 11). The claim holds for the shipped RUNTIME (the image's CMD
    runs nginx, which proxies /api itself; server.js is the dev-only
    proxy; src/ reads the proxyHost key nowhere) — the comment now
    names that evidence, and the machine verifier is a deferred item.
  - *The keycloak smoke asserted reachability but not correctness* —
    the HTTP code was printed for a human and never parsed; a 404 from
    a drifted realm name reached "proceed with merge". The code is
    asserted (200 or 401) and the failure is fatal.
  - *The env extractors read only the pod-template shape* — a bare Pod
    carries its containers in its own spec, so the clearable sweep and
    the env-types render half saw no rows for the chart's test pods.
    Both read both shapes now, like the keycloak expectation already
    did.
  - *The keycloak expectation kept only the last port per component* —
    a workload reaching Keycloak on two ports was membership-checked on
    one; a policy admitting the wrong port passed. Every port is
    collected and asserted now.
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
    umbrella, and the overlay names the umbrella's version.
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
  - *The chart's version moved with the chart's content, and nothing
    enforced it* — 114 commits of this branch changed the chart
    without moving the version, and the deploy repo's overlay then
    named a release the cluster was not running.
    `scripts/chart-version-check.py` fails the pipeline when the
    content moves without the version. (The reason this pass gave —
    "Flux reconciles `spec.chart.spec.version`" — was wrong: for a
    Git-path source the field is ignored, and pass 32 corrected it.)
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
- Chart `genieai-umbrella` at **0.2.125** on `feat/k8s-migration`; deployed on
  the laptop minikube via Flux from `genie-ai-deploy` (`overlays/jrevillard-laptop/dev`).
- Rebased onto `main` at `18d02f094` (the tip that carries !586, !587,
  !588); the branch has since drifted 12 commits behind `origin/main`
  (see the current state above).
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
     the chart-version rule explains that the version is the deploy
     repo's LABEL of the installed chart (for a Git-path source Flux
     ignores the field; the install decision is the source's digest).
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
  - *A verifier for the parity gate's `notApplicable` and `composeOnly`
    categories.* `notRead` has one (it walks the shipped source); the other
    two are reviewed by hand in the pass loop. A machine check needs the
    notion of a variable the shipped RUNTIME reads, not one the source tree
    mentions — the frontend's `VUE_PROXY_HOST` is read by `server.js`, which
    the image never executes (the CMD runs nginx), so a naive source walk
    both over- and under-reports.

  - *Clearable-gate addendum (0.2.129)*: the authed probe's env rows sat
    inside the init container, gated on `data.arangodb.enabled` while the
    Job itself was gated only on `services.backend.enabled` — clearing
    `data` removed ARANGO_USER from a surviving workload, and the
    clearable-blocks gate flagged the unowned drop. The whole Job is now
    gated on backend AND arangodb (no Arango = nothing to migrate; the
    backend fails its own named connection error). Baseline render
    byte-identical; gate green.

  - *chatqna readiness starvation (0.2.130)*: after the authed probe let
    the upgrade proceed, chatqna sat at 0/1 Ready — its startup does a
    HEAD against huggingface.co for the baked-in granite config, a pod
    with no internet egress answers Errno 101, and the blocking 5x8s
    retry loop starved the uvicorn event loop: the 1 s readiness probe
    timed out 267 times and the pod left the Service endpoints, which
    surfaced downstream as `connect ETIMEDOUT` from the backend (the
    French chat check). Fix: `HF_HUB_OFFLINE: "1"` in opea.chatqna.env —
    the models are baked into the image, the check is pointless in an
    air-gapped cluster. Compose variant deferred to its own MR (compose
    is read-only for chart work).
