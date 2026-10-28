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

# Go's template engine prints these when a nil value reaches a `%s` verb
# or a stringified field: "%!s(<nil>)" in a container argument, the bare
# text "<nil>" in an env value. They are not values — they are the
# engine's debug output, and a pod that reads one fails at runtime with
# nothing in the manifest to explain it.
GARBAGE = re.compile(r"<nil>|%!")

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
    """The render surfaces the sweep runs on.

    Three, not two: the in-cluster GPU tier is its OWN surface. The model
    Deployments (vllm, vllm-translation, tei, tei-reranker) exist ONLY in
    that mode, so a sweep that never renders them asserts nothing about
    the blocks they read — and a cleared model block rendered "%!s(<nil>)"
    into the container args while the whole suite stayed green.
    """
    base = fixture_flags(chart_path, "render-base-flags")
    full_flags = fixture_flags(chart_path, "render-full-flags")
    full = base + full_flags
    full.append(f"--set=opea.gpu.nodeHost={GPU_NODE_HOST}")
    incluster = base + full_flags
    incluster.append("--set=opea.gpu.mode=in-cluster")
    return [
        ("baseline", base),
        ("full surface", full),
        ("in-cluster GPU", incluster),
    ]


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
    """(rc, stderr, documents, text) for one render."""
    proc = subprocess.run(
        ["helm", "template", "test", chart_path, "-n", "genieai"] + list(flags),
        capture_output=True,
        text=True,
    )
    docs = []
    if proc.returncode == 0:
        docs = [d for d in yaml.load_all(proc.stdout, Loader=LOADER) if d]
    return proc.returncode, proc.stderr, docs, proc.stdout


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


def object_names(docs):
    """The name of every rendered object."""
    names = set()
    for doc in docs:
        if isinstance(doc, dict):
            name = (doc.get("metadata") or {}).get("name")
            if name:
                names.add(name)
    return names


def _normalized(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def owns_drop(block, group, vanished):
    """Whether the cleared block owns the rows it removed.

    A row that DISAPPEARS is a degradation the operator did not ask
    for, unless the block that removed it is the one that configures it:

      * the block's path names the workload it took the row from (the
        service segment of `services.backend.env` names the backend), or
      * the row pointed at a resource the block removed (a service
        switched off with its tier: the row carried its host, the port
        beside it carried nothing).

    The rows one WORKLOAD loses are judged as ONE group, and one owned
    row forgives that workload's group: a row that carries no name of
    its own (a port, a model id) belongs to the same removal as the row
    that does, and judging it alone would report a legitimate
    degradation — the backend losing the chatqna PORT because the OPEA
    tier went off. Two workloads are never forgiven together: the drop
    a second workload suffers is judged on its own.
    """
    segments = [_normalized(part) for part in block.split(".")]
    for key, value in group:
        workload = _normalized(key[0])
        if any(token and token in workload for token in segments[-2:]):
            return True
        if any(gone and gone in str(value) for gone in vanished):
            return True
    return False


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
    orphans = []
    guards = 0
    rendered = 0
    started = time.time()
    for label, flags in surfaces(chart_path):
        base_rc, base_err, base_docs, base_text = render(chart_path, flags)
        if base_rc != 0:
            print("FAIL: the baseline render of the %s failed:\n%s" % (label, base_err[:800]))
            return 1
        base_rows = env_rows(base_docs)
        base_names = object_names(base_docs)
        for block in blocks:
            rc, stderr, docs, text = render(chart_path, flags + [f"--set={block}=null"])
            if rc == 0:
                rendered += 1
                garbage = GARBAGE.search(text)
                if garbage:
                    emptied.append(
                        "  [%s] %s: the render carries the template engine's debug "
                        "output %r — a cleared block reached a value as nil"
                        % (label, block, text[max(0, garbage.start() - 40):garbage.start() + 20])
                    )
                cleared_rows = env_rows(docs)
                dropped = []
                for key, value in base_rows.items():
                    if key not in cleared_rows:
                        dropped.append((key, value))
                        continue
                    if value and not cleared_rows[key]:
                        emptied.append(
                            "  [%s] %s: %s / %s / %s went from %r to an empty value"
                            % (label, block, key[0], key[1], key[2], value)
                        )
                # NO SILENT DROP. A row that DISAPPEARS is as much a
                # degradation as one that empties: the pod starts without
                # a variable the operator never touched. It is legitimate
                # only when the block that removed it is the one that
                # configures it.
                #
                # The workload survived or not is read from the RENDERED
                # OBJECTS, not from the rows that still carry a value: a
                # workload stripped of every row is the worst case, not
                # an exempt one.
                vanished_names = base_names - object_names(docs)
                surviving_workloads = {
                    workload
                    for workload in {key[0] for key, _ in dropped}
                    if workload not in vanished_names
                }
                for workload in sorted(surviving_workloads):
                    rows = [(key, value) for key, value in dropped if key[0] == workload]
                    if not owns_drop(block, rows, vanished_names):
                        orphans.append(
                            "  [%s] %s: the block removed %d env row(s) from %s, "
                            "a workload it does not configure — %s"
                            % (
                                label,
                                block,
                                len(rows),
                                workload,
                                ", ".join(sorted(key[2] for key, _ in rows)),
                            )
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
    total = len(blocks) * len(surfaces(chart_path))
    print(
        f"{len(blocks)} blocks swept on {len(surfaces(chart_path))} surfaces ({total} renders): "
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
        print("a cleared block must not EMPTY a value the pods read, nor render "
              "the template engine's debug output:")
        for row in emptied:
            print(row)
    if orphans:
        print("a cleared block must not remove an env row from a workload it does "
              "not configure:")
        for row in orphans:
            print(row)
    if crashes or nameless or emptied or orphans:
        return 1
    print("every cleared block degrades or fails with a named guard")
    return 0


if __name__ == "__main__":
    sys.exit(main())
