---
title: "Access Control"
description: "Who can query which OKF repositories — the default-open read model, Keycloak scopes, the write-side rules, and the planned admin facility."
weight: 6
---

Every chat query is answered from a set of knowledge repositories. **Access
control decides which repositories that set contains for the person asking.**
This page describes the complete capability: how a signed-in user reaches OKF
repositories, how access can be restricted, what is enforced today, and what is
planned.

## The mental model

Access control is **per-user, not per-query**. When a query arrives, the
backend resolves the caller's identity to an *authorized graph set* — the list
of serving OKF repositories that user may reach. Retrieval then routes the
query only into those repositories. Nothing the user does at question time can
widen that set.

```
Keycloak JWT ──► okf-server authz ──► authorized graph set
                                          │
              chat query ──► BFF carrier (authorized_graph_names)
                                          │
                              chatqna → retriever (routes per graph)
```

Three facts define the model:

1. **Identity comes from Keycloak.** Every request carries a verified JWT.
   The relevant claims are the user's roles (the `tools-admin` bootstrap
   super-role) and any `okf:*` scopes.
2. **The universe is the *serving* set.** A repository is serving when it is
   published, fully ingested, and not deleted. Draft, review and retracted
   repositories are never reachable by chat queries — for anyone except
   curation flows.
3. **Scopes restrict; their absence no longer disables.** Since the
   default-open change (October 2026), a user holding no `okf:*` scopes is
   authorized for **all serving repositories**. A user holding at least one
   scope is restricted to exactly the scoped repositories.

## What each caller gets

| Caller | Authorized OKF graph set |
|---|---|
| `tools-admin` super-role | Every serving repository |
| A wildcard scope (`okf:*:*:read` or `admin`) | Every serving repository |
| One or more exact scopes (`okf:itu:repo-a:read`) | Exactly the scoped repositories — in both modes |
| No `okf:*` scopes (the default for every regular user) | **Every serving repository** (`OKF_SCOPE_MODE=open`, the default) — or none (`closed`) |

Two properties hold in every mode:

- **Write access is never opened by default.** Creating, editing, ingesting,
  publishing or deleting repositories always requires the corresponding
  `admin` scope or the super-role. The default-open rule exists on the *read*
  side only — a regular user can query everything, but can touch nothing.
- **The intersection is the guarantee.** Authorization is the intersection of
  *what is serving* and *what the caller may reach*. A repository that is not
  serving never appears, no matter what the caller holds.

## The scope grammar

A scope is a four-segment string on the JWT:

```
okf:{tenant}:{repo}:{level}
```

- **level** must be `read` or `admin`. `admin` implies `read`. Anything else
  (a typo such as `write`) grants nothing.
- **repo** is a repository id, or `*` for all repositories. A `*` repo segment
  makes the whole scope unrestricted.
- **tenant** is currently ignored (reserved for future multi-tenancy).
- Malformed scopes are ignored, never an error: a broken scope grants nothing
  and cannot fail a login.

Scopes are read from the `okf_scopes` claim (falling back to entries in the
standard `scope` claim).

## The mode flag: `OKF_SCOPE_MODE`

| Value | Behavior for a user with **no** `okf:*` scopes |
|---|---|
| `open` *(default)* | Authorized for every serving repository |
| `closed` | The historical default-deny: no OKF repository, legacy collection only |

