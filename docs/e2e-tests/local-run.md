# The local e2e run

The Playwright suite has **no CI door**. The operator's decision of 2026-11-10
gives this suite no CI resources — no CI stage, no per-MR e2e, no repaired
monthly schedule — and the suite runs **locally, regularly** instead.

That makes the local run the thing that defines the **executed set**: the
specs the suite actually runs. Before this run existed, that set was a CI job
(`e2e:playwright`) whose rule requires a merge train this GitLab instance
never creates, so the set was a claim in a YAML file that nobody executed —
and half the suite (`epic1/`, `epic2/`, `epic3/`, `okf/`, the root-level
specs) was outside it, visibly red, and invisible to the repository.

## The command

```bash
BASE_URL=https://genieai-forge.local:4443 tests/e2e/run/run-local-e2e.sh
```

One command, from the repository root. It:

1. resolves the **Keycloak admin credentials** — `KEYCLOAK_ADMIN_PASSWORD` or
   `ADMIN_TOKEN` from the environment, otherwise the shared stack's
   `keycloak-admin-credentials` secret (`kubectl -n genieai`, never a
   credential in the repository);
2. maps the venue **name** to an address when the runner cannot resolve it
   (see *Venue address* below);
3. **provisions the venue fixtures** — `tests/e2e/provision-e2e-fixtures.js`,
   the same script the CI job and Phase 0 run, so `testuser`, `testadmin`
   and `testplain` exist and are converged before the suite starts;
4. runs the **whole `tests/e2e/` tree** — `npx playwright test tests/e2e/
   --project=chromium`;
5. reports the outcome and runs the **failure path** (below).

### Prerequisites

| Requirement | Note |
|---|---|
| `npm install` at the repository root | Playwright resolves from the root `node_modules` |
| `npx playwright install chromium` | the suite drives a real browser |
| a reachable venue | `BASE_URL` points at the stack's edge |
| Keycloak master-realm admin | see step 1 above |

### Venue address

The shared k8s stack advertises its edge as `genieai-forge.local`, a name the
cluster DNS does not serve. A runner that cannot resolve it needs the address:

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

**The whole tree.** Every spec under `tests/e2e/` runs — `chatbot/`,
`documents/`, `admin/`, `helpers/`, `epic1/`, `epic2/`, `epic3/`, `okf/` and
the root-level specs (`chat-composer`, `chat-conversation`,
`living-intelligence`, `resizable-sidebars`, `responsive-layout`,
`theme-runtime-config`, `welcome-banner`).

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
| `tests/e2e/okf/` (5 specs) | the OKF Studio, the artifacts view, the RAGAS panel | `okfEnabled` in the deployment's `/runtime/config.js` — the same knob the frontend reads (`okfEnabled=0` = pillar parked) |
| `tests/e2e/epic1/d7a-*.spec.js`, `d7b-*.spec.js` | a brokered external identity provider | the identity providers of the realm (none = Phase D steps 1–5 were not run here) |
| `tests/e2e/epic2/i1-multi-realm.spec.js` | a second realm | the realm inventory (no `genie2` = Phase 0 step 0.6 was not run here) |

A probe that cannot read the venue **fails loudly**: an unreadable venue is
not an absent surface, and a skip built on a failed probe is the silent
fallback the suite forbids.

The run's output lists every skipped spec with its reason, so **a green run
never means "nothing ran"** — the report names what did not run and why.

## The failure path

A red run must not stay a silent red (#1736). The run ends with
`tests/e2e/run/file-failure-issues.js`, which:

- prints the counts, the skipped specs with their reasons, and the failures;
- files **one issue per failing spec file** — title
  `test(e2e): <file> is red on the local run`, labelled `status::backlog`
  (set once, at creation, and never moved again), carrying the failing
  tests and their logs;
- adds a **comment** instead of a second issue when an open issue with that
  title already exists, so a suite that stays red does not flood the tracker.

To only report, without filing: `E2E_FILE_ISSUES=0 tests/e2e/run/run-local-e2e.sh`.
To file a past run's failures by hand: `node tests/e2e/run/file-failure-issues.js --file-issues`.

## Shared-stack discipline

The run drives a **shared** stack (namespace `genieai`, chart
`genieai-umbrella`) — one stack, never one per agent. It deploys nothing,
changes no chart and touches no cluster resource: it logs in, reads and
provisions the three venue fixtures, and the specs create and remove their own
ephemeral state.

Two caveats the operator should know before booking a slot:

- the run needs a **serial slot** on the shared stack — the phase specs
  mutate the shared realm (the Phase-H spec rotates the realm signing keys,
  the Phase-K spec changes the realm's token lifespan and restores it), so
  two runs at once would fight over the same realm;
- the OKF specs skip on a core-profile venue. Pointing the run at an
  OKF-enabled venue is what exercises them.

## Known-red specs

| Spec | Why it is red | Fix |
|---|---|---|
| the specs that hardcode `https://localhost/` | the venue answers under another origin | #1737 (MR !841) |
| the chat specs reading a Vuex path the CSR refactor deleted | `waitForBotResponse` polls a path the frontend no longer exposes | #1738 (MR !841) |

A spec that is known-red is named, never silently excluded, and never edited
to make it pass.
