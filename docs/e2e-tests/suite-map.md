# The E2E suite map

The map of the Playwright suite in `tests/e2e/`: for every spec file — the
feature area it lives in, the acceptance phase/story it serves (the
`docs/e2e-tests/` phases), the deployment profile it needs, and the shared
helpers it uses. Raised by the operator's question of 2026-11-10 and
delivered as issue #1741.

## The one axis

The suite is organized on **ONE axis: the functional area**. Every spec
lives in the directory of the area it drives. The former phase directories
(`epic1/`, `epic2/`, `epic3/`) were a second axis mixed into the same tree —
a file that belongs to the auth area living under `epic2/` was the visible
symptom (#1741).

Phase traceability survives the reorganization in two places:

- the **phase-letter filename prefixes** (`a1-`, `d7b-`, `g1-`, `l3-`), kept
  on every acceptance spec when it moved into `auth/`;
- the **Phase/story column** of the map below, which ties every spec to its
  phase and its source document.

The rule for new work: **one spec, one place, one axis**. A new spec goes
under its area's directory. A spec whose area is unclear becomes a follow-up
issue (see *Exceptions and follow-ups*), never a root-level file and never a
revival of a phase directory.

Decision record: the alternatives considered in #1741 were keep-phase (the
loose root specs move under phase dirs), move-to-functional (this choice),
and split-hybrid (phase dirs for acceptance specs, feature dirs for the
rest — rejected: it keeps BOTH axes in the tree, which is the problem being
fixed). Functional won because the phase directories were already redundant
as an axis — every phase spec is an auth/session spec, so `epic1/`–`epic3/`
were one area wearing three phase names — while the feature axis is what
the defect evidence demanded (an auth spec findable under `auth/`, an
area's specs and their helpers together for a wave like #1822).

## `auth/` — login, session lifecycle, tokens and realms

Source documents: [epic1-keycloak-foundation.md](epic1-keycloak-foundation.md)
(phases A–E), [epic2-secure-api-access.md](epic2-secure-api-access.md)
(phases F–K), [epic3-session-lifecycle-gdpr.md](epic3-session-lifecycle-gdpr.md)
(phases L–N).

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `a1-login-redirect.spec.js` | A.1 | unauthenticated app root redirects to the Keycloak login page | core | `base-url` |
| `a2-full-login-flow.spec.js` | A.2 | full browser login: app → Keycloak → authenticated app | core | `base-url`, `e2e-fixtures` |
| `a3-legacy-routes-redirect.spec.js` | A.3 | removed legacy auth routes (`/login`, `/register`, `/forgot-password`) behave on the Keycloak IdP | core | `base-url` |
| `d7a-external-idp-button.spec.js` | D.7a | external-IdP button renders on the login page | external-IdP | `base-url`, `venue-profile` |
| `d7b-external-idp-login-flow.spec.js` | D.7b | full login through the brokered external identity provider | external-IdP | `base-url`, `venue-profile` |
| `g1-swagger-authorize.spec.js` | G.1 | Swagger UI loads with the OAuth2 security scheme and its Authorize button | core | — |
| `h1-jwks-force-refresh.spec.js` | H.1 | realm key rotation forces a JWKS refresh; sessions survive it | core | `auth`, `keycloak-admin` |
| `i1-multi-realm.spec.js` | I.1 | a second realm (`genie2`) validates tokens through its own JWKS | multi-realm | `auth`, `keycloak-admin`, `venue-profile` |
| `j1-opea-continuity.spec.js` | J.1 | the session token propagates to the OPEA services and the sanitized profile comes back | core | `auth` |
| `k1-auth-error-display.spec.js` | K.1 | Keycloak auth failures render the visible error surface (and its realm mutation is reverted) | core | `auth`, `keycloak-admin` |
| `l1-frontend-logout-redirect.spec.js` | L.1 | logout redirects to the Keycloak login page | core | `base-url`, `e2e-fixtures` |
| `l2-localstorage-cleanup.spec.js` | L.2 | logout clears the legacy localStorage items | core | `base-url`, `e2e-fixtures` |
| `l3-vuex-state-cleared.spec.js` | L.3 | logout clears the Vuex auth state | core | `base-url`, `e2e-fixtures` |

Phases **without** a Playwright spec — B, C, E (foundation provisioning
steps), F (backend-side token-forwarding verification), M and N (user
lifecycle, GDPR erasure) — are the manual shell phases of their source
documents. They are procedures, not specs; this map records the fact so no
one reads a missing directory as an accident.

## `chatbot/` — the chat surface

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `chat-composer.spec.js` | — (feature spec) | one composer instance at a time across the welcome screen/chat view; i18n keys it renders match the frontend locale files | core | `welcome`, `layout`, `base-url` |
| `chat-conversation.spec.js` | — (feature spec) | the conversation view's V1 invariants (header, bubbles, feedback, held-release stream) | core | `welcome`, `chatbot`, `route`, `layout` |
| `conversation-history.spec.js` | — (feature spec) | conversation history list, deletion and the cleanup sweep caps | core | `auth`, `chatbot` |
| `error-handling.spec.js` | — (feature spec) | a failed chat turn renders the answer card's error block and recovers | core | `chatbot` |
| `quick-help-scope.spec.js` | — (feature spec) | the Quick Help grid renders its declared scope and dead cards send nothing | core | `route`, `stream-route`, `welcome` |
| `send-message-and-stream.spec.js` | — (feature spec) | sending a message and the SSE stream rendering | core | `chatbot` |

## `documents/` — document management

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `search.spec.js` | — (feature spec) | document search by partial name | core | `auth`, `documents` (+ `fixtures/` seed files) |
| `upload.spec.js` | — (feature spec) | upload of each supported extension into the document table | core | `auth`, `documents` (+ `fixtures/` seed files) |

## `admin/` — the admin dashboard

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `authz.spec.js` | — (feature spec) | admin surface authorization: navbar gating + backend 403 | core | `auth`, `chatbot` |
| `data-wiring.spec.js` | — (feature spec) | overview stat tiles/health/resources render from the system-health payload | core | `auth`, `chatbot` |
| `failure-states.spec.js` | — (feature spec) | admin API failures render the visible error notification and recover | core | `auth`, `chatbot` |
| `logs-view.spec.js` | — (feature spec) | the Logs tab renders the VL-backed roll-up rows | core | `auth`, `chatbot` |

## `okf/` — the OKF pillar

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `artifacts-view.spec.js` | — (feature spec) | the OKF artifacts view | OKF | `chatbot`, `venue-profile` |
| `concept-ceiling.spec.js` | — (feature spec) | the concept-document size ceiling behaviour | OKF | `chatbot`, `venue-profile` |
| `ragas-guide-errors.spec.js` | — (feature spec) | the RAGAS guide error surfaces | OKF | `auth`, `base-url`, `keycloak-admin`, `locale`, `venue-profile` |
| `ragas-judge-selector.spec.js` | — (feature spec) | the RAGAS judge model selector | OKF | `auth`, `base-url`, `keycloak-admin`, `venue-profile` |
| `ragas-rescore-tracking.spec.js` | — (feature spec) | RAGAS rescore tracking | OKF | `auth`, `base-url`, `keycloak-admin`, `locale`, `venue-profile` |

OKF specs skip **with a reason** on a venue whose runtime config does not
expose the pillar — see [local-run.md](local-run.md).

## `theme/` — frontend shell and visual layer

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `living-intelligence.spec.js` | — (feature spec) | the decoration assets are served from `/config/` and revalidated, never cached immutable | core | `cache-headers`, `chatbot` |
| `resizable-sidebars.spec.js` | — (feature spec) | the shared edge handle: drag, collapse, restore, the clamp | core | `chatbot`, `welcome`, `layout` |
| `responsive-layout.spec.js` | — (feature spec) | the quick-help grid column invariant across viewports | core | `chatbot`, `welcome`, `layout` |
| `welcome-banner.spec.js` | — (feature spec) | the welcome banner scrim: alpha floor, wordmark contrast | core | `welcome` |

## Root — pinned exception

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `theme-runtime-config.spec.js` | — (feature spec) | cache-header contract for the runtime theme config (`/config/theme-variables.css`, `/runtime/config.js`, `@theme_fallback`) | core | `cache-headers`, `base-url` |

It sits at the tree root because the dormant CI invocation
(`.gitlab-ci.yml` → `e2e:playwright`) and its changes-anchor name it
**verbatim** — the one file whose move would edit that frozen file. Its
natural home under the axis is `theme/` (it is the sibling contract of
`theme/living-intelligence.spec.js`); it moves when that CI file is next
edited for real, not before. Follow-up: #1823.

## `helpers/` and `run/` — unit specs of the suite's own modules

These are not app specs: they unit-test the suite's own modules and run
without a venue surface.

| Unit spec | Tests | Profile |
|-----------|-------|---------|
| `helpers/auth.spec.js` | the auth/session minting helper | none |
| `helpers/base-url.spec.js` | the ONE venue-edge module (normalization) | none |
| `helpers/chatbot.spec.js` | the chat login/stream helper | none |
| `helpers/keycloak-admin.spec.js` | the Keycloak admin API helper | none |
| `helpers/route.spec.js` | the route-mock wrapper | none |
| `helpers/venue-launch-args.spec.js` | the browser launch-args/venue-mapping helper | none |
| `helpers/venue-profile.spec.js` | the venue-surface probe (every runtime skip's reason) | none |
| `run/file-failure-issues.spec.js` | the failure path (issue filing from a report) | none |
| `run/install-browsers.spec.js` | the browser-tree reconciler | none |
| `run/preflight.spec.js` | the run pre-flight | none |
| `run/venue-dns.spec.js` | the venue-name mapping preload | none |

## Keeping the map true

The map is documentation of a layout the pins already enforce mechanically:

- the **executed set** (the whole tree) is pinned by `tests/config-validator/`
  from the run script — a spec added anywhere under `tests/e2e/` is executed,
  and a spec file added under one of the CI's executed globs adds one line to
  the validator's exact list;
- the **anchor demand** requires every executed/consumed path to be covered
  by the CI changes-anchor globs, so a spec moved into an area directory
  stays train-triggerable without an anchor edit;
- the **handle-locator gate** and the **fixture-password scan** carry the
  per-file lists they need and were updated by the same MR that moved the
  files (#1741).

When you move or add a spec: move it into its area directory, update this
map's row, and let the validator suite tell you which pin lists followed.
If the honest answer to "which area is this?" does not exist, do not invent
a directory — file a follow-up issue with `status::backlog` and leave the
file where the axis currently least lies about it.
