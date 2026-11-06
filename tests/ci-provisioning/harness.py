#!/usr/bin/env python3
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Stub-curl harness for the e2e Keycloak readiness block (#1337).

Extracts the readiness script item from .gitlab-ci.yml with pyyaml,
concatenates it with the shared-helper item that precedes it (http_label /
resp_status / resp_body / kc_curl), and executes the
pair under a stub curl whose responses are scripted per scenario (plus a
stub sleep that fast-forwards the retry loops). The stub sleep mirrors the
runner semantics that matter here: the loops are bounded by iteration
counts, not wall time, so failure verdicts are reachable deterministically.

Scope note (re-scope after main's venue-fixture convergence): the block
under test is the readiness loop (token acquisition + genie-app client
visibility) and the ROPC refusal probe. The testuser/roles provisioning
moved to tests/e2e/provision-e2e-fixtures.js (3991dd474) and is exercised
by its own suite — NOT scripted here. A scenario that makes the reduced
block call an unscripted endpoint makes the stub exit 97 — the block captures
every exit code, so the scenario ends red on a transport verdict naming
"curl exit 97" (loud either way); drift is caught both ways.

Provenance: the #1289 cycle story this harness exists for is told once,
its README (§Why it exists) — kept there, not duplicated here.

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

    def find(anchor):
        item = next((i for i in items if isinstance(i, str) and anchor in i), None)
        if item is None:
            sys.exit(
                f"harness extraction lost: no .e2e_web_base script item carries "
                f"{anchor!r} — the block was reworded or reshaped; update "
                f"provisioning_items() to the new anchors"
            )
        return item

    return find("http_label() {"), find("Keycloak readiness wait")


def long_token():
    """A long opaque token string (not a real JWT — shape does not matter
    here) whose only job is to exceed the 200-char display truncation of
    the block's BODY capture."""
    return "tok" * 300


def token_body():
    return json.dumps(
        {
            "access_token": long_token(),
            "expires_in": 60,
            "refresh_expires_in": 1800,
            "token_type": "Bearer",
        }
    )


GENIE_CLIENT = json.dumps([{"id": "client-1", "clientId": "genie-app"}])

# The realm's client listing as the admin API returns it: every client with
# its direct-access-grant flag. Only admin-cli carries the grant — Keycloak
# provisions it with direct grants on in every realm, and the readiness loop
# mints its admin token through it. The `secret` member is a FIXTURE STRING,
# not a credential: its only job is to prove the probe never prints the
# listing it reads (the scenarios forbid it in the output).
REALM_CLIENTS = json.dumps(
    [
        {"clientId": "admin-cli", "directAccessGrantsEnabled": True},
        {
            "clientId": "genie-app",
            "secret": "harness-fixture-not-a-credential",
            "directAccessGrantsEnabled": False,
        },
        {
            "clientId": "genie-proxy-client",
            "secret": "harness-fixture-not-a-credential",
            "directAccessGrantsEnabled": False,
        },
        {
            "clientId": "dataprep-service-client",
            "secret": "harness-fixture-not-a-credential",
            "directAccessGrantsEnabled": False,
        },
        {
            "clientId": "okf-server",
            "secret": "harness-fixture-not-a-credential",
            "directAccessGrantsEnabled": False,
        },
    ]
)


def _resp_list(override, default):
    """Normalize an override: a single dict becomes a one-entry list; a list
    is served in order (the last entry repeats once exhausted)."""
    if override is None:
        return [default]
    if isinstance(override, dict):
        return [override]
    if not override:
        raise ValueError(
            "an empty response-list override has no last entry to repeat — "
            "give the rule at least one response"
        )
    return override


def base_rules(client_resp=None, token_resp=None, ropc_resp=None, realm_clients_resp=None):
    """The scripted endpoints of the reduced readiness block, overridable
    per scenario. An endpoint the block stops calling leaves an unused rule
    (harmless); an endpoint that appears without a rule makes the stub exit 97 and the
    scenario red (loud)."""
    return [
        {
            "name": "health",
            "method": "GET",
            "url": "/api/health",
            "responses": [{"status": "200", "body": "ok"}],
        },
        {
            "name": "token",
            "method": "POST",
            "url": "realms/master/protocol/openid-connect/token",
            "responses": _resp_list(
                token_resp, {"status": "200", "body": token_body()}
            ),
        },
        {
            # The genie-app lookup is the FILTERED listing. Its url is spelled
            # out in full because the stub serves the longest matching url:
            # the unfiltered realm listing below is a substring of it, and a
            # shorter rule would win on the filtered call too.
            "name": "client",
            "method": "GET",
            "url": "/admin/realms/genie/clients?clientId=genie-app",
            "responses": _resp_list(
                client_resp, {"status": "200", "body": GENIE_CLIENT}
            ),
        },
        {
            # The unfiltered realm listing: the whole client set with its
            # direct-access-grant flags. The read-back asserts the SHAPE of
            # that set — no client outside the allowlist carries the grant.
            "name": "realm_clients",
            "method": "GET",
            "url": "/admin/realms/genie/clients",
            "responses": _resp_list(
                realm_clients_resp, {"status": "200", "body": REALM_CLIENTS}
            ),
        },
        {
            "name": "ropc",
            "method": "POST",
            "url": "realms/genie/protocol/openid-connect/token",
            "responses": _resp_list(
                ropc_resp,
                {
                    "status": "401",
                    "body": json.dumps(
                        {
                            "error": "unauthorized_client",
                            "error_description": "Client not allowed to initiate direct access grants.",
                        }
                    ),
                },
            ),
        },
    ]


def scenario(name, expect_exit, rules, expect=(), forbid=(), calls=None):
    return {
        "name": name,
        "expect_exit": expect_exit,
        "rules": rules,
        "expect": list(expect),
        "forbid": list(forbid),
        "calls": calls or {},
    }


def scenarios_list():
    invalid_grant = {
        "status": "401",
        "body": json.dumps(
            {"error": "invalid_grant", "error_description": "Invalid user credentials."}
        ),
    }
    scs = []

    scs.append(
        scenario(
            # The read-back must answer the realm listing AND print nothing
            # of it: the listing carries the clients' secrets, so the fixture
            # string is forbidden in the output.
            "happy_path_full",
            0,
            base_rules(),
            expect=[
                "Keycloak ready",
                "ROPC refusal verified",
                "Direct-access grants verified across the genie realm's clients",
            ],
            forbid=["harness-fixture-not-a-credential"],
        )
    )

    scs.append(
        scenario(
            # #1319: a definitive 401 invalid_grant cannot heal — fail after 3
            # consecutive rejections instead of burning the 90-iteration budget,
            # and stop feeding Keycloak's brute-force protector.
            "definitive_401_fails_fast",
            1,
            base_rules(token_resp=invalid_grant),
            expect=["definitively rejected", "Check KEYCLOAK_ADMIN_PASSWORD"],
            forbid=["Waiting for Keycloak via nginx/Kong... (4/90)"],
            calls={"token": 3},
        )
    )

    # Same rejection with an OAuth error body whose JSON exceeds the 200-char
    # display truncation: the classifier reads the FULL capture (KC_RAW), so
    # the fail-fast still fires at attempt 3. A display-body classifier
    # parses a truncated string — json.load throws before any member is
    # read — classifies the rejection transient and burns the budget (token count 90 ≠ 3) — this
    # scenario is the mutation gate for that regression.
    long_invalid_grant = {
        "status": "401",
        "body": json.dumps(
            {
                "error": "invalid_grant",
                "error_description": "Invalid user credentials. " + "x" * 250,
            }
        ),
    }
    scs.append(
        scenario(
            "long_body_401_still_fails_fast",
            1,
            base_rules(token_resp=long_invalid_grant),
            expect=["definitively rejected", "Check KEYCLOAK_ADMIN_PASSWORD"],
            forbid=["Waiting for Keycloak via nginx/Kong... (4/90)"],
            calls={"token": 3},
        )
    )

    scs.append(
        scenario(
            "transient_000_then_token_ok",
            0,
            base_rules(
                token_resp=[
                    {"status": "000", "body": "", "rc": 7},
                    {"status": "200", "body": token_body()},
                ]
            ),
            expect=["Keycloak ready", "Direct-access grants verified"],
            forbid=["harness-fixture-not-a-credential"],
        )
    )

    scs.append(
        scenario(
            # #1320: the loop's own token rejected on the client lookup is a
            # definitive authentication failure — no retry with a dead token.
            "dead_token_401_fails_client_lookup",
            1,
            base_rules(
                client_resp={
                    "status": "401",
                    "body": json.dumps({"error": "HTTP 401 Unauthorized"}),
                }
            ),
            expect=[
                "rejected during the genie-app client lookup",
                "failing instead of retrying with a dead token",
            ],
            calls={"client": 1},
        )
    )

    scs.append(
        scenario(
            # A truncated transport answer carrying a 401 trailer is NOT a
            # definitive token rejection (the status may sit over a truncated
            # body — the #1334 round-6 class): the loop retries, and a genuinely
            # expired token answers cleanly on a later attempt. The budget then
            # expires with the honest client-lookup verdict, not the mid-loop
            # dead-token exit.
            "truncated_client_401_retries",
            1,
            base_rules(
                client_resp={
                    "status": "401",
                    "body": json.dumps({"error": "HTTP 401 Unauthorized"}),
                    "rc": 28,
                }
            ),
            expect=["last client lookup: HTTP 401"],
            forbid=["failing instead of retrying with a dead token"],
            calls={"client": 90},
        )
    )

    scs.append(
        scenario(
            # A 200 without a usable token rides the full readiness budget, then
            # fails with the named proxy-interception hint — never silently.
            "token_200_without_access_token",
            1,
            base_rules(token_resp={"status": "200", "body": '{"spoofed": true}'}),
            expect=[
                "The endpoint answered HTTP 200 but the body contained no usable access_token"
            ],
            calls={"token": 90},
        )
    )

    scs.append(
        scenario(
            # A 200 whose body was cut mid-transfer leaves an access_token
            # PREFIX in TOKEN_BODY (unparseable JSON, so no usable token);
            # the post-loop failure echo must withhold token material from
            # the job log. The mutation gate: un-mask the echo and this
            # scenario's forbid fires on the raw token prefix.
            "truncated_token_body_withheld",
            1,
            base_rules(
                token_resp={
                    "status": "200",
                    "body": '{"access_token": "toktoktoktoktok", "expires_in": 60',
                    "rc": 28,
                }
            ),
            expect=[
                "response body: <withheld — token response material>",
                "The endpoint answered HTTP 200 but the body contained no usable access_token",
            ],
            forbid=["toktoktok"],
            calls={"token": 90},
        )
    )

    scs.append(
        scenario(
            # ROPC drift: the realm accepted the direct grant far enough to
            # validate credentials — fail the job.
            "ropc_drift_invalid_grant",
            1,
            base_rules(ropc_resp=invalid_grant),
            expect=["ROPC posture drifted"],
            forbid=["ROPC refusal verified"],
        )
    )

    scs.append(
        scenario(
            "ropc_rate_limited_exhausted",
            1,
            base_rules(ropc_resp={"status": "429", "body": "slow down"}),
            expect=["token endpoint rate-limited the probe"],
            forbid=["ROPC refusal verified"],
            calls={"ropc": 5},
        )
    )

    scs.append(
        scenario(
            # #1303: a client OUTSIDE the allowlist carrying the direct-access
            # grant is the drift the genie-app probe cannot see (genie-app
            # itself refuses). The read-back is what catches it — the job
            # fails and names the client.
            "realm_client_drift_fails",
            1,
            base_rules(
                realm_clients_resp={
                    "status": "200",
                    "body": json.dumps(
                        [
                            {"clientId": "admin-cli", "directAccessGrantsEnabled": True},
                            {
                                "clientId": "genie-proxy-client",
                                "secret": "harness-fixture-not-a-credential",
                                "directAccessGrantsEnabled": True,
                            },
                        ]
                    ),
                }
            ),
            expect=["genie realm ROPC posture drifted", "genie-proxy-client"],
            forbid=["Direct-access grants verified"],
        )
    )

    scs.append(
        scenario(
            # The listing is the ONLY thing that proves the other clients'
            # posture: an unreadable answer leaves the invariant UNVERIFIED,
            # and the job must fail on that — never pass without a verdict.
            "realm_client_listing_unreadable_fails",
            1,
            base_rules(
                realm_clients_resp={
                    "status": "401",
                    "body": json.dumps({"error": "HTTP 401 Unauthorized"}),
                }
            ),
            expect=["could not be read back", "UNVERIFIED"],
            forbid=["Direct-access grants verified"],
        )
    )

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
    for tool, target in (
        ("curl", os.path.join(HERE, "stub_curl.py")),
        ("sleep", "/bin/true"),
    ):
        link = os.path.join(shim, tool)
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(target, link)

    env = os.environ.copy()
    env["PATH"] = shim + os.pathsep + env["PATH"]
    env["HARNESS_SCENARIO"] = scenario_path
    env["HARNESS_STATE"] = state_path
    env["KEYCLOAK_ADMIN_PASSWORD"] = "ci-harness-password"

    try:
        proc = subprocess.run(
            ["bash", "-c", helper + "\n" + block],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=workdir,
            check=False,
        )
        output = proc.stdout + proc.stderr
    except subprocess.TimeoutExpired as exc:
        # Fail THIS scenario loudly and keep the report running — a hung
        # scenario must not skip the remaining diagnoses.
        def _s(v):
            return v.decode(errors="replace") if isinstance(v, bytes) else (v or "")

        return (
            ["scenario hung past the 120s budget — killed"],
            _s(exc.stdout) + _s(exc.stderr),
        )
    problems = []
    if proc.returncode != sc["expect_exit"]:
        problems.append(f"exit code {proc.returncode}, expected {sc['expect_exit']}")
    for text in sc["expect"]:
        if text not in output:
            problems.append(f"expected output missing: {text!r}")
    for text in sc["forbid"]:
        if text in output:
            problems.append(f"forbidden output present: {text!r}")
    if sc["calls"]:
        counts = {}
        if os.path.exists(state_path):
            with open(state_path) as f:
                counts = json.load(f)
        for name, expected in sc["calls"].items():
            actual = counts.get(name, 0)
            if actual != expected:
                problems.append(
                    f"rule {name!r} called {actual} times, expected {expected}"
                )
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
                print(f"FAIL {sc['name']}")
                for p in problems:
                    print(f"  - {p}")
                # The block's own output is the diagnosis: print it under the
                # problem lines so a red scenario explains itself in place.
                for line in output.splitlines():
                    print(f"  | {line}")
            else:
                print(f"ok   {sc['name']}")
    print(f"{len(scs) - failed}/{len(scs)} scenarios pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
