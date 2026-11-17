#!/usr/bin/env python3
"""Capture the deployed stack baseline (V03) and reconcile it with the source baseline.

Story 1.2 of the agentic-foundations PRD (issue #1948). The record this script
renders is the reference E01 (Epic 4) measures against: it must describe the
system that actually serves traffic, not the one the repository assumes.

Read-only. The script creates, patches and deletes nothing on the cluster, and
never writes a secret into the record.

Usage:
    python3 scripts/baseline/capture-deployed-baseline.py \
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
# declares the workload's environment.
OPEA_WORKLOADS = {
    "chatqna": ("chatqna.yaml", "chatqna"),
    "retriever": ("retriever.yaml", "retriever"),
    "dataprep": ("dataprep.yaml", "dataprep"),
    "embedding": ("embedding.yaml", "embedding"),
    "reranker": ("reranker.yaml", "reranker"),
    "translation": ("translation.yaml", "translation"),
}

# The template variables that address a values section, and the chart path
# each one means. The templates are the only place where "which values key
# becomes which environment variable" is written down, so they are parsed
# rather than guessed.
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

# Model ids are compared wherever they are declared: the OPEA tier, the
# backend's translation wiring, the OKF server's judge. Each entry maps the
# environment variable to the chart path that declares it.
MODEL_VARIABLES = {
    "EMBEDDING_MODEL_ID": "opea.embedding.modelId",
    "LLM_MODEL": "opea.models.llm.modelId",
    "VLLM_MODEL_ID": "opea.models.llm.modelId",
    "RAGAS_JUDGE_MODEL": "opea.models.llm.modelId",
    "VLLM_TRANSLATION_MODEL_ID": "opea.translation.modelId",
    "LLM_MODEL_ID": "opea.translation.modelId",
    "RAGAS_EMBED_MODEL": "opea.embedding.modelId",
}

# Kubernetes injects the service-discovery variables into every pod; they
# are not configuration and are not part of the source baseline.
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
        "against. The divergence is the known containerd stale-pull behaviour of the "
        "venue-update mechanism (a rollout restart alone does not re-pull a mutable "
        "tag). Updating the running stack is the venue update procedure, outside this "
        "story."
    ),
    "kc-realm": (
        "By design - the chart leaves the realm empty in this section; the template "
        "falls back to data.keycloak.realm."
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
    """Compare values as the deployment carries them (strings) against the chart."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def is_injected(env_name):
    return any(pattern.search(env_name) for pattern in INJECTED_PATTERNS)


# --------------------------------------------------------------------------
# source baseline
# --------------------------------------------------------------------------


def parse_template_env(template_file):
    """Return {env name: chart path or None} for one chart template.

    The path is None when the template renders a literal or a helper call -
    both are recorded as "declared by the template, not by a values leaf".
    """
    text = open(os.path.join(CHART_TEMPLATES, template_file), encoding="utf-8").read()
    mapping = {}

    # Service-factory style: (dict "name" "ENV" "value" <expr>)
    for match in re.finditer(r'\(dict "name" "([A-Z0-9_]+)" "value" (.*)', text):
        mapping.setdefault(match.group(1), _expression_to_path(match.group(2)))

    # Hand-rendered style: - name: ENV / [comment lines] / value: {{ <expr> }}
    for match in re.finditer(
        r"- name: ([A-Z0-9_]+)\n(?:\s*#.*\n)*\s*value: \{\{-?\s*(.*?)\s*\}\}", text
    ):
        mapping.setdefault(match.group(1), _expression_to_path(match.group(2)))

    return mapping


def _expression_to_path(expression):
    """Resolve a template value expression to the chart values path it reads."""
    for pattern in (
        r"index \(index \(\$opea \| default dict\) \"([a-z]+)\"[^)]*\) \"([A-Za-z0-9]+)\"",
        r"index \(index \(\$opeaModels \| default dict\) \"([a-z]+)\"[^)]*\) \"([A-Za-z0-9]+)\"",
    ):
        found = re.search(pattern, expression)
        if found:
            prefix = "opea" if "opeaModels" not in pattern else "opea.models"
            return f"{prefix}.{found.group(1)}.{found.group(2)}"

    found = re.search(r"index \(\$opea\.([a-z]+) \| default dict\) \"([A-Za-z0-9]+)\"", expression)
    if found:
        return f"opea.{found.group(1)}.{found.group(2)}"

    found = re.search(r"\$([A-Za-z][A-Za-z0-9]*)\.([A-Za-z0-9]+)", expression)
    if found and found.group(1) in SECTION_VARS:
        return f"opea.{SECTION_VARS[found.group(1)]}.{found.group(2)}"

    return None


