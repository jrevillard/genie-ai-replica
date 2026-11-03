#!/usr/bin/env python3
"""Stub-curl harness for the e2e Keycloak provisioning block (#1337).

Extracts the provisioning script item from .gitlab-ci.yml with pyyaml,
concatenates it with the shared-helper item that precedes it (http_label /
resp_status / resp_body / kc_curl / require_clean_curl), and executes the
pair under a stub curl whose responses are scripted per scenario (plus a
stub sleep that fast-forwards the retry loops). The stub sleep mirrors the
runner semantics that matter here: the loops are bounded by iteration
counts, not wall time, so failure verdicts are reachable deterministically.

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


HEALTHY_USER = json.dumps({
    "id": "user-123",
    "username": "testuser",
    "email": "testuser@e2e.test",
    "enabled": True,
    "emailVerified": True,
    "requiredActions": [],
})

DRIFTED_USER = json.dumps({
    "id": "user-123",
    "username": "testuser",
    "email": "testuser@e2e.test",
    "enabled": True,
    "emailVerified": False,
    "requiredActions": ["Verify Email"],
})

GENIE_CLIENT = json.dumps([{"id": "client-1", "clientId": "genie-app"}])

ADMIN_ROLE = json.dumps({"id": "role-admin-1", "name": "admin"})


def _resp_list(override, default):
    """Normalize an override: a single dict becomes a one-entry list; a list
    is served in order (the last entry repeats once exhausted)."""
    if override is None:
        return [default]
    if isinstance(override, dict):
        return [override]
    return override


def base_rules(client_resp=None, create_resp=None, user_resp=None,
               roles_resp=None, role_mapping_resp=None, reset_resp=None,
               token_resp=None, ropc_resp=None, delete_resp=None):
    """The scripted endpoints, overridable per scenario."""
    return [
        {"name": "health", "method": "GET", "url": "/api/health",
         "responses": [{"status": "200", "body": "ok"}]},
        {"name": "token", "method": "POST", "url": "realms/master/protocol/openid-connect/token",
         "responses": _resp_list(token_resp, {"status": "200", "body": token_body()})},
        {"name": "client", "method": "GET", "url": "clients?clientId=genie-app",
         "responses": _resp_list(client_resp, {"status": "200", "body": GENIE_CLIENT})},
        {"name": "create", "method": "POST", "url": "genie/users",
         "responses": _resp_list(create_resp, {"status": "201", "body": ""})},
        {"name": "lookup", "method": "GET", "url": "users?username=testuser&exact=true",
         "responses": _resp_list(user_resp, {"status": "200", "body": "[%s]" % HEALTHY_USER})},
        {"name": "roles", "method": "GET", "url": "admin/realms/genie/roles/admin",
         "responses": _resp_list(roles_resp, {"status": "200", "body": ADMIN_ROLE})},
        {"name": "role_mapping", "method": "POST", "url": "role-mappings/realm",
         "responses": _resp_list(role_mapping_resp, {"status": "204", "body": ""})},
        {"name": "reset", "method": "PUT", "url": "reset-password",
         "responses": _resp_list(reset_resp, {"status": "204", "body": ""})},
        {"name": "delete", "method": "DELETE", "url": "admin/realms/genie/users/",
         "responses": _resp_list(delete_resp, {"status": "204", "body": ""})},
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
        expect=["testuser created", "Assigned admin role to testuser",
                "ROPC refusal verified"],
    ))

    scs.append(scenario(
        "create_recovers_from_transport_blip", 0,
        base_rules(create_resp=[{"status": "000", "body": "", "rc": 7},
                                {"status": "201", "body": ""}]),
        expect=["testuser created", "attempt 1/3"],
    ))

    scs.append(scenario(
        # A clean-exit 429 retries through the same transient arm — a
        # narrowing of that arm (the #1289 round-1 drift class) turns this
        # scenario red.
        "create_recovers_from_429", 0,
        base_rules(create_resp=[{"status": "429", "body": "slow down"},
                                {"status": "201", "body": ""}]),
        expect=["testuser created"],
    ))

    scs.append(scenario(
        # A truncated transport answer (curl exit 28 after headers) must not
        # be read as the 204 verdict — require_clean_curl fails loudly. The
        # reset runs on the 409/healthy-account convergence path only.
        "truncated_reset_fails_loud", 1,
        base_rules(create_resp={"status": "409", "body": "User exists with same email"},
                   reset_resp={"status": "204", "body": "", "rc": 28}),
        expect=["transport fault during the password reset"],
        forbid=["password converged"],
    ))

    scs.append(scenario(
        "create_persistent_500", 1,
        base_rules(create_resp=[{"status": "500", "body": "boom"}]),
        expect=["transient failures persisted through all 3 create attempts"],
        forbid=["testuser created"],
        calls={"create": 3},
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
        # #1333: 404 from the direct role endpoint = the role does not exist.
        "roles_404_warns", 0,
        base_rules(roles_resp={"status": "404", "body": json.dumps({
            "error": "Not Found", "error_description": "Could not find role"})}),
        expect=["the 'admin' realm role does not exist"],
        forbid=["Assigned admin role"],
    ))

    scs.append(scenario(
        # #1334 round-6 finding: a truncated transport answer over a 200
        # trailer is a lookup fault, never a missing-role verdict.
        "roles_transport_fault_not_misattributed", 0,
        base_rules(roles_resp={"status": "200", "body": '{"id":"role-adm', "rc": 28}),
        expect=["roles lookup hit a transport fault"],
        forbid=["does not exist", "Assigned admin role"],
    ))

    scs.append(scenario(
        # An expired token reaching the roles lookup is the same definitive
        # class as the client-lookup 401 (#1320): the token was minted by
        # this run. Fail with the named cause instead of warning and running
        # the suites without the admin role.
        "roles_401_fails_fast", 1,
        base_rules(roles_resp={"status": "401", "body": json.dumps({
            "error": "HTTP 401 Unauthorized"})}),
        expect=["rejected during the admin role lookup",
                "failing instead of running the suites without the admin role"],
        forbid=["WARNING: Could not resolve the admin role"],
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
        "role_mapping_403_warns", 0,
        base_rules(role_mapping_resp={"status": "403", "body": "forbidden"}),
        expect=["WARNING: admin role assignment failed"],
    ))

    # The remaining require_clean_curl gates, pinned like truncated_reset:
    # a truncated transport answer over a captured status must fail the
    # call loudly, never be read as a semantic verdict.
    scs.append(scenario(
        "truncated_delete_fails_loud", 1,
        base_rules(create_resp={"status": "409", "body": "User exists with same email"},
                   user_resp={"status": "200", "body": "[%s]" % DRIFTED_USER},
                   delete_resp={"status": "204", "body": "", "rc": 28}),
        expect=["transport fault during the stale testuser delete"],
        forbid=["testuser recreated"],
    ))

    scs.append(scenario(
        "truncated_lookup_fails_loud", 1,
        base_rules(create_resp={"status": "409", "body": "User exists with same email"},
                   user_resp={"status": "200", "body": "[%s]" % HEALTHY_USER, "rc": 28}),
        expect=["transport fault during the testuser lookup"],
        forbid=["password converged", "testuser recreated"],
    ))

    scs.append(scenario(
        "truncated_role_mapping_fails_loud", 1,
        base_rules(role_mapping_resp={"status": "204", "body": "", "rc": 28}),
        expect=["transport fault during the admin role assignment"],
        forbid=["WARNING: admin role assignment failed", "Assigned admin role"],
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

    scs.append(scenario(
        "create_409_healthy_resets", 0,
        base_rules(create_resp=[{"status": "409",
                                 "body": "User exists with same email"}],
                   user_resp={"status": "200", "body": "[%s]" % HEALTHY_USER}),
        expect=["testuser already exists", "password converged"],
    ))

    scs.append(scenario(
        "create_409_drifted_recreated", 0,
        # 409, lookup shows drift, delete, re-create (201), re-lookup healthy.
        base_rules(create_resp=[{"status": "409", "body": "User exists with same email"},
                                {"status": "201", "body": ""}],
                   user_resp=[{"status": "200", "body": "[%s]" % DRIFTED_USER},
                              {"status": "200", "body": "[%s]" % HEALTHY_USER}]),
        expect=["drifted login state", "testuser recreated"],
        calls={"create": 2, "delete": 1},
    ))

    scs.append(scenario(
        # A 200 without a usable token rides the full readiness budget, then
        # fails with the named proxy-interception hint — never silently.
        "token_200_without_access_token", 1,
        base_rules(token_resp={"status": "200", "body": '{"spoofed": true}'}),
        expect=["The endpoint answered HTTP 200 but the body contained no usable access_token"],
        calls={"token": 90},
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
