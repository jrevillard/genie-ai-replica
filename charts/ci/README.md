# CI / chart-testing configuration

`charts/ci/ct.yaml` configures [chart-testing](https://github.com/helm/chart-testing)
for the umbrella chart. Used by `.gitlab-ci.yml` job `charts:integration` (added in
Plan 7). Locally:

```bash
make test
```

Pinned K8s version: **1.33.0** — the kind node image AND the `ct install --kube-version 1.33.0` CLI flag (there is no config-file key for it). Update both in lockstep.