- **When to close it:** only if a deployment must not expose its serving
  repositories to general users — for example a staging system holding
  sensitive crawl content, or a pilot where OKF answers should be limited to a
  pilot group. Closing it *requires* a scope-granting mechanism to be in place
  first (see [Keycloak integration](#keycloak-integration)), otherwise every
  regular user loses OKF access entirely.
- **How to flip it:** set `OKF_SCOPE_MODE=closed` in `.env` (Docker Compose)
  or `okf_scope_mode: closed` in `group_vars` (Ansible — the env template key
  is snake_case; an `OKF_SCOPE_MODE:` key in group_vars is silently unused and
  the deployment stays open) and recreate the okf-server container. The value
  is read per request; no rebuild is needed.
- **Invalid values fail closed.** Only `open` and `closed` are recognized; the
  variable's *absence* means `open`. An explicitly **empty** value counts as
  invalid, not as absent. An explicit typo (e.g. `OKF_SCOPE_MODE=opn`)
  degrades to `closed` with a warning in the okf-server log — a misconfigured
  attempt to pin a deployment must not silently fail open.
- **Any granted scope still restricts its holder in both modes.** Open mode is
  not "ignore scopes"; it is "absence of scopes is not a denial". A token
  carrying okf scope entries that are all malformed (e.g. wrong level or
  segment count) counts as *scoped* and keeps the closed list — the
  restriction was intended, and closed is its visible symptom.

## What a scopeless caller can and cannot reach

Default-open is deliberately narrow. A user with no `okf:*` scopes passes two
read endpoints on the OKF API — nothing else:

| Surface | Scopeless caller in open mode |
|---|---|
| `GET /api/okf/authz/graphs` (the chat authorization endpoint) | ✅ Allowed — note this response enumerates the serving inventory: repository names, ids, domains and graph names |
| `GET /api/okf/retrieval-config` (the chat posture read) | ✅ Allowed — with the governing admin's identity (`updated_by`) stripped; identity metadata is superadmin-only |
| Repository list, concept content, Studio, Lab, audit | ❌ Still scope-gated |
| Any write (repo CRUD, ingest, lifecycle, governance) | ❌ Requires `admin` scope or super-role — in both modes |

Two deliberate consequences, stated plainly:

- **Read-side openness is cross-tenant.** The tenant segment of a scope is
  currently ignored everywhere (a Story 6.1 consistency rule), so in open mode
  a scopeless user reaches serving repositories from *every* domain, not just
  "their" tenant. Tenant-scoped read isolation arrives with the admin-facility
  work item, not before.
- **The serving inventory is readable.** Any authenticated user can learn
  which repositories exist and serve. Repositories' *content* stays behind
  the query pipeline (answers only surface chunks relevant to a query); only
  the names/ids/domains are exposed.

## Conversation continuity (sticky routing)

A conversation remembers which repositories answered its recent questions and
hints the next query toward them ("sticky" graphs). Sticky hints are always
**filtered through the current user's authorized set** before use — if a user
loses reach to a repository (or a repository is retracted), the next query
cannot follow the conversation into it.

## Repository-level restriction (the admin facility)

Every repository carries an access-control entry — **new repositories default
OPEN for all users**; restriction is opt-in per repository. Two pieces:

### The restriction toggle

In the repository editor's right rail, the **Access** panel shows each
repository's posture and a toggle:

- **Open for all users** *(the default, including every newly created
  repository)*: the repository follows the deployment's mode — in the default
  `open` mode, every signed-in user's queries can reach it.
- **Restricted**: the repository is fenced off. Only stewards (super-role or
  wildcard scope) and users holding a grant for that repository can query it —
  in EITHER mode. Default-open does not bypass a restriction: a scopeless
  regular user reaches every *unrestricted* repo but is fenced out of
  restricted ones until granted.

Restriction is enforced at the two serving reads (`/authz/graphs` and
`/retrieval-config`), identically — the chat carrier and the engagement gate
can never disagree about a restricted repository.

### Grants and revocations

The same panel grants and revokes per-user access (`read` or `admin` level).
A grant writes an `okf:{tenant}:{repo}:{level}` entry into the user's
`okf_scopes` Keycloak attribute; the existing protocol mapper ships it in the
user's token, so **a grant takes effect at the user's next login** and
survives logout everywhere (it is a Keycloak attribute, not a session).
Every grant, revoke and restriction toggle is written to the audit log.

Grants require okf-server to hold Keycloak credentials for the delegated
user-management client:

| Variable | Default | Purpose |
|---|---|---|
| `KC_OKF_ACCESS_CLIENT_ID` | `genie-proxy-client` | The service account okf-server uses for grant/revoke Admin-API writes. |
| `KC_OKF_ACCESS_CLIENT_SECRET` | unset | Its secret. Unset = the grant/revoke routes answer `503 ACCESS_CONTROL_UNCONFIGURED` (the panel says so honestly) — **restriction enforcement needs no Keycloak and keeps working**. |

### The declared `required_scopes` field

Repositories are stamped at creation with `acl.required_scopes` (a
domain-steward scope). With the facility shipped, a restricted repository is
also traversable by holders of any scope satisfying one of those declared
entries — the hand-set path for operators who provision scopes directly in
Keycloak rather than through the panel.

## Keycloak integration

**What ships** — the claim plumbing and the grant facility:

- The realm template (`configs/keycloak/genie-realm.yaml`) provisions an
  `okf-scopes` protocol mapper on the `genie-app` and `okf-server` clients
  that copies a multivalued user attribute `okf_scopes` into the token's
  `okf_scopes` claim. The built-in admin user carries
  `okf_scopes: [okf:*:*:admin]` through exactly this path.
- The repository editor's **Access** panel grants and revokes per-user,
  per-repo access by writing that same attribute through the Keycloak Admin
  API (the `genie-proxy-client` service account; see the
  `KC_OKF_ACCESS_*` table above). Every change is audited.

Setting a user's `okf_scopes` attribute by hand in the Keycloak admin console
also works and lands in their next token — the panel is the convenient,
audited path, not the only one.

**Operational interplay with the mode flag** — grants RESTRICT in every mode,
and restriction fences repos off in every mode. A deployment can therefore:

- stay `open` and use per-repo restriction + grants only for the repositories
  that need fencing (the default posture), or
- flip `OKF_SCOPE_MODE=closed` for restrict-by-default once grants exist, and
  grant access per user per repo — every regular user then reaches exactly
  the granted set.

No pipeline change is involved in any of this: okf-server consumes the claim
the mapper mints.

## Request flow and observability

1. The BFF calls `GET /api/okf/authz/graphs` with the caller's token and
   receives the authorized graph set (plus a ≤30 s serving-set TTL).
2. The BFF attaches `authorized_graph_names` to the retrieval context (ADR
   okf-039), together with sticky graphs filtered through that same set.
3. chatqna re-encodes the set into the retrieval carrier; the retriever routes
   the query into each authorized graph.
4. Denials (closed mode, or insufficient scope on any other surface) are
   audited as `authz.denied.*` rows; admissions and resolutions carry
   `okf.authz.*` span attributes (`scope_mode`, `unrestricted`,
   `authorized_graphs`).

**Revocation skew:** consumers may cache the serving set for up to 30 seconds
(the TTL on the authz response). A change in what a user can reach — including
losing a scope — takes effect within that window, never later.

## Related pages

- [Ingestion]({{< relref "ingestion" >}}) — how repositories become serving.
- [Document lifecycle]({{< relref "document-lifecycle" >}}) — publish and
  retract transitions.
- [OKF variables reference](/docs/configure/okf-variables/) — every
  `OKF_*` setting, including `OKF_SCOPE_MODE`.
