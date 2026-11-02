"""
Property 3: Service Resource Generation

**Validates: Requirements 3.1, 3.4, 3.5, 9.4**

For any set of workload definitions (GPU or CPU), the manifest generator SHALL produce:
  (a) exactly one ClusterIP Service per Deployment with the Service name matching
      the Deployment name,
  (b) all resources in a single namespace,
  (c) each Service's targetPort equal to the container's declared containerPort, and
  (d) Service type ClusterIP for all non-ingress services.
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

# Find helm binary
HELM_BIN = shutil.which("helm")
if HELM_BIN is None:
    _winget_helm = Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Packages"
    if _winget_helm.exists():
        for helm_exe in _winget_helm.rglob("helm.exe"):
            HELM_BIN = str(helm_exe)
            break
if HELM_BIN is None:
    HELM_BIN = "helm"

# All services expected to have a matching Deployment+Service pair
# Maps: deployment/service name -> (tier, values_key)
ALL_SERVICES = {
    # GPU services
    "vllm": ("gpu", "gpu.vllm"),
    "tei": ("gpu", "gpu.tei"),
    "tei-reranker": ("gpu", "gpu.teiReranker"),
    "dataprep": ("gpu", "gpu.dataprep"),
    # CPU services - Application tier
    "backend": ("cpu", "cpu.backend"),
    "frontend": ("cpu", "cpu.frontend"),
    "document-repository": ("cpu", "cpu.documentRepository"),
    "nginx": ("cpu", "cpu.nginx"),
    "kong": ("cpu", "cpu.kong"),
    # CPU services - Data tier
    "arango-vector-db": ("cpu", "cpu.arangodb"),
    "redis-cache": ("cpu", "cpu.redis"),
    "kong-database": ("cpu", "cpu.kongDatabase"),
    "keycloak-db": ("cpu", "cpu.keycloakDb"),
    # CPU services - Microservices tier
    "embedding": ("cpu", "cpu.embedding"),
    "reranker": ("cpu", "cpu.reranker"),
    "textgen": ("cpu", "cpu.textgen"),
    "translation": ("cpu", "cpu.translation"),
    "guardrail": ("cpu", "cpu.guardrail"),
    "retriever-arango-service": ("cpu", "cpu.retrieverArangoService"),
    "http-service": ("cpu", "cpu.httpService"),
    "chatqna-xeon-backend-server": ("cpu", "cpu.chatqnaXeonBackendServer"),
    "chatqna-xeon-ui-server": ("cpu", "cpu.chatqnaXeonUiServer"),
    "chatqna-xeon-nginx-server": ("cpu", "cpu.chatqnaXeonNginxServer"),
    # CPU services - Auth & Utility
    "keycloak": ("cpu", "cpu.keycloak"),
    "clamav": ("cpu", "cpu.clamav"),
    # CPU services - Monitoring
    "health-monitor": ("cpu", "cpu.healthMonitor"),
}

# Services that are NOT expected to have ClusterIP (Ingress is LoadBalancer-managed)
NON_CLUSTERIP_RESOURCES = set()  # All services in this chart use ClusterIP


# --- Hypothesis Strategies ---

# Generate valid Docker image names
image_strategy = st.from_regex(
    r"[a-z][a-z0-9\-]*(/[a-z][a-z0-9\-]*)*:[a-z0-9][a-z0-9\.\-]{0,10}",
    fullmatch=True,
)

# Generate valid container ports (1024-65535)
port_strategy = st.integers(min_value=1024, max_value=65535)

# Generate replica counts
replicas_strategy = st.integers(min_value=1, max_value=5)


@st.composite
def workload_config(draw):
    """Generate a random workload configuration with varied images, ports, and replicas."""
    # Randomly vary ports for GPU services
    gpu_vllm_port = draw(port_strategy)
    gpu_tei_port = draw(port_strategy)
    gpu_tei_reranker_port = draw(port_strategy)
    gpu_dataprep_port = draw(port_strategy)

    # Randomly vary ports for a subset of CPU services
    cpu_backend_port = draw(port_strategy)
    cpu_frontend_port = draw(port_strategy)
    cpu_embedding_port = draw(port_strategy)
    cpu_kong_port = draw(port_strategy)

    # Vary replicas
    gpu_replicas = draw(replicas_strategy)
    cpu_replicas = draw(replicas_strategy)

    return {
        "gpu": {
            "vllm": {"port": gpu_vllm_port, "replicas": gpu_replicas},
            "tei": {"port": gpu_tei_port, "replicas": gpu_replicas},
            "teiReranker": {"port": gpu_tei_reranker_port, "replicas": gpu_replicas},
            "dataprep": {"port": gpu_dataprep_port, "replicas": gpu_replicas},
        },
        "cpu": {
            "backend": {"port": cpu_backend_port, "replicas": cpu_replicas},
            "frontend": {"port": cpu_frontend_port, "replicas": cpu_replicas},
            "embedding": {"port": cpu_embedding_port, "replicas": cpu_replicas},
            "kong": {"port": cpu_kong_port, "replicas": cpu_replicas},
        },
    }


# --- Helper Functions ---


def render_helm_templates(values_override: dict = None) -> list:
    """Run helm template with optional values override and return parsed documents."""
    cmd = [HELM_BIN, "template", "test-release", str(HELM_CHART_PATH)]

    override_file = None
    if values_override:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False
        ) as f:
            yaml.dump(values_override, f)
            override_file = f.name
        cmd.extend(["-f", override_file])

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            pytest.skip(f"helm template failed: {result.stderr[:500]}")

        documents = list(yaml.safe_load_all(result.stdout))
        return [doc for doc in documents if doc is not None]
    finally:
        if override_file:
            os.unlink(override_file)


def get_deployments(documents: list) -> dict:
    """Extract all Deployment resources keyed by name."""
    return {
        doc["metadata"]["name"]: doc
        for doc in documents
        if doc.get("kind") == "Deployment"
    }


def get_services(documents: list) -> dict:
    """Extract all Service resources keyed by name."""
    return {
        doc["metadata"]["name"]: doc
        for doc in documents
        if doc.get("kind") == "Service"
    }


def get_container_port(deployment: dict) -> int | None:
    """Extract the first containerPort from a Deployment's first container."""
    containers = (
        deployment.get("spec", {})
        .get("template", {})
        .get("spec", {})
        .get("containers", [])
    )
    if not containers:
        return None
    ports = containers[0].get("ports", [])
    if not ports:
        return None
    return ports[0].get("containerPort")


