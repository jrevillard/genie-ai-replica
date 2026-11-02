"""
Property-based test: Endpoint DNS Format

**Validates: Requirements 3.2, 3.3**

For any service dependency where a CPU service references a GPU service, or the Dataprep
service references a CPU service, the generated environment variable value SHALL be a valid
URL of the form `http://<service-name>.<namespace>.svc.cluster.local:<port>` where
`<service-name>` matches the target Kubernetes Service name and `<port>` matches the target
service's container port.
"""

import re
from pathlib import Path

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st


# Path to the Helm chart ConfigMap templates
CHART_PATH = Path(__file__).resolve().parents[2] / "helm" / "genieai"
GPU_CONFIGMAP_PATH = CHART_PATH / "templates" / "config" / "configmap-gpu-services.yaml"
CPU_CONFIGMAP_PATH = CHART_PATH / "templates" / "config" / "configmap-cpu-services.yaml"

# Kubernetes DNS URL pattern: http://<service-name>.<namespace>.svc.cluster.local:<port>
DNS_URL_PATTERN = re.compile(
    r"^http://(?P<service>[a-z][a-z0-9\-]*)"
    r"\.(?P<namespace>[a-z][a-z0-9\-]*)"
    r"\.svc\.cluster\.local"
    r":(?P<port>\d+)(?P<path>/.*)?$"
)

# Known service dependency graph from the design doc:
# CPU services referencing GPU services (Requirement 3.2)
CPU_TO_GPU_DEPENDENCIES = {
    "VLLM_ENDPOINT": {"service": "vllm", "port": 8000},
    "TEI_EMBEDDING_ENDPOINT": {"service": "tei", "port": 80},
    "TEI_RERANKING_ENDPOINT": {"service": "tei-reranker", "port": 80},
}

# Dataprep (GPU) referencing CPU services (Requirement 3.3)
DATAPREP_TO_CPU_DEPENDENCIES = {
    "ARANGO_URL": {"service": "arango-vector-db", "port": 8529},
    "EMBEDDING_ENDPOINT": {"service": "embedding", "port": 6000},
    "GUARDRAIL_URL": {"service": "guardrail", "port": 9090},
    "DOCUMENT_REPOSITORY_URL": {"service": "document-repository", "port": 3001},
    "BACKEND_SERVICE_URL": {"service": "backend", "port": 3000},
    "HTTP_SERVICE_URL": {"service": "http-service", "port": 6666},
}

# CPU internal references that also use DNS format
CPU_INTERNAL_DEPENDENCIES = {
    "ARANGO_URL": {"service": "arango-vector-db", "port": 8529},
    "BACKEND_URL": {"service": "backend", "port": 3000},
}


# --- Hypothesis Strategies ---

# Generate valid Kubernetes namespace names (RFC 1123 subdomain)
namespace_strategy = st.from_regex(
    r"[a-z][a-z0-9\-]{0,20}[a-z0-9]",
    fullmatch=True,
).filter(lambda s: "--" not in s and len(s) >= 2)


@st.composite
def service_dependency_graph(draw):
    """Generate a random service dependency graph with namespace."""
    namespace = draw(namespace_strategy)
    return {"namespace": namespace}


def render_configmap_template(template_path: Path, namespace: str) -> dict:
    """
    Parse a Helm ConfigMap template by substituting the namespace Go template
    expression with the given namespace value. Returns the data section as a dict.

    This simulates `helm template` without requiring the helm binary.
    """
    content = template_path.read_text(encoding="utf-8")

    # Replace Helm Go template namespace references:
    # {{ .Values.namespace }} and variants with optional whitespace
    content = re.sub(
        r"\{\{\s*\.Values\.namespace\s*\}\}",
        namespace,
        content,
    )

    # Remove any remaining Helm template directives (labels, includes, etc.)
    # so we can parse the data section cleanly
    lines = content.split("\n")
    data_section = {}
    in_data = False

    for line in lines:
        # Skip Helm template lines
        if "{{" in line and "}}" in line:
            continue

        if line.strip() == "data:":
            in_data = True
            continue

        if in_data:
            # End of data section if we hit a non-indented line
            if line and not line.startswith(" ") and not line.startswith("#"):
                break

            # Parse key: value pairs (YAML format with 2-space indent)
            # Match lines like: '  KEY: "value"' or '  KEY: value'
            match = re.match(r"^\s+([A-Z][A-Z0-9_]*)\s*:\s*(.+)$", line)
            if match:
                key = match.group(1)
                value = match.group(2).strip()
                # Remove surrounding quotes
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                data_section[key] = value

    return data_section


