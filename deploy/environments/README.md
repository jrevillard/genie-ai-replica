# Per-environment overlays live in the deploy repo, not here

This directory is intentionally empty (only this file and a `.gitkeep`).
It used to be documented as the home of per-environment Kustomize
overlays, and several places in this repo still described that model.
It is not the model that shipped.

**Where the overlays actually are.** `genie-ai-deploy` (a separate
repository) holds one overlay per deployment target under
`overlays/<pays>/<env>/`, each with a `kustomization.yaml` and a
`values.yaml`, reconciled by Flux v2 onto the cluster. The per-release
HelmRelease in `flux-system` is the install unit; this repository holds
the chart it points at.

```
genie-ai-deploy/
├── clusters/<pays>/flux-system/     # the Flux Kustomizations themselves
└── overlays/<pays>/<env>/           # values + the HelmRelease for that target
```

The laptop target is `overlays/jrevillard-laptop/dev`, built and
reconciled by `scripts/laptop-cluster-bootstrap.sh`; the whole procedure
is documented in `docs/charts/laptop-cluster-bootstrap.md`.

This directory stays in the tree so the path referenced from older
documentation resolves to something that explains itself, rather than
404ing.
