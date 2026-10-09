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

Pinned K8s version: **1.33.0** — the kind node image AND the `ct install --kube-version 1.33.0` CLI flag (there is no config-file key for it). Update both in lockstep.