def validate_dns_url(
    url: str, expected_namespace: str, expected_service: str, expected_port: int
) -> tuple[bool, str]:
    """
    Validate a URL matches the Kubernetes DNS format.
    Returns (is_valid, error_message).
    """
    match = DNS_URL_PATTERN.match(url)
    if not match:
        return False, f"URL '{url}' does not match DNS format pattern"

    service = match.group("service")
    namespace = match.group("namespace")
    port = int(match.group("port"))

    errors = []
    if service != expected_service:
        errors.append(
            f"service name '{service}' does not match expected '{expected_service}'"
        )
    if namespace != expected_namespace:
        errors.append(
            f"namespace '{namespace}' does not match expected '{expected_namespace}'"
        )
    if port != expected_port:
        errors.append(
            f"port {port} does not match expected {expected_port}"
        )

    if errors:
        return False, f"URL '{url}' has errors: {'; '.join(errors)}"
    return True, ""


@given(config=service_dependency_graph())
@settings(
    max_examples=50,
    deadline=10000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_endpoint_dns_format(config):
    """
    Property 4: Endpoint DNS Format

    **Validates: Requirements 3.2, 3.3**

    For any service dependency where a CPU service references a GPU service, or the
    Dataprep service references a CPU service, the generated environment variable value
    SHALL be a valid URL of the form:
        http://<service-name>.<namespace>.svc.cluster.local:<port>
    where <service-name> matches the target Kubernetes Service name and <port> matches
    the target service's container port.
    """
    namespace = config["namespace"]

    # Render ConfigMap templates with the random namespace
    gpu_data = render_configmap_template(GPU_CONFIGMAP_PATH, namespace)
    cpu_data = render_configmap_template(CPU_CONFIGMAP_PATH, namespace)

    assert gpu_data, "GPU ConfigMap template rendered no data entries"
    assert cpu_data, "CPU ConfigMap template rendered no data entries"

    errors = []

    # Validate CPU ConfigMap: CPU services referencing GPU services (Req 3.2)
    for env_var, expected in CPU_TO_GPU_DEPENDENCIES.items():
        value = cpu_data.get(env_var)
        if value is None:
            errors.append(
                f"CPU ConfigMap missing env var '{env_var}' "
                f"(expected reference to {expected['service']}:{expected['port']})"
            )
            continue

        is_valid, error_msg = validate_dns_url(
            value, namespace, expected["service"], expected["port"]
        )
        if not is_valid:
            errors.append(f"CPU ConfigMap {env_var}: {error_msg}")

    # Validate GPU ConfigMap: Dataprep referencing CPU services (Req 3.3)
    for env_var, expected in DATAPREP_TO_CPU_DEPENDENCIES.items():
        value = gpu_data.get(env_var)
        if value is None:
            errors.append(
                f"GPU ConfigMap missing env var '{env_var}' "
                f"(expected reference to {expected['service']}:{expected['port']})"
            )
            continue

        is_valid, error_msg = validate_dns_url(
            value, namespace, expected["service"], expected["port"]
        )
        if not is_valid:
            errors.append(f"GPU ConfigMap {env_var}: {error_msg}")

    # Validate CPU ConfigMap: internal CPU service references using DNS format
    for env_var, expected in CPU_INTERNAL_DEPENDENCIES.items():
        value = cpu_data.get(env_var)
        if value is None:
            errors.append(
                f"CPU ConfigMap missing env var '{env_var}' "
                f"(expected reference to {expected['service']}:{expected['port']})"
            )
            continue

        is_valid, error_msg = validate_dns_url(
            value, namespace, expected["service"], expected["port"]
        )
        if not is_valid:
            errors.append(f"CPU ConfigMap {env_var}: {error_msg}")

    assert not errors, (
        f"DNS format validation failed for namespace '{namespace}':\n"
        + "\n".join(f"  - {e}" for e in errors)
    )


@given(config=service_dependency_graph())
@settings(
    max_examples=50,
    deadline=10000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_all_dns_urls_use_correct_namespace(config):
    """
    Property 4 (supplemental): All DNS URLs in ConfigMaps use the configured namespace.

    **Validates: Requirements 3.2, 3.3**

    For any namespace configuration, ALL environment variable values that contain
    Kubernetes DNS URLs must reference the correct namespace.
    """
    namespace = config["namespace"]

    # Render both ConfigMap templates
    gpu_data = render_configmap_template(GPU_CONFIGMAP_PATH, namespace)
    cpu_data = render_configmap_template(CPU_CONFIGMAP_PATH, namespace)

    errors = []

    for cm_name, data in [("gpu-services-config", gpu_data), ("cpu-services-config", cpu_data)]:
        for key, value in data.items():
            if not isinstance(value, str):
                continue

            # Check if the value looks like a DNS URL
            match = DNS_URL_PATTERN.match(value)
            if match:
                found_namespace = match.group("namespace")
                if found_namespace != namespace:
                    errors.append(
                        f"{cm_name}/{key}: DNS URL uses namespace "
                        f"'{found_namespace}' but expected '{namespace}' "
                        f"(full URL: {value})"
                    )

    assert not errors, (
        f"Namespace mismatch in DNS URLs for configured namespace '{namespace}':\n"
        + "\n".join(f"  - {e}" for e in errors)
    )
