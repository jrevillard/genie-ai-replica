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

Pinned K8s version: **1.33.0** — solely via the kind node image (`kindest/node:v1.33.0`) the cluster is created from. There is no ct config key and no ct CLI flag for it (verified against chart-testing v3.15.0 source).

## The GPU node host every CI render names

`https://gpu.ci-render.local:444` — one value, in every job's render
(`chart:lint`, `chart:parity`, `chart:crd-validate`) and in the gate
scripts' own renders (`scripts/clearable-blocks-check.py`). The external
GPU mode refuses to render without a node host, so every surface that
enables the OPEA tier names one; when two jobs named two different hosts,
their "prod" renders stopped being the same surface, and a defect that
only shows for one host shape (a DNS name with dots, an explicit port, an
IP literal — which changes the derived egress ipBlock) was covered in one
job and missing from the other.
