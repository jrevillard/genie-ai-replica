#!/usr/bin/env python3
"""Clearing a values block must never break the render.

Why this exists
---------------
The chart's contract: a CLEARED block degrades to the derived behaviour
(a block whose switch lives inside it turns that tier off — the same
meaning as `enabled: false`), and a block the chart cannot derive from
fails in the template that needs it, BY NAME. Neither may crash the
template engine, and neither may silently EMPTY a value the pods dial.

A crash is the worst of the three outcomes: "nil pointer evaluating
interface {}.cache.enabled" names a TEMPLATE, never the values key the
operator cleared, and a chart with a hundred blocks leaves the operator
guessing which one they cleared was the guilty one. Six review passes
found that class — in the helm test templates, in the services' optional
`pvc` blocks, in the convergence templates, in the identity CR's
sub-blocks, in the edge tier's `tls`/`cors` blocks.

What is checked
---------------
EVERY dict-valued node in values.yaml, cleared one at a time, on BOTH
render surfaces (the baseline and the full tier surface, so the OPEA and
observability templates are exercised). The sweep is STRUCTURAL: the
candidate list comes from the values tree itself, not from a hand-written
list of block names — a list of names cannot see a block that was added
later, and the blocks that crash are exactly the ones nobody remembered
to add to the list.

Three assertions, one per failure mode:

1. NO CRASH. An error carrying the failing expression (`at <expr>`) is
   the template engine crashing: a defect. A chart-authored guard
   (`helm`'s `fail`/`required`) reports the VALUES KEY and never carries
   that shape — it is the contract being honoured. Any other error (a
   YAML parse error, a schema violation) is neither: it names neither
   the values key nor the operator's mistake, so it is a defect too.
2. NO SILENT EMPTY. A render that succeeds is not enough: a degraded
   render that EMPTIES a value the pods dial (the GPU endpoint, the
   collector address) is a broken release that installs cleanly. Every
   environment row present in BOTH the baseline and the cleared render
   must keep a non-empty value.
3. NO LOST BLOCK. A block the sweep cannot assert on would be listed in
   EXEMPT, with the reason. The default is swept, so a NEW block is
   covered the day it is added.

Usage: scripts/clearable-blocks-check.py [chart-path]
       CHART=charts/genieai-umbrella scripts/clearable-blocks-check.py
"""

import os
import re
import subprocess
import sys
import time

import yaml

# libyaml when it is there: the sweep parses ~200 renders, and the pure
# Python loader is 18x slower on a chart-sized manifest.
LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)

# The signature of a template-engine crash: the engine reports the
# expression it could not evaluate. A chart-authored guard (helm's
# `fail`/`required`) reports the values key instead, and never carries
# this shape.
ENGINE_CRASH = "at <"

# The signature of a chart-authored guard: helm reports the location and
# the message the template wrote — and the message names the values key
# the operator has to fix.
CHART_GUARD = re.compile(r"execution error at \([^)]*\):")

# The signature of a template-engine crash, for the report: the LAST
# match is the INNERMOST template — the one that actually crashed, not
# the include site that called it.
CRASH_EXPRESSION = re.compile(r"at <([^>]+)>")
CRASH_TEMPLATE = re.compile(r"templates/([A-Za-z0-9_./-]+):(\d+):(\d+)")

WORKLOAD_KINDS = ("Deployment", "Job", "DaemonSet", "StatefulSet", "ReplicaSet", "Pod")

# Blocks whose clearing is NOT a configuration — the sweep cannot assert
# on them, and the chart does not promise anything for them. EMPTY: every
# block of the values tree is swept.
EXEMPT = {}

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


def render(chart_path, flags):
    """(rc, stderr, documents) for one render."""
    proc = subprocess.run(
        ["helm", "template", "test", chart_path, "-n", "genieai"] + list(flags),
        capture_output=True,
        text=True,
    )
    docs = []
    if proc.returncode == 0:
        docs = [d for d in yaml.load_all(proc.stdout, Loader=LOADER) if d]
    return proc.returncode, proc.stderr, docs


