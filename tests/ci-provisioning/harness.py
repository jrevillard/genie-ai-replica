#!/usr/bin/env python3
"""Stub-curl harness for the e2e Keycloak readiness block (#1337).

Extracts the readiness script item from .gitlab-ci.yml with pyyaml,
concatenates it with the shared-helper item that precedes it (http_label /
resp_status / resp_body / kc_curl / require_clean_curl), and executes the
pair under a stub curl whose responses are scripted per scenario (plus a
stub sleep that fast-forwards the retry loops). The stub sleep mirrors the
runner semantics that matter here: the loops are bounded by iteration
counts, not wall time, so failure verdicts are reachable deterministically.

Scope note (re-scope after main's venue-fixture convergence): the block
under test is the readiness loop (token acquisition + genie-app client
visibility) and the ROPC refusal probe. The testuser/roles provisioning
moved to tests/e2e/provision-e2e-fixtures.js (3991dd474) and is exercised
by its own suite — NOT scripted here. A scenario that makes the reduced
block call an unscripted endpoint exits 97 through the stub (loud harness
bug), so scenario drift against block drift is caught both ways.

Provenance: during the #1289 cycle this class of scratch harness caught a
real implementation bug an xhigh-effort code review missed — the curl
exit-code capture sat inside the command substitution, so the assignment
vanished into the subshell and every transport failure looked like a clean
exit. Committed (option 1 of #1337) so the guard semantics stay
regression-proofed and future review rounds mutate + verify instead of
eyeballing shell in YAML.

Exit codes: 0 = all scenarios pass, 1 = at least one scenario failed.
"""

import json
import os
import subprocess
import sys
import tempfile

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CI_FILE = os.path.join(ROOT, ".gitlab-ci.yml")
HERE = os.path.dirname(os.path.abspath(__file__))


def provisioning_items():
    with open(CI_FILE) as f:
        doc = yaml.safe_load(f)
    items = doc[".e2e_web_base"]["script"]
    helper = next(i for i in items if isinstance(i, str) and "http_label() {" in i)
    block = next(i for i in items if isinstance(i, str) and "Keycloak readiness wait" in i)
    return helper, block


def long_token():
    """A JWT-shaped access token long enough to exceed the 200-char display
    truncation of the block's BODY capture."""
    return "tok" * 300


def token_body():
    return json.dumps({
        "access_token": long_token(),
        "expires_in": 60,
        "refresh_expires_in": 1800,
        "token_type": "Bearer",
    })


GENIE_CLIENT = json.dumps([{"id": "client-1", "clientId": "genie-app"}])


def _resp_list(override, default):
    """Normalize an override: a single dict becomes a one-entry list; a list
    is served in order (the last entry repeats once exhausted)."""
    if override is None:
        return [default]
    if isinstance(override, dict):
        return [override]
    return override


def base_rules(client_resp=None, token_resp=None, ropc_resp=None):
    """The scripted endpoints of the reduced readiness block, overridable
    per scenario. An endpoint the block stops calling leaves an unused rule
    (harmless); an endpoint that appears without a rule exits 97 (loud)."""
    return [
        {"name": "health", "method": "GET", "url": "/api/health",
         "responses": [{"status": "200", "body": "ok"}]},
        {"name": "token", "method": "POST", "url": "realms/master/protocol/openid-connect/token",
         "responses": _resp_list(token_resp, {"status": "200", "body": token_body()})},
        {"name": "client", "method": "GET", "url": "clients?clientId=genie-app",
         "responses": _resp_list(client_resp, {"status": "200", "body": GENIE_CLIENT})},
        {"name": "ropc", "method": "POST", "url": "realms/genie/protocol/openid-connect/token",
         "responses": _resp_list(ropc_resp, {"status": "401", "body": json.dumps({
             "error": "unauthorized_client",
             "error_description": "Client not allowed to initiate direct access grants.",
         })})},
    ]


def scenario(name, expect_exit, rules, expect=(), forbid=(), calls=None):
    return {"name": name, "expect_exit": expect_exit, "rules": rules,
            "expect": list(expect), "forbid": list(forbid), "calls": calls or {}}


