#!/usr/bin/env python3
"""Stub curl driven by a JSON scenario — the engine behind harness.py (#1337).

Env contract:
  HARNESS_SCENARIO: path to a scenario JSON {"rules": [...]}
  HARNESS_STATE:    path to the per-rule call-counter JSON this stub maintains

Each rule is {"name", "method", "url" (substring match), "responses"} — a
list of {"status", "body", "rc"} served in order; the last entry repeats
once exhausted. The body goes to the -o file (or stdout), the -w format is
emitted with %{http_code} substituted (and the literal "\\n" two-char
sequence, exactly as curl interprets it), and the rule's rc becomes the
exit code — a non-zero rc over a captured status models a truncated
transport answer (timeout after headers, reset mid-body).

An unscripted call exits 97 with a message on stderr: the harness must
script every call the provisioning block makes, and a scenario that
reaches an unscripted URL is a harness bug, not a pass.
"""

import json
import os
import sys

VALUE_FLAGS = {"-o", "-w", "-H", "-d", "--data", "--data-urlencode", "--data-raw",
               "--connect-timeout", "--max-time"}


def parse_args(argv):
    method = "GET"
    url = ""
    out_file = None
    write_out = ""
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "-X":
            method = argv[i + 1]
            i += 2
        elif arg in VALUE_FLAGS:
            if arg == "-o":
                out_file = argv[i + 1]
            elif arg == "-w":
                write_out = argv[i + 1]
            i += 2
        elif arg.startswith("--"):
            i += 1
        elif arg.startswith("-"):
            i += 1  # bundled short flags: -s -k -f -S and combinations
        else:
            url = arg
            i += 1
    return method, url, out_file, write_out


def main():
    method, url, out_file, write_out = parse_args(sys.argv[1:])
    with open(os.environ["HARNESS_SCENARIO"]) as f:
        scenario = json.load(f)
    state_path = os.environ["HARNESS_STATE"]
    state = {}
    if os.path.exists(state_path):
        with open(state_path) as f:
            state = json.load(f)
    matches = [r for r in scenario["rules"]
               if r["method"] == method and r["url"] in url]
    if not matches:
        sys.stderr.write("stub-curl: no scenario rule for %s %s\n" % (method, url))
        sys.exit(97)
    # Longest url wins: a POST to /users/<id>/role-mappings/realm also
    # contains the create rule's /users substring — the most specific rule
    # must serve the call.
    rule = max(matches, key=lambda r: len(r["url"]))
    name = rule["name"]
    count = state.get(name, 0)
    responses = rule["responses"]
    resp = responses[count] if count < len(responses) else responses[-1]
    state[name] = count + 1
    with open(state_path, "w") as f:
        json.dump(state, f)
    status = str(resp.get("status", "000"))
    body = resp.get("body", "")
    if out_file:
        with open(out_file, "w") as f:
            f.write(body)
    elif body:
        sys.stdout.write(body)
    if write_out:
        trailer = write_out.replace("\\n", "\n").replace("%{http_code}", status)
        sys.stdout.write(trailer)
    sys.exit(int(resp.get("rc", 0)))


if __name__ == "__main__":
    main()
