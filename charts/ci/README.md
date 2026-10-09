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
