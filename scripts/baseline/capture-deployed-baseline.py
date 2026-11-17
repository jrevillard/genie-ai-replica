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
        --out docs/baselines/v03-deployed-baseline-2026-11-17.md

Exit codes:
    0  the record was written and every discrepancy carries a disposition
    2  the record was written, but at least one discrepancy is UNRESOLVED
    3  the capture failed (cluster unreachable, chart source missing, ...)
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request

try:
    import yaml
except ImportError:  # pragma: no cover - CI installs PyYAML for the chart gates
    sys.exit("PyYAML is required (pip install pyyaml)")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHART_DIR = os.path.join(REPO_ROOT, "charts", "genieai-umbrella")
CHART_TEMPLATES = os.path.join(CHART_DIR, "templates", "opea")

# The GitLab front door refuses the default Python user agent (the token
# endpoint answers 403); the capture identifies itself like a normal client.
USER_AGENT = "genieai-baseline-capture/1.0"

# The chart section each OPEA workload is rendered from. The component label
# is what the chart puts on the workload; the file is the template that
# declares the workload's environment. The scope is the retrieval and
# ingestion tier the acceptance criteria name: the application tier (backend,
# frontend, document repository) is compared for its model ids only.
OPEA_WORKLOADS = {
    "chatqna": ("chatqna.yaml", "chatqna"),
    "retriever": ("retriever.yaml", "retriever"),
    "dataprep": ("dataprep.yaml", "dataprep"),
    "embedding": ("embedding.yaml", "embedding"),
    "reranker": ("reranker.yaml", "reranker"),
    "translation": ("translation.yaml", "translation"),
}

