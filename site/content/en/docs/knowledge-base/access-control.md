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
  or `group_vars` (Ansible) and recreate the okf-server container. The value
  is read per request; no rebuild is needed.
- **Any granted scope still restricts its holder in both modes.** Open mode is
  not "ignore scopes"; it is "absence of scopes is not a denial".

## What a scopeless caller can and cannot reach

Default-open is deliberately narrow. A user with no `okf:*` scopes passes two
read endpoints on the OKF API — nothing else:

| Surface | Scopeless caller in open mode |
|---|---|
| `GET /api/okf/authz/graphs` (the chat authorization endpoint) | ✅ Allowed |
| `GET /api/okf/retrieval-config` (the chat posture read) | ✅ Allowed |
| Repository list, concept content, Studio, Lab, audit | ❌ Still scope-gated |
| Any write (repo CRUD, ingest, lifecycle, governance) | ❌ Requires `admin` scope or super-role — in both modes |

## Conversation continuity (sticky routing)

A conversation remembers which repositories answered its recent questions and
hints the next query toward them ("sticky" graphs). Sticky hints are always
**filtered through the current user's authorized set** before use — if a user
loses reach to a repository (or a repository is retracted), the next query
cannot follow the conversation into it.

## Repository-level ACL — declared, not yet enforced

Repositories carry an `acl.required_scopes` field (stamped at creation, e.g.
`okf:t:{domain}:admin`). **Today this field is metadata only** — the serving
path does not consult it. It is the anchor for the planned enforcement work:
once the admin facility (below) can grant scopes, per-repository
`required_scopes` become the second gate a caller must satisfy before a
specific repository enters their authorized set. Until that ships, the honest
statement is: repository-level restriction is possible only by granting (or
not granting) scopes per user.

## Keycloak integration

**Today** — no Keycloak client scopes or protocol mappers for `okf:*` claims
ship with the product, and there is no admin UI to grant one. That is precisely
why the default matters: with no way to grant scopes, `closed` mode locks
every regular user out of OKF answers, while `open` mode delivers the intended
behavior — *once a repository is ingested and published, any regular user's
query can be routed to it*.

**Planned** (sprint item *okf-repo-access-control-keycloak*) — the full
facility:

1. **Keycloak side:** an `okf-scope` client scope with protocol mappers that
   put `okf:{tenant}:{repo}:{level}` entries into the token's `okf_scopes`
   claim; roles or groups per repository.
2. **Admin facility:** grant and revoke repository access per user or group
   from the OKF admin UI, with an audit trail; writes the grantings through to
   Keycloak so tokens carry them on next login.
3. **Enforcement:** once scopes are being granted, administrators choose per
   deployment whether to flip `OKF_SCOPE_MODE=closed` (restrict-by-default) or
   stay open and use scopes only for exceptional restrictions.
4. **Per-repository ACL enforcement:** `acl.required_scopes` on the repository
   doc becomes a live second gate in the authorized-set resolution.

No pipeline change is needed when that lands: okf-server already reads the
claims the mappers will produce.

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
