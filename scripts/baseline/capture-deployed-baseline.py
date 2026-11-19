#!/usr/bin/env python3
"""Capture the deployed stack baseline (V03) and reconcile it with the source baseline.

Story 1.2 of the agentic-foundations PRD (issue #1948). The record this script
renders is the reference E01 (Epic 4) measures against: it must describe the
system that actually serves traffic, not the one the repository assumes.

Read-only. The script creates, patches and deletes nothing on the cluster, and
never writes a secret into the record.

Usage:
    uv run --no-cache --with pyyaml python scripts/baseline/capture-deployed-baseline.py \
        --namespace genieai \
        --out docs/baselines/v03-deployed-baseline-2026-11-18.md

Exit codes:
    0  the record was written and every discrepancy carries a disposition
    2  the record was written, but at least one discrepancy is UNRESOLVED
    3  the capture failed (cluster unreachable, chart source missing, ...)
"""

from __future__ import annotations

import argparse
import base64
import binascii
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from functools import cache

try:
    import yaml
except ImportError:  # pragma: no cover - CI installs PyYAML for the chart gates
    sys.exit("PyYAML is required (pip install pyyaml)")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHART_DIR = os.path.join(REPO_ROOT, "charts", "genieai-umbrella")
CHART_TEMPLATES = os.path.join(CHART_DIR, "templates", "opea")
BACKEND_TEMPLATE = os.path.join(CHART_DIR, "templates", "services", "backend.yaml")

# The GitLab front door refuses the default Python user agent (the token
# endpoint answers 403); the capture identifies itself like a normal client.
USER_AGENT = "genieai-baseline-capture/1.0"

# The chart section each OPEA workload is rendered from. The component label
# is what the chart puts on the workload; the file is the template that
# declares the workload's environment. The scope is the retrieval and
# ingestion tier the acceptance criteria name, plus the OKF tier the chart
# renders beside it (the PII sidecar, the OKF server, the RAGAS judge): the
# application tier (backend, frontend, document repository) is compared for
# its model ids only.
OPEA_WORKLOADS = {
    "chatqna": "chatqna.yaml",
    "retriever": "retriever.yaml",
    "dataprep": "dataprep.yaml",
    "embedding": "embedding.yaml",
    "reranker": "reranker.yaml",
    "translation": "translation.yaml",
    "pii-service": "pii-service.yaml",
    "okf-server": "okf-server.yaml",
    "ragas-service": "ragas-service.yaml",
}

# The values path each workload's operator env map lives at. The retrieval
# tier's map is its own chart section's `env`; the OKF tier's map sits under
# the OKF section, one path per workload.
WORKLOAD_ENV_MAPS = {
    "pii-service": "okf.pii.env",
    "okf-server": "okf.server.env",
    "ragas-service": "okf.ragas.env",
}

# The model ids the APPLICATION tier pins. The chart path each one comes
# from is read from the application's own template - that template's
# fallback chain is the only place the fallback is written down.
MODEL_VARIABLES = {
    "backend": ("VLLM_TRANSLATION_MODEL_ID",),
}

# The model roles the record reports. Each role names the chart path that
# declares it and the (workload, variable) pairs that may carry it, in a
# fixed order so the reported value never depends on kubectl's item order.
MODEL_ROLES = (
    ("embedding", "opea.embedding.modelId", (("embedding", "EMBEDDING_MODEL_ID"),)),
    ("reranker", "opea.models.reranker.modelId", ()),
    ("llm", "opea.models.llm.modelId", (("chatqna", "LLM_MODEL"), ("dataprep", "VLLM_MODEL_ID"))),
    (
        "translation",
        "opea.translation.modelId",
        (("translation", "LLM_MODEL_ID"), ("chatqna", "VLLM_TRANSLATION_MODEL_ID")),
    ),
)

# The values the chart COMPUTES from other values. Those rows are the ones a
# baseline is strictest about (the model node it talks to, the public origin
# the realm pins) and they are derived exactly as the chart's helpers derive
# them (templates/_lib/_opea.tpl, templates/_lib/_urls.tpl).
DERIVED_VARIABLES = {
    ("chatqna", "VLLM_LLM_ENDPOINT"): [("derived", "gpu.endpoint.llm")],
    ("chatqna", "VLLM_TRANSLATION_ENDPOINT"): [("derived", "gpu.endpoint.translation")],
    ("chatqna", "GPU_NODE_HOST"): [("derived", "gpu.hostname")],
    ("chatqna", "KEYCLOAK_URL"): [("derived", "public.issuer")],
    ("dataprep", "VLLM_ENDPOINT"): [("derived", "gpu.endpoint.llm")],
    ("dataprep", "TEI_EMBEDDING_ENDPOINT"): [("derived", "gpu.endpoint.embedding")],
    ("dataprep", "GPU_NODE_HOST"): [("derived", "gpu.hostname")],
    ("retriever", "VLLM_ENDPOINT"): [("derived", "gpu.endpoint.llm")],
    ("retriever", "TEI_EMBEDDING_ENDPOINT"): [("derived", "gpu.endpoint.embedding")],
    ("retriever", "GPU_NODE_HOST"): [("derived", "gpu.hostname")],
    ("embedding", "EMBEDDING_MODEL_ENDPOINT"): [("derived", "gpu.endpoint.embedding")],
    ("embedding", "TEI_EMBEDDING_ENDPOINT"): [("derived", "gpu.endpoint.embedding")],
    ("reranker", "TEI_RERANKING_ENDPOINT"): [("derived", "gpu.endpoint.reranker")],
    # The backend names its translation endpoint explicitly when the
    # operator does; otherwise it falls back to the GPU's translation
    # endpoint, exactly as the template does.
    ("backend", "VLLM_TRANSLATION_ENDPOINT"): [
        ("path", "services.backend.translation.endpoint"),
        ("derived", "gpu.endpoint.translation"),
    ],
}

# Kubernetes injects the service-discovery variables into every pod; they
# are not configuration. The filter only applies to a variable the chart does
# NOT declare - a chart-declared `<peer>_SERVICE_PORT` is configuration and
# is compared.
INJECTED_PATTERNS = (
    re.compile(r"_SERVICE_HOST$"),
    re.compile(r"_SERVICE_PORT"),
    re.compile(r"_PORT_\d+_TCP"),
    re.compile(r"_TCP$"),
    re.compile(r"_TCP_ADDR$"),
    re.compile(r"_TCP_PORT$"),
    re.compile(r"_TCP_PROTO$"),
)

# Dispositions for the differences this story knows about. A difference with
# no entry here is rendered as UNRESOLVED: an unexplained drift must not
# pass silently.
# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def run(args, check=True):
    """Run a command and return its stdout as text."""
    proc = subprocess.run(args, capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"command failed ({proc.returncode}): {' '.join(args)}\n{proc.stderr.strip()}"
        )
    return proc.stdout


def kubectl_json(namespace, *args):
    return json.loads(run(["kubectl", "-n", namespace, *args, "-o", "json"]))


def get_path(values, path):
    node = values
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def leaf_paths(values, prefix=""):
    """The dotted paths of every leaf of a values tree."""
    paths = set()
    if isinstance(values, dict):
        for key, value in values.items():
            child = f"{prefix}.{key}" if prefix else str(key)
            paths.update(leaf_paths(value, child))
    elif isinstance(values, list):
        paths.add(prefix)
    else:
        paths.add(prefix)
    return paths


def set_path(values, path, replacement):
    """The values tree with `path` replaced by `replacement`.

    Flux refuses to merge a targeted source whose path runs through a
    scalar (helm's own parser errors on it), so the capture fails loudly
    rather than dropping the source.
    """
    parts = path.split(".")
    node = values
    for part in parts[:-1]:
        node = node.setdefault(part, {})
        if not isinstance(node, dict):
            raise RuntimeError(
                f"the targeted overlay path {path} runs through a scalar - the "
                "effective source baseline cannot be resolved"
            )
    node[parts[-1]] = replacement
    return values