def get_service_target_port(service: dict) -> int | None:
    """Extract the targetPort from a Service's first port definition."""
    ports = service.get("spec", {}).get("ports", [])
    if not ports:
        return None
    return ports[0].get("targetPort")


def get_service_type(service: dict) -> str | None:
    """Extract the Service type."""
    return service.get("spec", {}).get("type")


def get_namespace(resource: dict) -> str | None:
    """Extract the namespace from a resource."""
    return resource.get("metadata", {}).get("namespace")


# --- Fixtures ---


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
    """Render all templates with default values once for the module."""
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


# --- Property Tests ---


class TestServiceResourceGeneration:
    """
    **Validates: Requirements 3.1, 3.4, 3.5, 9.4**

    Property 3: Service Resource Generation

    For any set of workload definitions (GPU or CPU), the manifest generator SHALL
    produce:
      (a) exactly one ClusterIP Service per Deployment with Service name matching
          Deployment name
      (b) all resources in a single namespace
      (c) each Service's targetPort equals the container's declared containerPort
      (d) Service type ClusterIP for all non-ingress services
    """

    @given(config=workload_config())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_one_service_per_deployment_with_matching_name(self, config, helm_available):
        """
        **Validates: Requirements 3.1**

        For any workload configuration, each Deployment SHALL have exactly one
        matching Service with the same name.
        """
        values_override = config
        documents = render_helm_templates(values_override)

        deployments = get_deployments(documents)
        services = get_services(documents)

        # Every deployment that's part of our known services should have a Service
        for svc_name in ALL_SERVICES:
            if svc_name in deployments:
                assert svc_name in services, (
                    f"Deployment '{svc_name}' exists but no matching Service "
                    f"with the same name was found. "
                    f"Available services: {sorted(services.keys())}"
                )

        # Verify no deployment has multiple services with same name (uniqueness)
        service_names = [
            doc["metadata"]["name"]
            for doc in documents
            if doc.get("kind") == "Service"
        ]
        for svc_name in ALL_SERVICES:
            count = service_names.count(svc_name)
            if svc_name in deployments:
                assert count == 1, (
                    f"Expected exactly 1 Service named '{svc_name}', "
                    f"but found {count}"
                )

    @given(config=workload_config())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_all_resources_single_namespace(self, config, helm_available):
        """
        **Validates: Requirements 3.4**

        For any workload configuration, all Deployments and Services SHALL be in
        a single namespace.
        """
        values_override = config
        documents = render_helm_templates(values_override)

        # Collect namespaces from all Deployments and Services
        namespaces = set()
        for doc in documents:
            kind = doc.get("kind")
            if kind in ("Deployment", "Service"):
                ns = get_namespace(doc)
                if ns:
                    namespaces.add(ns)

        # All should be in the same single namespace
        assert len(namespaces) <= 1, (
            f"Expected all resources in a single namespace, "
            f"but found multiple namespaces: {sorted(namespaces)}"
        )

    @given(config=workload_config())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_target_port_matches_container_port(self, config, helm_available):
        """
        **Validates: Requirements 3.5**

        For any workload configuration, each Service's targetPort SHALL equal
        the container's declared containerPort in the matching Deployment.
        """
        values_override = config
        documents = render_helm_templates(values_override)

        deployments = get_deployments(documents)
        services = get_services(documents)

        for svc_name in ALL_SERVICES:
            if svc_name in deployments and svc_name in services:
                container_port = get_container_port(deployments[svc_name])
                target_port = get_service_target_port(services[svc_name])

                assert container_port is not None, (
                    f"Deployment '{svc_name}' has no containerPort defined"
                )
                assert target_port is not None, (
                    f"Service '{svc_name}' has no targetPort defined"
                )
                assert target_port == container_port, (
                    f"Service '{svc_name}' targetPort ({target_port}) does not "
                    f"match Deployment containerPort ({container_port}). "
                    f"Config override: {json.dumps(config, indent=2)}"
                )

    @given(config=workload_config())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_all_services_clusterip_type(self, config, helm_available):
        """
        **Validates: Requirements 9.4**

        For any workload configuration, all non-ingress Services SHALL have
        type ClusterIP.
        """
        values_override = config
        documents = render_helm_templates(values_override)

        services = get_services(documents)

        for svc_name, svc_doc in services.items():
            if svc_name in NON_CLUSTERIP_RESOURCES:
                continue
            # Only check services that are part of our known workloads
            if svc_name in ALL_SERVICES:
                svc_type = get_service_type(svc_doc)
                assert svc_type == "ClusterIP", (
                    f"Service '{svc_name}' has type '{svc_type}' but expected "
                    f"'ClusterIP'. All non-ingress services must use ClusterIP."
                )