def env_rows(docs):
    """(workload, container, env name) -> value, for every rendered env row."""
    rows = {}
    for doc in docs:
        if not isinstance(doc, dict) or doc.get("kind") not in WORKLOAD_KINDS:
            continue
        workload = doc.get("metadata", {}).get("name", "<unnamed>")
        spec = (doc.get("spec") or {}).get("template") or {}
        pod = (spec.get("spec") or {})
        containers = (pod.get("containers") or []) + (pod.get("initContainers") or [])
        for container in containers:
            for entry in container.get("env") or []:
                if "value" in entry:
                    key = (workload, container.get("name", "<unnamed>"), entry.get("name"))
                    rows[key] = entry["value"]
    return rows


def classify(stderr):
    """(kind, detail) for one failed render."""
    if ENGINE_CRASH in stderr:
        expressions = CRASH_EXPRESSION.findall(stderr)
        templates = CRASH_TEMPLATE.findall(stderr)
        template = templates[-1] if templates else ("?", "?")
        expression = expressions[-1] if expressions else "?"
        return "crash", "%s:%s — %s" % (template[0], template[1], expression)
    if CHART_GUARD.search(stderr):
        return "guard", ""
    return "nameless", stderr.strip().split("\n")[0][:160]


def main():
    chart_path = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("CHART", "charts/genieai-umbrella")
    )
    values_path = os.path.join(chart_path, "values.yaml")
    with open(values_path) as handle:
        values = yaml.safe_load(handle)

    every = dict_blocks(values)
    blocks = [b for b in every if b not in EXEMPT]
    skipped = [b for b in every if b in EXEMPT]

    crashes = []
    nameless = []
    emptied = []
    guards = 0
    rendered = 0
    started = time.time()
    for label, flags in surfaces(chart_path):
        base_rc, base_err, base_docs = render(chart_path, flags)
        if base_rc != 0:
            print("FAIL: the baseline render of the %s failed:\n%s" % (label, base_err[:800]))
            return 1
        base_rows = env_rows(base_docs)
        for block in blocks:
            rc, stderr, docs = render(chart_path, flags + [f"--set={block}=null"])
            if rc == 0:
                rendered += 1
                cleared_rows = env_rows(docs)
                for key, value in base_rows.items():
                    if key not in cleared_rows:
                        continue
                    if value and not cleared_rows[key]:
                        emptied.append(
                            "  [%s] %s: %s / %s / %s went from %r to an empty value"
                            % (label, block, key[0], key[1], key[2], value)
                        )
                continue
            kind, detail = classify(stderr)
            if kind == "guard":
                guards += 1
            elif kind == "crash":
                crashes.append("  [%s] %s: %s" % (label, block, detail))
            else:
                nameless.append("  [%s] %s: %s" % (label, block, detail))
    elapsed = time.time() - started
    total = len(blocks) * 2
    print(
        f"{len(blocks)} blocks swept on 2 surfaces ({total} renders): "
        f"{rendered} degraded, {guards} failed by name, "
        f"{len(crashes)} crashed the template engine, "
        f"{len(nameless)} failed without naming a values key ({elapsed:.0f}s)"
    )
    if skipped:
        for block in skipped:
            print(f"  not swept: {block} — {EXEMPT[block]}")
    if crashes:
        print("a cleared block must degrade or fail by NAME, never by a crash:")
        for crash in crashes:
            print(crash)
    if nameless:
        print("a cleared block must fail with a message naming the values key:")
        for failure in nameless:
            print(failure)
    if emptied:
        print("a cleared block must not EMPTY a value the pods read:")
        for row in emptied:
            print(row)
    if crashes or nameless or emptied:
        return 1
    print("every cleared block degrades or fails with a named guard")
    return 0


if __name__ == "__main__":
    sys.exit(main())
