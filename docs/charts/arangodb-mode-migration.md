# ArangoDB mode migration

`kube-arangodb` requires **fresh `helm uninstall` + `helm install`** when transitioning between single-node and cluster modes. In-place upgrade attempts fail with `ArangoDeployment.spec.mode is immutable`. The chart does not perform this conversion automatically — operators must:

1. Backup **both** data stores — the uninstall below destroys the release's resources:
   - Arango: `arangodump` (or a PVC snapshot if the storage class supports it)
   - Postgres: `pg_dump` via the CNPG pod (`kubectl exec` into the `keycloak-db-*` instance pod, `pg_dumpall` as the postgres user)
2. `helm uninstall <release>` — use the plain release name the deployment
   actually uses. On the Flux path the release is named `genieai`
   (`releaseName: genieai` in the overlay's `helmrelease.yaml`), so the
   command is `helm uninstall genieai -n genieai`. A `genieai-<env>`-style
   release name collides with the chart's fullname-derivation pattern.
3. BLAST RADIUS, stated honestly: the uninstall deletes the release's
   **regular resources** — the `ArangoDeployment` and its PVCs, the CNPG
   `Cluster` and its PVCs, the Deployments, the Secrets materialized from
   SealedSecrets. It does **not** delete the release namespace: the chart
   does not own it (the deploy-repo Kustomization applies it, and the
   chart deliberately renders no Namespace object for the release — a
   chart-owned namespace made every failed install→uninstall remediation
   DELETE it and cascade away the SealedSecrets and the operator
   resources with it). A namespace that becomes empty stays; the PVCs
   inside it do not, unless the namespace itself is deleted.
4. `helm install genieai charts/genieai-umbrella/ -n genieai \
     --create-namespace --set ingress.host=<public-host> \
     --set data.keycloak.adminEmail=<ops@example.org> \
     --set data.keycloak.smtp.from=... --set data.keycloak.smtp.host=... \
     --set data.keycloak.smtp.port=587 --set data.keycloak.smtp.starttls=true \
     --set data.arangodb.mode=cluster`
   — the render refuses without the public host, the operator contact
   and a mail server (`ingress.host is required`,
   `data.keycloak.adminEmail is required`, and the realm's mail flags
   fail the render with no SMTP server), plus the Secret-backed
   `envSecrets` rows. On the Flux path, edit the overlay's
   `values.yaml` (`data.arangodb.mode: cluster`) instead of installing by
   hand, and let Flux reconcile — a manual `helm install` is fought by
   helm-controller, which owns the release.
5. Restore both data stores from backup.

> **On the Flux path, the release is controller-owned.** Do not
> `helm uninstall` a release helm-controller manages: it reconciles the
> HelmRelease back to its declared state (and retries forever on
> failure). Suspend the reconciliation or drive the change through the
> deploy repo — see `.claude/rules/K8s-WORKFLOW.md`.