# Model ids declared by a workload OUTSIDE the parsed OPEA templates, with the
# chart path each one comes from. The backend's translation model is declared
# by the application tier (services.backend.translation.modelId), not by the
# OPEA tier (opea.translation.modelId) - the two coincide today only because
# both default to the same model id.
MODEL_VARIABLES = {
    "backend": {"VLLM_TRANSLATION_MODEL_ID": "services.backend.translation.modelId"},
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
    ("chatqna", "VLLM_LLM_ENDPOINT"): "gpu.endpoint.llm",
    ("chatqna", "VLLM_TRANSLATION_ENDPOINT"): "gpu.endpoint.translation",
    ("chatqna", "GPU_NODE_HOST"): "gpu.hostname",
    ("chatqna", "KEYCLOAK_URL"): "public.issuer",
    ("dataprep", "VLLM_ENDPOINT"): "gpu.endpoint.llm",
    ("dataprep", "TEI_EMBEDDING_ENDPOINT"): "gpu.endpoint.embedding",
    ("dataprep", "GPU_NODE_HOST"): "gpu.hostname",
    ("retriever", "VLLM_ENDPOINT"): "gpu.endpoint.llm",
    ("retriever", "TEI_EMBEDDING_ENDPOINT"): "gpu.endpoint.embedding",
    ("retriever", "GPU_NODE_HOST"): "gpu.hostname",
    ("embedding", "EMBEDDING_MODEL_ENDPOINT"): "gpu.endpoint.embedding",
    ("embedding", "TEI_EMBEDDING_ENDPOINT"): "gpu.endpoint.embedding",
    ("reranker", "TEI_RERANKING_ENDPOINT"): "gpu.endpoint.reranker",
    ("backend", "VLLM_TRANSLATION_ENDPOINT"): "gpu.endpoint.translation",
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
DISPOSITIONS = {
    "image-digest": (
        "Accepted for V03 - the running digest is the reference E01 must measure "
        "against. The pod runs a push the registry no longer serves, and the tag has "
        "moved on. Note that the index digest is not a content identity: it changes on "
        "every re-push (the attestation), so the amd64 child digest is the stable "
        "one. The divergence is the known containerd stale-pull behaviour of the "
        "venue-update mechanism (a rollout restart alone does not re-pull a mutable "
        "tag). Updating the running stack is the venue update procedure, outside this "
        "story."
    ),
    "not-carried": (
        "Reported - the chart declares this variable and the deployment does not "
        "carry it. The chart renders some rows only under a condition (the prompt "
        "rows, the docling endpoint), so this is reported and does not fail the "
        "capture."
    ),
    "chart-version": (
        "Recorded - the local chart source is not the chart the deployment runs. The "
        "comparison below is against the local source, so it describes what the "
        "repository would deploy, not what runs. Re-run the capture from the chart "
        "version the deployment runs."
    ),
}


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


def parse_template_env(template_file):
    """Return {env name: {"path": ..., "literal": ...}} for one chart template.

    A path is the chart values leaf the template reads; a literal is the
    value the template renders verbatim. A variable with neither is rendered
    by a helper call and is recorded as "declared by the template, not by a
    values leaf".
    """
    text = open(os.path.join(CHART_TEMPLATES, template_file), encoding="utf-8").read()
    mapping = {}

    def record(env_name, expression):
        if env_name in mapping:
            return
        chain = _expression_chain(expression)
        mapping[env_name] = {
            "chain": chain,
            "path": chain[0][1] if chain and chain[0][0] == "path" else None,
            "literal": chain[0][1] if chain and chain[0][0] == "literal" else None,
        }

    # Service-factory style: (dict "name" "ENV" "value" <expr>)
    for match in re.finditer(r'\(dict "name" "([A-Z0-9_]+)" "value" (.*)', text):
        record(match.group(1), match.group(2))

    # Hand-rendered style: - name: ENV / [comment lines] / value: {{ <expr> }}
    for match in re.finditer(
        r"- name: ([A-Z0-9_]+)\n(?:\s*#.*\n)*\s*value: \{\{-?\s*(.*?)\s*\}\}", text
    ):
        record(match.group(1), match.group(2))

    return mapping


def _expression_chain(expression):
    """The fallback chain of a template expression, in order.

    `($opeaChatqna.kcRealm | default ($dataKeycloak.realm | default "genie"))`
    renders the first candidate that carries a value: the chart leaves the
    realm empty in that section and falls back to the realm the data tier
    declares. Reading only the first operand would report a difference the
    chart does not make.
    """
    candidates = []

    # A bare literal: the template renders this value verbatim.
    stripped = expression.strip()
    for _ in range(4):
        found = re.fullmatch(r'"([^"]*)"', stripped)
        if found:
            candidates.append((0, "literal", found.group(1)))
            break
        if not stripped.endswith(")"):
            break
        stripped = stripped[:-1].strip()

    def add(position, path):
        candidates.append((position, "path", path))

    for found in re.finditer(
        r"index \(index \(\$opea \| default dict\) \"([a-z]+)\"[^)]*\) \"([A-Za-z0-9]+)\"",
        expression,
    ):
        add(found.start(), f"opea.{found.group(1)}.{found.group(2)}")

    for found in re.finditer(
        r"index \(index \(\$opeaModels \| default dict\) \"([a-z]+)\"[^)]*\) \"([A-Za-z0-9]+)\"",
        expression,
    ):
        add(found.start(), f"opea.models.{found.group(1)}.{found.group(2)}")

    for found in re.finditer(
        r"index \(\$opea\.([a-z]+) \| default dict\) \"([A-Za-z0-9]+)\"", expression
    ):
        add(found.start(), f"opea.{found.group(1)}.{found.group(2)}")

    for found in re.finditer(r"\$([A-Za-z][A-Za-z0-9]*)\.([A-Za-z0-9]+)", expression):
        variable, key = found.group(1), found.group(2)
        if variable in SECTION_VARS:
            add(found.start(), f"opea.{SECTION_VARS[variable]}.{key}")
        elif variable.startswith("data") and variable != "data":
            add(found.start(), f"data.{variable[4:].lower()}.{key}")

    # A literal only counts when it is the operand of a `default`: the other
    # quoted strings in an expression are arguments of a helper call.
    for found in re.finditer(r'\|\s*default\s+"([^"]*)"', expression):
        candidates.append((found.start(), "literal", found.group(1)))

    candidates.sort(key=lambda item: item[0])
    return [(kind, value) for _position, kind, value in candidates]


def _resolve_chain(chain, values):
    """The first candidate of the chain that carries a value.

    Returns (the source it came from, the value).
    """
    for kind, value in chain:
        if kind == "path":
            found = get_path(values, value)
            if found not in (None, "", [], {}):
                return value, found
        else:
            return None, value
    return None, None


SECTION_VARS = {
    "opeaChatqna": "chatqna",
    "opeaRetriever": "retriever",
    "opeaDataprep": "dataprep",
    "opeaEmbedding": "embedding",
    "opeaReranker": "reranker",
    "opeaTranslation": "translation",
    "opeaModelsLlm": "models.llm",
    "opeaModelsReranker": "models.reranker",
}


def template_env_maps():
    """{workload component: {env name: chart path or None}} for every OPEA workload."""
    return {
        component: parse_template_env(template_file)
        for component, (template_file, _section) in OPEA_WORKLOADS.items()
    }


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
                    "replicas": spec.get("replicas", 1),
                    "ready": item.get("status", {}).get("readyReplicas", 0),
                    "containers": containers,
                }
            )
    return workloads


