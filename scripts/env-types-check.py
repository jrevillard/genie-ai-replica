#!/usr/bin/env python3
"""Every rendered environment variable value must be a STRING.

Why this exists: `v1.EnvVar.value` is typed `string` in the Kubernetes API.
A chart that renders `value: 20` (an int) or `value: false` (a bool) passes
`helm template`, passes `helm lint --strict`, and passes kubeconform's
schema check only because the schema is applied AFTER the YAML-to-JSON
conversion — the value is then rejected by the API server at apply time,
as a CreateContainerConfigError the operator sees minutes after the
install, with the pod's manifest as the only clue.

What this gate ACTUALLY catches
-------------------------------

The chart has two stringification layers, and they are not equivalent:

  * the service factory's `envRows` normalizes every row that goes
    through it (`toString` on the value), so a row that forgets its own
    `| toString` still renders a string — the per-row `| toString` is a
    second layer, not the load-bearing one;
  * a template that hand-renders its env block (the translation
    orchestrator does — it does not go through the factory) has NEITHER
    layer: its value reaches the manifest as the operator typed it, and
    an id whose text happens to parse as a YAML number ("3.1") takes the
    whole Deployment down with "cannot unmarshal number into Go struct
    field EnvVar.value of type string".

So the second render overrides the knobs whose values feed the rows
OUTSIDE the factory, plus the numeric knobs the factory reads. The knob
list is the gate's real specification: a knob there that no row consumes
proves nothing, because the factory would stringify it again before it
reached the manifest.

Usage: scripts/env-types-check.py [chart-path]
       CHART=charts/genieai-umbrella scripts/env-types-check.py
"""

import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

WORKLOAD_KINDS = ("Deployment", "Job", "DaemonSet", "StatefulSet", "ReplicaSet", "Pod")

# libyaml when it is there: this gate parses chart-sized renders and the
# pure Python loader is ~18x slower on them.
LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)

