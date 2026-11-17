# The local e2e run

The Playwright suite has **no CI door**. The operator's decision of 2026-11-10
gives this suite no CI resources — no CI stage, no per-MR e2e, no repaired
monthly schedule — and the suite runs **locally, regularly** instead.

That makes the local run the thing that defines the **executed set**: the
specs the suite actually runs. Before this run existed, that set was a CI job
(`e2e:playwright`) whose rule requires a merge train this GitLab instance
never creates, so the set was a claim in a YAML file that nobody executed —
and half the suite (`epic1/`, `epic2/`, `epic3/`, `okf/`, the root-level
specs) was outside it, visibly red, and invisible to the repository. The
phase directories and the loose root specs have since been rehomed on
the feature axis — `okf/` was already one and is unchanged, and
`theme-runtime-config.spec.js` — the last root-level holdout, pinned
there by the dormant CI invocation — moved into `theme/` when its pin
moved (#1823, [suite-map.md](suite-map.md)).

## The command

```bash
BASE_URL=https://<your-venue-host>:4443 tests/e2e/run/run-local-e2e.sh
```

One command, from the repository root. It:

1. resolves the **Keycloak admin credentials** — `KEYCLOAK_ADMIN_PASSWORD` or
   `ADMIN_TOKEN` from the environment; otherwise, for the DEFAULT venue only,
   the shared stack's `keycloak-admin-credentials` secret (`kubectl -n
   genieai`, never a credential in the repository). The secret belongs to
   that stack: point `BASE_URL` at any other venue and the run asks for
   credentials instead of guessing;
2. maps the venue **name** to an address when the runner cannot resolve it
   (see *Venue address* below);
3. runs the **pre-flight** — the runner launches the browser and opens the
   venue, and a broken runner stops the run there, before the venue and
   before the tracker (see *The pre-flight* below);
4. **provisions the venue fixtures** — `tests/e2e/provision-e2e-fixtures.js`,
   the same script the CI job and Phase 0 run, so `testuser`, `testadmin`
   and `testplain` exist and are converged before the suite starts;
5. runs the **whole `tests/e2e/` tree** — `npx playwright test tests/e2e/
   --project=chromium`;
6. moves the run's report to a **per-run name** (`reports/playwright-report-run-<stamp>.json`)
   and reads it from there — any later Playwright invocation in the checkout
   (`--list`, a single spec) writes the fixed path again, and the failure
   path must file from **this** run's report;
7. runs the **post-run ROPC posture gate** (below) and records its verdict —
   the venue must not keep a widened auth surface, whatever the specs said;
8. reports the outcome and runs the **failure path** (below); the gate's
   verdict is the exit's last word (exit 5 wins over the suite's own status).

Two **locks** are taken first, one per checkout and one per venue: they stop
two runs on the same machine from resetting the venue fixtures' passwords
under each other's logins and from racing for the same report file. They do
NOT book the venue across machines — the shared stack's slot is booked with
the orchestrator (the coordination board), and that booking is what keeps two
machines off the same stack.

### Prerequisites

Exit codes of the runner: `0` the suite passed and the failure path read its
report; `1` the suite is red (or the failure path could not file); `2` the
runner is missing a tool or the admin credentials; `3` another run holds the
slot (the checkout or the venue lock); `4` the suite wrote no report — a
broken run, nothing is filed; `5` the post-run ROPC posture gate failed
(see *The post-run ROPC posture gate* below); any other code is the suite
process's own death passed through (a signal, an OOM).

| Requirement | Note |
|---|---|
| `npm ci` at the repository root | Playwright resolves from the root `node_modules`, and `npm ci` is what puts the tree at the lockfile's versions (`npm install` is free to drift from them) |
| `node tests/e2e/run/install-browsers.js` | reconciles the checkout and the browser tree with the pinned `@playwright/test` — the build the suite drives must be the one the lockfile pins, and `PLAYWRIGHT_BROWSERS_PATH` must point at it when it lives outside the default cache (see *The browser tree* below) |
| the browser's shared libraries on `LD_LIBRARY_PATH` | a bare container image has no libatk/libgbm |
| the Inter fonts on `XDG_DATA_HOME` | the pixel-measurement specs measure rendered text |
| a reachable venue | `BASE_URL` points at the stack's edge |
| Keycloak master-realm admin | see step 1 above |

### The pre-flight

A broken runner and a broken product look the same in a report: every test
dies on the same message. `tests/e2e/run/preflight.js` tells them apart —
it launches the browser and opens the venue **before** the suite touches
anything, and stops the run with the named cause. Without it, a runner
whose Chromium build does not match the installed `@playwright/test` turns
220 of 242 tests into the same launch error, and the failure path reports
one failure per spec file for one missing binary.

The pre-flight also **reports the runner it used** — the `@playwright/test`
version on disk and the Chromium revision that version names — so a result
can be read against the browser that produced it.

### The browser tree

The suite drives one Chromium build, and the `@playwright/test` the
repository pins names it: the version's own `browsers.json` carries the
revision. A tree carrying another revision fails **every** spec at launch,
before one assertion runs — the runner looks broken and the product looks
faulty. On 2026-11-10 exactly that happened: one missing binary was filed
as twelve product bugs (#1779).

`node tests/e2e/run/install-browsers.js` reconciles both sides, in order:

1. the **checkout** matches the lockfile — `npm ci` when the versions the
   runner loads (`@playwright/test` → `playwright` → `playwright-core`)
   differ from the ones the lockfile pins for those same paths. A
   checkout's `node_modules` can disagree with `package-lock.json` while
   `node_modules/.package-lock.json` claims otherwise, and a nested install
   is pinned by its own entry, not by a hoisted sibling's;
2. the **browser tree** carries the revision the installed Playwright names
   — installed by that Playwright's own installer, then **verified**: both
   builds are asserted; the *headless shell* is the one a headless run
   launches, and it is the one that was missing when one missing build
   became twelve filed issues. Each is checked at the location the
   installer named, together with the install's completion marker.

   The **install** is spawned **only when a build it names is absent or
   carries no completion marker**, so a reconciled machine downloads
   nothing; the dry run that names the locations still runs, and the
   verification runs either way, so a tree that was never installed still
   fails loudly.

   The install is Playwright's own `install chromium`, and it **prunes the
   browser directories no installed Playwright claims** — your own previous
   revision, and the versions of any project whose `playwright-core` is no
   longer on disk. A version still installed elsewhere is claimed through
   its link entry and survives. Give this suite its own browser root
   anyway: a shared one is pruned by whichever project's install runs
   last — every directory no live link entry claims goes with it, so a
   stale revision of yours disappears the moment another project repairs.

No revision number is written in the repository: it is derived from the
installed Playwright, so a lockfile bump needs no second number to change.
The command is idempotent.

**Where the provisioning calls it.** The reconciler lives in the repository
— that is the half that must survive a lockfile bump. The pod's own
provisioning script (on the pod's persistent disk, outside this repository)
calls it, so a pod recreation restores the right build instead of the one the
image baked. The script itself is not versioned here: the pod's disk is the
thing that carries it, and the revision it derives is always the one the
checked-out lockfile pins.

### Venue address

A runner that cannot resolve the venue's edge hostname needs the address
resolved another way: ask for whatever name the venue IS reachable by and
pass the answer as `E2E_VENUE_IP`. The example below resolves the
**shared-forge venue** — the run's DEFAULT venue, the shared stack of the
*Shared-stack discipline* section; substitute your venue's own names and port:

```bash
E2E_VENUE_IP=$(getent hosts forge-k3s.openclaw.svc.cluster.local | awk '{print $1}') \
BASE_URL=https://genieai-forge.local:4443 tests/e2e/run/run-local-e2e.sh
```

The mapping has to reach **two** resolvers: Node (`dns.lookup`,
`dns.promises.lookup`, `dns.resolve4/6` — patched by the preload
`tests/e2e/run/venue-dns.js`) and Chromium (`--host-resolver-rules` — added
by `tests/e2e/helpers/venue-launch-args.js`, which the Playwright config and
the helpers' own browser launches both read). With only the Node half, the API
helpers answer and the browser cannot open the app.

A runner whose Chromium cannot load its shared libraries needs them on
`LD_LIBRARY_PATH` — that is a property of the runner, not of the suite.

## The executed set

**The whole tree.** Every spec under `tests/e2e/` runs — the feature
directories `auth/`, `chatbot/`, `documents/`, `admin/`, `okf/`, `theme/`,
and the `helpers/` and `run/` unit specs. What each directory holds, and which
acceptance phase each spec serves: [`suite-map.md`](suite-map.md).

The set is **pinned** by `tests/config-validator/` (the guard *the local e2e
run defines the executed set*): the invocation is derived from the run script
— never copied into a second hand-maintained list — and must cover every spec
file in the tree. Narrowing the invocation fails the guard and names the
specs it dropped.

The CI job's curated invocation still sits in `.gitlab-ci.yml` (the file is
frozen — no CI change), and its own guard still checks that the job's wiring
is internally consistent. It is not the executed set: the job never starts.

## The venue profile, and what skips with a reason

A spec that drives a **surface the venue does not expose** skips **with a
reason** — it does not fail looking for a surface that never renders, and it
never passes quietly. The reason is read from the venue itself, not guessed:

| Specs | Surface they need | The venue's own answer |
|---|---|---|
| `tests/e2e/okf/` (5 specs) | the OKF Studio, the artifacts view, the RAGAS panel | `okfEnabled` in the deployment's `/runtime/config.js` — the same knob the frontend reads (`okfEnabled="0"` = pillar parked, rendered as the reason prints it) |
| `tests/e2e/auth/d7a-*.spec.js`, `d7b-*.spec.js` | a brokered external identity provider | the identity providers of the realm (none = Phase D steps 1–5 were not run here) |
| `tests/e2e/auth/i1-multi-realm.spec.js` | a second realm | the realm inventory (no `genie2` = Phase 0 step 0.6 was not run here) |
| `tests/e2e/chatbot/send-message-and-stream.spec.js` (the French group) | a locale the deployment serves, and a translator that answers en→fr | three venue facts: `availableLocales` in the deployment's `/runtime/config.js` (the whitelist, with `en` always retained), the locale the APP adopted on boot (`<html lang>` — the build's locale files are the half of the rule the venue does not publish), and the `POST /api/translate` probe (a typed `UNSUPPORTED_LANGUAGE` refusal, or an answer that echoes its source, is the venue saying the language is absent) |
| `tests/e2e/documents/upload.spec.js` (the ingest group), `tests/e2e/chatbot/real-rag-citation.spec.js` | a dataprep chain that lands `Ingested` | no HTTP surface declares the chain, so the profile proves it BEHAVIORALLY: a canary uploads one tiny `.md` file through the repository's own upload route, triggers the ingest, holds until the shared status vocabulary reads an ingested status, and removes it again. A chain that never lands reads as an absent one, and the reason carries the status it last saw |

A probe that cannot read the venue **fails loudly**: an unreadable venue is
not an absent surface, and a skip built on a failed probe is the silent
fallback the suite forbids.

The run's output lists every skipped spec with its reason, so **a green run
never means "nothing ran"** — the report names what did not run and why.

## The post-run ROPC posture gate

After the suite, the run asserts the venue's auth posture: the primary realm
carries NO direct access grants on ANY of its clients
(`tests/e2e/run/check-ropc-posture.js`, reading the assertion that lives in
`helpers/keycloak-admin.js` — the posture's single home, #1727; swept
realm-wide by #1846). A run that leaves the venue wider than it found it fails
**with exit 5, loudly**, even with every spec green: the two scripts that
legitimately flip the grant on a real venue (`data/okf/smoke-test/mint-tokens.mjs`,
the rag-benchmarks anchor wrapper) each carry a verified revert, and a revert
that fails to land is what this gate catches — on the default pair or on any
pair the script's own overrides named. Two obligations, neither dropping the
other: the gate's verdict is RECORDED first, the failure path still reports a
red run, and the gate's exit 5 is the last word. The gate sweeps the
realms `ROPC_POSTURE_REALMS` names, comma-separated (default `genie`) —
two standing postures stay out of the verdict, because their grants are
the provisioned state and not a run's doing: the test-only realm
(`genie2`) and the two built-in clients the realm export cannot pin
(`realm-management`, `security-admin-console` — Keycloak reserves a
built-in's authentication-flow bindings, so the convergence import
cannot declare them; their grants stay server defaults, read back
false). Every OTHER
built-in is pinned false by the export (#1849 — `admin-cli` used to
answer ROPC=true out of the box) and the gate asserts it like any
declared client: a venue whose convergence has not yet applied the pin
reds on `admin-cli` until its next convergence run — and an overridden eval
client needs no mirror convention. A non-zero gate exit with no widened surface behind it
means the gate itself could not run: its output names the real cause. On a
venue fresh from the MANUAL
acceptance phases — whose Phase 0 prep (`00-clean-start.md` § 0.7) enables a
test-only ROPC the manual mints rely on — a gate failure is the honest signal
to revert that temp ROPC.

## The failure path

A red run must not stay a silent red (#1736). The run ends with
`tests/e2e/run/file-failure-issues.js`, which:

- prints the counts, the skipped specs with their reasons, and the failures;
- prints the **context of the red**: the build the venue serves, this
  checkout's HEAD, whether the venue's build is behind it, and — per
  failing spec file — the handles the spec waited for and the file in
  this checkout that declares them.

The suite is launched **on demand** — a human, or an agent asked to run it
— so whoever launched it sees the red. The issue is written **by hand**,
from that report. The path files nothing: its job is to make the red
readable.

To read a past run's failures (the runner renames the report — the fixed
path holds whatever ran last):

```bash
ls reports/playwright-report-run-*.json
node tests/e2e/run/file-failure-issues.js --report reports/playwright-report-run-<stamp>.json \
  --venue https://<your-venue-host>:4443
```

`--venue` is the address the FAILED RUN pointed at — the venue-alive
re-probe keys on it, not on this shell's `BASE_URL`.

A run that wrote **no** report is a broken run: the runner stops there
rather than reading the fixed path, which would be another run's report.

**A red run is not automatically a finding.** Two venue events produce
exactly the same report as a defect of the product:

- a venue that goes away mid-run — the venue's node rebooting during
  a run moves its address and with it the edge's LoadBalancer IP, and
  every spec that navigates during that window fails with
  `net::ERR_CONNECTION_REFUSED at the edge`. The path groups those
  failures into ONE venue-availability report. Check the venue's own
  events before reading anything into the rest:

  ```bash
  kubectl get events -A --field-selector reason=NodeReady --sort-by=.lastTimestamp
  kubectl -n <venue-namespace> get events --sort-by=.lastTimestamp | tail
  ```

- a **stale venue build** (#1844/#1845, #1895, #1896): every deployment
  tracks the mutable `main` registry tag with `imagePullPolicy: Always`,
  but a pod picks up a new `main` only when it restarts — a wave that
  lands frontend test handles leaves the venue's pods serving the build
  from BEFORE the wave, and every spec asserting those handles fails with
  `element(s) not found`.

The report answers the second one in one line: **the venue's build is
BEHIND this checkout** (the two builds are compared with `git
merge-base --is-ancestor`; a venue serving EXACTLY this checkout is not
behind it — it is current). A venue behind cannot serve the handles the
checkout declares — the remedy is a venue refresh, not a code change:

```bash
kubectl -n <venue-namespace> rollout restart deploy/<frontend-deployment>
```

then re-run the red specs before believing anything.

To prove it by hand — does the venue serve the handle the checkout
declares? The frontend lazy-loads its views, so a handle lives in a
CHUNK, not in the main bundle. Fetch `/` and read the served
`js/app.<hash>.js` name from the HTML; fetch that bundle and extract its
webpack chunk-hash map (the `{<id>:"<hash>", ...}` object beside the
`"js/"+` script-name template); fetch `js/<id>.<hash>.js` for each entry
and grep for the handle the failing spec reads. A handle the checkout has
and no chunk carries is a stale venue, not a spec defect.

### The build marker and the pre-flight probe (#1851)

Since #1851 the run answers "which build did I exercise?" itself. The
frontend image bakes **`/build-info.json`** — `{"git_sha": "<full commit
sha>"}` — at build time (CI passes `GIT_SHA=$CI_COMMIT_SHA`; a build
that skips it carries `"unknown"`). The pre-flight reads it through the
same browser context that checked reachability, and every run prints the
verdict as a `venue build:` line:

- **fresh** — the marker equals the checkout's `HEAD`;
- **STALE** — the marker names another sha: the line carries BOTH shas
  and the remedy pointer above; the run continues, but every red below
  reads against the named build, not the checkout's;
- **predates the contract** — no readable `/build-info.json` (the SPA
  fallback answers): a frontend built before #1851. Freshness is
  undetectable there; the chunk walk below is still the tool;
- **BROKEN** — the path is served but carries no readable `git_sha`:
  the venue HAS the contract and violated it. This one stops the run,
  like an unreachable venue — it is a deployment defect, not a
  freshness fact.

The failure path (`file-failure-issues.js`) names the marker in its
report (`venue build: <sha>`), so a stale venue cannot be mistaken for a
defect of the product without the build being named.

## Shared-stack discipline

The run drives a **shared** stack (namespace `genieai`, chart
`genieai-umbrella`) — one stack, never one per agent. It deploys nothing,
changes no chart and touches no cluster resource: it logs in, reads and
provisions the three venue fixtures, and the specs create and remove their own
ephemeral state.

Two caveats the operator should know before booking a slot:

- the run needs a **serial slot** on the shared stack — the phase specs
  mutate the shared realm (the Phase-H spec rotates the realm signing keys),
  so two runs at once would fight over the same realm. The slot is booked
  with the orchestrator; the runner's own locks are per machine;
- the OKF specs skip on a core-profile venue. Pointing the run at an
  OKF-enabled venue is what exercises them.

## Known-red specs

The run of 2026-11-10 (shared-forge venue, chart 0.2.171):
**242 tests — 212 passed, 13 failed, 17 skipped.** Spec paths below are
shown at their current (post-#1741 reorganization) home; the run itself
recorded the pre-reorganization paths (`epic1/…`, `epic3/…`, root-level,
and `chatbot/…` for the specs that did not move).

| Spec | Failures | Why it is red | Fix |
|---|---|---|---|
| `auth/a1`, `a2`, `a3`, `auth/l1`, `l2`, `l3` | 8 | the specs navigate to a literal `https://localhost/`, which answers nothing on a k8s venue | #1737 (MR !841) |
| `chatbot/error-handling`, `chatbot/send-message-and-stream`, `chatbot/chat-conversation` | 5 | `waitForBotResponse` polls a Vuex path the CSR refactor deleted — the same drift, seen as a disposed route context and a click timeout | #1738, #1758 (MR !841) |

An earlier run of the same day showed five more failures (`welcome-banner`, `resizable-sidebars`) that were **not** a spec defect: the venue's node rebooted mid-run and the edge refused connections. On the settled stack they pass.

A spec that is known-red is named, never silently excluded, and never edited
to make it pass. These reds are the **proof that the suite runs** — the run
executed them, in their broken state, on a branch that does not carry the
fixes; they are not defects of the run's own change-set.
