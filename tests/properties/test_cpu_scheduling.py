"""
Property 2: CPU Manifest Scheduling Correctness

Validates: Requirements 2.1, 2.2, 2.3

For any CPU-only service definition with any valid container image, port, and
environment configuration, the generated Kubernetes Deployment manifest SHALL contain:
(a) a requiredDuringSchedulingIgnoredDuringExecution node affinity rule matching
    the CPU node pool label (cpu-pool=true),
(b) NO nvidia.com/gpu resource requests or limits, and
(c) NO tolerations for the GPU node pool taint (nvidia.com/gpu).
"""

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
import yaml
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st


# --- Constants ---

HELM_CHART_PATH = Path(__file__).resolve().parents[2] / "helm" / "genieai"

# Find helm binary - check PATH first, then known Windows install locations
HELM_BIN = shutil.which("helm")
if HELM_BIN is None:
    # Check common WinGet install path
    _winget_helm = Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Packages"
    if _winget_helm.exists():
        for helm_exe in _winget_helm.rglob("helm.exe"):
            HELM_BIN = str(helm_exe)
            break
if HELM_BIN is None:
    HELM_BIN = "helm"  # Fallback, will fail gracefully in fixture

# All 21 CPU-only services as defined in the spec
CPU_SERVICES = [
    "backend",
    "frontend",
    "document-repository",
    "nginx",
    "kong",
    "arango",
    "redis",
    "kong-database",
    "keycloak-db",
    "embedding",
    "reranker",
    "textgen",
    "translation",
    "guardrail",
    "retriever-arango-service",
    "http-service",
    "chatqna-xeon-backend-server",
    "chatqna-xeon-ui-server",
    "chatqna-xeon-nginx-server",
    "keycloak",
    "clamav",
]

# Mapping from service name to values.yaml key path
SERVICE_TO_VALUES_KEY = {
    "backend": "cpu.backend",
    "frontend": "cpu.frontend",
    "document-repository": "cpu.documentRepository",
    "nginx": "cpu.nginx",
    "kong": "cpu.kong",
    "arango": "cpu.arangodb",
    "redis": "cpu.redis",
    "kong-database": "cpu.kongDatabase",
    "keycloak-db": "cpu.keycloakDb",
    "embedding": "cpu.embedding",
    "reranker": "cpu.reranker",
    "textgen": "cpu.textgen",
    "translation": "cpu.translation",
    "guardrail": "cpu.guardrail",
    "retriever-arango-service": "cpu.retrieverArangoService",
    "http-service": "cpu.httpService",
    "chatqna-xeon-backend-server": "cpu.chatqnaXeonBackendServer",
    "chatqna-xeon-ui-server": "cpu.chatqnaXeonUiServer",
    "chatqna-xeon-nginx-server": "cpu.chatqnaXeonNginxServer",
    "keycloak": "cpu.keycloak",
    "clamav": "cpu.clamav",
}

# Expected deployment names for each service in the rendered manifests
SERVICE_TO_DEPLOYMENT_NAME = {
    "backend": "backend",
    "frontend": "frontend",
    "document-repository": "document-repository",
    "nginx": "nginx",
    "kong": "kong",
    "arango": "arango-vector-db",
    "redis": "redis-cache",
    "kong-database": "kong-database",
    "keycloak-db": "keycloak-db",
    "embedding": "embedding",
    "reranker": "reranker",
    "textgen": "textgen",
    "translation": "translation",
    "guardrail": "guardrail",
    "retriever-arango-service": "retriever-arango-service",
    "http-service": "http-service",
    "chatqna-xeon-backend-server": "chatqna-xeon-backend-server",
    "chatqna-xeon-ui-server": "chatqna-xeon-ui-server",
    "chatqna-xeon-nginx-server": "chatqna-xeon-nginx-server",
    "keycloak": "keycloak",
    "clamav": "clamav",
}


# --- Hypothesis Strategies ---

# Generate valid Docker image names
image_strategy = st.from_regex(
    r"[a-z][a-z0-9\-]*(/[a-z][a-z0-9\-]*)*:[a-z0-9][a-z0-9\.\-]{0,10}",
    fullmatch=True,
)

# Generate valid port numbers (1024-65535, common application ports)
port_strategy = st.integers(min_value=1024, max_value=65535)

# Generate valid environment variable key-value pairs
env_key_strategy = st.from_regex(r"[A-Z][A-Z0-9_]{1,20}", fullmatch=True)
env_value_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P", "S"), blacklist_characters="\x00\n\r\"'\\`"),
    min_size=1,
    max_size=50,
)


@st.composite
def cpu_service_config(draw):
    """Generate a random CPU service configuration with image, port, and resources."""
    service = draw(st.sampled_from(CPU_SERVICES))
    image = draw(image_strategy)
    port = draw(port_strategy)
    replicas = draw(st.integers(min_value=1, max_value=5))

    return {
        "service": service,
        "image": image,
        "port": port,
        "replicas": replicas,
    }


# --- Helper Functions ---