# The overrides that make a non-string reachable.
#
# `opea.translation.modelId` is the load-bearing entry: the translation
# orchestrator hand-renders its env block (it does not go through the
# service factory), so its LLM_MODEL_ID row has no normalization layer at
# all. The others exercise the factory's rows with values whose text
# parses as a number or a boolean.
TYPE_OVERRIDES = [
    "--set=opea.translation.modelId=3.1",
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
    return list(yaml.load_all(proc.stdout, Loader=LOADER))


def env_values(docs):
    """(workload, container, env name, value) for every rendered env row.

    A Pod carries its containers in its own spec; a Deployment (or a Job)
    carries them in the pod template it renders.
    """
    rows = []
    for doc in docs:
        if not isinstance(doc, dict) or doc.get("kind") not in WORKLOAD_KINDS:
            continue
        workload = doc.get("metadata", {}).get("name", "<unnamed>")
        template = (doc.get("spec") or {}).get("template")
        pod = (template or {}).get("spec") or doc.get("spec") or {}
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


# An env row that bypasses the service factory must quote or stringify
# its value: the factory's `envRows` normalization is what makes the
# factory-rendered rows safe, and a template that hand-renders its env
# block has no such layer. `include` and `printf` return strings; a
# bare `.Values` expression does not (an operator's "3.1" renders a
# YAML float).
SAFE_VALUE = ("quote", "toString", "include", "printf", "boolEnvValue")
ENV_NAME_LINE = re.compile(r"^\s*-\s*name:\s*[A-Za-z_][A-Za-z0-9_]*\s*$")
ENV_VALUE_START = re.compile(r"^\s*value:\s*\{\{-?\s*")

# A branch marker opens, closes or switches a branch of the action. It is
# matched WHOLE, so the text between two markers is one branch body.
BRANCH_MARKER = re.compile(r"\{\{-?\s*(?:else\s+if|else|if|with|range|end)\b[^{}]*?\}\}")
# Any action, captured whole.
ACTION = re.compile(r"\{\{-?\s*(.*?)\s*-?\}\}", re.S)
# A Go template comment: it renders nothing, and it can sit inside an
# action. The dashes are part of the comment's own markers, not of the
# value: `{{- /* note */ -}}` is the chart's house style everywhere
# else, and stripping only the undashed form made the comment read as a
# value leaf.
TEMPLATE_COMMENT = re.compile(r"\{\{-?\s*/\*.*?\*/\s*-?\}\}", re.S)


def _action_expression(lines, start):
    """The expression of the `value: {{ ... }}` action starting at `start`.

    The action may span several lines, and it may carry a trailing YAML
    comment — a scanner that only matches a single line sees NEITHER, and
    the row slips out of the gate's coverage exactly when it is at risk
    (a comment after the action is how an author documents the knob, and
    a wrapped expression is how a long one is written). The braces are
    balanced so the capture ends at the action's own `}}`.
    """
    depth = 0
    collected = []
    for index in range(start, len(lines)):
        line = lines[index]
        # A YAML comment after the action is not part of it.
        line = re.sub(r"(?<!#)#.*$", "", line) if "#" in line else line
        collected.append(line)
        depth += line.count("{{") - line.count("}}")
        if depth <= 0 and "{{" in "".join(collected):
            break
    text = "\n".join(collected)
    # GREEDY: an action may hold several sub-actions (`{{ if $smtp }}{{ ... }}{{ else }}...{{ end }}`),
    # and the safety of the row depends on the WHOLE action, not on its first
    # sub-expression.
    match = re.search(r"\{\{-?\s*(.*)\s*-?\}\}", text, re.S)
    return match.group(1) if match else text


def _branch_bodies(expression):
    """The branch bodies of the action, as (value expressions, literal text).

    The action is split on its branch markers, so each body is what one
    branch renders. A construct the split does not know (a nested marker,
    a comment) lands in the body it belongs to, and the safety verdict
    does not depend on the exact nesting: every value expression of
    every body must be safe.
    """
    text = TEMPLATE_COMMENT.sub("", "{{" + expression + "}}")
    bodies = []
    for segment in BRANCH_MARKER.split(text):
        leaves = [leaf.strip() for leaf in ACTION.findall(segment)]
        bodies.append((leaves, ACTION.sub("", segment)))
    return bodies


def _is_yaml_string(text):
    """Whether the text parses as a YAML string.

    A literal branch is only a problem when YAML reads it as something
    else — a number, a boolean (`yes`, `on`), a null. `localhost` and
    `no-reply@genieai.local` are strings and stay strings.
    """
    try:
        return isinstance(yaml.safe_load(text), str)
    except yaml.YAMLError:
        # Not YAML at all: the manifest is broken for another reason, and
        # this gate is about types.
        return True


def _unsafe_bodies(expression):
    """The branch bodies that can render a non-string value."""
    unsafe = []
    for leaves, literal in _branch_bodies(expression):
        unsafe_leaf = next(
            (leaf for leaf in leaves if not any(token in leaf for token in SAFE_VALUE)),
            None,
        )
        if unsafe_leaf:
            unsafe.append(unsafe_leaf)
            continue
        # A body with no value expression renders its literal text
        # alone: `value: {{ if $x }}3.1{{ end }}` renders `value: 3.1`, a
        # YAML float. A literal next to a value expression is part of a
        # longer text and stays a string.
        text = literal.strip()
        if not leaves and text and not _is_yaml_string(text):
            unsafe.append(text)
    return unsafe


def scan_hand_rendered_env_rows(chart_path):
    """The env rows that bypass the factory and are not quoted/stringified.

    The RENDER half of this gate can only see the values it overrides:
    a template that hand-renders a new env row outside the factory is
    unprotected until its knob joins TYPE_OVERRIDES. This half closes
    the class structurally — every such row must quote or stringify, on
    EVERY branch.
    """
    problems = []
    templates = Path(chart_path) / "templates"
    for path in sorted(templates.rglob("*")):
        # The library helpers (.tpl) hand-render env rows too — envMapRows,
        # envRows, convergenceEnvSecretRows — so a row added THERE must be
        # covered as well: the render half can only see the knobs it
        # overrides by hand.
        if path.suffix not in (".yaml", ".yml", ".tpl"):
            continue
        lines = path.read_text().split("\n")
        for index, line in enumerate(lines):
            if not ENV_NAME_LINE.match(line):
                continue
            # The value may sit a few lines below the name (a comment
            # explains it): scan forward to the first content line.
            value_index = index + 1
            while value_index < len(lines) and (
                not lines[value_index].strip()
                or lines[value_index].lstrip().startswith("#")
            ):
                value_index += 1
            if value_index >= len(lines):
                continue
            if not ENV_VALUE_START.match(lines[value_index]):
                continue
            expression = _action_expression(lines, value_index)
            unsafe = _unsafe_bodies(expression)
            if not unsafe:
                continue
            problems.append(
                f"{path.relative_to(chart_path)}:{value_index + 1}: the env row "
                f"{line.strip()} renders an unquoted value ({'; '.join(unsafe)}) — "
                "a value that parses as a number or a boolean reaches the API "
                "server as a non-string"
            )
    return problems


def main():
    chart_path = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
        "CHART", "charts/genieai-umbrella"
    )
    failures = 0
    unquoted = scan_hand_rendered_env_rows(chart_path)
    if unquoted:
        print(f"FAIL: {len(unquoted)} hand-rendered env row(s) render an unquoted value:")
        for problem in unquoted:
            print(f"  {problem}")
        failures += 1
    else:
        print("PASS: every hand-rendered env row quotes or stringifies its value")
    failures += check(render(chart_path, []), "default values")
    # The full-surface render: the OPEA tier is OFF by default, and the
    # OPEA orchestrators are where most of the numeric knobs live. Without
    # this tier the second render would not cover the rows the first one
    # misses.
    failures += check(
        render(
            chart_path,
            TYPE_OVERRIDES + ["--set=opea.gpu.nodeHost=https://gpu.ci-render.local:444"],
            with_full_tier=True,
        ),
        "full surface with type-breaking overrides",
    )
    if failures:
        print()
        print("the chart renders non-string environment values — the API server will reject them")
        sys.exit(1)
    print()
    print("every rendered environment value is a string")


if __name__ == "__main__":
    main()
