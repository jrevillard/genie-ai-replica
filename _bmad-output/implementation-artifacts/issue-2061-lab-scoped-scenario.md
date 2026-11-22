# #2061 — the group-scoped test scenario (the fixture for a scoped Testing Lab)

**Status: BUILT AND VERIFIED on the local build (2026-11-22).** Ships in its
own MR (`feat/okf-lab-scoped-scenario`); it changes no product code.

Companion artifact: `issue-2061-testing-lab-scoped-evaluation.md` (the phase
record and the security baseline phase 2 inherits).

## Why this exists

The Testing Lab's universe is the DEPLOYMENT's, not the caller's: a run scores
every repository head that competes, whichever caller opened it. That is
honest — the docs now say so — but it leaves the next phase (E-1/E-2, the
Evaluation Context) with nothing to stand on:

- no deployment had two repositories fenced behind **different** groups, so
  "the evaluated set" was never a function of the caller;
- no caller carried **two** scope strings at once, so the union of several
  group memberships — the thing an Evaluation Context has to express — was
  never exercised.

David's instruction after phase 1 was to look at the existing repositories,
structure the groups and users the local build needs, and either write the
instructions or build the fixture. This is the built fixture, and the
instructions.

## What was built

Everything goes through the PRODUCT's own facilities — no direct Keycloak
writes for the grants:

| Piece | How it is made | What it is |
|---|---|---|
| fence A | `PUT /api/okf/repos/:id/access` `{restricted: true}` | a serving repository behind the per-repo gate |
| fence B | already fenced by an earlier grant (the harness re-asserts it) | the second fence |
| group A | `POST /api/okf/repos/:id/access/grant-group` | holds the scope-shaped realm role `okf:t:<fence A>:read` |
| group B | the same, for fence B | holds `okf:t:<fence B>:read` |
| principal A / B / AB / none | Keycloak admin API (create + group membership) | one per scope combination, plus the control |

**The global scope mode is untouched.** `OKF_SCOPE_MODE` stays `open`: the
deployment runs in it, and the per-repo fence is what decides. Under `open` a
scopeless caller reaches every UNRESTRICTED repository and is fenced OUT of a
restricted one until granted — the exact posture the fixture needs
(`components/okf-server/services/access-control-service.js:50-58`).

**The mechanism the fixture rides** is the existing one, not a new one: a
group grant makes the scope-shaped role a group member's realm role, the
okf-server middleware folds realm role names that are scope strings into the
caller's effective scopes (`components/okf-server/middleware/auth.js:43-51`),
and the per-repo gate reads those scopes. The union of two group memberships
is therefore just two scope strings on one token — which is the shape the
Evaluation Context has to name.

## The verification (structural, on the running build)

A fence's graph name is minted from the repository's name and version
(`workingGraphName`), so the harness does not guess it: each fence is derived
as the SET DIFFERENCE between the principal that holds it and the control that
holds none. What is asserted is the structure, not a name.

```
okf-lab-principal-a      traversable=13
okf-lab-principal-b      traversable=13
okf-lab-principal-ab     traversable=14
okf-lab-principal-none   traversable=12
fence A: OKF_emulator-walk_v1
fence B: OKF_solar-system_v1
sizes: none=12 a=13 b=13 ab=14
PASS  fence A is exactly one repository
PASS  fence B is exactly one repository
PASS  the two fences are disjoint
PASS  the control traverses NEITHER fence
PASS  a group holder traverses its own fence
PASS  a group holder traverses NOT the other fence
PASS  b group holder traverses its own fence
PASS  b group holder traverses NOT the other fence
PASS  a member of BOTH groups traverses BOTH fences (the union)
PASS  the union is exactly none + A + B
PASS  the union is strictly larger than either group alone
```

Measured through `GET /api/okf/authz/graphs` — the same read the carrier
resolves through, so the fixture is verified at the boundary that matters
(the carrier's `authorized_graph_names`), not at a mock.

## How to run it

```bash
# from the build root (it reads .env)
node scripts/okf-testing-lab/lab-scoped-scenario.js            # apply + verify
node scripts/okf-testing-lab/lab-scoped-scenario.js --verify   # verify only
node scripts/okf-testing-lab/lab-scoped-scenario.js --teardown # remove it all
```

Idempotent; it restores the direct-access-grant setting it borrows and
deletes its throwaway tools-admin caller. The principals' random passwords
land in `okf-scenario-credentials.json` in the build root — git-ignored,
host-side, never printed, never committed.

## What it does NOT do

- It does not flip `OKF_SCOPE_MODE`, and it does not change the deployment's
  posture beyond the two fences.
- It does not create an Evaluation Context object, a carrier writer, or any
  product code. Phase 2's entry criterion is unchanged and still unmet: the
  carrier-trust findings **#2081** (F1 and F2) must be fixed before a
  substituting writer may exist.
- It does not decide what the Lab's scoped universe should BE. It makes the
  question answerable: with two fences and a union-carrying principal in
  place, E-2's "which repositories are in the evaluated set" has a case that
  fails today (the Lab would score all of them) and passes afterwards.