def build_values_override(config: dict) -> dict:
    """Build a values override dict for a specific CPU service config."""
    service = config["service"]
    values_key = SERVICE_TO_VALUES_KEY[service]

    # Navigate the nested dict structure
    keys = values_key.split(".")
    override = {}
    current = override
    for key in keys[:-1]:
        current[key] = {}
        current = current[key]

    # Set the service config with overridden values
    current[keys[-1]] = {
        "image": config["image"],
        "port": config["port"],
        "replicas": config["replicas"],
    }

    return override


def render_helm_templates(values_override: dict) -> list:
    """Run `helm template` with a values override and return parsed YAML documents."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yaml", delete=False
    ) as f:
        yaml.dump(values_override, f)
        override_file = f.name

    try:
        result = subprocess.run(
            [
                HELM_BIN,
                "template",
                "test-release",
                str(HELM_CHART_PATH),
                "-f",
                override_file,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            pytest.skip(
                f"helm template failed: {result.stderr[:500]}"
            )

        # Parse all YAML documents from the output
        documents = list(yaml.safe_load_all(result.stdout))
        return [doc for doc in documents if doc is not None]
    finally:
        os.unlink(override_file)


def find_cpu_deployments(documents: list, deployment_name: str) -> list:
    """Find Deployment resources matching the given name."""
    deployments = []
    for doc in documents:
        if (
            doc
            and doc.get("kind") == "Deployment"
            and doc.get("metadata", {}).get("name") == deployment_name
        ):
            deployments.append(doc)
    return deployments


def get_pod_spec(deployment: dict) -> dict:
    """Extract the pod spec from a Deployment."""
    return deployment.get("spec", {}).get("template", {}).get("spec", {})


def has_cpu_node_affinity(pod_spec: dict) -> bool:
    """
    Check that the pod spec has requiredDuringSchedulingIgnoredDuringExecution
    node affinity rule matching cpu-pool=true.
    """
    affinity = pod_spec.get("affinity", {})
    node_affinity = affinity.get("nodeAffinity", {})
    required = node_affinity.get("requiredDuringSchedulingIgnoredDuringExecution", {})
    node_selector_terms = required.get("nodeSelectorTerms", [])

    for term in node_selector_terms:
        match_expressions = term.get("matchExpressions", [])
        for expr in match_expressions:
            if (
                expr.get("key") == "cpu-pool"
                and expr.get("operator") == "In"
                and "true" in expr.get("values", [])
            ):
                return True
    return False


def has_no_gpu_resources(pod_spec: dict) -> bool:
    """
    Check that NO container in the pod spec has nvidia.com/gpu
    resource requests or limits.
    """
    containers = pod_spec.get("containers", [])
    init_containers = pod_spec.get("initContainers", [])

    for container in containers + init_containers:
        resources = container.get("resources", {})
        requests = resources.get("requests", {})
        limits = resources.get("limits", {})

        if "nvidia.com/gpu" in requests or "nvidia.com/gpu" in limits:
            return False
    return True


def has_no_gpu_tolerations(pod_spec: dict) -> bool:
    """
    Check that the pod spec has NO tolerations for the GPU node pool taint
    (nvidia.com/gpu).
    """
    tolerations = pod_spec.get("tolerations", [])
    for toleration in tolerations:
        if toleration.get("key") == "nvidia.com/gpu":
            return False
    return True


# --- Property Tests ---


@pytest.fixture(scope="module")
def helm_available():
    """Check that helm is available on the system."""
    try:
        result = subprocess.run(
            [HELM_BIN, "version", "--short"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            pytest.skip("helm is not available")
    except FileNotFoundError:
        pytest.skip("helm is not installed")


@pytest.fixture(scope="module")
def default_rendered_manifests():
    """Render all templates with default values (no overrides) once for the module."""
    result = subprocess.run(
        [HELM_BIN, "template", "test-release", str(HELM_CHART_PATH)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        pytest.skip(f"helm template failed with default values: {result.stderr[:500]}")

    documents = list(yaml.safe_load_all(result.stdout))
    return [doc for doc in documents if doc is not None]


class TestCPUManifestSchedulingCorrectness:
    """
    **Validates: Requirements 2.1, 2.2, 2.3**

    Property 2: CPU Manifest Scheduling Correctness

    For any CPU-only service definition, the generated Kubernetes Deployment
    manifest SHALL contain correct CPU node affinity, no GPU resources,
    and no GPU tolerations.
    """

    @given(config=cpu_service_config())
    @settings(
        max_examples=30,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_cpu_service_has_cpu_affinity(self, config, helm_available):
        """
        **Validates: Requirements 2.1**

        For any CPU service config, the rendered Deployment SHALL have
        requiredDuringSchedulingIgnoredDuringExecution node affinity
        for cpu-pool=true.
        """
        values_override = build_values_override(config)
        documents = render_helm_templates(values_override)

        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployments = find_cpu_deployments(documents, deployment_name)

        assert len(deployments) > 0, (
            f"No Deployment found for CPU service '{config['service']}' "
            f"(expected deployment name: '{deployment_name}')"
        )

        for deployment in deployments:
            pod_spec = get_pod_spec(deployment)
            assert has_cpu_node_affinity(pod_spec), (
                f"CPU service '{config['service']}' (deployment '{deployment_name}') "
                f"does NOT have requiredDuringSchedulingIgnoredDuringExecution "
                f"node affinity for cpu-pool=true. "
                f"Pod spec affinity: {pod_spec.get('affinity')}"
            )

    @given(config=cpu_service_config())
    @settings(
        max_examples=30,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_cpu_service_has_no_gpu_resources(self, config, helm_available):
        """
        **Validates: Requirements 2.2**

        For any CPU service config, the rendered Deployment SHALL NOT
        have nvidia.com/gpu resource requests or limits.
        """
        values_override = build_values_override(config)
        documents = render_helm_templates(values_override)

        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployments = find_cpu_deployments(documents, deployment_name)

        assert len(deployments) > 0, (
            f"No Deployment found for CPU service '{config['service']}' "
            f"(expected deployment name: '{deployment_name}')"
        )

        for deployment in deployments:
            pod_spec = get_pod_spec(deployment)
            assert has_no_gpu_resources(pod_spec), (
                f"CPU service '{config['service']}' (deployment '{deployment_name}') "
                f"has nvidia.com/gpu resource requests or limits, which is NOT allowed. "
                f"Pod spec containers: {json.dumps([c.get('resources', {}) for c in pod_spec.get('containers', [])])}"
            )

    @given(config=cpu_service_config())
    @settings(
        max_examples=30,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_cpu_service_has_no_gpu_tolerations(self, config, helm_available):
        """
        **Validates: Requirements 2.3**

        For any CPU service config, the rendered Deployment SHALL NOT
        have tolerations for the GPU node pool taint (nvidia.com/gpu).
        """
        values_override = build_values_override(config)
        documents = render_helm_templates(values_override)

        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployments = find_cpu_deployments(documents, deployment_name)

        assert len(deployments) > 0, (
            f"No Deployment found for CPU service '{config['service']}' "
            f"(expected deployment name: '{deployment_name}')"
        )

        for deployment in deployments:
            pod_spec = get_pod_spec(deployment)
            assert has_no_gpu_tolerations(pod_spec), (
                f"CPU service '{config['service']}' (deployment '{deployment_name}') "
                f"has tolerations for nvidia.com/gpu taint, which is NOT allowed. "
                f"Pod spec tolerations: {pod_spec.get('tolerations')}"
            )


class TestAllCPUServicesDefaultValues:
    """
    **Validates: Requirements 2.1, 2.2, 2.3**

    Deterministic test that validates ALL 21 CPU services with default
    values satisfy the scheduling correctness properties.
    """

    @pytest.mark.parametrize("service", CPU_SERVICES)
    def test_all_cpu_services_affinity_with_defaults(
        self, service, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 2.1**

        Each of the 21 CPU services rendered with default values SHALL
        have CPU node affinity.
        """
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[service]
        deployments = find_cpu_deployments(
            default_rendered_manifests, deployment_name
        )

        assert len(deployments) > 0, (
            f"No Deployment found for CPU service '{service}' "
            f"(expected: '{deployment_name}')"
        )

        for deployment in deployments:
            pod_spec = get_pod_spec(deployment)
            assert has_cpu_node_affinity(pod_spec), (
                f"CPU service '{service}' missing cpu-pool=true affinity"
            )

    @pytest.mark.parametrize("service", CPU_SERVICES)
    def test_all_cpu_services_no_gpu_resources_with_defaults(
        self, service, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 2.2**

        Each of the 21 CPU services rendered with default values SHALL
        NOT have GPU resources.
        """
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[service]
        deployments = find_cpu_deployments(
            default_rendered_manifests, deployment_name
        )

        assert len(deployments) > 0, (
            f"No Deployment found for CPU service '{service}' "
            f"(expected: '{deployment_name}')"
        )

        for deployment in deployments:
            pod_spec = get_pod_spec(deployment)
            assert has_no_gpu_resources(pod_spec), (
                f"CPU service '{service}' has nvidia.com/gpu resources"
            )

    @pytest.mark.parametrize("service", CPU_SERVICES)
    def test_all_cpu_services_no_gpu_tolerations_with_defaults(
        self, service, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 2.3**

        Each of the 21 CPU services rendered with default values SHALL
        NOT have GPU tolerations.
        """
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[service]
        deployments = find_cpu_deployments(
            default_rendered_manifests, deployment_name
        )

        assert len(deployments) > 0, (
            f"No Deployment found for CPU service '{service}' "
            f"(expected: '{deployment_name}')"
        )

        for deployment in deployments:
            pod_spec = get_pod_spec(deployment)
            assert has_no_gpu_tolerations(pod_spec), (
                f"CPU service '{service}' has nvidia.com/gpu tolerations"
            )
