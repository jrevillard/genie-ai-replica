# ArangoDB mode migration

`kube-arangodb` requires **fresh `helm uninstall` + `helm install`** when transitioning between single-node and cluster modes. In-place upgrade attempts fail with `ArangoDeployment.spec.mode is immutable`. The chart does not perform this conversion automatically — operators must:

1. Backup Arango data (`arangodump` or PVC snapshot if SC supports it)
2. `helm uninstall genieai-<release>`
3. Verify all PVCs unbound (CNPG/sealed-secrets do not delete, but arango storage does)
4. `helm install genieai-<release> charts/genieai-umbrella --set data.arangodb.mode=cluster`
5. Restore Arango data from backup
