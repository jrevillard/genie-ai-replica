#!/usr/bin/env python3
"""Clearing a CLEARABLE values block must never crash the render.

Why this exists
---------------

The chart's contract: a CLEARED block degrades to the derived behaviour
(`services.backend.translation: null` is documented as the supported way
to reset that block, and the per-service shape block documents its
optional knobs as optional), and a block that is NOT clearable fails the
render with a NAMED message — the guard that names the values key and
the remedy.

What it must never do is crash with "nil pointer evaluating interface
{}.endpoint": that names a TEMPLATE (or worse, a helm test pod) instead
of the values key the operator cleared, and with a hundred blocks in
values.yaml the operator is left guessing which one they cleared was the
guilty one. Three review passes found that class — in a helm test
template reading `services.backend.translation` unguarded, in the two
services reading their optional `pvc` block unguarded, and in the
convergence templates reading their optional block unguarded.

What is checked
---------------

Every CLEARABLE block: the per-service optional knobs the shape block
documents (for the services that declare them), plus the tier-level
blocks the chart documents as clearable. Each one is nulled, the chart
is rendered, and the render must not fail with the nil-pointer
signature — the failure mode is greppable and exact, unlike a judgement
about which message is acceptable.

A block that is NOT clearable (a CR's structure, a required image
reference) is out of scope: nulling it is not a configuration anyone
writes, and the chart has no contract to keep there.

Usage: scripts/clearable-blocks-check.py [chart-path]
       CHART=charts/genieai-umbrella scripts/clearable-blocks-check.py
"""

import os
import subprocess
import sys
import time

import yaml

# The signature of an unguarded read: Go's template engine walking into
# a nil interface. The message names the template, never the values key.
NIL_POINTER = "nil pointer"

# The per-service knobs the values.yaml "Per-service entry shape" block
# documents as optional. Clearing one must degrade, not crash.
OPTIONAL_SERVICE_KEYS = (
    "replicas",
    "resources",
    "env",
    "secrets",
    "pvc",
    "volumes",
    "volumeMounts",
    "probes",
    "podDisruptionBudget",
    "podAnnotations",
    "workingDir",
    "command",
    "args",
    "podSecurityContext",
    "securityContext",
)

# The tier-level blocks the chart documents as clearable.
CLEARABLE_BLOCKS = (
    "services.backend.translation",
    "data.keycloak.convergence",
)


def base_flags(chart_path):
    """The shared CI render fixture, resolved next to the chart."""
    ci_dir = os.path.join(os.path.dirname(os.path.abspath(chart_path)), "ci")
    fixture = os.path.join(ci_dir, "render-base-flags")
    if not os.path.isfile(fixture):
        sys.exit(f"missing render fixture: {fixture}")
    with open(fixture) as handle:
        flags = []
        for line in handle:
            line = line.strip()
            if line:
                flags.extend(line.split())
    return flags


def candidate_blocks(values):
    """The clearable blocks: the optional per-service knobs + the tier ones."""
    blocks = list(CLEARABLE_BLOCKS)
    for name, service in (values.get("services") or {}).items():
        if not isinstance(service, dict):
            continue
        for key in OPTIONAL_SERVICE_KEYS:
            if key in service:
                blocks.append(f"services.{name}.{key}")
    return blocks


def main():
    chart_path = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("CHART", "charts/genieai-umbrella")
    )
    values_path = os.path.join(chart_path, "values.yaml")
    with open(values_path) as handle:
        values = yaml.safe_load(handle)
    blocks = candidate_blocks(values)
    flags = base_flags(chart_path)

    crashes = []
    started = time.time()
    for block in blocks:
        proc = subprocess.run(
            ["helm", "template", "test", chart_path, "-n", "genieai"]
            + flags
            + [f"--set={block}=null"],
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0:
            continue
        if NIL_POINTER in proc.stderr:
            first = proc.stderr.strip().split("\n")[0][:200]
            crashes.append(f"  {block}: {first}")
    elapsed = time.time() - started

    print(
        f"{len(blocks)} clearable blocks cleared, {len(crashes)} crashed the render "
        f"with a nil pointer ({elapsed:.0f}s)"
    )
    if crashes:
        print("a cleared block must degrade or fail by NAME, never by nil pointer:")
        for crash in crashes:
            print(crash)
        return 1
    print("every cleared block degrades or fails with a named guard")
    return 0


if __name__ == "__main__":
    sys.exit(main())