def scenarios_list():
    invalid_grant = {"status": "401", "body": json.dumps({
        "error": "invalid_grant", "error_description": "Invalid user credentials."})}
    scs = []

    scs.append(scenario(
        "happy_path_full", 0, base_rules(),
        expect=["Keycloak ready", "Assigned" if False else "ROPC refusal verified"],
    ))

    scs.append(scenario(
        # #1319: a definitive 401 invalid_grant cannot heal — fail after 3
        # consecutive rejections instead of burning the 90-iteration budget,
        # and stop feeding Keycloak's brute-force protector.
        "definitive_401_fails_fast", 1,
        base_rules(token_resp=invalid_grant),
        expect=["definitively rejected", "Check KEYCLOAK_ADMIN_PASSWORD"],
        forbid=["Waiting for Keycloak via nginx/Kong... (4/90)"],
        calls={"token": 3},
    ))

    # Same rejection with an OAuth error body whose JSON exceeds the 200-char
    # display truncation: the classifier reads the FULL capture (KC_RAW), so
    # the fail-fast still fires at attempt 3. A display-body classifier
    # parses a truncated string, finds no error member, classifies the
    # rejection transient and burns the budget (token count 90 ≠ 3) — this
    # scenario is the mutation gate for that regression.
    long_invalid_grant = {"status": "401", "body": json.dumps({
        "error": "invalid_grant",
        "error_description": "Invalid user credentials. " + "x" * 250,
    })}
    scs.append(scenario(
        "long_body_401_still_fails_fast", 1,
        base_rules(token_resp=long_invalid_grant),
        expect=["definitively rejected", "Check KEYCLOAK_ADMIN_PASSWORD"],
        forbid=["Waiting for Keycloak via nginx/Kong... (4/90)"],
        calls={"token": 3},
    ))

    scs.append(scenario(
        "transient_000_then_token_ok", 0,
        base_rules(token_resp=[{"status": "000", "body": "", "rc": 7},
                               {"status": "200", "body": token_body()}]),
        expect=["Keycloak ready"],
    ))

    scs.append(scenario(
        # #1320: the loop's own token rejected on the client lookup is a
        # definitive authentication failure — no retry with a dead token.
        "dead_token_401_fails_client_lookup", 1,
        base_rules(client_resp={"status": "401",
                                "body": json.dumps({"error": "HTTP 401 Unauthorized"})}),
        expect=["rejected during the genie-app client lookup",
                "failing instead of retrying with a dead token"],
        calls={"client": 1},
    ))

    scs.append(scenario(
        # A truncated transport answer carrying a 401 trailer is NOT a
        # definitive token rejection (the status may sit over a truncated
        # body — the #1334 round-6 class): the loop retries, and a genuinely
        # expired token answers cleanly on a later attempt. The budget then
        # expires with the honest client-lookup verdict, not the mid-loop
        # dead-token exit.
        "truncated_client_401_retries", 1,
        base_rules(client_resp={"status": "401",
                                "body": json.dumps({"error": "HTTP 401 Unauthorized"}),
                                "rc": 28}),
        expect=["last client lookup: HTTP 401"],
        forbid=["failing instead of retrying with a dead token"],
        calls={"client": 90},
    ))

    scs.append(scenario(
        # A 200 without a usable token rides the full readiness budget, then
        # fails with the named proxy-interception hint — never silently.
        "token_200_without_access_token", 1,
        base_rules(token_resp={"status": "200", "body": '{"spoofed": true}'}),
        expect=["The endpoint answered HTTP 200 but the body contained no usable access_token"],
        calls={"token": 90},
    ))

    scs.append(scenario(
        # ROPC drift: the realm accepted the direct grant far enough to
        # validate credentials — fail the job.
        "ropc_drift_invalid_grant", 1,
        base_rules(ropc_resp=invalid_grant),
        expect=["ROPC posture drifted"],
        forbid=["ROPC refusal verified"],
    ))

    scs.append(scenario(
        "ropc_rate_limited_exhausted", 1,
        base_rules(ropc_resp={"status": "429", "body": "slow down"}),
        expect=["token endpoint rate-limited the probe"],
        forbid=["ROPC refusal verified"],
        calls={"ropc": 5},
    ))

    return scs


def run_scenario(sc, helper, block, workdir):
    scenario_path = os.path.join(workdir, "scenario.json")
    state_path = os.path.join(workdir, "state.json")
    if os.path.exists(state_path):
        os.remove(state_path)
    with open(scenario_path, "w") as f:
        json.dump({"rules": sc["rules"]}, f)

    shim = os.path.join(workdir, "shim")
    os.makedirs(shim, exist_ok=True)
    for tool, target in (("curl", os.path.join(HERE, "stub-curl")),
                         ("sleep", "/bin/true")):
        link = os.path.join(shim, tool)
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(target, link)

    env = os.environ.copy()
    env["PATH"] = shim + os.pathsep + env["PATH"]
    env["HARNESS_SCENARIO"] = scenario_path
    env["HARNESS_STATE"] = state_path
    env["KEYCLOAK_ADMIN_PASSWORD"] = "ci-harness-password"

    proc = subprocess.run(["bash", "-c", helper + "\n" + block],
                          env=env, capture_output=True, text=True,
                          timeout=120, cwd=workdir)
    output = proc.stdout + proc.stderr
    problems = []
    if proc.returncode != sc["expect_exit"]:
        problems.append("exit code %d, expected %d" % (proc.returncode, sc["expect_exit"]))
    for text in sc["expect"]:
        if text not in output:
            problems.append("expected output missing: %r" % text)
    for text in sc["forbid"]:
        if text in output:
            problems.append("forbidden output present: %r" % text)
    if sc["calls"]:
        counts = {}
        if os.path.exists(state_path):
            with open(state_path) as f:
                counts = json.load(f)
        for name, expected in sc["calls"].items():
            actual = counts.get(name, 0)
            if actual != expected:
                problems.append("rule %r called %d times, expected %d" % (name, actual, expected))
    return problems, output


def main():
    scs = scenarios_list()
    helper, block = provisioning_items()
    failed = 0
    with tempfile.TemporaryDirectory(prefix="provisioning-harness-") as workdir:
        for sc in scs:
            problems, output = run_scenario(sc, helper, block, workdir)
            if problems:
                failed += 1
                print("FAIL %s" % sc["name"])
                for p in problems:
                    print("  - %s" % p)
            else:
                print("ok   %s" % sc["name"])
    print("%d/%d scenarios pass" % (len(scs) - failed, len(scs)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
