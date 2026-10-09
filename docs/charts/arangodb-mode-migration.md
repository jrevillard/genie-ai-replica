# ArangoDB mode migration

`kube-arangodb` requires **fresh `helm uninstall` + `helm install`** when transitioning between single-node and cluster modes. In-place upgrade attempts fail with `ArangoDeployment.spec.mode is immutable`. The chart does not perform this conversion automatically — operators must:

1. Backup **both** data stores — the uninstall below is namespace-wide and destroys everything:
   - Arango: `arangodump` (or a PVC snapshot if the storage class supports it)
   - Postgres: `pg_dump` via the CNPG pod (`kubectl exec` into the `keycloak-db-*` instance pod, `pg_dumpall` as the postgres user)
2. `helm uninstall <env>` — use a plain release name; the chart prefixes resource names itself, and `genieai-<env>`-style release names collide with the fullname-derivation pattern
3. BLAST RADIUS, stated honestly: uninstall deletes the release-owned Namespace, and namespace deletion cascades **every** resource inside it — Arango PVCs, CNPG Postgres PVCs, Secrets materialized from SealedSecrets, everything, release-owned or not. Nothing survives step 2; the step-1 backups are the only recovery path.
4. `helm install <env> charts/genieai-umbrella --set data.arangodb.mode=cluster`
5. Restore both data stores from backup
