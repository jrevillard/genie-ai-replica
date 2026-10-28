#!/usr/bin/env python3
"""Clearing a values block must never crash the render.

Why this exists
---------------
The chart's contract: a CLEARED block degrades to the derived behaviour
(a block whose switch lives inside it turns that tier off — the same
meaning as `enabled: false`), and a block the chart cannot derive from
fails in the template that needs it, BY NAME. Neither may crash the
template engine.

A crash is the worst of the three outcomes: "nil pointer evaluating
interface {}.cache.enabled" names a TEMPLATE, never the values key the
operator cleared, and a chart with a hundred blocks leaves the operator
guessing which one they cleared was the guilty one. Six review passes
found that class — in the helm test templates reading their optional
blocks unguarded, in the services reading their optional `pvc` block, in
the convergence templates reading their optional block, in the identity
CR reading its optional sub-blocks, and in the edge tier reading its
optional `tls`/`cors` blocks.

What is checked
---------------
EVERY dict-valued node in values.yaml, cleared one at a time, on BOTH
render surfaces (the baseline and the full tier surface). The sweep is
STRUCTURAL: the candidate list comes from the values tree itself, not
from a hand-written list of block names — a list of names cannot see a
block that was added later, and the blocks that crash are exactly the
ones nobody remembered to add to the list.

The assertion is about the FAILURE MODE, not the message: an error
carrying the failing expression (`at <expr>`) is the template engine
crashing and is a defect; an error that names a values key (helm's
`fail`/`required`) is the contract being honoured.

A block the sweep cannot assert on is listed in EXEMPT, with the reason.
The default is swept, so a NEW block is covered the day it is added.

Usage: scripts/clearable-blocks-check.py [chart-path]
       CHART=charts/genieai-umbrella scripts/clearable-blocks-check.py
"""

import os
import re
import subprocess
import sys
import time

import yaml

# The signature of a template-engine crash: the engine reports the
# expression it could not evaluate. A chart-authored guard (helm's
# `fail`/`required`) reports the values key instead, and never carries
# this shape.
ENGINE_CRASH = "at <"

# Blocks whose clearing is NOT a configuration — the sweep cannot assert
# on them, and the chart does not promise anything for them.
#
# `global` holds the chart's OWN defaults for every cluster-wide knob
# (imageRegistry, imagePullPolicy, imagePullSecrets, toolingImageRegistry,
# toolingArch, kubeletToolsMirror). Clearing it in an overlay DELETES those
# defaults (Helm's `null` removes a key instead of merging it), which is a
# destructive values edit rather than a setting: the chart's own default
# for `toolingArch` disappears and the tools init container is handed an
# empty architecture. The documented way to drop a global override is
# `global: {}` — an empty map MERGES, and the chart's defaults survive.
EXEMPT = {
    "global": (
        "the namespace root of the chart's cluster-wide defaults: clearing it "
        "deletes those defaults (Helm's null removes a key), which is not a "
        "configuration — `global: {}` is the documented way to drop an "
        "override"
    ),
}

# The GPU node host is required by the external GPU mode and has no chart
# default; the render must reach it or every orchestrator endpoint is
# empty. The full surface needs it named.
GPU_NODE_HOST = "https://gpu.ci-render.local:444"


def fixture_flags(chart_path, name):
    """The shared CI render fixture, resolved next to the chart."""
    ci_dir = os.path.join(os.path.dirname(os.path.abspath(chart_path)), "ci")
    fixture = os.path.join(ci_dir, name)
    if not os.path.isfile(fixture):
        sys.exit(f"missing render fixture: {fixture}")
    with open(fixture) as handle:
        flags = []
        for line in handle:
            line = line.strip()
            if line:
                flags.extend(line.split())
    return flags


def surfaces(chart_path):
    """The render surfaces the sweep runs on: the baseline and the full tier."""
    base = fixture_flags(chart_path, "render-base-flags")
    full = base + fixture_flags(chart_path, "render-full-flags")
    full.append(f"--set=opea.gpu.nodeHost={GPU_NODE_HOST}")
    return [("baseline", base), ("full surface", full)]


def dict_blocks(values):
    """Every dict-valued node in the values tree, as dotted paths."""
    blocks = []

    def walk(node, prefix):
        if not isinstance(node, dict):
            return
        for name, child in node.items():
            path = f"{prefix}.{name}" if prefix else name
            if isinstance(child, dict) and child:
                blocks.append(path)
            walk(child, path)

    walk(values, "")
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

    blocks = [b for b in dict_blocks(values) if b not in EXEMPT]
    skipped = [b for b in dict_blocks(values) if b in EXEMPT]

    crashes = []
    guards = 0
    rendered = 0
    started = time.time()
    for label, flags in surfaces(chart_path):
        for block in blocks:
            proc = subprocess.run(
                ["helm", "template", "test", chart_path, "-n", "genieai"]
                + flags
                + [f"--set={block}=null"],
                capture_output=True,
                text=True,
            )
            if proc.returncode == 0:
                rendered += 1
                continue
            stderr = proc.stderr
            if ENGINE_CRASH in stderr:
                expression = re.search(r"at <([^>]+)>", stderr)
                template = re.search(r"templates/([A-Za-z0-9_./-]+):", stderr)
                crashes.append(
                    "  [%s] %s: %s — %s"
                    % (
                        label,
                        block,
                        template.group(1) if template else "?",
                        expression.group(1) if expression else "?",
                    )
                )
            else:
                # A chart-authored guard: the render failed BY NAME.
                guards += 1

    elapsed = time.time() - started
    total = len(blocks) * 2
    print(
        f"{len(blocks)} blocks swept on 2 surfaces ({total} renders): "
        f"{rendered} degraded, {guards} failed by name, "
        f"{len(crashes)} crashed the template engine ({elapsed:.0f}s)"
    )
    if skipped:
        for block in skipped:
            print(f"  not swept: {block} — {EXEMPT[block]}")
    if crashes:
        print("a cleared block must degrade or fail by NAME, never by a crash:")
        for crash in crashes:
            print(crash)
        return 1
    print("every cleared block degrades or fails with a named guard")
    return 0


if __name__ == "__main__":
    sys.exit(main())