def deep_merge(base, override):
    """Merge the overlay over the chart defaults (maps merge, scalars replace)."""
    out = dict(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def normalize(value):
    """The value as the deployment carries it (a string)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def values_equal(left, right):
    """Compare a chart value with a deployed string.

    Numbers compare numerically (a chart default of 1.0 and a deployed "1.0"
    are the same value), everything else compares as text.
    """
    left_text, right_text = normalize(left), normalize(right)
    if left_text == right_text:
        return True
    try:
        return float(left_text) == float(right_text)
    except ValueError:
        return False


def is_injected(env_name):
    return any(pattern.search(env_name) for pattern in INJECTED_PATTERNS)


def _display_path(path):
    """The path as the record shows it: repo-relative, absolute when outside."""
    relative = os.path.relpath(path, REPO_ROOT)
    return path if relative.startswith("..") else relative


def cell(value):
    """A markdown table cell: pipes would break the column count."""
    return normalize(value).replace("|", "\\|")


# --------------------------------------------------------------------------
# source baseline
# --------------------------------------------------------------------------


def strip_go_comments(text):
    """The template without its Go comments.

    A commented-out row is documentation, not a declaration: reading it
    would report a chart-declared variable the deployment does not carry.
    """
    return re.sub(r"\{\{-?\s*/\*.*?\*/\s*-?\}\}", "", text, flags=re.S)


def parse_template_env(template_path):
    """Return {env name: {...}} for one chart template.

    A path is the chart values leaf the template reads; a literal is the
    value the template renders verbatim; a chain is the template's own
    fallback order; the guards are the conditions under which the template
    renders the row at all. A row the template renders only under a
    condition that does not hold is NOT declared by the chart - the
    deployment is right to not carry it.
    """
    with open(template_path, encoding="utf-8") as handle:
        text = strip_go_comments(handle.read())
    mapping = {}
    locals_map = {}
    guards = []

    def record(env_name, expression):
        if env_name in mapping:
            return
        chain = _expression_chain(expression, locals_map)
        mapping[env_name] = {
            "chain": chain,
            "path": chain[0][1] if chain and chain[0][0] == "path" else None,
            "literal": chain[0][1] if chain and chain[0][0] == "literal" else None,
            "guards": [guard for guard in guards if guard and guard != "block"],
            "unresolved_guard": any(guard is None for guard in guards),
        }

    events = []
    # A local assignment: {{- $name := <expr> -}}
    for match in re.finditer(
        r"\{\{-?\s*\$([A-Za-z][A-Za-z0-9]*)\s*(:=|=)\s*(.*?)\s*-?\}\}", text, re.S
    ):
        events.append((match.start(), "assign", match.groups()))
    # A block: {{- if <cond> -}} / {{- else -}} / {{- end -}} and the other
    # block openers, whose `end` must not pop an `if` guard.
    for match in re.finditer(
        r"\{\{-?\s*(if|else|end|with|range|define|block)\b(.*?)-?\}\}",
        text,
        re.S,
    ):
        events.append((match.start(), match.group(1), match.group(2)))
    # Service-factory style: (dict "name" "ENV" "value" <expr>)
    for match in re.finditer(r'\(dict "name" "([A-Z0-9_]+)" "value" ', text):
        events.append(
            (match.start(), "env", (match.group(1), _dict_expression(text, match.end())))
        )
    # Hand-rendered style: - name: ENV / [comment lines] / value: {{ <expr> }}
    for match in re.finditer(
        r"- name: ([A-Z0-9_]+)\n(?:\s*#.*\n)*\s*value: \{\{-?\s*(.*?)\s*\}\}", text
    ):
        events.append((match.start(), "env", match.groups()))

    for _position, kind, payload in sorted(events, key=lambda item: item[0]):
        if kind == "assign":
            name, operator, expression = payload
            chain, base = _local_assignment(expression, locals_map)
            known = locals_map.get(name) or {}
            if operator == "=" and known.get("chain"):
                # A reassignment adds an alternative: the template renders
                # whichever value it ends up with.
                chain = list(known["chain"]) + list(chain)
            locals_map[name] = {"chain": chain, "base": base}
        elif kind == "if":
            guards.append(_guard_condition(payload, locals_map))
        elif kind == "else":
            # A row in the else branch renders when the condition does NOT
            # hold: the enclosing guard is negated, not unresolved.
            if guards and guards[-1] != "block":
                top = guards[-1]
                guards[-1] = ("none", top[1]) if top else None
        elif kind in ("with", "range", "define", "block"):
            # A block that is not a guard: its `end` closes it, never an
            # enclosing `if` guard.
            guards.append("block")
        elif kind == "end":
            if guards:
                guards.pop()
        elif kind == "env":
            record(payload[0], payload[1])

    return mapping


def _dict_expression(text, start):
    """The expression of a (dict "name" ... "value" <expr>) row.

    The expression may hold parentheses of its own, so the call is closed
    by counting them - a row's value is not the rest of the line.
    """
    depth = 1
    index = start
    while index < len(text):
        char = text[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return text[start:index].strip()
        index += 1
    return text[start:].strip()


def _strip_parens(expression):
    """The expression without the closing parens of the call around it."""
    stripped = expression.strip()
    for _ in range(4):
        if not stripped.endswith(")"):
            break
        stripped = stripped[:-1].strip()
    return stripped


def _variable_base(name, locals_map):
    """The values path a template variable points at."""
    known = (locals_map or {}).get(name)
    if known and known.get("base"):
        return known["base"]
    return _variable_prefix(name)


def _local_assignment(expression, locals_map):
    """(chain, base path) for one template local assignment."""
    expression = expression.strip()
    found = re.match(r"^\.Values\.([A-Za-z0-9_.]+)", expression)
    if found:
        return [("path", found.group(1))], found.group(1)
    found = re.search(
        r'include "genieai-umbrella\.opeaGpuEndpoint".*?"path"\s+"([A-Za-z0-9]+)"',
        expression,
    )
    if found:
        return [("derived", f"gpu.endpoint.{found.group(1)}")], None
    found = re.match(r"^\$([A-Za-z][A-Za-z0-9]*)(?:\.([A-Za-z0-9]+))?", expression)
    if found:
        name, key = found.group(1), found.group(2)
        base = _variable_base(name, locals_map)
        if base:
            path = f"{base}.{key}" if key else base
            chain = [("path", path)]
            chain += [
                item for item in _expression_chain(expression) if item[0] == "literal"
            ]
            return chain, path
    return _expression_chain(expression), None


NEGATED = re.compile(r"\bnot\b")


def _guard_condition(condition, locals_map):
    """(kind, chain) for a guard's condition, or None when unevaluable.

    `kind` is "any" - the condition holds when one of the chain's
    candidates carries a value - or "none", the negated form an `else`
    branch renders under. None means the capture cannot evaluate the
    condition: the row is conditional, and the record must not claim the
    chart declares it.
    """
    condition = condition.strip()
    if NEGATED.search(condition):
        # A negated condition: the capture does not evaluate it.
        return None
    found = re.fullmatch(r"\$([A-Za-z][A-Za-z0-9]*)", condition)
    if found:
        known = (locals_map or {}).get(found.group(1))
        chain = list((known or {}).get("chain") or [])
        return ("any", chain) if chain else None
    found = re.fullmatch(r"\$([A-Za-z][A-Za-z0-9]*)\.([A-Za-z0-9]+)", condition)
    if found:
        base = _variable_base(found.group(1), locals_map)
        if base:
            return ("any", [("path", f"{base}.{found.group(2)}")])
    # A condition that parses to neither a local nor a path: the capture
    # cannot evaluate it.
    return None


def _candidate_value(item, values, derived=None):
    """The value one candidate of a chain names.

    `None` when the candidate names nothing: a path that does not resolve,
    or a derived value the chart does not compute.
    """
    kind, value = item
    if kind == "path":
        return get_path(values, value)
    if kind == "derived":
        source = derived if derived is not None else derive_values(values)
        return source.get(value, "")
    return value


def _candidate_holds(item, values, derived=None):
    """Whether one candidate of a guard carries a value.

    A guard asks Go's question - is this truthy - and a non-empty map or
    list IS truthy. The chain resolution asks a different one: a subtree is
    not a value (see `_resolve_chain`).
    """
    return not _sprig_empty(_candidate_value(item, values, derived))


def _guards_hold(guards, values):
    """Whether every known guard of a rendered row holds for these values."""
    derived = derive_values(values)
    for kind, chain in guards:
        holds = any(_candidate_holds(item, values, derived) for item in chain)
        if kind == "none":
            # The `else` branch of the condition: it renders when the
            # condition does NOT hold.
            holds = not holds
        if not holds:
            return False
    return True


def _dotted_prefix(variable, key):
    """The values path a dotted template variable plus an index key addresses."""
    if variable.startswith("data") and variable != "data":
        return f"data.{variable[4:].lower()}.{key}"
    if variable in ("opea", "okf", "data"):
        return f"{variable}.{key}"
    return None


def _variable_prefix(variable):
    """The values path a template local variable addresses.

    `$dataKeycloak` is `data.keycloak`; a variable the chart does not use
    as a values pointer maps to nothing. The template's own assignments
    carry the rest (`$opeaChatqna := $opea.chatqna`), so no table of
    section names is kept here: a renamed template local would make such
    a table answer with a path that no longer exists.
    """
    if variable == "opeaModels":
        return "opea.models"
    if variable in ("opea", "okf", "data"):
        return variable
    if variable.startswith("data") and variable != "data":
        return f"data.{variable[4:].lower()}"
    return None


def _expression_chain(expression, locals_map=None):
    """The fallback chain of a template expression, in order.

    `($opeaChatqna.kcRealm | default ($dataKeycloak.realm | default "genie"))`
    renders the first candidate that carries a value: the chart leaves the
    realm empty in that section and falls back to the realm the data tier
    declares. Reading only the first operand would report a difference the
    chart does not make.
    """
    candidates = []

    # A bare literal: the template renders this value verbatim.
    stripped = _strip_parens(expression)
    found = re.fullmatch(r'"([^"]*)"', stripped)
    if found:
        candidates.append((0, "literal", found.group(1)))
    else:
        # A bare local: the value the template assigned to it.
        local = re.fullmatch(r"\$([A-Za-z][A-Za-z0-9]*)", stripped)
        if local and locals_map:
            known = locals_map.get(local.group(1))
            if known and known.get("chain"):
                return list(known["chain"])

    # Two-level index: index (index ($opea | default dict) "llm" ...) "modelId"
    for found in re.finditer(
        r"index \(index \(\$([A-Za-z]+)[^)]*\) \"([a-z]+)\"[^)]*\) \"([A-Za-z0-9]+)\"",
        expression,
    ):
        prefix = _variable_prefix(found.group(1))
        if prefix:
            candidates.append(
                (found.start(), "path", f"{prefix}.{found.group(2)}.{found.group(3)}")
            )

    # Dotted variable + index: index ($opea.retriever | default dict) "key"
    #   or index ($okf.server | default dict) "url"
    for found in re.finditer(
        r'index \(?\$([A-Za-z]+)\.([A-Za-z0-9]+)(?:\s*\|\s*default\s+dict\))?\s*\"([A-Za-z0-9]+)\"',
        expression,
    ):
        prefix = _dotted_prefix(found.group(1), found.group(2))
        if prefix:
            candidates.append((found.start(), "path", f"{prefix}.{found.group(3)}"))

    # Single-level index on a plain variable, with or without a defaulted
    # dict: index $dataKeycloak "internalUrl"
    for found in re.finditer(
        r'index \(?\$([A-Za-z]+)(?:\s*\|\s*default\s+dict\)?)?\s*\"([A-Za-z0-9]+)\"',
        expression,
    ):
        prefix = _variable_prefix(found.group(1))
        if prefix:
            candidates.append(
                (found.start(), "path", f"{prefix}.{found.group(2)}")
            )

    for found in re.finditer(r"\$([A-Za-z][A-Za-z0-9]*)\.([A-Za-z0-9]+)", expression):
        prefix = _variable_base(found.group(1), locals_map)
        if prefix:
            candidates.append((found.start(), "path", f"{prefix}.{found.group(2)}"))

    # A literal only counts when it is the operand of a `default`: the other
    # quoted strings in an expression are arguments of a helper call.
    for found in re.finditer(r'\|\s*default\s+"([^"]*)"', expression):
        candidates.append((found.start(), "literal", found.group(1)))

    candidates.sort(key=lambda item: item[0])
    return [(kind, value) for _position, kind, value in candidates]


def _resolve_chain(chain, values):
    """The first candidate of the chain that carries a value.

    Emptiness is Helm's own: sprig's `default` treats nil, the empty string,
    `false`, zero and the empty list or map as empty, and renders the next
    candidate. Returns (the source it came from, the value).
    """
    derived = derive_values(values)
    for item in chain:
        kind, value = item
        if kind == "literal":
            return None, value
        found = _candidate_value(item, values, derived)
        if kind == "path" and isinstance(found, (dict, list)):
            # A subtree, not a leaf: the chain mis-parsed the path and
            # pointing at it would compare a Python repr against the
            # deployment.
            continue
        if not _sprig_empty(found):
            return value, found
    return None, None


def _sprig_empty(value):
    """Sprig's `empty`: nil, "", false, 0, and the empty list or map."""
    return (
        value is None
        or value == ""
        or value is False
        or value == 0
        or value == []
        or value == {}
    )


@cache
def template_env_maps():
    """{workload component: {env name: chart path or None}} for every OPEA workload."""
    return {
        component: parse_template_env(os.path.join(CHART_TEMPLATES, template_file))
        for component, template_file in OPEA_WORKLOADS.items()
    }


@cache
def backend_env_map():
    """The application tier's template rows.

    The application tier is not the retrieval configuration, but its
    translation block declares a model id the backend pins - and the
    template's own fallback chain is the only place that fallback is
    written down.
    """
    return parse_template_env(BACKEND_TEMPLATE)


def derive_values(values):
    """The values the chart computes from other values.

    Mirrors the chart's helpers: the GPU endpoint family
    (templates/_lib/_opea.tpl) and the public issuer
    (templates/_lib/_urls.tpl).
    """
    gpu = get_path(values, "opea.gpu") or {}
    node = gpu.get("nodeHost") or ""
    paths = gpu.get("paths") or {}
    namespace = get_path(values, "namespace") or ""
    in_cluster = {
        "llm": f"http://vllm.{namespace}.svc.cluster.local:8000",
        "embedding": f"http://tei.{namespace}.svc.cluster.local:80",
        "reranker": f"http://tei-reranker.{namespace}.svc.cluster.local:80",
        "translation": f"http://vllm-translation.{namespace}.svc.cluster.local:9031",
    }

    def endpoint(key):
        if gpu.get("mode") == "in-cluster":
            return in_cluster.get(key, "")
        path = paths.get(key, "")
        host = node[:-1] if node.endswith("/") else node
        return f"{host}{path}" if host and path else ""

    hostname = re.sub(r"^([a-z]+://)?(\[[^\]]+\]|[^:/]+).*", r"\2", node)
    ingress = get_path(values, "ingress") or {}
    context_path = get_path(values, "data.keycloak.httpRelativePath") or "/auth"
    host = ingress.get("host") or ""
    issuer = f"{ingress.get('scheme') or 'https'}://{host}{context_path}" if host else ""
    return {
        "gpu.endpoint.llm": endpoint("llm"),
        "gpu.endpoint.embedding": endpoint("embedding"),
        "gpu.endpoint.reranker": endpoint("reranker"),
        "gpu.endpoint.translation": endpoint("translation"),
        "gpu.hostname": hostname,
        "public.issuer": issuer,
    }


# --------------------------------------------------------------------------
# cluster capture
# --------------------------------------------------------------------------


def container_env(container):
    """The environment of one container, with secret values never read.

    A secret-backed variable is rendered as its reference (`secret:<name>/<key>`)
    so the record can show that the variable exists without leaking it.
    """
    env = {}
    for entry in container.get("env", []):
        if "value" in entry:
            env[entry["name"]] = entry["value"]
        elif "valueFrom" in entry:
            ref = entry["valueFrom"]
            source = ref.get("secretKeyRef") or ref.get("configMapKeyRef") or {}
            env[entry["name"]] = (
                f"<secret:{source.get('name')}/{source.get('key')}>"
                if source
                else "<downward-api>"
            )
        else:
            # The chart renders the variable with an empty value; the API
            # stores the entry without one.
            env[entry["name"]] = ""
    return env


def capture_workloads(namespace):
    """Deployments and statefulsets with their containers and environment."""
    workloads = []
    for kind in ("deploy", "statefulset"):
        for item in kubectl_json(namespace, "get", kind).get("items", []):
            meta = item["metadata"]
            spec = item["spec"]
            containers = []
            for container in spec["template"]["spec"].get("containers", []):
                containers.append(
                    {
                        "name": container["name"],
                        "image": container.get("image") or "",
                        "env": container_env(container),
                    }
                )
            workloads.append(
                {
                    "kind": kind,
                    "name": meta["name"],
                    "component": meta.get("labels", {}).get("app.kubernetes.io/component", ""),
                    "selector": spec.get("selector", {}).get("matchLabels", {}),
                    "replicas": spec.get("replicas", 0) or 0,
                    "containers": containers,
                }
            )
    return workloads


def hook_jobs(namespace):
    """The Helm hook jobs of the namespace.

    A hook job runs once per release: its pods are not part of the
    deployment's steady state, and their random name would make the
    baseline drift on every release for reasons that have nothing to do
    with the stack.
    """
    names = set()
    for item in kubectl_json(namespace, "get", "jobs").get("items", []):
        annotations = item.get("metadata", {}).get("annotations", {})
        if "helm.sh/hook" in annotations:
            names.add(item["metadata"]["name"])
    return names


def capture_pods(namespace):
    """Running pods with the digest of the image they actually run."""
    hooks = hook_jobs(namespace)
    pods = []
    for pod in kubectl_json(namespace, "get", "pods").get("items", []):
        meta = pod["metadata"]
        status = pod.get("status", {})
        if meta.get("labels", {}).get("job-name") in hooks:
            continue
        spec_containers = {
            container["name"]: container
            for container in pod.get("spec", {}).get("containers", [])
        }
        for container in status.get("containerStatuses", []):
            pods.append(
                {
                    "pod": meta["name"],
                    "labels": meta.get("labels", {}),
                    "container": container.get("name", ""),
                    "image": container.get("image") or "",
                    "digest": container.get("imageID", ""),
                    "pull_policy": spec_containers.get(container.get("name"), {}).get(
                        "imagePullPolicy", ""
                    ),
                    "ready": container.get("ready", False),
                    "phase": status.get("phase", ""),
                    "created": meta.get("creationTimestamp", ""),
                    "env": container_env(spec_containers.get(container.get("name"), {})),
                }
            )
    return pods


def capture_topology(namespace):
    services = []
    for service in kubectl_json(namespace, "get", "svc").get("items", []):
        ports = ",".join(
            f"{port.get('port')}/{port.get('protocol', 'TCP')}"
            for port in service.get("spec", {}).get("ports", [])
        )
        services.append(
            {
                "name": service["metadata"]["name"],
                "type": service.get("spec", {}).get("type", "ClusterIP"),
                "ports": ports,
            }
        )
    policies = kubectl_json(namespace, "get", "networkpolicy").get("items", [])
    return {"services": services, "network_policies": len(policies)}


def capture_release(flux_namespace, release):
    """The HelmRelease: chart version, release revision and the overlay values."""
    release_obj = kubectl_json(flux_namespace, "get", "helmrelease", release)
    spec = release_obj.get("spec", {})
    status = release_obj.get("status", {})
    # The revision the cluster attests as DEPLOYED: a failed upgrade is
    # recorded in the history before it fails, so the highest version is not
    # necessarily the one that runs.
    history = status.get("history") or []
    deployed = [entry for entry in history if entry.get("status") == "deployed"]
    if deployed:
        revision = max(int(entry.get("version", 0)) for entry in deployed)
        revision_entry = next(
            (entry for entry in deployed if int(entry.get("version", 0)) == revision),
            {},
        )
    else:
        revision = max(
            (int(entry.get("version", 0)) for entry in history), default=0
        )
        revision_entry = {}
    conditions = status.get("conditions") or []
    ready = next(
        (condition for condition in conditions if condition.get("type") == "Ready"),
        {},
    )
    overlay = {}
    overlay_names = []
    secret_paths = set()
    targeted = []
    for source in spec.get("valuesFrom", []):
        name = source.get("name")
        if not name:
            continue
        kind = source.get("kind", "ConfigMap")
        values_key = source.get("valuesKey", "values.yaml")
        target_path = source.get("targetPath", "")
        if kind == "Secret":
            secret = kubectl_json(flux_namespace, "get", "secret", name)
            encoded = secret.get("data", {}).get(values_key)
            raw = base64.b64decode(encoded).decode("utf-8") if encoded else None
        else:
            configmap = kubectl_json(flux_namespace, "get", "configmap", name)
            raw = configmap.get("data", {}).get(values_key)
        if raw:
            values = yaml.safe_load(raw) or {}
            if kind == "Secret":
                # The values live in a Secret: they are used for the
                # comparison, in memory, and their paths are remembered so
                # the record can show that a value came from a Secret
                # without ever showing the value.
                secret_paths.update(leaf_paths(values))
            if target_path:
                # A targeted source is applied LAST and REPLACES the subtree
                # at that path (Flux applies the references with a
                # targetPath after everything else).
                targeted.append((target_path, values))
            else:
                overlay = deep_merge(overlay, values)
            overlay_names.append(name)
        elif not source.get("optional"):
            raise RuntimeError(
                f"the overlay {kind} {name} carries no {values_key} - the effective "
                "source baseline cannot be resolved"
            )
    # Flux: the values inlined in the HelmRelease have a HIGHER priority
    # than the values the release reads from a source.
    inline = spec.get("values") or {}
    if inline:
        overlay = deep_merge(overlay, inline)
        overlay_names.append("inline values")
    for target_path, values in targeted:
        overlay = set_path(overlay, target_path, values)
    overlay_name = ", ".join(overlay_names) or "(none)"
    # Where the release secrets live: helm-controller stores the release in
    # the storage namespace, which is not the namespace the release is
    # installed into.
    storage_namespace = (
        status.get("storageNamespace")
        or spec.get("storageNamespace")
        or spec.get("targetNamespace")
        or flux_namespace
    )
    chart_spec = spec.get("chart", {}).get("spec", {})
    return {
        "chart": chart_spec,
        "chart_name": revision_entry.get("chartName", ""),
        "chart_version": revision_entry.get("chartVersion", ""),
        "source_ref": chart_spec.get("sourceRef", {}),
        "storage_namespace": storage_namespace,
        "release": release,
        "revision": revision,
        "overlay": overlay,
        "overlay_name": overlay_name,
        "secret_paths": secret_paths,
        "status": ready.get("message", ""),
        "ready": ready.get("status", ""),
    }


def local_chart_version():
    """The version of the chart source this capture compares against."""
    with open(os.path.join(CHART_DIR, "Chart.yaml"), encoding="utf-8") as handle:
        return (yaml.safe_load(handle) or {}).get("version", "")


# --------------------------------------------------------------------------
# chart identity
# --------------------------------------------------------------------------

# Helm keeps these four apart from the templates and the chart's own files:
# they live in the chart's metadata, values, lock and schema, so they are
# compared apart from the file-by-file content comparison.
CHART_METADATA_FILES = (
    "Chart.yaml",
    "Chart.lock",
    "values.yaml",
    "values.schema.json",
)

# The chart's path inside the repository, as git addresses it.
CHART_REPO_PATH = "charts/genieai-umbrella"


def git_blob_sha(content):
    """The git blob id of a file's bytes.

    Git hashes a blob as sha1("blob <size>\\0" + content); the chart
    comparison uses the same identity, so two files match when their blob
    ids agree.
    """
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


def decode_release_payload(encoded):
    """The decoded payload of a Helm release secret.

    Helm stores a release as base64(gzip(json)) and the secret holds that
    value base64-encoded again, so decoding is two base64 layers and a
    gunzip.
    """
    raw = base64.b64decode(encoded)
    try:
        raw = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        pass
    try:
        raw = gzip.decompress(raw)
    except (OSError, EOFError):
        pass
    return json.loads(raw)


def attested_chart(storage_namespace, release, revision):
    """The chart the release was rendered from, as the release secret holds it.

    The secret's `chart` carries the templates, the files, the values, the
    metadata and the lock the release was rendered with. The rendered
    manifest and the effective values are NOT read: they carry the
    deployment's configuration, not the chart's identity.
    """
    name = f"sh.helm.release.v1.{release}.v{revision}"
    try:
        secret = kubectl_json(storage_namespace, "get", "secret", name)
    except (RuntimeError, json.JSONDecodeError):
        return None
    encoded = (secret.get("data") or {}).get("release")
    if not encoded:
        return None
    try:
        chart = decode_release_payload(encoded).get("chart") or {}
    except (ValueError, json.JSONDecodeError):
        return None
    try:
        templates = {
            entry.get("name", ""): base64.b64decode(entry.get("data") or "")
            for entry in chart.get("templates") or []
        }
        files = {
            entry.get("name", ""): base64.b64decode(entry.get("data") or "")
            for entry in chart.get("files") or []
        }
    except (binascii.Error, ValueError):
        # A payload the capture cannot read attests no chart: the identity
        # stays UNRESOLVED, and the record says so.
        return None
    return {
        "templates": templates,
        "files": files,
        "values": chart.get("values") or {},
        "metadata": chart.get("metadata") or {},
        "lock": chart.get("lock") or {},
    }


def env_map_path(component, section):
    """The values path of a workload's operator env map.

    The retrieval tier's map is its own chart section's `env`; the OKF
    tier's map lives under the OKF section, one path per workload.
    """
    if component in WORKLOAD_ENV_MAPS:
        return WORKLOAD_ENV_MAPS[component]
    return f"opea.{section}.env" if section else ""


def local_chart_files():
    """The chart source's own files, as {path: bytes}.

    The paths are relative to the chart root, like the paths the release
    secret carries. The four files Helm keeps apart are left out: they are
    compared apart. The vendored dependencies are left out too: Helm keeps
    them in the chart's dependencies, not in its files.
    """
    files = {}
    for root, dirs, names in os.walk(CHART_DIR):
        if os.path.relpath(root, CHART_DIR) == ".":
            # The vendored dependencies sit in the chart's own `charts`
            # directory: Helm keeps them in the chart's dependencies, not in
            # its files. No other directory of that name is excluded.
            dirs[:] = sorted(name for name in dirs if name != "charts")
        else:
            dirs[:] = sorted(dirs)
        for name in sorted(names):
            absolute = os.path.join(root, name)
            relative = os.path.relpath(absolute, CHART_DIR).replace(os.sep, "/")
            if relative in CHART_METADATA_FILES:
                continue
            with open(absolute, "rb") as handle:
                files[relative] = handle.read()
    return files


def chart_commits():
    """The commits whose chart content can differ from HEAD's.

    The chart's content changes only where a commit touches it, so the
    candidates are those commits; the commit that carries the attested chart
    is one of them.
    """
    output = run(
        ["git", "-C", REPO_ROOT, "log", "--format=%H", "--", CHART_REPO_PATH],
        check=False,
    )
    commits = [line.strip() for line in output.splitlines() if line.strip()]
    head = run(["git", "-C", REPO_ROOT, "rev-parse", "HEAD"], check=False).strip()
    if head and head not in commits:
        commits.insert(0, head)
    return commits


def commit_chart_files(commit):
    """The chart files a commit carries, as {path: git blob id}."""
    output = run(
        ["git", "-C", REPO_ROOT, "ls-tree", "-r", commit, "--", CHART_REPO_PATH],
        check=False,
    )
    files = {}
    for line in output.splitlines():
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if len(parts) < 3 or parts[1] != "blob":
            continue
        relative = path[len(CHART_REPO_PATH) + 1 :]
        if relative in CHART_METADATA_FILES:
            continue
        files[relative] = parts[2]
    return files


def source_commit(attested_ids):
    """The commit of this repository that carries the attested chart.

    The chart the deployment runs is content: the commit that carries the
    same content is the commit the release was rendered from. A chart no
    commit of this checkout carries is a commit this checkout does not know.
    """
    for commit in chart_commits():
        if commit_chart_files(commit) == attested_ids:
            return commit
    return None


def values_identical(left, right):
    """Two values compared by content.

    The key order of a mapping is not a difference, and a number written
    `1` against `1.0` is the same value.
    """
    if isinstance(left, dict) and isinstance(right, dict):
        if set(left) != set(right):
            return False
        return all(values_identical(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            return False
        return all(values_identical(item, other) for item, other in zip(left, right))
    return values_equal(left, right)


def display_value(value):
    """A value as the record shows it: JSON, with the keys ordered."""
    try:
        return json.dumps(value, sort_keys=True, default=str)
    except (TypeError, ValueError):
        return normalize(value)


def leaf_values(values, prefix=""):
    """The leaves of a values tree, as {path: value}."""
    leaves = {}
    if isinstance(values, dict):
        for key, value in values.items():
            child = f"{prefix}.{key}" if prefix else str(key)
            leaves.update(leaf_values(value, child))
    else:
        leaves[prefix] = values
    return leaves


def dependency_names(lock=None):
    """The names of the chart's dependencies."""
    if lock is None:
        with open(os.path.join(CHART_DIR, "Chart.lock"), encoding="utf-8") as handle:
            lock = yaml.safe_load(handle) or {}
    return {dep.get("name", "") for dep in lock.get("dependencies") or []}


def values_differences(chart):
    """The differences between the chart source's values and the attested ones.

    Helm coalesces the dependency charts' defaults into the chart's values,
    under the dependency's name; those leaves belong to the dependency, not
    to the chart, so they are not compared.
    """
    with open(os.path.join(CHART_DIR, "values.yaml"), encoding="utf-8") as handle:
        local = yaml.safe_load(handle) or {}
    local_leaves = leaf_values(local)
    attested_leaves = leaf_values(chart.get("values") or {})
    # The dependency's own leaves are coalesced into the chart's values by
    # helm, under the dependency's name. The names of both locks count: a
    # dependency the attested chart carries and the source does not is a
    # difference the lock comparison reports, not a flood of value leaves.
    dependencies = dependency_names() | dependency_names(chart.get("lock") or {})
    differences = []
    for path, value in sorted(local_leaves.items()):
        if path in attested_leaves:
            if not values_identical(value, attested_leaves[path]):
                differences.append(
                    {
                        "kind": "values",
                        "path": f"values.yaml:{path}",
                        "source": cell(display_value(value)),
                        "deployed": cell(display_value(attested_leaves[path])),
                    }
                )
        elif path.split(".")[0] not in dependencies:
            differences.append(
                {
                    "kind": "values",
                    "path": f"values.yaml:{path}",
                    "source": cell(display_value(value)),
                    "deployed": "(not in the chart the deployment runs)",
                }
            )
    for path in sorted(attested_leaves):
        if path in local_leaves or path.split(".")[0] in dependencies:
            continue
        differences.append(
            {
                "kind": "values",
                "path": f"values.yaml:{path}",
                "source": "(not in the chart source)",
                "deployed": cell(display_value(attested_leaves[path])),
            }
        )
    return differences


def lock_differences(chart):
    """The differences between the chart source's lock and the attested one."""
    with open(os.path.join(CHART_DIR, "Chart.lock"), encoding="utf-8") as handle:
        local = yaml.safe_load(handle) or {}
    attested = chart.get("lock") or {}
    differences = []
    if (
        local.get("digest")
        and attested.get("digest")
        and local["digest"] != attested["digest"]
    ):
        differences.append(
            {
                "kind": "lock",
                "path": "Chart.lock:digest",
                "source": cell(local["digest"]),
                "deployed": cell(attested["digest"]),
            }
        )
    local_dependencies = {
        dep.get("name"): dep for dep in local.get("dependencies") or []
    }
    attested_dependencies = {
        dep.get("name"): dep for dep in attested.get("dependencies") or []
    }
    for name in sorted(set(local_dependencies) | set(attested_dependencies)):
        left = local_dependencies.get(name) or {}
        right = attested_dependencies.get(name) or {}
        if left.get("version") == right.get("version") and left.get(
            "repository"
        ) == right.get("repository"):
            continue
        differences.append(
            {
                "kind": "lock",
                "path": f"Chart.lock:{name}",
                "source": cell(
                    f"{left.get('version', '(none)')} from {left.get('repository', '(none)')}"
                ),
                "deployed": cell(
                    f"{right.get('version', '(none)')} from {right.get('repository', '(none)')}"
                ),
            }
        )
    return differences


def chart_differences(chart, attested_ids):
    """Every difference between the chart source and the attested chart."""
    differences = []
    local = local_chart_files()
    for path, content in sorted(local.items()):
        if path not in attested_ids:
            differences.append(
                {
                    "kind": "extra",
                    "path": path,
                    "source": f"blob {git_blob_sha(content)[:12]}",
                    "deployed": "(not in the chart the deployment runs)",
                }
            )
        elif git_blob_sha(content) != attested_ids[path]:
            differences.append(
                {
                    "kind": "content",
                    "path": path,
                    "source": f"blob {git_blob_sha(content)[:12]}",
                    "deployed": f"blob {attested_ids[path][:12]}",
                }
            )
    for path in sorted(attested_ids):
        if path not in local:
            differences.append(
                {
                    "kind": "missing",
                    "path": path,
                    "source": "(not in the chart source)",
                    "deployed": f"blob {attested_ids[path][:12]}",
                }
            )
    attested_version = (chart.get("metadata") or {}).get("version", "")
    local_version = local_chart_version()
    if attested_version and attested_version != local_version:
        differences.append(
            {
                "kind": "version",
                "path": "Chart.yaml",
                "source": f"version {local_version}",
                "deployed": f"version {attested_version}",
            }
        )
    differences.extend(values_differences(chart))
    differences.extend(lock_differences(chart))
    return differences


def chart_identity(release_info):
    """The chart the deployment runs, and how the chart source compares.

    The cluster attests the chart in two objects: the release history names
    the chart version the deployed revision runs, and the release secret of
    that revision holds the chart it was rendered with. The comparison is
    content: the chart source in this repository against the attested chart,
    file by file, plus the version, the values and the lock.

    A comparison that cannot be established is UNRESOLVED: the source is
    not a GitRepository, the attested chart carries no template, or no
    commit of this checkout carries the attested chart.
    """
    source_ref = release_info.get("source_ref") or {}
    identity = {
        "status": "UNRESOLVED",
        "reason": "",
        "chart_name": release_info.get("chart_name", ""),
        "chart_version": release_info.get("chart_version", ""),
        "local_chart_version": local_chart_version(),
        "source_kind": source_ref.get("kind", ""),
        "source_name": source_ref.get("name", ""),
        "source_namespace": source_ref.get("namespace", ""),
        "commit": "",
        "files": 0,
        "differences": [],
    }
    if identity["source_kind"] != "GitRepository":
        identity["reason"] = (
            "the release does not render from a GitRepository source, so no commit "
            "of this repository attests the chart the deployment runs"
        )
        return identity
    chart = attested_chart(
        release_info.get("storage_namespace", ""),
        release_info.get("release", ""),
        release_info.get("revision", 0),
    )
    if chart is None:
        identity["reason"] = (
            "the release secret of the deployed revision could not be read: the "
            "chart the deployment runs is not attested"
        )
        return identity
    if not chart["templates"]:
        identity["reason"] = (
            "the attested chart carries no template: an empty commit attests nothing"
        )
        return identity
    attested = dict(chart["templates"])
    attested.update(chart["files"])
    attested_ids = {path: git_blob_sha(content) for path, content in attested.items()}
    commit = source_commit(attested_ids)
    if commit is None:
        identity["reason"] = (
            "no commit of this checkout carries the chart the deployment runs: the "
            "chart identity cannot be established here"
        )
        return identity
    identity["commit"] = commit
    identity["files"] = len(attested)
    identity["differences"] = chart_differences(chart, attested_ids)
    identity["status"] = "DIFFERENT" if identity["differences"] else "IDENTICAL"
    return identity


def chart_disposition(difference):
    """The disposition a difference between the chart source and the chart the
    deployment runs carries.

    The difference is explained: it says the repository's chart source is
    not the chart the running release was rendered from. It is recorded, not
    a failure - the record's job is to state the truth.
    """
    return (
        "Recorded - the chart source in this repository is not the chart the "
        "deployment runs at this path. The record reconciles the deployment "
        "against the chart source, so it describes what the repository would "
        "deploy, not what runs."
    )


def chart_identity_rows(identity):
    """The rows the chart identity contributes to the discrepancy table."""
    if not identity:
        return []
    if identity["status"] == "UNRESOLVED":
        # An unestablishable comparison is an unresolved difference: it
        # never passes silently.
        return [
            {
                "workload": "chart identity",
                "env": "chart identity",
                "source_value": "the chart source in this repository",
                "source_path": "",
                "deployed": identity["reason"],
                "disposition": "**UNRESOLVED**",
            }
        ]
    return [
        {
            "workload": "chart identity",
            "env": difference["path"],
            "source_value": difference["source"],
            "source_path": "",
            "deployed": difference["deployed"],
            "disposition": chart_disposition(difference),
        }
        for difference in identity["differences"]
    ]


# --------------------------------------------------------------------------
# registry and model endpoints
# --------------------------------------------------------------------------


def image_reference(image):
    """(repository, tag, digest) of an image reference.

    `repo:tag` names a tag. `repo:tag@sha256:digest` and `repo@sha256:digest`
    name a PINNED artifact: the digest is what the deployment declares, and
    the tag is only the name it was pushed under.
    """
    reference, _, digest = image.partition("@")
    parts = reference.rsplit(":", 1)
    # A colon names a tag when what follows it is not a registry port:
    # "host:5000/image" keeps the port in the repository name.
    if len(parts) == 2 and "/" not in parts[1]:
        repository, tag = parts[0], parts[1]
    else:
        repository, tag = reference, ""
    return repository, tag, digest.strip()


def image_reference_label(image):
    """The reference the deployment declares, as the record names it."""
    _repository, tag, digest = image_reference(image)
    if digest:
        return f"pinned {digest}"
    return f"tag {tag}" if tag else "the image"


REGISTRY_TOKENS = {}


def registry_token(auth_host, project):
    """A pull token for the registry, reused for the whole capture."""
    key = (auth_host, project)
    if key not in REGISTRY_TOKENS:
        with urllib.request.urlopen(
            urllib.request.Request(
                f"https://{auth_host}/jwt/auth?service=container_registry"
                f"&scope=repository:{project}:pull",
                headers={"User-Agent": USER_AGENT},
            ),
            timeout=30,
        ) as response:
            REGISTRY_TOKENS[key] = json.load(response).get("token", "")
    return REGISTRY_TOKENS[key]


def registry_manifest(image, reference):
    """The digests the registry serves for one reference of an image.

    `reference` is a tag or a digest; `image` names the repository.
    Returns (index digest, amd64 child digest, note). The index digest is
    what the runtime records as the running digest; the child digest is the
    stable content identity (the index digest moves on every re-push, the
    attestation changes the index and not the image).

    The registry's v2 API is queried directly (the registry LISTING is
    polluted with cache-* buildx tags - see
    `.claude/rules/CVE-REMEDIATION.md`). `docker buildx imagetools inspect`
    resolves the same digests for an operator, but the capture must not
    require a docker daemon.
    """
    repository = image_reference(image)[0]
    registry_host = repository.split("/")[0]
    if not registry_host.startswith("registry."):
        return None, "", "outside the GitLab registry"
    project = repository.split("/", 1)[1]
    auth_host = re.sub(r"^registry\.", "", registry_host)
    token = registry_token(auth_host, project)
    request = urllib.request.Request(
        f"https://{registry_host}/v2/{project}/manifests/{reference}",
        headers={
            "User-Agent": USER_AGENT,
            "Authorization": f"Bearer {token}",
            "Accept": ",".join(
                [
                    "application/vnd.oci.image.index.v1+json",
                    "application/vnd.docker.distribution.manifest.list.v2+json",
                    "application/vnd.oci.image.manifest.v1+json",
                    "application/vnd.docker.distribution.manifest.v2+json",
                ]
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        index_digest = response.headers.get("Docker-Content-Digest")
        body = response.read()
    child = ""
    try:
        manifest = json.loads(body)
        entries = manifest.get("manifests")
        if entries:
            for entry in entries:
                platform = entry.get("platform", {})
                if (
                    platform.get("os") == "linux"
                    and platform.get("architecture") == "amd64"
                ):
                    child = entry.get("digest", "")
                    break
        else:
            # A single manifest: its own digest is the content identity.
            child = index_digest or ""
    except ValueError:
        child = ""
    return index_digest, child, ""


def http_json(url, api_key=None, timeout=30, insecure=False):
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    context = None
    if insecure:
        # The GPU node serves a certificate signed by an internal CA the
        # pods' trust store does not carry; the deployment declares
        # OPEA_SSL_SKIP_VERIFY=1 and drops NODE_TLS_REJECT_UNAUTHORIZED for
        # the same reason. The capture mirrors the posture of the workload
        # that declares the endpoint - and only for that endpoint.
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        return json.load(response)


def cluster_secret(namespace, name, key):
    """Read one secret value. It is used in memory and never written out."""
    secret = kubectl_json(namespace, "get", "secret", name)
    encoded = secret.get("data", {}).get(key)
    if not encoded:
        return None
    return base64.b64decode(encoded).decode("utf-8", "replace")


def capture_models(namespace, env_by_component):
    """The model ids the GPU node actually serves.

    Each endpoint is probed with the TLS posture of the workload that
    declares it, never with another workload's.

    The credential is the node's `vllm-api-key`. The GPU front door
    answers 401 without a bearer, and it accepts this key as well as the
    deployment's own `HF_TOKEN` (which the retriever's TEI call carries;
    the reranker's client sends no `Authorization` header at all). The
    probe therefore authenticates against the front door, not by
    mirroring one client.
    """
    api_key = cluster_secret(namespace, "vllm-api-key", "VLLM_API_KEY")

    def endpoint_for(component, *names):
        env = env_by_component.get(component, {})
        for name in names:
            if env.get(name):
                return env[name], component
        return None, None

    def insecure_for(component):
        env = env_by_component.get(component, {})
        return (
            env.get("OPEA_SSL_SKIP_VERIFY") == "1"
            or env.get("NODE_TLS_REJECT_UNAUTHORIZED") == "0"
        )

    probes = {
        "embedding": endpoint_for("retriever", "TEI_EMBEDDING_ENDPOINT"),
        "reranker": endpoint_for("reranker", "TEI_RERANKING_ENDPOINT"),
        "llm": endpoint_for("chatqna", "VLLM_LLM_ENDPOINT"),
        "translation": endpoint_for("chatqna", "VLLM_TRANSLATION_ENDPOINT"),
    }

    served = {}
    for role, (endpoint, component) in probes.items():
        if not endpoint:
            served[role] = {"error": "no endpoint declared in the deployment"}
            continue
        base = endpoint.rstrip("/")
        flavour = "tei" if role in ("embedding", "reranker") else "openai"
        try:
            if flavour == "tei":
                info = http_json(
                    f"{base}/info", api_key, insecure=insecure_for(component)
                )
                served[role] = {
                    "model_id": info.get("model_id"),
                    "dtype": info.get("model_dtype"),
                    "max_input_length": info.get("max_input_length"),
                    "server_version": info.get("version"),
                    "commit": info.get("sha"),
                    "endpoint": endpoint,
                }
            else:
                listing = http_json(
                    f"{base}/v1/models", api_key, insecure=insecure_for(component)
                )
                models = listing.get("data", [])
                first = models[0] if models else {}
                served[role] = {
                    "model_id": first.get("id"),
                    "max_model_len": first.get("max_model_len"),
                    "server": "vLLM",
                    "endpoint": endpoint,
                }
        except (urllib.error.URLError, OSError, ValueError) as error:
            served[role] = {"endpoint": endpoint, "error": str(error)}
    return served


# --------------------------------------------------------------------------
# reconciliation
# --------------------------------------------------------------------------


def resolve_source(
    env_name, component, section, template_map, chart_values, overlay_values, effective_values
):
    """Resolve one environment variable against the source baseline.

    Returns (label, chart default, overlay value, effective value, status,
    the path the chart default resolved from). The three layers stay
    distinct: the chart's own default, the overlay override that applies on
    top of it, and what the deployment runs.
    """
    overlay = overlay_values or {}

    # 1. the section's environment map (the operator's own variables)
    if section:
        path = f"{env_map_path(component, section)}.{env_name}"
        if get_path(chart_values, path) is not None or get_path(effective_values, path) is not None:
            default = get_path(chart_values, path)
            effective = get_path(effective_values, path)
            override = get_path(overlay, path)
            return path, default, override, effective, None, path

    # 2. a value the chart derives from other values (GPU endpoints, origin)
    derived_chain = DERIVED_VARIABLES.get((component, env_name))
    if derived_chain:
        default_path, default = _resolve_chain(derived_chain, chart_values)
        effective_path, effective = _resolve_chain(derived_chain, effective_values)
        override = ""
        if effective_path and effective_path.startswith("gpu."):
            # A derived value has no values leaf of its own: the overlay's
            # contribution is the derived value when it differs from the
            # chart's default.
            override = effective if effective != default else ""
        elif effective_path:
            found = get_path(overlay, effective_path)
            if not _sprig_empty(found):
                override = normalize(found)
        chain_path = next(
            (value for kind, value in derived_chain if kind in ("path", "derived")), None
        )
        label = effective_path or default_path or chain_path or f"derived:{component}.{env_name}"
        # The default may not resolve (the chart's own default is empty and
        # the operator sets it): the path it would come from is still named.
        default_path = default_path or chain_path
        return (
            f"derived:{label}",
            default,
            override,
            effective,
            None,
            default_path,
        )

    # 3. a values leaf the template renders into this variable - through
    #    the template's own fallback chain - or the value it renders verbatim
    template_entry = template_map.get(env_name) if template_map else None
    if template_entry:
        chain = template_entry.get("chain") or []
        default_path, default = _resolve_chain(chain, chart_values)
        effective_path, effective = _resolve_chain(chain, effective_values)
        override = ""
        if effective_path:
            # The overlay is read where the value actually resolved: an
            # override further down the chain is the layer that produced
            # the deployed value, and the record must show it.
            found = get_path(overlay, effective_path)
            if not _sprig_empty(found):
                override = normalize(found)
        if effective is not None:
            # The label names the values leaf the template READS, even when
            # the value itself came from the template's fallback: the leaf
            # is where the operator would set it.
            chain_path = next(
                (value for kind, value in chain if kind == "path"), None
            )
            return (
                effective_path or chain_path or "template literal",
                default,
                override,
                effective,
                None,
                default_path,
            )

    # 4. the template renders the variable, but from a literal or a helper
    if template_map and env_name in template_map:
        return "", "(template literal or helper)", "", "", "TEMPLATE", ""

    return "", "", "", "", "UNDECLARED", ""


def compare_workload(workload, env_maps, chart_values, overlay_values, effective_values):
    """Compare the deployed environment with the effective source baseline."""
    component = workload["component"]
    section = component if component in OPEA_WORKLOADS else None
    template_map = env_maps.get(component, {}) if section else {}
    model_only = component not in OPEA_WORKLOADS
    if model_only:
        # The application tier is compared for the model ids it pins and
        # for the endpoints the chart derives; its remaining environment is
        # not the retrieval configuration this story baselines. It is
        # listed, never dropped silently.
        template_map = {
            name: entry
            for name, entry in backend_env_map().items()
            if name in MODEL_VARIABLES.get(component, ())
        }

    rows = []
    undeclared = []
    deployed_env = workload.get("serving_env")
    if deployed_env is None:
        deployed_env = {}
        for container in workload["containers"]:
            deployed_env.update(container["env"])

    # The comparison is two-directional: the source's own variables are
    # enumerated too, so a knob the chart declares and the deployment does
    # not carry is reported instead of being invisible.
    declared_names = set(template_map.keys())
    env_map_prefix = env_map_path(component, section)
    if env_map_prefix:
        env_map = get_path(effective_values, env_map_prefix) or {}
        declared_names |= set(env_map.keys())

    for env_name in sorted(declared_names | set(deployed_env)):
        label, default, override, effective, status, default_path = resolve_source(
            env_name, component, section, template_map, chart_values, overlay_values, effective_values
        )
        if env_name not in deployed_env:
            if status == "UNDECLARED":
                continue
            entry = template_map.get(env_name) or {}
            if entry.get("guards") and not _guards_hold(entry["guards"], effective_values):
                # The chart renders this row only under a condition that does
                # not hold here: the deployment is right to not carry it.
                continue
            conditional = bool(entry.get("unresolved_guard"))
            rows.append(
                {
                    "env": env_name,
                    "source_path": label,
                    "default_path": default_path,
                    "source_value": normalize(default),
                    "overlay_value": normalize(override),
                    "effective_value": normalize(effective),
                    "deployed": "(not carried)",
                    # An unconditional row the deployment does not carry is a
                    # difference: it carries no disposition and fails the
                    # capture. A conditional one (a condition the capture
                    # could not evaluate) is reported, not a verdict.
                    "status": "CONDITIONAL" if conditional else "NOT CARRIED",
                }
            )
            continue
        deployed = deployed_env[env_name]
        if status is None:
            if (
                model_only
                and env_name not in MODEL_VARIABLES.get(component, ())
                and (component, env_name) not in DERIVED_VARIABLES
            ):
                # The application tier is compared for its model ids only:
                # its remaining environment is not the retrieval
                # configuration this story baselines. It is listed, never
                # dropped silently.
                undeclared.append(env_name)
                continue
            status = "MATCH" if values_equal(effective, deployed) else "DIFFERENT"
        elif status == "UNDECLARED" and is_injected(env_name):
            # Kubernetes injects it: it is service discovery, not
            # configuration, and the chart does not declare it.
            continue
        if status == "UNDECLARED":
            undeclared.append(env_name)
            continue
        rows.append(
            {
                "env": env_name,
                "source_path": label,
                "default_path": default_path,
                "source_value": normalize(default),
                "overlay_value": normalize(override),
                "effective_value": normalize(effective),
                "deployed": deployed,
                "status": status,
            }
        )
    return rows, undeclared


def discrepancy_row(workload_name, row, disposition):
    """The discrepancy a compared row produces.

    The source of the difference is the EFFECTIVE value (the chart default
    with the overlay override applied) - that is what the comparison used -
    and the path it comes from names where the value was read.
    """
    return {
        "workload": workload_name,
        "env": row["env"],
        "source_value": row["effective_value"]
        or row["overlay_value"]
        or row["source_value"]
        or "(derived from the chart source)",
        "source_path": row["source_path"],
        "deployed": row["deployed"],
        "disposition": disposition or "**UNRESOLVED**",
    }


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


def render_markdown(data):
    lines = []
    add = lines.append
    capture = data["capture"]
    secret_paths = set(capture.get("secret_paths") or [])
    add(f"# V03 deployed baseline - {capture['date']}")
    add("")
    add(
        "Generated by `scripts/baseline/capture-deployed-baseline.py`. "
        "Do not edit by hand: re-run the script to refresh it."
    )
    add("")
    add(f"- **Captured:** {capture['timestamp']}")
    add(f"- **Target deployment:** {capture['cluster']} - namespace `{capture['namespace']}`")
    add(
        f"- **Release:** `{capture['release']}` revision {capture['release_revision']}, "
        f"chart `{capture['chart_name']}`"
    )
    add(
        f"- **Source compared against:** the chart source in this repository, version "
        f"{capture['local_chart_version']}"
    )
    add(f"- **Overlay values:** `{capture['overlay_name']}`")
    add(f"- **Release health:** {capture['release_health']}")
    add("")
    add("## How to re-run")
    add("")
    add("```bash")
    add(capture["command"])
    add("```")
    add("")
    add(
        "The capture is read-only: it creates, patches and deletes nothing, and it "
        "writes no secret into the record."
    )
    add("")

    identity = data.get("chart_identity") or {}
    add("## Chart identity")
    add("")
    add(
        "Which chart the deployment runs, read from the cluster objects that attest "
        "it: the release history names the chart version the deployed revision runs, "
        "and the release secret of that revision holds the chart it was rendered with."
    )
    add("")
    if not identity:
        add("The chart identity was not established.")
        add("")
    else:
        add(
            f"- **Chart the deployment runs:** `{cell(identity['chart_name'])}` version "
            f"{cell(identity['chart_version'])} (the release history of revision "
            f"{capture['release_revision']})"
        )
        add(
            f"- **Rendered from:** the `{cell(identity['source_kind'])}` "
            f"`{cell(identity['source_name'])}` in namespace "
            f"`{cell(identity['source_namespace'])}`"
        )
        add(
            f"- **Commit of this repository that carries it:** "
            f"`{cell(identity['commit'] or '(none)')}`"
        )
        add(f"- **Chart files compared:** {identity['files']}")
        if identity["status"] == "UNRESOLVED":
            add(f"- **Verdict:** UNRESOLVED - {identity['reason']}.")
        elif identity["status"] == "DIFFERENT":
            add(
                "- **Verdict:** DIFFERENT - the chart source in this repository is not "
                "the chart the deployment runs (see the table below)."
            )
        else:
            add(
                "- **Verdict:** IDENTICAL - the chart source in this repository is the "
                "chart the deployment runs."
            )
        add("")
        if identity["differences"]:
            add("| path | chart source | chart the deployment runs |")
            add("|---|---|---|")
            for difference in identity["differences"]:
                add(
                    f"| `{cell(difference['path'])}` | {cell(difference['source'])} | "
                    f"{cell(difference['deployed'])} |"
                )
            add("")

    add("## Workloads and image digests")
    add("")
    add(
        "The **running index digest** is the digest the pod's runtime records. The "
        "**running amd64 child** is the CONTENT the pod runs - the child digest is the "
        "content identity; the index digest moves on every re-push (the attestation "
        "changes the index, not the image). The two registry columns are the digests "
        "of the artifact the deployment DECLARES: its digest pin when the reference "
        "carries one, its tag otherwise, resolved at capture time. The verdict compares "
        "the CONTENT, never the index."
    )
    add("")
    add(
        "| workload | container | image | running index digest | running amd64 child | "
        "registry index digest | registry amd64 child | status |"
    )
    add("|---|---|---|---|---|---|---|---|")
    for row in data["images"]:
        add(
            f"| `{cell(row['workload'])}` | {cell(row['container'])} | `{cell(row['image'])}` | "
            f"`{cell(row['running_digest'])}` | {cell(row.get('running_child_digest', ''))} | "
            f"{cell(row['registry_digest'])} | {cell(row['registry_child_digest'])} | {row['status']} |"
        )
    add("")

    add("## Models")
    add("")
    add(
        "| role | chart default | declared in the deployment | served by the model node | "
        "serving detail | status |"
    )
    add("|---|---|---|---|---|---|")
    for row in data["models"]:
        add(
            f"| {row['role']} | {cell(row['chart_default_display'])} | {cell(row['declared'])} | "
            f"{cell(row['served'])} | {cell(row['detail'])} | {row['status']} |"
        )
    add("")

    add("## Retrieval and ingestion configuration")
    add("")
    add(
        "Compared per workload: the chart's own default, the overlay override that "
        "applies on top of it, and what the running pod carries. `TEMPLATE` means the "
        "chart template renders the variable from a literal or a helper rather than "
        "from a values leaf."
    )
    add("")
    for workload in data["config"]:
        add(f"### `{cell(workload['workload'])}`")
        add("")
        if workload["rows"]:
            add("| variable | chart default | overlay | deployed | status |")
            add("|---|---|---|---|---|")
        for row in workload["rows"]:
            default_cell = cell(row["source_value"])
            # The chain is per-side: when the chart default fell through to a
            # different element than the deployed value resolved from, say so
            # - otherwise the two columns read as one shared source.
            default_path = row.get("default_path")
            if default_path and default_path != row["source_path"]:
                default_cell = f"{default_cell} (`via {default_path}`)"
            overlay_cell = cell(row["overlay_value"])
            if row.get("source_path") in secret_paths:
                # The value lives in a Secret: the record says so and never
                # shows it.
                overlay_cell = "<from secret>"
            add(
                f"| `{cell(row['env'])}` | {default_cell} | "
                f"{overlay_cell} | {cell(row['deployed'])} | {row['status']} |"
            )
        add("")
        compared = sum(1 for row in workload["rows"] if row["status"] != "TEMPLATE")
        templated = sum(1 for row in workload["rows"] if row["status"] == "TEMPLATE")
        if workload["rows"]:
            add(
                f"Compared against a chart value: {compared}; rendered by the template "
                f"(literal or helper): {templated}."
            )
        if workload.get("multi_container"):
            add(
                "This workload carries several containers; their environments are "
                "merged and a name collision keeps the last container's value."
            )
        add("")
        if workload["undeclared"]:
            add(
                "Carried by the deployment and not compared against the chart source: "
                + ", ".join(f"`{name}`" for name in workload["undeclared"])
            )
            add("")

    add("## Discrepancies and dispositions")
    add("")
    if not data["discrepancies"]:
        add("No difference between the deployment and the source baseline.")
        add("")
    else:
        add("| workload | variable | source | deployed | disposition |")
        add("|---|---|---|---|---|")
        for row in data["discrepancies"]:
            source = cell(row["source_value"])
            if row.get("source_path") in secret_paths:
                source = "<from secret>"
            elif row.get("source_path"):
                source = f"{source} (`{row['source_path']}`)"
            add(
                f"| `{cell(row['workload'])}` | `{cell(row['env'])}` | "
                f"{source} | {cell(row['deployed'])} | {cell(row['disposition'])} |"
            )
        add("")
        add(data["image_disposition_note"])
        add("")

    add("## Topology")
    add("")
    add(f"- **Edge:** {data['topology']['edge']}")
    add(f"- **NetworkPolicies:** {data['topology']['network_policies']}")
    add(f"- **External dependencies:** {data['topology']['external']}")
    add("")
    add("| service | type | ports |")
    add("|---|---|---|")
    for service in data["topology"]["services"]:
        add(f"| `{cell(service['name'])}` | {service['type']} | {cell(service['ports'])} |")
    add("")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# capture
# --------------------------------------------------------------------------


def pick_running_pod(pods, workload, container_name):
    """The pod that actually serves the workload: running, ready, newest.

    A pod of an outgoing ReplicaSet can still carry an image digest; taking
    the first match in kubectl's order would state the OLD image as the
    running one.
    """
    matching = [
        pod
        for pod in pods
        if pod["container"] == container_name
        and pod["digest"]
        and all(
            pod["labels"].get(key) == value
            for key, value in workload["selector"].items()
        )
    ]
    running = [pod for pod in matching if pod["phase"] == "Running"]
    ready = [pod for pod in running if pod["ready"]]
    candidates = ready or running or matching
    if not candidates:
        return None
    return max(candidates, key=lambda pod: pod["created"])


def _not_running_status(workload):
    """Why a workload runs no pod: scaled to zero, or its pods are not there."""
    if int(workload.get("replicas") or 0) == 0:
        return "NOT RUNNING (scaled to zero)"
    return "NOT RUNNING (no running pod)"


UNOWNED_MARK = "no workload owns this pod"


def build_images(workloads, pods):
    """One row per workload container, plus the pods no workload owns.

    A database server owned by a custom resource (the ArangoDB cluster is an
    ArangoDeployment, not a StatefulSet) is a workload of the deployment
    too: without it the record would list the database's services and never
    state the version the retrieval runs against.
    """
    images = []
    for workload in workloads:
        for container in workload["containers"]:
            running = pick_running_pod(pods, workload, container["name"])
            images.append(
                {
                    "workload": workload["name"],
                    "container": container["name"],
                    "image": container["image"],
                    "running_digest": running["digest"] if running else "not running",
                    "running_child_digest": "",
                    "pull_policy": running.get("pull_policy", "") if running else "",
                    "registry_digest": "",
                    "registry_child_digest": "",
                    "status": _not_running_status(workload),
                }
            )

    owned = {
        pod["pod"]
        for workload in workloads
        for pod in pods
        if all(
            pod["labels"].get(key) == value
            for key, value in workload["selector"].items()
        )
    }
    for pod in pods:
        if pod["pod"] in owned or not pod["digest"]:
            continue
        images.append(
            {
                "workload": f"{pod['pod']} ({UNOWNED_MARK})",
                "container": pod["container"],
                "image": pod["image"],
                "running_digest": pod["digest"],
                "running_child_digest": "",
                "pull_policy": pod.get("pull_policy", ""),
                "registry_digest": "",
                "registry_child_digest": "",
                "status": "NOT COMPARABLE",
            }
        )
    return images


def resolve_registry_digests(images):
    """Resolve the registry digests of every image and compare the CONTENT.

    The running image and the registry's current tag are compared by their
    amd64 child digest - the content identity. The index digest is
    reported, never used as the verdict: it changes on every re-push (the
    attestation changes the index, not the image), so an index that moved
    says nothing about the image the pod runs.
    """
    differences = 0
    for row in images:
        running = row["running_digest"]
        tag_digest, tag_child, note = None, "", ""
        _repository, tag, digest = image_reference(row["image"])
        # The artifact the deployment DECLARES: its digest pin when it has
        # one, its tag otherwise. Resolving the tag of a pinned reference
        # would describe another artifact than the one the deployment runs.
        try:
            tag_digest, tag_child, note = registry_manifest(
                row["image"], digest or tag
            )
        except Exception as error:  # noqa: BLE001 - reported, never fatal
            tag_digest, tag_child, note = None, "", f"unresolved ({error})"
        row["registry_digest"] = tag_digest or note or "not applicable"
        row["registry_child_digest"] = tag_child or ""
        if not running or running == "not running":
            # A workload that runs no pod is never compared: a verdict
            # would assert something about a container that does not
            # exist. The row keeps the reason it runs no pod.
            row["running_child_digest"] = ""
            continue
        running_child = ""
        running_note = ""
        running_digest = running.split("@")[-1]
        if tag_digest and running_digest == tag_digest:
            # The pod runs the very artifact the deployment declares: its
            # content is the content already resolved.
            running_child = tag_child
        else:
            try:
                _served, running_child, running_note = registry_manifest(
                    row["image"], running_digest
                )
            except Exception as error:  # noqa: BLE001 - reported, never fatal
                running_child, running_note = "", f"unresolved ({error})"
        row["running_child_digest"] = running_child or running_note
        if not tag_child:
            # The tag's content could not be resolved: nothing to compare.
            row["status"] = "NOT COMPARABLE"
        elif running_child:
            if running_child == tag_child:
                # The same content: only the index moved.
                row["status"] = (
                    "MATCH"
                    if tag_digest and tag_digest in running
                    else "SAME CONTENT"
                )
            else:
                row["status"] = "DIFFERENT"
                differences += 1
        else:
            # The registry does not serve the running digest: only the
            # index digests can be compared.
            same = bool(tag_digest) and (
                tag_digest in running or running.endswith(tag_digest)
            )
            row["status"] = "MATCH" if same else "DIFFERENT"
            if not same:
                differences += 1
    return differences


def image_disposition(row):
    """The disposition of one image row, stated as observed facts."""
    if row["status"] == "DIFFERENT":
        return (
            "Accepted for V03 - the running image and the image the deployment declares "
            f"carry different content (the running amd64 child digest "
            f"{row['running_child_digest']}, the declared one {row['registry_child_digest']}). "
            "The running content is the reference E01 must measure against. The "
            f"deployment declares imagePullPolicy {row.get('pull_policy') or 'not declared'}, "
            "so the next pod start pulls the declared reference; re-running the capture "
            "after a rollout refreshes this row."
        )
    if row["status"] == "SAME CONTENT":
        return (
            "Accepted for V03 - the running image and the artifact the deployment "
            "declares carry the "
            f"same content (the same amd64 child digest {row['registry_child_digest']}); "
            "only the index digest differs, and the index is not a content identity: it "
            "changes on every re-push (the attestation changes the index, not the image). "
            f"The deployment declares imagePullPolicy {row.get('pull_policy') or 'not declared'}, "
            "so the next pod start pulls the declared reference. E01 must measure against "
            "the content digest, which is stable."
        )
    return (
        "Accepted for V03 - the running digest is the reference E01 must measure against; "
        "the registry's current index digest is reported next to it."
    )


def image_note(images):
    """The counts the image table ends with, computed from the rows."""
    comparable = [
        row
        for row in images
        if row["status"] in ("MATCH", "SAME CONTENT", "DIFFERENT")
    ]
    moved = [row for row in comparable if row["status"] != "MATCH"]
    same = [row for row in moved if row["status"] == "SAME CONTENT"]
    different = [row for row in moved if row["status"] == "DIFFERENT"]
    rest = [
        row
        for row in images
        if row["status"] not in ("MATCH", "SAME CONTENT", "DIFFERENT")
    ]
    # Each row carries exactly one reason: the counts partition the rows.
    counts = {"outside": 0, "unresolved": 0, "stopped": 0, "unowned": 0, "other": 0}
    for row in rest:
        if str(row["registry_digest"]).startswith("unresolved"):
            counts["unresolved"] += 1
        elif row["registry_digest"] == "outside the GitLab registry":
            counts["outside"] += 1
        elif str(row["status"]).startswith("NOT RUNNING"):
            counts["stopped"] += 1
        elif UNOWNED_MARK in row["workload"]:
            counts["unowned"] += 1
        else:
            counts["other"] += 1
    reasons = []
    if counts["outside"]:
        reasons.append(f"{counts['outside']} an image outside the GitLab registry")
    if counts["unresolved"]:
        reasons.append(f"{counts['unresolved']} a reference the registry does not resolve")
    if counts["stopped"]:
        reasons.append(f"{counts['stopped']} a workload that runs no pod")
    if counts["unowned"]:
        reasons.append(f"{counts['unowned']} a pod no workload owns")
    if counts["other"]:
        reasons.append(f"{counts['other']} a reference that resolves to no artifact")
    listed = ", ".join(reasons) if reasons else "none"
    owned_by_nobody = sum(
        1 for row in images if UNOWNED_MARK in row["workload"]
    )
    tail = (
        f" {owned_by_nobody} of the {len(images)} rows are pods no workload owns."
        if owned_by_nobody
        else ""
    )
    return (
        f"{len(moved)} of the {len(comparable)} comparable GitLab-registry workload "
        f"images run an index digest that differs from the one the deployment declares: "
        f"{len(same)} of them carry the same content, {len(different)} a different "
        f"one. The {len(rest)} other rows are not comparable - {listed}.{tail}"
    )


def collect_discrepancies(config, models, images, identity=None):
    """Every difference the record reports, each with its disposition.

    The capture's own gate lives here: a difference the capture finds and
    cannot explain carries no disposition, and the record then fails.
    """
    discrepancies = []
    for workload in config:
        for row in workload["rows"]:
            if row["status"] == "DIFFERENT":
                # No disposition table remains: an unexplained difference
                # must fail the capture, so it carries none.
                discrepancies.append(
                    discrepancy_row(workload["workload"], row, None)
                )
            elif row["status"] == "CONDITIONAL":
                # A row whose guard the capture cannot evaluate: it cannot
                # certify that the chart leaves the row out here, so the row
                # carries no disposition and the capture fails on it.
                discrepancies.append(
                    discrepancy_row(workload["workload"], row, None)
                )
            elif row["status"] == "NOT CARRIED":
                # An unconditional chart-declared variable the deployment does
                # not carry is a difference: no disposition, so the capture
                # fails on it.
                discrepancies.append(
                    discrepancy_row(workload["workload"], row, None)
                )
    # A served model that differs from the source is a difference between
    # the deployment and the source: it belongs in the discrepancy table
    # and in the exit gate.
    discrepancies.extend(model_discrepancy_rows(models))
    discrepancies.extend(image_discrepancy_rows(images))
    # The chart identity: a comparison that could not be established carries
    # no disposition, so it fails the capture.
    discrepancies.extend(chart_identity_rows(identity))
    return discrepancies


def image_discrepancy_rows(images):
    """The discrepancies the image table produces."""
    rows = []
    for row in images:
        if row["status"] not in ("DIFFERENT", "SAME CONTENT"):
            continue
        rows.append(
            {
                "workload": row["workload"],
                "env": "image digest",
                "source_value": (
                    f"registry `{image_reference_label(row['image'])}` = "
                    f"{row['registry_digest']}"
                ),
                "deployed": f"running {row['running_digest']}",
                "disposition": image_disposition(row),
            }
        )
    return rows


def model_discrepancy_rows(models):
    """The discrepancies the model table produces.

    A model the node serves that differs from the source, and a model that
    could not be probed at all, are both unresolved: the record cannot
    attest the served model ids the acceptance criteria name.
    """
    rows = []
    for model in models:
        if model["status"] not in ("DIFFERENT", "NOT PROBED", "UNKNOWN"):
            continue
        rows.append(
            {
                "workload": f"({model['role']} model)",
                "env": "model id",
                "source_value": model["difference_source"],
                "source_path": model["difference_path"],
                "deployed": model["served"],
                "disposition": "**UNRESOLVED**",
            }
        )
    return rows


def build_models(env_by_component, chart_values, effective_values, served):
    """The models table: what the chart declares, what the cluster pins, what answers.

    A role that no workload in the deployment declares is reported as
    "not declared here": the chart's value for it belongs to a topology
    this deployment does not run (the in-cluster model tier, deployed only
    in `gpu.mode=in-cluster`), and comparing against it would publish a
    difference that does not exist.
    """
    models = []
    for role, path, sources in MODEL_ROLES:
        declared = ""
        declared_source = ""
        for component, env_name in sources:
            value = env_by_component.get(component, {}).get(env_name)
            if value:
                declared = value
                declared_source = f"{component}/{env_name}"
                break
        observed = served.get(role, {})
        served_id = observed.get("model_id") or observed.get("error") or "unknown"
        detail = ", ".join(
            f"{key}={observed[key]}"
            for key in (
                "dtype",
                "max_input_length",
                "max_model_len",
                "server_version",
                "server",
            )
            if observed.get(key) is not None
        )
        chart_default = normalize(get_path(chart_values, path))
        effective = normalize(get_path(effective_values, path))
        difference_source = effective or chart_default
        difference_path = path
        if declared and served_id != "unknown" and not values_equal(declared, served_id):
            difference_source = declared
            difference_path = f"{declared_source} (pinned)"
        if observed.get("error"):
            status = "NOT PROBED"
        elif served_id == "unknown":
            status = "UNKNOWN"
        elif not declared:
            status = "NOT DECLARED HERE"
        elif not values_equal(declared, served_id):
            status = "DIFFERENT"
        elif not values_equal(effective, declared):
            # The deployment pins another value than the source declares.
            status = "DIFFERENT"
        else:
            status = "MATCH"
        models.append(
            {
                "role": role,
                "chart_default_display": (
                    chart_default if status != "NOT DECLARED HERE" else
                    "(not deployed in this topology)"
                ),
                "difference_source": difference_source,
                "difference_path": difference_path,
                "declared": declared or "(no workload declares this model)",
                "served": served_id,
                "detail": detail + (f", pinned by {declared_source}" if declared_source else ""),
                "status": status,
            }
        )
    return models


def external_dependencies(workloads):
    """The endpoints the deployment reaches OUTSIDE the cluster."""
    external = set()
    for workload in workloads:
        for container in workload["containers"]:
            for key, value in container["env"].items():
                if not key.endswith("_ENDPOINT") or not value.startswith("http"):
                    continue
                if ".svc.cluster.local" in value:
                    continue
                external.add(value)
    return ", ".join(sorted(external))


def capture(namespace, flux_namespace, release, date, out_path):
    """Read the deployment and the source baseline, and reconcile them."""
    workloads = capture_workloads(namespace)
    pods = capture_pods(namespace)
    topology = capture_topology(namespace)
    release_info = capture_release(flux_namespace, release)
    with open(os.path.join(CHART_DIR, "values.yaml"), encoding="utf-8") as handle:
        chart_values = yaml.safe_load(handle)

    overlay_values = release_info["overlay"]
    effective_values = deep_merge(chart_values, overlay_values)
    env_maps = template_env_maps()

    images = build_images(workloads, pods)
    resolve_registry_digests(images)

    # The third layer is the SERVING pod, not the Deployment's template:
    # during a rollout the two differ, and the serving pod is what E01
    # measures.
    for workload in workloads:
        serving = {}
        for container in workload["containers"]:
            pod = pick_running_pod(pods, workload, container["name"])
            if pod and pod.get("env"):
                serving.update(pod["env"])
            else:
                serving.update(container["env"])
        workload["serving_env"] = serving

    # The model table answers for the SERVING pod, like the configuration
    # tables: during a rollout the Deployment template can disagree with
    # what actually answers.
    env_by_component = {}
    for workload in workloads:
        if workload.get("serving_env"):
            env_by_component.setdefault(workload["component"], {}).update(
                workload["serving_env"]
            )

    config = []
    for workload in workloads:
        rows, undeclared = compare_workload(
            workload, env_maps, chart_values, overlay_values, effective_values
        )
        if rows or undeclared:
            multi = len(workload["containers"]) > 1
            config.append(
                {
                    "workload": workload["name"],
                    "rows": rows,
                    "undeclared": undeclared,
                    "multi_container": multi,
                }
            )

    served = capture_models(namespace, env_by_component)
    models = build_models(env_by_component, chart_values, effective_values, served)

    # The chart the deployment runs, attested from the cluster objects that
    # hold it, and how the chart source in this repository compares with it.
    identity = chart_identity(release_info)

    # Every difference the record reports, each with its disposition. The
    # capture's own gate: a difference without one fails the capture.
    discrepancies = collect_discrepancies(config, models, images, identity)

    edge = ", ".join(
        f"{service['name']} ({service['type']} {service['ports']})"
        for service in topology["services"]
        if service["type"] in ("LoadBalancer", "NodePort")
    )

    return {
        "capture": {
            "date": date,
            "secret_paths": sorted(release_info.get("secret_paths") or []),
            "timestamp": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "cluster": run(
                [
                    "kubectl",
                    "config",
                    "view",
                    "--minify",
                    "-o",
                    "jsonpath={.clusters[0].cluster.server}",
                ]
            ).strip(),
            "namespace": namespace,
            "release": release,
            "release_revision": release_info["revision"],
            "chart_name": release_info["chart"].get("chart", ""),
            "local_chart_version": local_chart_version(),
            "overlay_name": release_info["overlay_name"],
            "release_health": (
                f"{release_info['ready']} - {release_info['status']}"
                if release_info["status"]
                else "unknown"
            ),
            "command": (
                "uv run --no-cache --with pyyaml python "
                f"scripts/baseline/capture-deployed-baseline.py --namespace {namespace} "
                f"--date {date} --out {_display_path(out_path)}"
            ),
        },
        "images": images,
        "models": models,
        "config": config,
        "chart_identity": identity,
        "discrepancies": discrepancies,
        "image_disposition_note": image_note(images),
        "topology": {
            "services": topology["services"],
            "network_policies": topology["network_policies"],
            "edge": edge or "(no LoadBalancer or NodePort service)",
            "external": external_dependencies(workloads) or "(none)",
        },
    }


def write_record(data, out_path):
    """Write the record, and return the discrepancies that carry no disposition."""
    directory = os.path.dirname(out_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(render_markdown(data))
    return [
        row for row in data["discrepancies"] if row["disposition"] == "**UNRESOLVED**"
    ]


def exit_code_for(discrepancies):
    """The capture's exit code: 2 while a difference carries no disposition."""
    return 2 if discrepancies else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--namespace", default="genieai")
    parser.add_argument("--flux-namespace", default="flux-system")
    parser.add_argument("--release", default="genieai")
    parser.add_argument("--date", default=dt.date.today().isoformat())
    parser.add_argument(
        "--out",
        default=None,
        help="output path (default docs/baselines/v03-deployed-baseline-<date>.md)",
    )
    args = parser.parse_args()

    out_path = args.out or os.path.join(
        REPO_ROOT, "docs", "baselines", f"v03-deployed-baseline-{args.date}.md"
    )

    try:
        data = capture(
            args.namespace, args.flux_namespace, args.release, args.date, out_path
        )
        unresolved = write_record(data, out_path)
    except Exception as error:  # noqa: BLE001 - the failure must name itself
        print(f"capture failed: {error}", file=sys.stderr)
        sys.exit(3)

    print(f"record written: {out_path}")

    if unresolved:
        for row in unresolved:
            print(f"UNRESOLVED: {row['workload']} {row['env']}", file=sys.stderr)
    sys.exit(exit_code_for(unresolved))


if __name__ == "__main__":
    main()
