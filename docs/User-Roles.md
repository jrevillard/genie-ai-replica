# User Roles

Historical design document — kept as a stub so old links land somewhere true
instead of 404. The hierarchical RBAC it described (Manager gating uploads,
AI Engineer gating the Query Inspector, a four-tier permission matrix, the
middleware files cited as enforcing it) never shipped with the v2.0 Keycloak
deployment, and those middleware files do not exist in this codebase.

Current reality: [`users.md`](users.md) §5 — only the Keycloak realm role
`admin` authorizes anything (every `/api/admin/*` route); the
`User` / `Manager` / `AI Engineer` / `Admin` labels are display-only metadata.
The full account lifecycle (registration, approval, first admin) is
[`users.md`](users.md).
