#!/usr/bin/env python3
"""Every rendered environment variable value must be a STRING.

Why this exists: `v1.EnvVar.value` is typed `string` in the Kubernetes API.
A chart that renders `value: 20` (an int) or `value: false` (a bool) passes
`helm template`, passes `helm lint --strict`, and passes kubeconform's
schema check only because the schema is applied AFTER the YAML-to-JSON
conversion — the value is then rejected by the API server at apply time,
as a CreateContainerConfigError the operator sees minutes after the
install, with the pod's manifest as the only clue.

The chart's env rows are built from operator-tunable values, and those
values are NOT all strings in values.yaml: a port is an int, a flag is a
bool, a threshold is a float. The template must stringify them at the
render boundary, because the API server does not.

This script renders the chart twice — once with the default values, once
with the numeric knobs overridden to a number — and asserts every
rendered env value is a string in both renders. The second render is the
one that matters: the defaults happen to be strings, so a template that
forgot `| toString` renders clean until an operator tunes the knob.

Usage: scripts/env-types-check.py [chart-path]
       CHART=charts/genieai-umbrella scripts/env-types-check.py
"""

import os
import subprocess
import sys

import yaml

WORKLOAD_KINDS = ("Deployment", "Job", "DaemonSet", "StatefulSet", "ReplicaSet")

# The knobs whose values are numbers or booleans in values.yaml. Overriding
# them with a number is what turns a missing `| toString` into a visible
# non-string env value.
NUMERIC_OVERRIDES = [
    "--set=opea.chatqna.retrieverArangoSearchStart=1",
    "--set=opea.dataprep.labelingStrategy=5",
    "--set=opea.retriever.retrieverArangoK=42",
    "--set=opea.retriever.retrieverArangoScoreThreshold=0.75",
    "--set=opea.retriever.retrieverArangoTraversalEnabled=false",
    "--set=services.backend.port=8080",
    "--set=services.documentRepository.clamavPort=3311",
    "--set=services.documentRepository.clamavHost=clamav",
]


def base_flags(chart_path):
    """The shared CI render fixture, resolved next to the chart."""
    return fixture_flags(chart_path, "render-base-flags")


def full_flags(chart_path):
    """The full-surface fixture: the tiers the base render leaves off."""
    return fixture_flags(chart_path, "render-full-flags")


def fixture_flags(chart_path, name):
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


def render(chart_path, extra_flags, with_full_tier=False):
    flags = base_flags(chart_path)
    if with_full_tier:
        flags += full_flags(chart_path)
    cmd = [
        "helm",
        "template",
        "test",
        chart_path,
        "-n",
        "genieai",
    ] + flags + list(extra_flags)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit("render failed:\n" + proc.stderr[:2000])
    return list(yaml.safe_load_all(proc.stdout))


def env_values(docs):
    """(workload, container, env name, value) for every rendered env row."""
    rows = []
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
                    rows.append(
                        (workload, container.get("name", "<unnamed>"), entry.get("name", "<unnamed>"), entry["value"])
                    )
    return rows


def check(docs, label):
    failures = []
    rows = env_values(docs)
    for workload, container, name, value in rows:
        if not isinstance(value, str):
            failures.append(
                f"  {workload}/{container}: {name} = {value!r} "
                f"({type(value).__name__}) — EnvVar.value must be a string; "
                f"the API server rejects a non-string at apply time"
            )
        elif value == "<nil>":
            failures.append(
                f"  {workload}/{container}: {name} = '<nil>' — a cleared value was "
                f"stringified from nil instead of degrading to its documented default"
            )
    if failures:
        print(f"FAIL: {label} — {len(failures)} non-string env value(s) of {len(rows)} rows:")
        for failure in failures:
            print(failure)
        return 1
    print(f"PASS: {label} — {len(rows)} env rows, all string")
    return 0


def main():
    chart_path = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
        "CHART", "charts/genieai-umbrella"
    )
    failures = 0
    failures += check(render(chart_path, []), "default values")
    # The full-surface render: the OPEA tier is OFF by default, and the
    # OPEA orchestrators are where most of the numeric knobs live. Without
    # this tier the second render would not cover the rows the first one
    # misses.
    failures += check(
        render(
            chart_path,
            NUMERIC_OVERRIDES + ["--set=opea.gpu.nodeHost=https://gpu.ci-render.local:444"],
            with_full_tier=True,
        ),
        "full surface with numeric and boolean overrides",
    )
    if failures:
        print()
        print("the chart renders non-string environment values — the API server will reject them")
        sys.exit(1)
    print()
    print("every rendered environment value is a string")


if __name__ == "__main__":
    main()
