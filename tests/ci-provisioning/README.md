# e2e readiness-block harness (#1337)

Executes the Keycloak readiness script item of `.e2e_web_base` (root
`.gitlab-ci.yml`) under a **stub curl** whose responses are scripted per
scenario, plus a stub `sleep` that fast-forwards the retry loops. The block
is extracted from the YAML with pyyaml and concatenated with the
shared-helper item that precedes it (`http_label` / `resp_status` /
`resp_body` / `kc_curl` / `require_clean_curl`).

**Scope (after main's venue-fixture convergence, 3991dd474):** the block
under test is the readiness loop (master-token acquisition, genie-app
client visibility) and the ROPC refusal probe. The testuser/roles
provisioning lives in `tests/e2e/provision-e2e-fixtures.js` and is
exercised by its own suite — a scenario that drives the reduced block
toward an unscripted endpoint exits 97 through the stub, so harness drift
against block drift is caught both ways.

## Run

```bash
bash tests/ci-provisioning/run.sh    # requires python3 + pyyaml
```

CI runs it as the `config:provisioning-harness` job (config stage), wired to
changes in `tests/ci-provisioning/**` and `.gitlab-ci.yml`.

## Why it exists

During the #1289 cycle a scratch version of this harness caught a real
implementation bug an xhigh-effort code review missed: the curl exit-code
capture sat inside the command substitution, so the assignment vanished
into the subshell and every transport failure looked like a clean exit.
The readiness block has consumed several review campaigns (#1248, #1269,
#1289 rounds) — the eyeballing cost is proven, so the harness is committed
(option 1 of #1337) and future changes mutate + verify instead of eyeballing
shell in YAML.

## Scenario semantics

- Every rule matches by HTTP method + URL substring; the **longest**
  matching URL serves the call. Responses are served in order; the last
  repeats once exhausted.
- A response's `rc` becomes the stub's exit code — a non-zero rc over a
  captured status models a truncated transport answer (timeout after
  headers, reset mid-body).
- An unscripted call exits 97: a scenario reaching an unscripted URL is a
  harness bug, not a pass.

## Provenance mutations

Each of these regressions turns specific scenarios red (verified against
the re-scoped scenario set):

| Mutation | Scenarios that go red |
|---|---|
| rc capture moved inside the command substitution (the #1289 bug) | `truncated_client_401_retries` |
| #1319 classifier reads the 200-char display body instead of the full capture | `long_body_401_still_fails_fast` |
| #1320 fail-fast loses the clean-exit gate (truncated 401 treated as definitive) | `truncated_client_401_retries` |
