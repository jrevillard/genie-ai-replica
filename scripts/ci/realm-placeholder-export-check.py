#!/usr/bin/env python3
"""Every realm placeholder must be EXPORTED by the convergence Job.

The chart's own render-time guard checks the realm's `$(env:VAR)`
placeholders against a list written out BY HAND in the template
(`$known`), in parallel with the Job's env block. Adding a name to one
list does not add it to the other — the template says so in as many
words. The consequence is a hole: a placeholder declared in `$known` but
never rendered as an env entry passes the render, and kcc then aborts the
import at runtime with a parse error that names the variable and nothing
else. The chart's guard is loud about a placeholder it does not know; it
is silent about one it knows but does not export.

This gate closes that hole from the RENDER — the third artifact, not a
second declaration. It reads the env names the convergence Job actually
renders (every container's `env[].name`, secret-backed rows included:
a `valueFrom` row is an export) and the placeholders the realm file
actually carries, and requires every placeholder to be among them.

Deleting an env row from the template turns this gate red; the chart's
own guard stays green. That is the whole point: the two checks cover
different classes, and only the pair covers the class.

SCOPE: this gate proves that a placeholder is EXPORTED — that the name
is among the Job's env rows. It says nothing about the VALUE: a row
that carries the right name and the wrong number passes by design (the
value's correctness belongs to the template that computes it, and to
the chart's own render-time guard). A second gate that reads values
would have to decide what the right value IS, per placeholder — a
judgement the chart does not encode anywhere.

Usage:
  realm-placeholder-export-check.py <rendered.yaml> <realm-file>

Exit codes: 0 = every placeholder is exported; 1 = at least one is not;
2 = usage or input error.
"""

import re
import sys

import yaml

PLACEHOLDER = re.compile(r"\$\(env:([A-Z_][A-Z0-9_]*)\)")
CONVERGENCE_JOB_SUFFIX = "-keycloak-convergence"


def fail_usage(message):
    print(f"usage error: {message}", file=sys.stderr)
    sys.exit(2)


def rendered_env_names(docs):
    """The env names the convergence Job renders.

    Every container of the Job: the realm import runs in one container
    today, but the export surface is "the Job's env", and a second
    container would export the same way.
    """
    names = set()
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        if doc.get("kind") != "Job":
            continue
        meta = doc.get("metadata") or {}
        name = meta.get("name") or ""
        if not name.endswith(CONVERGENCE_JOB_SUFFIX):
            continue
        pod = ((doc.get("spec") or {}).get("template") or {}).get("spec") or {}
        for container in pod.get("containers") or []:
            for entry in container.get("env") or []:
                env_name = entry.get("name")
                if env_name:
                    names.add(env_name)
    return names


def realm_placeholders(path):
    with open(path, encoding="utf-8") as handle:
        body = handle.read()
    return set(PLACEHOLDER.findall(body))


def main(argv):
    if len(argv) != 3:
        fail_usage("expected <rendered.yaml> <realm-file>")

    rendered_path, realm_path = argv[1], argv[2]
    try:
        with open(rendered_path, encoding="utf-8") as handle:
            docs = list(yaml.safe_load_all(handle))
    except OSError as error:
        fail_usage(f"cannot read the render: {error}")
    except yaml.YAMLError as error:
        fail_usage(f"the render is not YAML: {error}")

    try:
        placeholders = realm_placeholders(realm_path)
    except OSError as error:
        fail_usage(f"cannot read the realm file: {error}")

    if not placeholders:
        fail_usage(
            "the realm file carries no $(env:VAR) placeholder — the fixture is wrong, not the chart"
        )

    exported = rendered_env_names(docs)
    if not exported:
        fail_usage(
            "the render carries no convergence Job env — the Job was not rendered, so the check would pass vacuously"
        )

    missing = sorted(placeholders - exported)
    if missing:
        print(
            "FAIL: the realm references placeholders the convergence Job does not export:"
        )
        for name in missing:
            print(f"  $(env:{name})")
        print(
            "  kcc aborts the import on an unresolved placeholder with a parse error that names nothing. "
            "Add the variable to the Job's env block (and to the template's $known list), or drop the "
            "placeholder from the realm file."
        )
        return 1

    print(
        f"PASS: every realm placeholder is exported by the convergence Job ({len(placeholders)} placeholders)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