def template_env_maps():
    """{workload component: {env name: chart path or None}} for every OPEA workload."""
    return {
        component: parse_template_env(template_file)
        for component, (template_file, _section) in OPEA_WORKLOADS.items()
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
            pod_spec = spec["template"]["spec"]
            containers = []
            for container in pod_spec.get("containers", []):
                env = container_env(container)
                containers.append(
                    {
                        "name": container["name"],
                        "image": container.get("image", ""),
                        "env": env,
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
        for container in status.get("containerStatuses", []):
            pods.append(
                {
                    "pod": meta["name"],
                    "labels": meta.get("labels", {}),
                    "container": container.get("name", ""),
                    "image": container.get("image", ""),
                    "digest": container.get("imageID", ""),
                    "ready": container.get("ready", False),
                    "restarts": container.get("restartCount", 0),
                    "phase": status.get("phase", ""),
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
    overlay = {}
    overlay_name = ""
    for source in spec.get("valuesFrom", []):
        name = source.get("name")
        if not name:
            continue
        overlay_name = name
        configmap = kubectl_json(flux_namespace, "get", "configmap", name)
        raw = configmap.get("data", {}).get("values.yaml")
        if raw:
            overlay = deep_merge(overlay, yaml.safe_load(raw) or {})
    return {
        "chart": spec.get("chart", {}).get("spec", {}),
        "revision": revision,
        "overlay": overlay,
        "overlay_name": overlay_name,
        "status": status.get("conditions", [{}])[0].get("message", ""),
    }


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
    """The digest the registry currently serves for a tagged image.

    Returns (digest, note). The note explains why nothing could be resolved.
    """
    reference = image.split("@")[0]
    parts = reference.rsplit(":", 1)
    if len(parts) != 2 or "/" not in parts[0]:
        return None, "pinned by digest or not a tagged image"
    repository, tag = parts
    registry_host = repository.split("/")[0]
    if not registry_host.startswith("registry."):
        return None, "outside the GitLab registry"
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
        return response.headers.get("Docker-Content-Digest"), ""


def http_json(url, api_key=None, timeout=30, insecure=False):
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    context = None
    if insecure:
        # The GPU node serves a certificate signed by an internal CA the
        # pods' trust store does not carry; the deployment declares
        # OPEA_SSL_SKIP_VERIFY=1 and drops NODE_TLS_REJECT_UNAUTHORIZED for
        # the same reason. The capture mirrors the deployment's own posture.
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
    """The model ids the GPU node actually serves."""
    api_key = cluster_secret(namespace, "vllm-api-key", "VLLM_API_KEY")

    def env_for(component):
        return env_by_component.get(component, {})

    def endpoint_for(component, *names):
        env = env_for(component)
        for name in names:
            if env.get(name):
                return env[name]
        return None

    # Mirror the deployment's TLS posture: the GPU node serves a certificate
    # signed by an internal CA, and the deployment itself skips verification
    # (OPEA_SSL_SKIP_VERIFY=1, NODE_TLS_REJECT_UNAUTHORIZED=0).
    insecure = any(
        env.get("OPEA_SSL_SKIP_VERIFY") == "1"
        for env in env_by_component.values()
    )

    probes = {
        "embedding": (endpoint_for("retriever", "TEI_EMBEDDING_ENDPOINT"), "tei"),
        "reranker": (endpoint_for("reranker", "TEI_RERANKING_ENDPOINT"), "tei"),
        "llm": (endpoint_for("chatqna", "VLLM_LLM_ENDPOINT"), "openai"),
        "translation": (endpoint_for("chatqna", "VLLM_TRANSLATION_ENDPOINT"), "openai"),
    }

    served = {}
    for role, (endpoint, flavour) in probes.items():
        if not endpoint:
            served[role] = {"error": "no endpoint declared in the deployment"}
            continue
        base = endpoint.rstrip("/")
        try:
            if flavour == "tei":
                info = http_json(f"{base}/info", api_key, insecure=insecure)
                served[role] = {
                    "model_id": info.get("model_id"),
                    "dtype": info.get("model_dtype"),
                    "max_input_length": info.get("max_input_length"),
                    "server_version": info.get("version"),
                    "commit": info.get("sha"),
                    "endpoint": endpoint,
                }
            else:
                listing = http_json(f"{base}/v1/models", api_key, insecure=insecure)
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


def resolve_source(env_name, section, template_map, effective_values):
    """Resolve one environment variable against the source baseline.

    Returns (chart path, source value, status).
    """
    if section:
        env_path = f"opea.{section}.env.{env_name}"
        env_value = get_path(effective_values, env_path)
        if env_value is not None:
            return env_path, env_value, None

    chart_path = template_map.get(env_name) if template_map else None
    if chart_path:
        source_value = get_path(effective_values, chart_path)
        if source_value is not None:
            return chart_path, source_value, None

    if template_map and env_name in template_map:
        return "", "(template literal or helper)", "TEMPLATE"

    if env_name in MODEL_VARIABLES:
        chart_path = MODEL_VARIABLES[env_name]
        source_value = get_path(effective_values, chart_path)
        if source_value is not None:
            return chart_path, source_value, None

    return "", "", "UNDECLARED"


def carries_relevant_config(workload):
    """Whether a workload's environment is part of the baseline's scope.

    The scope is the retrieval and ingestion configuration (the OPEA tier)
    plus every workload that declares a model id: those are the values the
    acceptance criteria name. The rest of the stack (frontend, ClamAV, the
    mail sink) carries no retrieval configuration and is covered by the
    image-digest and topology tables.
    """
    if workload["component"] in OPEA_WORKLOADS:
        return True
    for container in workload["containers"]:
        if any(name in MODEL_VARIABLES for name in container["env"]):
            return True
    return False


def compare_workload(workload, env_maps, effective_values):
    """Compare the deployed environment with the effective source baseline."""
    component = workload["component"]
    section = OPEA_WORKLOADS.get(component, (None, None))[1]
    template_map = env_maps.get(component, {}) if section else {}

    rows = []
    undeclared = []
    deployed_env = {}
    for container in workload["containers"]:
        deployed_env.update(container["env"])
    for env_name, deployed in sorted(deployed_env.items()):
        if is_injected(env_name):
            continue
        chart_path, source_value, status = resolve_source(
            env_name, section, template_map, effective_values
        )
        if status is None:
            status = (
                "MATCH"
                if normalize(source_value) == normalize(deployed)
                else "DIFFERENT"
            )
        if status == "UNDECLARED":
            undeclared.append((env_name, deployed))
            continue
        rows.append(
            {
                "env": env_name,
                "source_path": chart_path,
                "source_value": normalize(source_value),
                "deployed": deployed,
                "status": status,
            }
        )
    return rows, undeclared


def disposition_for(row, workload_name):
    """The disposition of a difference, or None when the difference is unexplained."""
    if row["status"] != "DIFFERENT":
        return None
    if row["env"] == "KC_REALM":
        return DISPOSITIONS["kc-realm"]
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
    add(f"- **Overlay values:** `{capture['overlay_name']}`")
    add("")
    add("## How to re-run")
    add("")
    add("```bash")
    add(
        "uv run --no-cache --with pyyaml python scripts/baseline/capture-deployed-baseline.py "
        f"--namespace {capture['namespace']}"
    )
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
    add("| workload | container | image | running digest | registry digest | status |")
    add("|---|---|---|---|---|---|")
    for row in data["images"]:
        add(
            f"| `{row['workload']}` | {row['container']} | `{row['image']}` | "
            f"`{row['running_digest']}` | {row['registry_digest']} | {row['status']} |"
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
            f"| {row['role']} | {row['chart_default']} | {row['declared']} | {row['served']} | "
            f"{row['detail']} | {row['status']} |"
        )
    add("")

    add("## Retrieval and ingestion configuration")
    add("")
    add(
        "Compared per workload: the chart default, the overlay override that applies on "
        "top of it, and what the running pod carries. `TEMPLATE` means the chart "
        "template renders the variable from a literal or a helper rather than from a "
        "values leaf."
    )
    add("")
    for workload in data["config"]:
        add(f"### `{workload['workload']}`")
        add("")
        add("| variable | chart default | overlay | deployed | status |")
        add("|---|---|---|---|---|")
        for row in workload["rows"]:
            add(
                f"| `{row['env']}` | {row['source_value']} | {row['overlay_value']} | "
                f"{row['deployed']} | {row['status']} |"
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
                "Carried by the deployment but not declared by the chart source: "
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
            add(
                f"| `{row['workload']}` | `{row['env']}` | {row['source_value']} | "
                f"{row['deployed']} | {row['disposition']} |"
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
        add(f"| `{service['name']}` | {service['type']} | {service['ports']} |")
    add("")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


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
        workloads = capture_workloads(args.namespace)
        pods = capture_pods(args.namespace)
        topology = capture_topology(args.namespace)
        release = capture_release(args.flux_namespace, args.release)
        with open(os.path.join(CHART_DIR, "values.yaml"), encoding="utf-8") as handle:
            chart_values = yaml.safe_load(handle)
    except Exception as error:  # noqa: BLE001 - the failure must name itself
        sys.exit(f"capture failed: {error}")

    effective_values = deep_merge(chart_values, release["overlay"])
    env_maps = template_env_maps()

    # ---- images -------------------------------------------------------
    images = []
    image_differences = 0
    image_discrepancies = []
    for workload in workloads:
        for container in workload["containers"]:
            running = next(
                (
                    pod
                    for pod in pods
                    if pod["digest"]
                    and pod["container"] == container["name"]
                    and all(
                        pod["labels"].get(key) == value
                        for key, value in workload["selector"].items()
                    )
                ),
                None,
            )
            running_digest = running["digest"] if running else ""
            registry_digest_value = ""
            status = "NOT RUNNING"
            if running_digest:
                try:
                    digest, note = registry_digest(container["image"])
                except Exception as error:  # noqa: BLE001 - reported, never fatal
                    digest, note = None, f"unresolved ({error})"
                if digest:
                    registry_digest_value = digest
                    same = digest in running_digest or running_digest.endswith(digest)
                    status = "MATCH" if same else "DIFFERENT"
                    if not same:
                        image_differences += 1
                        image_discrepancies.append(
                            {
                                "workload": workload["name"],
                                "env": "image digest",
                                "source_value": f"registry `{image_tag(container['image'])}` = {digest}",
                                "deployed": f"running {running_digest}",
                                "disposition": DISPOSITIONS["image-digest"],
                            }
                        )
                else:
                    registry_digest_value = note
                    status = "NOT COMPARABLE"
            images.append(
                {
                    "workload": workload["name"],
                    "container": container["name"],
                    "image": container["image"],
                    "running_digest": running_digest or "not running",
                    "registry_digest": registry_digest_value or "not applicable",
                    "status": status,
                }
            )

    # ---- configuration ------------------------------------------------
    env_by_component = {}
    for workload in workloads:
        if workload["containers"]:
            env_by_component.setdefault(workload["component"], {}).update(
                workload["containers"][0]["env"]
            )

    config = []
    discrepancies = []
    for workload in workloads:
        if not carries_relevant_config(workload):
            continue
        rows, undeclared = compare_workload(workload, env_maps, effective_values)
        for row in rows:
            row["overlay_value"] = (
                normalize(get_path(release["overlay"], row["source_path"]))
                if row["source_path"]
                else ""
            )
            if row["status"] == "DIFFERENT":
                disposition = disposition_for(row, workload["name"])
                discrepancies.append(
                    {
                        "workload": workload["name"],
                        "env": row["env"],
                        "source_value": row["source_value"],
                        "deployed": row["deployed"],
                        "disposition": disposition or "**UNRESOLVED**",
                    }
                )
        config.append(
            {"workload": workload["name"], "rows": rows, "undeclared": undeclared}
        )

    # ---- models -------------------------------------------------------
    served = capture_models(args.namespace, env_by_component)
    models = []
    for role, path in (
        ("embedding", "opea.embedding.modelId"),
        ("reranker", "opea.models.reranker.modelId"),
        ("llm", "opea.models.llm.modelId"),
        ("translation", "opea.translation.modelId"),
    ):
        declared = ""
        for workload in workloads:
            for container in workload["containers"]:
                for env_name, chart_path in MODEL_VARIABLES.items():
                    if chart_path == path and env_name in container["env"]:
                        declared = container["env"][env_name]
                        break
                if declared:
                    break
            if declared:
                break
        observed = served.get(role, {})
        served_id = observed.get("model_id") or observed.get("error") or "unknown"
        detail = ", ".join(
            f"{key}={observed[key]}"
            for key in ("dtype", "max_input_length", "max_model_len", "server_version", "server")
            if observed.get(key) is not None
        )
        status = "MATCH"
        if observed.get("error"):
            status = "NOT PROBED"
        elif declared and served_id != "unknown" and declared != served_id:
            status = "DIFFERENT"
        models.append(
            {
                "role": role,
                "chart_default": normalize(get_path(effective_values, path)),
                "declared": declared or "(not declared in the cluster)",
                "served": served_id,
                "detail": detail,
                "status": status,
            }
        )

    # ---- topology -----------------------------------------------------
    edge = ", ".join(
        f"{service['name']} ({service['type']} {service['ports']})"
        for service in topology["services"]
        if service["type"] in ("LoadBalancer", "NodePort")
    )
    external = ", ".join(
        sorted(
            {
                value
                for workload in workloads
                for container in workload["containers"]
                for key, value in container["env"].items()
                if key.endswith("_ENDPOINT") and value.startswith("http")
            }
        )
    )

    data = {
        "capture": {
            "date": args.date,
            "timestamp": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "cluster": run(
                ["kubectl", "config", "view", "-o", "jsonpath={.clusters[0].cluster.server}"]
            ).strip(),
            "namespace": args.namespace,
            "release": args.release,
            "release_revision": release["revision"],
            "chart_name": release["chart"].get("chart", ""),
            "chart_version": release["chart"].get("version", ""),
            "overlay_name": release["overlay_name"],
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
            "external": external or "(none)",
        },
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(render_markdown(data))
    print(f"record written: {out_path}")

    unresolved = [
        row for row in discrepancies if row["disposition"] == "**UNRESOLVED**"
    ]
    if unresolved:
        for row in unresolved:
            print(f"UNRESOLVED: {row['workload']} {row['env']}", file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