def capture_pods(namespace):
    """Running pods with the digest of the image they actually run."""
    pods = []
    for pod in kubectl_json(namespace, "get", "pods").get("items", []):
        meta = pod["metadata"]
        status = pod.get("status", {})
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
                    "ready": container.get("ready", False),
                    "restarts": container.get("restartCount", 0),
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
    revision = 0
    for entry in status.get("history", []):
        revision = max(revision, int(entry.get("version", 0)))
    conditions = status.get("conditions") or [{}]
    overlay = deep_merge({}, spec.get("values") or {})
    overlay_name = "inline values" if spec.get("values") else ""
    for source in spec.get("valuesFrom", []):
        name = source.get("name")
        if not name:
            continue
        overlay_name = name
        kind = source.get("kind", "ConfigMap")
        values_key = source.get("valuesKey", "values.yaml")
        if kind == "Secret":
            secret = kubectl_json(flux_namespace, "get", "secret", name)
            encoded = secret.get("data", {}).get(values_key)
            raw = base64.b64decode(encoded).decode("utf-8") if encoded else None
        else:
            configmap = kubectl_json(flux_namespace, "get", "configmap", name)
            raw = configmap.get("data", {}).get(values_key)
        if raw:
            overlay = deep_merge(overlay, yaml.safe_load(raw) or {})
        else:
            raise RuntimeError(
                f"the overlay {kind} {name} carries no {values_key} - the effective "
                "source baseline cannot be resolved"
            )
    return {
        "chart": spec.get("chart", {}).get("spec", {}),
        "revision": revision,
        "overlay": overlay,
        "overlay_name": overlay_name,
        "status": conditions[0].get("message", ""),
        "ready": conditions[0].get("status", ""),
    }


def local_chart_version():
    """The version of the chart source this capture compares against."""
    with open(os.path.join(CHART_DIR, "Chart.yaml"), encoding="utf-8") as handle:
        return (yaml.safe_load(handle) or {}).get("version", "")


def deployed_chart_source(flux_namespace, source_ref):
    """The commit of the chart source the release was rendered from.

    For a GitRepository source the release ignores `spec.chart.spec.version`
    and installs the branch tip: the identity of the chart is its commit,
    not its version field.
    """
    if source_ref.get("kind") != "GitRepository":
        return "", ""
    namespace = source_ref.get("namespace", flux_namespace)
    repository = kubectl_json(namespace, "get", "gitrepository", source_ref["name"])
    revision = repository.get("status", {}).get("artifact", {}).get("revision", "")
    # The revision is "<branch>@sha1:<sha>"; the commit is the identity.
    found = re.search(r"([0-9a-f]{40})", revision)
    return found.group(1) if found else revision


def chart_source_matches(deployed_sha):
    """Whether the local chart tree is the tree the deployment was rendered from.

    Returns None when the deployed commit is unknown to this checkout.
    """
    if not deployed_sha:
        return None
    try:
        run(["git", "-C", REPO_ROOT, "cat-file", "-e", f"{deployed_sha}^{{commit}}"])
    except RuntimeError:
        return None
    diff = run(["git", "-C", REPO_ROOT, "diff", "--stat", deployed_sha, "--", "charts/"])
    return diff.strip() == ""


# --------------------------------------------------------------------------
# registry and model endpoints
# --------------------------------------------------------------------------


def image_tag(image):
    """The tag of a tagged image reference (empty for a digest-pinned one)."""
    reference = image.split("@")[0]
    parts = reference.rsplit(":", 1)
    if len(parts) == 2 and "/" in parts[0]:
        return parts[1]
    return ""


