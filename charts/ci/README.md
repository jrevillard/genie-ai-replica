# CI / chart-testing configuration

`charts/ci/ct.yaml` configures [chart-testing](https://github.com/helm/chart-testing)
for the umbrella chart. Locally:

```bash
make test
```

`ct` v3.15+ requires an explicit Chart.yaml schema and yamllint config — both
live beside the ct config (`chart_schema.yaml`, `lintconf.yaml`) and must be
passed on the CLI:

```bash
ct lint --config charts/ci/ct.yaml \
  --chart-yaml-schema charts/ci/chart_schema.yaml \
  --lint-conf charts/ci/lintconf.yaml \
  --charts charts/genieai-umbrella
```

Pinned K8s version: **1.33.0** — the kind node image (`kindest/node:v1.33.0`)
the cluster is created from, and `kube-version`, the file every render
names. There is no ct config key and no ct CLI flag for the node image
(verified against chart-testing v3.15.0 source).

`kube-version` holds the version the chart is RENDERED against, and it
is one value for every surface: the pipeline's renders, the CI jobs'
renders, the gate scripts' own renders (`scripts/ci/*.py`), the render
guards and `scripts/local-test.sh`. Without an explicit `--kube-version`,
helm compares the chart's `kubeVersion` constraint against the
Kubernetes version COMPILED INTO the helm binary — so the same chart
renders on one machine and fails on another, and a helm release that
ships a newer k8s breaks every render in the pipeline for a reason that
has nothing to do with the chart. The file holds the range's LOW bound
(the CI validates against it; the laptop cluster runs the high bound).

## The GPU node host every CI render names

`https://gpu.ci-render.local:444` — one value, in every job's render
(`chart:lint`, `chart:parity`, `chart:crd-validate`) and in the gate
scripts' own renders (`scripts/ci/clearable-blocks-check.py`). The external
GPU mode refuses to render without a node host, so every surface that
enables the OPEA tier names one; when two jobs named two different hosts,
their "prod" renders stopped being the same surface, and a defect that
only shows for one host shape (a DNS name with dots, an explicit port, an
IP literal — which changes the derived egress ipBlock) was covered in one
job and missing from the other.

## The API versions the renders declare

`--api-versions opentelemetry.io/v1beta1/OpenTelemetryCollector` — one
line, in `render-base-flags`, so every render (the pipeline's jobs and
the gate scripts' own) declares it.

The chart renders the `OpenTelemetryCollector` CR only where the
operator's CRD is served: the OpenTelemetry Operator is a cluster
bootstrap prerequisite, and a cluster without it cannot map the kind —
which aborts the WHOLE atomic Helm upgrade. The guard reads Helm's
`Capabilities.APIVersions`, which an OFFLINE render (`helm template`)
fills with nothing, so the CR would silently vanish from every CI
render — and with it the coverage `chart:contract` (the collector's
config) and `chart:crd-validate` (the CR against the installed CRD)
exist to provide. Declaring the API version explicitly restores it.

A flag file carries no comments: the readers split each line on
whitespace and pass it straight to `helm`, so a `#` line would reach
the binary as an argument.

## The realm's placeholders, and the Job that must export them

`configs/keycloak/genie-realm.yaml` carries `$(env:VAR)` placeholders that
keycloak-config-cli substitutes at import time. The chart ships a COPY of
that file (`charts/genieai-assets/files/genie-realm.yaml`) and CI compares
the two with `cmp` — a copy that drifts changes what the chart imports, so
the check is a hard gate.

The chart's own render-time guard checks the placeholders against `$known`,
a list written out BY HAND in the convergence Job template, in parallel
with that Job's env block. The two lists are not derived from each other:
a name in `$known` is not necessarily exported, and a placeholder that is
declared but never rendered passes every render and aborts the import at
runtime with a kcc parse error that names nothing.

`scripts/ci/realm-placeholder-export-check.py` closes that hole from the
RENDER — the env names the convergence Job actually exports, against the
placeholders the realm actually carries. It runs in `chart:lint`, right
after the base render. A render that carries no convergence Job is
refused as vacuous rather than passing.

It proves a placeholder is EXPORTED, not that its value is right: the
name is the contract this gate owns, the value belongs to the template
that computes it.

## The parity floor is a measurement

`config-parity-check.py --min-compared=N` floors how many variables the
run actually COMPARED. Every allowlist category (`mayDiffer`,
`codeDefault`, `composeOnly`, `notRead`, `secretProvided`) removes
variables from that set, so a reclassification lowers the count — and a
floor left where it was stops noticing. The floor equals the count, not
one below it.

So it is a MEASUREMENT, not a constant: re-measure it whenever the
allowlist changes (the gate prints the count in its first line) and
update the invocation in `.gitlab-ci.yml` in the same commit. A floor
that is even one below the count hides exactly the reclassification it
exists to catch.