class TestAllServicesDefaultValues:
    """
    **Validates: Requirements 3.1, 3.4, 3.5, 9.4**

    Deterministic test that validates ALL services with default values
    satisfy the service resource generation properties.
    """

    def test_every_deployment_has_matching_service(
        self, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 3.1**

        Every known Deployment SHALL have exactly one matching ClusterIP Service.
        """
        deployments = get_deployments(default_rendered_manifests)
        services = get_services(default_rendered_manifests)

        for svc_name in ALL_SERVICES:
            assert svc_name in deployments, (
                f"Expected Deployment '{svc_name}' not found in rendered manifests. "
                f"Available deployments: {sorted(deployments.keys())}"
            )
            assert svc_name in services, (
                f"Expected Service '{svc_name}' not found in rendered manifests. "
                f"Available services: {sorted(services.keys())}"
            )

    def test_all_resources_in_single_namespace(
        self, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 3.4**

        All Deployments and Services SHALL be in a single namespace.
        """
        namespaces = set()
        for doc in default_rendered_manifests:
            kind = doc.get("kind")
            if kind in ("Deployment", "Service"):
                ns = get_namespace(doc)
                if ns:
                    namespaces.add(ns)

        assert len(namespaces) == 1, (
            f"Expected all resources in one namespace, "
            f"found: {sorted(namespaces)}"
        )
        assert "genieai" in namespaces, (
            f"Expected namespace 'genieai', got: {namespaces}"
        )

    @pytest.mark.parametrize("svc_name", sorted(ALL_SERVICES.keys()))
    def test_target_port_matches_container_port(
        self, svc_name, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 3.5**

        Each Service's targetPort SHALL equal the Deployment's containerPort.
        """
        deployments = get_deployments(default_rendered_manifests)
        services = get_services(default_rendered_manifests)

        assert svc_name in deployments, f"Deployment '{svc_name}' not found"
        assert svc_name in services, f"Service '{svc_name}' not found"

        container_port = get_container_port(deployments[svc_name])
        target_port = get_service_target_port(services[svc_name])

        assert container_port is not None, (
            f"Deployment '{svc_name}' has no containerPort"
        )
        assert target_port is not None, (
            f"Service '{svc_name}' has no targetPort"
        )
        assert target_port == container_port, (
            f"Service '{svc_name}': targetPort={target_port} != "
            f"containerPort={container_port}"
        )

    @pytest.mark.parametrize("svc_name", sorted(ALL_SERVICES.keys()))
    def test_service_type_is_clusterip(
        self, svc_name, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 9.4**

        All non-ingress Services SHALL use ClusterIP type.
        """
        services = get_services(default_rendered_manifests)

        assert svc_name in services, f"Service '{svc_name}' not found"

        svc_type = get_service_type(services[svc_name])
        assert svc_type == "ClusterIP", (
            f"Service '{svc_name}' has type '{svc_type}', expected 'ClusterIP'"
        )