def registry_digest(image):
    """The digests the registry currently serves for a tagged image.

    Returns (index digest, amd64 child digest, note). The index digest is
    what the runtime records as the running digest; the child digest is the
    stable content identity (the index digest moves on every re-push, the
    attestation changes the index and not the image).
    """
    reference = image.split("@")[0]
    parts = reference.rsplit(":", 1)
    if len(parts) != 2 or "/" not in parts[0]:
        return None, "", "pinned by digest or not a tagged image"
    repository, tag = parts
    registry_host = repository.split("/")[0]
    if not registry_host.startswith("registry."):
        return None, "", "outside the GitLab registry"
    project = repository.split("/", 1)[1]
    auth_host = re.sub(r"^registry\.", "", registry_host)
    with urllib.request.urlopen(
        urllib.request.Request(
            f"https://{auth_host}/jwt/auth?service=container_registry"
            f"&scope=repository:{project}:pull",
            headers={"User-Agent": USER_AGENT},
        ),
        timeout=30,
    ) as response:
        token = json.load(response).get("token", "")
    request = urllib.request.Request(
        f"https://{registry_host}/v2/{project}/manifests/{tag}",
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
        for entry in manifest.get("manifests", []):
            platform = entry.get("platform", {})
            if platform.get("os") == "linux" and platform.get("architecture") == "amd64":
                child = entry.get("digest", "")
                break
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
                # TEI does not authenticate with the GPU API key: the
                # credential belongs to the OpenAI-compatible endpoints.
                info = http_json(f"{base}/info", None, insecure=insecure_for(component))
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

    Returns (label, chart default, overlay value, effective value, status).
    The three layers stay distinct: the chart's own default, the overlay
    override that applies on top of it, and what the deployment runs.
    """
    overlay = overlay_values or {}

    def layers(path, derived_key=None):
        if derived_key:
            default = derive_values(chart_values).get(derived_key, "")
            effective = derive_values(effective_values).get(derived_key, "")
            # A derived value has no values leaf of its own: the overlay's
            # contribution is the derived value when it differs from the
            # chart's default.
            override = effective if effective != default else ""
        else:
            default = get_path(chart_values, path)
            effective = get_path(effective_values, path)
            override = get_path(overlay, path)
        return default, override, effective

    # 1. the section's environment map (the operator's own variables)
    if section:
        path = f"opea.{section}.env.{env_name}"
        if get_path(chart_values, path) is not None or get_path(effective_values, path) is not None:
            default, override, effective = layers(path)
            return path, default, override, effective, None

    # 2. a value the chart derives from other values (GPU endpoints, origin)
    derived_key = DERIVED_VARIABLES.get((component, env_name))
    if derived_key:
        default, override, effective = layers(None, derived_key)
        return f"derived:{derived_key}", default, override, effective, None

    # 3. a values leaf the template renders into this variable - through
    #    the template's own fallback chain - or the value it renders verbatim
    template_entry = template_map.get(env_name) if template_map else None
    if template_entry:
        chain = template_entry.get("chain") or []
        _default_path, default = _resolve_chain(chain, chart_values)
        effective_path, effective = _resolve_chain(chain, effective_values)
        override = ""
        if chain and chain[0][0] == "path":
            found = get_path(overlay, chain[0][1])
            if found not in (None, ""):
                override = normalize(found)
        if effective is not None:
            return effective_path or "template literal", default, override, effective, None

    # 4. a model id declared by a workload outside the parsed templates
    model_path = MODEL_VARIABLES.get(component, {}).get(env_name)
    if model_path:
        default, override, effective = layers(model_path)
        if effective is not None:
            return model_path, default, override, effective, None

    # 5. the template renders the variable, but from a literal or a helper
    if template_map and env_name in template_map:
        return "", "(template literal or helper)", "", "", "TEMPLATE"

    return "", "", "", "", "UNDECLARED"


def compare_workload(workload, env_maps, chart_values, overlay_values, effective_values):
    """Compare the deployed environment with the effective source baseline."""
    component = workload["component"]
    section = OPEA_WORKLOADS.get(component, (None, None))[1]
    template_map = env_maps.get(component, {}) if section else {}
    model_only = component not in OPEA_WORKLOADS

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
    if section:
        env_map = get_path(effective_values, f"opea.{section}.env") or {}
        declared_names |= set(env_map.keys())

    for env_name in sorted(declared_names | set(deployed_env)):
        if env_name not in deployed_env:
            label, default, override, effective, status = resolve_source(
                env_name, component, section, template_map, chart_values, overlay_values, effective_values
            )
            if status == "UNDECLARED":
                continue
            rows.append(
                {
                    "env": env_name,
                    "source_path": label,
                    "source_value": normalize(default),
                    "overlay_value": normalize(override),
                    "effective_value": normalize(effective),
                    "deployed": "(not carried)",
                    "status": "NOT CARRIED",
                }
            )
            continue
        deployed = deployed_env[env_name]
        label, default, override, effective, status = resolve_source(
            env_name, component, section, template_map, chart_values, overlay_values, effective_values
        )
        if status is None:
            if model_only and env_name not in MODEL_VARIABLES.get(component, {}):
                # The application tier is compared for its model ids only:
                # its remaining environment is not the retrieval
                # configuration this story baselines. It is listed, never
                # dropped silently.
                undeclared.append((env_name, deployed))
                continue
            status = "MATCH" if values_equal(effective, deployed) else "DIFFERENT"
        elif status == "UNDECLARED" and is_injected(env_name):
            continue
        if status == "UNDECLARED":
            undeclared.append((env_name, deployed))
            continue
        rows.append(
            {
                "env": env_name,
                "source_path": label,
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


def disposition_for(row):
    """The disposition of a difference, or None when the difference is unexplained."""
    if row["status"] != "DIFFERENT":
        return None
    return None


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


def render_markdown(data):
    lines = []
    add = lines.append
    capture = data["capture"]
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
        f"chart `{capture['chart_name']}` {capture['chart_version']}"
    )
    add(
        f"- **Source compared against:** the chart source in this repository, version "
        f"{capture['local_chart_version']}"
        + (
            f" - the deployment was rendered from the chart source commit "
            f"`{capture['deployed_chart_source']}`"
            + (
                " (the local chart tree is that tree)"
                if capture["chart_source_matches"] is True
                else " (the local chart tree DIFFERS from that tree)"
                if capture["chart_source_matches"] is False
                else " (that commit is unknown to this checkout)"
            )
            if capture.get("deployed_chart_source")
            else ""
        )
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

    add("## Workloads and image digests")
    add("")
    add(
        "`running digest` is the digest the pod actually runs. `registry digest` is what "
        "the registry serves for the same tag at capture time."
    )
    add("")
    add(
        "| workload | container | image | running digest | registry index digest | "
        "registry amd64 child | status |"
    )
    add("|---|---|---|---|---|---|---|")
    for row in data["images"]:
        add(
            f"| `{cell(row['workload'])}` | {cell(row['container'])} | `{cell(row['image'])}` | "
            f"`{cell(row['running_digest'])}` | {cell(row['registry_digest'])} | "
            f"{cell(row['registry_child_digest'])} | {row['status']} |"
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
            f"| {row['role']} | {cell(row['chart_default'])} | {cell(row['declared'])} | "
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
        add("| variable | chart default | overlay | deployed | status |")
        add("|---|---|---|---|---|")
        for row in workload["rows"]:
            add(
                f"| `{cell(row['env'])}` | {cell(row['source_value'])} | "
                f"{cell(row['overlay_value'])} | {cell(row['deployed'])} | {row['status']} |"
            )
        add("")
        compared = sum(1 for row in workload["rows"] if row["status"] != "TEMPLATE")
        templated = sum(1 for row in workload["rows"] if row["status"] == "TEMPLATE")
        add(
            f"Compared against a chart value: {compared}; rendered by the template "
            f"(literal or helper): {templated}."
        )
        add("")
        if workload["undeclared"]:
            add(
                "Carried by the deployment and not compared against the chart source: "
                + ", ".join(f"`{name}`" for name, _value in workload["undeclared"])
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
            if row.get("source_path"):
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
                    "registry_digest": "",
                    "registry_child_digest": "",
                    "status": "NOT RUNNING",
                    "_image": container["image"],
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
                "workload": f"{pod['pod']} (no workload owns this pod)",
                "container": pod["container"],
                "image": pod["image"],
                "running_digest": pod["digest"],
                "registry_digest": "",
                "registry_child_digest": "",
                "status": "NOT RUNNING",
                "_image": pod["image"],
            }
        )
    return images


def resolve_registry_digests(images):
    """Resolve the registry digests of every tagged image and compare."""
    differences = 0
    for row in images:
        digest, child, note = None, "", ""
        try:
            digest, child, note = registry_digest(row["_image"])
        except Exception as error:  # noqa: BLE001 - reported, never fatal
            digest, child, note = None, "", f"unresolved ({error})"
        if digest:
            row["registry_digest"] = digest
            row["registry_child_digest"] = child or "single manifest"
            running = row["running_digest"]
            same = digest in running or running.endswith(digest)
            row["status"] = "MATCH" if same else "DIFFERENT"
            if not same:
                differences += 1
        else:
            row["registry_digest"] = note or "not applicable"
            row["registry_child_digest"] = ""
            row["status"] = "NOT COMPARABLE"
        del row["_image"]
    return differences


def build_models(env_by_component, effective_values, served):
    """The models table: what the chart declares, what the cluster pins, what answers."""
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
        chart_default = normalize(get_path(effective_values, path))
        if observed.get("error"):
            status = "NOT PROBED"
        elif served_id == "unknown":
            status = "UNKNOWN"
        elif not values_equal(chart_default, served_id):
            status = "DIFFERENT"
        elif declared and not values_equal(declared, served_id):
            status = "DIFFERENT"
        else:
            status = "MATCH"
        models.append(
            {
                "role": role,
                "chart_default": chart_default,
                "chart_default_path": path,
                "declared": declared or "(no workload pins this model)",
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
    image_differences = resolve_registry_digests(images)

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

    env_by_component = {}
    for workload in workloads:
        for container in workload["containers"]:
            env_by_component.setdefault(workload["component"], {}).update(container["env"])

    config = []
    discrepancies = []
    for workload in workloads:
        rows, undeclared = compare_workload(
            workload, env_maps, chart_values, overlay_values, effective_values
        )
        for row in rows:
            if row["status"] == "DIFFERENT":
                disposition = disposition_for(row)
                discrepancies.append(
                    discrepancy_row(workload["name"], row, disposition)
                )
            elif row["status"] == "NOT CARRIED":
                discrepancies.append(
                    discrepancy_row(
                        workload["name"], row, DISPOSITIONS["not-carried"]
                    )
                )
        if rows:
            config.append(
                {"workload": workload["name"], "rows": rows, "undeclared": undeclared}
            )

    served = capture_models(namespace, env_by_component)
    models = build_models(env_by_component, effective_values, served)

    # A served model that differs from the source is a difference between
    # the deployment and the source: it belongs in the discrepancy table
    # and in the exit gate.
    for model in models:
        if model["status"] != "DIFFERENT":
            continue
        discrepancies.append(
            {
                "workload": f"({model['role']} model)",
                "env": "model id",
                "source_value": model["chart_default"],
                "source_path": model["chart_default_path"],
                "deployed": model["served"],
                "disposition": "**UNRESOLVED**",
            }
        )

    # The chart source this capture compares against must be the chart the
    # deployment runs: otherwise the record describes what the repository
    # would deploy, not what serves traffic.
    deployed_chart_version = release_info["chart"].get("version", "")
    local_version = local_chart_version()
    source_ref = release_info["chart"].get("sourceRef", {})
    deployed_source = deployed_chart_source(flux_namespace, source_ref)
    tree_matches = chart_source_matches(deployed_source)
    if tree_matches is False:
        discrepancies.append(
            {
                "workload": "(chart source)",
                "env": "chart source",
                "source_value": f"the local chart tree ({local_version})",
                "source_path": "charts/",
                "deployed": f"the chart the deployment was rendered from ({deployed_source})",
                "disposition": DISPOSITIONS["chart-version"],
            }
        )

    image_discrepancies = [
        {
            "workload": row["workload"],
            "env": "image digest",
            "source_value": f"registry `{image_tag(row['image'])}` = {row['registry_digest']}",
            "deployed": f"running {row['running_digest']}",
            "disposition": DISPOSITIONS["image-digest"],
        }
        for row in images
        if row["status"] == "DIFFERENT"
    ]

    edge = ", ".join(
        f"{service['name']} ({service['type']} {service['ports']})"
        for service in topology["services"]
        if service["type"] in ("LoadBalancer", "NodePort")
    )

    return {
        "capture": {
            "date": date,
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
            "chart_version": deployed_chart_version,
            "local_chart_version": local_version,
            "deployed_chart_source": deployed_source,
            "chart_source_matches": tree_matches,
            "overlay_name": release_info["overlay_name"],
            "release_health": (
                f"{release_info['ready']} - {release_info['status']}"
                if release_info["status"]
                else "unknown"
            ),
            "command": (
                "uv run --no-cache --with pyyaml python "
                f"scripts/baseline/capture-deployed-baseline.py --namespace {namespace} "
                f"--out {_display_path(out_path)}"
            ),
        },
        "images": images,
        "models": models,
        "config": config,
        "discrepancies": image_discrepancies + discrepancies,
        "image_disposition_note": (
            f"{image_differences} of {len(images)} workload images run a digest that "
            "differs from the registry tag."
        ),
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
