#!/usr/bin/env python3
# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
"""Render deploy/ansible/templates/env.j2 for one of the deployment shapes.

The ROCm branches of env.j2 are gated by Jinja conditionals, so a static
read of the template cannot tell whether a row renders on a given
deployment. This helper renders the template for the three shapes the
repository cares about and prints the result:

    nvidia       — the shared group_vars only (the NVIDIA deployment)
    rocm-local   — + the ROCm GPU node's vars (the co-located node)
    rocm-remote  — + a remote GPU node (the app host's group_vars)

The rendering is deliberately lenient about UNDEFINED variables (they
render empty, as the deployment's own dotenv would): the point of the
gate is the CONDITIONAL structure, not the secret values.

Usage:
    python3 render_env_template.py <case>
    python3 render_env_template.py --cases     # list the case names

Requires jinja2. The CI job installs it (apk add py3-jinja2); the
JavaScript gate skips when python3 or jinja2 is missing.
"""

import json
import pathlib
import re
import sys

import jinja2
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
TEMPLATE = REPO_ROOT / "deploy/ansible/templates/env.j2"
ALL_VARS = REPO_ROOT / "deploy/ansible/group_vars/all.yml"
ROCM_VARS = REPO_ROOT / "deploy/ansible/group_vars/rocm_gpu_nodes/vars.yml"

# The filters env.j2 uses that Jinja does not ship. Ansible provides them.
ANSIBLE_FILTERS = {
    "regex_replace": lambda value, pattern, repl: re.sub(pattern, repl, value),
    "regex_search": lambda value, pattern: re.search(pattern, value),
    "regex_findall": lambda value, pattern: re.findall(pattern, value),
    "ternary": lambda value, true_val, false_val: true_val if value else false_val,
    "basename": lambda value: value.rsplit("/", 1)[-1],
    "dirname": lambda value: value.rsplit("/", 1)[0],
    "to_json": json.dumps,
    "to_yaml": lambda value: yaml.safe_dump(value, default_flow_style=False).strip(),
    "from_json": json.loads,
}


def _base_vars(**extra):
    """The shared variables every deployment carries."""
    variables = yaml.safe_load(ALL_VARS.read_text()) or {}
    variables.update({"ansible_host": "10.0.0.5", "inventory_hostname": "gpu0"})
    variables.update(extra)
    return variables


def _cases():
    # The ROCm group_vars exist only on a tree that carries the ROCm path;
    # the NVIDIA case needs nothing from them, so their absence must not
    # break the render (the gate is meant to run on any checkout).
    rocm = yaml.safe_load(ROCM_VARS.read_text()) if ROCM_VARS.exists() else {}
    remote = {key: value for key, value in rocm.items() if key != "rocm_gpu_node_local"}
    return {
        "nvidia": _base_vars(),
        "rocm-local": _base_vars(**rocm),
        "rocm-remote": _base_vars(
            **remote,
            rocm_gpu_node_remote=True,
            gpu_node_host="gpu.example.org",
        ),
    }


def render(case):
    """Render env.j2 for `case` and return the text."""
    if case not in _cases():
        raise SystemExit(
            f"unknown case {case!r}; known cases: {', '.join(sorted(_cases()))}"
        )
    env = jinja2.Environment(undefined=jinja2.Undefined, keep_trailing_newline=True)
    env.filters.update(ANSIBLE_FILTERS)
    template = env.from_string(TEMPLATE.read_text())
    return template.render(**_cases()[case])


def main(argv):
    if not argv or argv[0] == "--cases":
        print("\n".join(sorted(_cases())))
        return 0
    sys.stdout.write(render(argv[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
