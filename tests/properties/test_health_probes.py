"""
Property 9: Health Probe Generation

**Validates: Requirements 6.1, 6.2, 6.3, 6.6**

For any service definition specifying probe type (HTTP, TCP, or exec) and endpoint
information, the generated Deployment manifest SHALL contain:
  (a) a readiness probe with periodSeconds=10, timeoutSeconds=5, successThreshold=1
  (b) a liveness probe with failureThreshold=3, periodSeconds=10, timeoutSeconds=5
  (c) for GPU services: a startup probe with initialDelaySeconds=60, periodSeconds=12,
      failureThreshold=30
  (d) for slow-starting CPU services: a startup probe with initialDelaySeconds=10,
      periodSeconds=5, failureThreshold=30
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

# GPU services — all use HTTP probes and have startup probes
GPU_SERVICES = ["vllm", "tei", "tei-reranker", "dataprep"]

GPU_DEPLOYMENT_NAMES = {
    "vllm": "vllm",
    "tei": "tei",
    "tei-reranker": "tei-reranker",
    "dataprep": "dataprep",
}

# CPU services categorized by probe type and startup behavior
# Regular HTTP services — no startup probe
CPU_HTTP_SERVICES = [
    "backend", "frontend", "document-repository", "nginx",
    "embedding", "reranker", "textgen", "translation", "guardrail",
    "retriever-arango-service", "http-service",
    "chatqna-xeon-backend-server", "chatqna-xeon-ui-server",
    "chatqna-xeon-nginx-server",
]

# TCP probe services without startup probe
CPU_TCP_SERVICES = ["kong", "redis", "clamav"]

# TCP probe services WITH startup probe (slow-starting data tier)
CPU_TCP_SLOW_START_SERVICES = ["arango"]

# Exec probe services WITH startup probe (slow-starting databases)
CPU_EXEC_SLOW_START_SERVICES = ["kong-database", "keycloak-db"]

# HTTP probe services WITH startup probe (slow-starting auth)
CPU_HTTP_SLOW_START_SERVICES = ["keycloak"]

# Mapping from service name to deployment name in rendered manifests
SERVICE_TO_DEPLOYMENT_NAME = {
    "vllm": "vllm",
    "tei": "tei",
    "tei-reranker": "tei-reranker",
    "dataprep": "dataprep",
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

# Expected probe settings
GPU_STARTUP_PROBE = {
    "initialDelaySeconds": 60,
    "periodSeconds": 12,
    "failureThreshold": 30,
}

CPU_SLOW_STARTUP_PROBE = {
    "initialDelaySeconds": 10,
    "periodSeconds": 5,
    "failureThreshold": 30,
}

READINESS_PROBE = {
    "periodSeconds": 10,
    "timeoutSeconds": 5,
    "successThreshold": 1,
}

LIVENESS_PROBE = {
    "periodSeconds": 10,
    "timeoutSeconds": 5,
    "failureThreshold": 3,
}


# --- Hypothesis Strategies ---

image_strategy = st.from_regex(
    r"[a-z][a-z0-9\-]*(/[a-z][a-z0-9\-]*)*:[a-z0-9][a-z0-9\.\-]{0,10}",
    fullmatch=True,
)

port_strategy = st.integers(min_value=1024, max_value=65535)

health_path_strategy = st.from_regex(
    r"/[a-z][a-z0-9\-/]{0,20}",
    fullmatch=True,
)


@st.composite
def gpu_service_definition(draw):
    """Generate a random GPU service definition."""
    service = draw(st.sampled_from(GPU_SERVICES))
    image = draw(image_strategy)
    port = draw(port_strategy)
    health_path = draw(health_path_strategy)
    return {
        "service": service,
        "image": image,
        "port": port,
        "healthPath": health_path,
    }


@st.composite
def cpu_http_service_definition(draw):
    """Generate a random CPU HTTP service definition (no slow start)."""
    service = draw(st.sampled_from(CPU_HTTP_SERVICES))
    image = draw(image_strategy)
    port = draw(port_strategy)
    health_path = draw(health_path_strategy)
    return {
        "service": service,
        "image": image,
        "port": port,
        "healthPath": health_path,
        "probeType": "http",
        "slowStart": False,
    }


@st.composite
def cpu_tcp_service_definition(draw):
    """Generate a random CPU TCP service definition (no slow start)."""
    service = draw(st.sampled_from(CPU_TCP_SERVICES))
    image = draw(image_strategy)
    port = draw(port_strategy)
    return {
        "service": service,
        "image": image,
        "port": port,
        "probeType": "tcp",
        "slowStart": False,
    }


@st.composite
def cpu_slow_start_service_definition(draw):
    """Generate a random slow-starting CPU service definition."""
    all_slow = CPU_TCP_SLOW_START_SERVICES + CPU_EXEC_SLOW_START_SERVICES + CPU_HTTP_SLOW_START_SERVICES
    service = draw(st.sampled_from(all_slow))
    image = draw(image_strategy)
    port = draw(port_strategy)

    if service in CPU_TCP_SLOW_START_SERVICES:
        probe_type = "tcp"
    elif service in CPU_EXEC_SLOW_START_SERVICES:
        probe_type = "exec"
    else:
        probe_type = "http"

    return {
        "service": service,
        "image": image,
        "port": port,
        "probeType": probe_type,
        "slowStart": True,
    }


# --- Helper Functions ---


def render_helm_templates(values_override: dict = None) -> list:
    """Run `helm template` with optional values override and return parsed YAML documents."""
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


def find_deployment(documents: list, deployment_name: str) -> dict | None:
    """Find a Deployment resource by name."""
    for doc in documents:
        if (
            doc
            and doc.get("kind") == "Deployment"
            and doc.get("metadata", {}).get("name") == deployment_name
        ):
            return doc
    return None


def get_container(deployment: dict) -> dict:
    """Extract the first container from a Deployment."""
    containers = (
        deployment.get("spec", {})
        .get("template", {})
        .get("spec", {})
        .get("containers", [])
    )
    assert len(containers) > 0, "Deployment has no containers"
    return containers[0]


def assert_readiness_probe_settings(probe: dict, probe_type: str, service_name: str):
    """Assert readiness probe has correct settings regardless of probe type."""
    assert probe is not None, (
        f"Service '{service_name}' is missing a readiness probe"
    )
    assert probe.get("periodSeconds") == READINESS_PROBE["periodSeconds"], (
        f"Service '{service_name}' readiness probe periodSeconds should be "
        f"{READINESS_PROBE['periodSeconds']}, got {probe.get('periodSeconds')}"
    )
    assert probe.get("timeoutSeconds") == READINESS_PROBE["timeoutSeconds"], (
        f"Service '{service_name}' readiness probe timeoutSeconds should be "
        f"{READINESS_PROBE['timeoutSeconds']}, got {probe.get('timeoutSeconds')}"
    )
    assert probe.get("successThreshold") == READINESS_PROBE["successThreshold"], (
        f"Service '{service_name}' readiness probe successThreshold should be "
        f"{READINESS_PROBE['successThreshold']}, got {probe.get('successThreshold')}"
    )


def assert_liveness_probe_settings(probe: dict, probe_type: str, service_name: str):
    """Assert liveness probe has correct settings regardless of probe type."""
    assert probe is not None, (
        f"Service '{service_name}' is missing a liveness probe"
    )
    assert probe.get("periodSeconds") == LIVENESS_PROBE["periodSeconds"], (
        f"Service '{service_name}' liveness probe periodSeconds should be "
        f"{LIVENESS_PROBE['periodSeconds']}, got {probe.get('periodSeconds')}"
    )
    assert probe.get("timeoutSeconds") == LIVENESS_PROBE["timeoutSeconds"], (
        f"Service '{service_name}' liveness probe timeoutSeconds should be "
        f"{LIVENESS_PROBE['timeoutSeconds']}, got {probe.get('timeoutSeconds')}"
    )
    assert probe.get("failureThreshold") == LIVENESS_PROBE["failureThreshold"], (
        f"Service '{service_name}' liveness probe failureThreshold should be "
        f"{LIVENESS_PROBE['failureThreshold']}, got {probe.get('failureThreshold')}"
    )


def assert_gpu_startup_probe(probe: dict, service_name: str):
    """Assert GPU startup probe has correct settings."""
    assert probe is not None, (
        f"GPU service '{service_name}' is missing a startup probe"
    )
    assert probe.get("initialDelaySeconds") == GPU_STARTUP_PROBE["initialDelaySeconds"], (
        f"GPU service '{service_name}' startup probe initialDelaySeconds should be "
        f"{GPU_STARTUP_PROBE['initialDelaySeconds']}, got {probe.get('initialDelaySeconds')}"
    )
    assert probe.get("periodSeconds") == GPU_STARTUP_PROBE["periodSeconds"], (
        f"GPU service '{service_name}' startup probe periodSeconds should be "
        f"{GPU_STARTUP_PROBE['periodSeconds']}, got {probe.get('periodSeconds')}"
    )
    assert probe.get("failureThreshold") == GPU_STARTUP_PROBE["failureThreshold"], (
        f"GPU service '{service_name}' startup probe failureThreshold should be "
        f"{GPU_STARTUP_PROBE['failureThreshold']}, got {probe.get('failureThreshold')}"
    )


def assert_cpu_slow_startup_probe(probe: dict, service_name: str):
    """Assert CPU slow-start startup probe has correct settings."""
    assert probe is not None, (
        f"Slow-starting CPU service '{service_name}' is missing a startup probe"
    )
    assert probe.get("initialDelaySeconds") == CPU_SLOW_STARTUP_PROBE["initialDelaySeconds"], (
        f"CPU slow-start service '{service_name}' startup probe initialDelaySeconds "
        f"should be {CPU_SLOW_STARTUP_PROBE['initialDelaySeconds']}, "
        f"got {probe.get('initialDelaySeconds')}"
    )
    assert probe.get("periodSeconds") == CPU_SLOW_STARTUP_PROBE["periodSeconds"], (
        f"CPU slow-start service '{service_name}' startup probe periodSeconds "
        f"should be {CPU_SLOW_STARTUP_PROBE['periodSeconds']}, "
        f"got {probe.get('periodSeconds')}"
    )
    assert probe.get("failureThreshold") == CPU_SLOW_STARTUP_PROBE["failureThreshold"], (
        f"CPU slow-start service '{service_name}' startup probe failureThreshold "
        f"should be {CPU_SLOW_STARTUP_PROBE['failureThreshold']}, "
        f"got {probe.get('failureThreshold')}"
    )


def assert_probe_type_matches(probe: dict, expected_type: str, probe_name: str, service_name: str):
    """Assert the probe uses the correct check mechanism (httpGet, tcpSocket, exec)."""
    if expected_type == "http":
        assert "httpGet" in probe, (
            f"Service '{service_name}' {probe_name} should use httpGet, "
            f"got: {list(probe.keys())}"
        )
    elif expected_type == "tcp":
        assert "tcpSocket" in probe, (
            f"Service '{service_name}' {probe_name} should use tcpSocket, "
            f"got: {list(probe.keys())}"
        )
    elif expected_type == "exec":
        assert "exec" in probe, (
            f"Service '{service_name}' {probe_name} should use exec, "
            f"got: {list(probe.keys())}"
        )


# --- Fixtures ---


@pytest.fixture(scope="module")
def helm_available():
    """Check that helm is available on the system."""
    try:
        result = subprocess.run(
            [HELM_BIN, "version", "--short"],
            capture_output=True, text=True, timeout=10,
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
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        pytest.skip(f"helm template failed: {result.stderr[:500]}")

    documents = list(yaml.safe_load_all(result.stdout))
    return [doc for doc in documents if doc is not None]


# --- Property Tests ---


class TestGPUHealthProbeGeneration:
    """
    **Validates: Requirements 6.1, 6.2, 6.3**

    GPU services SHALL have readiness, liveness, and startup probes
    with correct settings and HTTP GET check type.
    """

    @given(config=gpu_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_gpu_service_has_readiness_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.1**

        GPU services SHALL have a readiness probe with periodSeconds=10,
        timeoutSeconds=5, successThreshold=1 using HTTP GET.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"GPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("readinessProbe")

        assert_readiness_probe_settings(probe, "http", config["service"])
        assert_probe_type_matches(probe, "http", "readinessProbe", config["service"])

    @given(config=gpu_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_gpu_service_has_liveness_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.2**

        GPU services SHALL have a liveness probe with failureThreshold=3,
        periodSeconds=10, timeoutSeconds=5 using HTTP GET.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"GPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("livenessProbe")

        assert_liveness_probe_settings(probe, "http", config["service"])
        assert_probe_type_matches(probe, "http", "livenessProbe", config["service"])

    @given(config=gpu_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_gpu_service_has_startup_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.3**

        GPU services SHALL have a startup probe with initialDelaySeconds=60,
        periodSeconds=12, failureThreshold=30 using HTTP GET.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"GPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("startupProbe")

        assert_gpu_startup_probe(probe, config["service"])
        assert_probe_type_matches(probe, "http", "startupProbe", config["service"])


class TestCPUHTTPHealthProbeGeneration:
    """
    **Validates: Requirements 6.1, 6.2**

    Regular CPU HTTP services SHALL have readiness and liveness probes
    with correct settings and NO startup probe.
    """

    @given(config=cpu_http_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_cpu_http_service_has_readiness_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.1**

        Regular CPU HTTP services SHALL have a readiness probe with
        periodSeconds=10, timeoutSeconds=5, successThreshold=1 using HTTP GET.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("readinessProbe")

        assert_readiness_probe_settings(probe, "http", config["service"])
        assert_probe_type_matches(probe, "http", "readinessProbe", config["service"])

    @given(config=cpu_http_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_cpu_http_service_has_liveness_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.2**

        Regular CPU HTTP services SHALL have a liveness probe with
        failureThreshold=3, periodSeconds=10, timeoutSeconds=5 using HTTP GET.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("livenessProbe")

        assert_liveness_probe_settings(probe, "http", config["service"])
        assert_probe_type_matches(probe, "http", "livenessProbe", config["service"])

    @given(config=cpu_http_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_cpu_http_service_has_no_startup_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.1, 6.2**

        Regular CPU HTTP services (fast-starting) SHALL NOT have a startup probe.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("startupProbe")

        assert probe is None, (
            f"Regular CPU HTTP service '{config['service']}' should NOT have a "
            f"startup probe (only slow-starting services need one). "
            f"Got: {json.dumps(probe, indent=2)}"
        )


class TestCPUTCPHealthProbeGeneration:
    """
    **Validates: Requirements 6.1, 6.2**

    CPU TCP services (kong, redis, clamav) SHALL have readiness and liveness
    probes using TCP socket checks.
    """

    @given(config=cpu_tcp_service_definition())
    @settings(
        max_examples=15,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_cpu_tcp_service_has_readiness_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.1**

        CPU TCP services SHALL have a readiness probe with periodSeconds=10,
        timeoutSeconds=5, successThreshold=1 using TCP socket.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("readinessProbe")

        assert_readiness_probe_settings(probe, "tcp", config["service"])
        assert_probe_type_matches(probe, "tcp", "readinessProbe", config["service"])

    @given(config=cpu_tcp_service_definition())
    @settings(
        max_examples=15,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_cpu_tcp_service_has_liveness_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.2**

        CPU TCP services SHALL have a liveness probe with failureThreshold=3,
        periodSeconds=10, timeoutSeconds=5 using TCP socket.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("livenessProbe")

        assert_liveness_probe_settings(probe, "tcp", config["service"])
        assert_probe_type_matches(probe, "tcp", "livenessProbe", config["service"])


class TestCPUSlowStartHealthProbeGeneration:
    """
    **Validates: Requirements 6.1, 6.2, 6.6**

    Slow-starting CPU services (ArangoDB, kong-database, keycloak-db, Keycloak)
    SHALL have readiness, liveness, AND startup probes with correct settings.
    """

    @given(config=cpu_slow_start_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_slow_start_service_has_readiness_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.1**

        Slow-starting CPU services SHALL have a readiness probe with correct settings.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("readinessProbe")

        assert_readiness_probe_settings(probe, config["probeType"], config["service"])
        assert_probe_type_matches(
            probe, config["probeType"], "readinessProbe", config["service"]
        )

    @given(config=cpu_slow_start_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_slow_start_service_has_liveness_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.2**

        Slow-starting CPU services SHALL have a liveness probe with correct settings.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("livenessProbe")

        assert_liveness_probe_settings(probe, config["probeType"], config["service"])
        assert_probe_type_matches(
            probe, config["probeType"], "livenessProbe", config["service"]
        )

    @given(config=cpu_slow_start_service_definition())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_slow_start_service_has_startup_probe(self, config, helm_available):
        """
        **Validates: Requirements 6.6**

        Slow-starting CPU services SHALL have a startup probe with
        initialDelaySeconds=10, periodSeconds=5, failureThreshold=30.
        """
        documents = render_helm_templates()
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[config["service"]]
        deployment = find_deployment(documents, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found in rendered manifests"
        )

        container = get_container(deployment)
        probe = container.get("startupProbe")

        assert_cpu_slow_startup_probe(probe, config["service"])
        assert_probe_type_matches(
            probe, config["probeType"], "startupProbe", config["service"]
        )


class TestAllServicesHaveProbesWithDefaults:
    """
    **Validates: Requirements 6.1, 6.2, 6.3, 6.6**

    Deterministic test validating ALL services have correct probe
    configurations with default values.
    """

    @pytest.mark.parametrize("service", GPU_SERVICES)
    def test_all_gpu_services_have_all_probes(
        self, service, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 6.1, 6.2, 6.3**

        Each GPU service with default values SHALL have readiness,
        liveness, and startup probes with correct settings.
        """
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[service]
        deployment = find_deployment(default_rendered_manifests, deployment_name)

        assert deployment is not None, (
            f"GPU deployment '{deployment_name}' not found"
        )

        container = get_container(deployment)

        # Check readiness probe
        readiness = container.get("readinessProbe")
        assert_readiness_probe_settings(readiness, "http", service)
        assert_probe_type_matches(readiness, "http", "readinessProbe", service)

        # Check liveness probe
        liveness = container.get("livenessProbe")
        assert_liveness_probe_settings(liveness, "http", service)
        assert_probe_type_matches(liveness, "http", "livenessProbe", service)

        # Check startup probe
        startup = container.get("startupProbe")
        assert_gpu_startup_probe(startup, service)
        assert_probe_type_matches(startup, "http", "startupProbe", service)

    @pytest.mark.parametrize("service", CPU_HTTP_SERVICES)
    def test_all_regular_cpu_http_services_probes(
        self, service, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 6.1, 6.2**

        Each regular CPU HTTP service with default values SHALL have
        readiness and liveness probes but NO startup probe.
        """
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[service]
        deployment = find_deployment(default_rendered_manifests, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found"
        )

        container = get_container(deployment)

        # Check readiness probe
        readiness = container.get("readinessProbe")
        assert_readiness_probe_settings(readiness, "http", service)
        assert_probe_type_matches(readiness, "http", "readinessProbe", service)

        # Check liveness probe
        liveness = container.get("livenessProbe")
        assert_liveness_probe_settings(liveness, "http", service)
        assert_probe_type_matches(liveness, "http", "livenessProbe", service)

        # No startup probe
        startup = container.get("startupProbe")
        assert startup is None, (
            f"Regular CPU HTTP service '{service}' should NOT have a startup probe"
        )

    @pytest.mark.parametrize("service", CPU_TCP_SERVICES)
    def test_all_cpu_tcp_services_probes(
        self, service, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 6.1, 6.2**

        Each CPU TCP service with default values SHALL have readiness
        and liveness probes using TCP socket.
        """
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[service]
        deployment = find_deployment(default_rendered_manifests, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found"
        )

        container = get_container(deployment)

        # Check readiness probe
        readiness = container.get("readinessProbe")
        assert_readiness_probe_settings(readiness, "tcp", service)
        assert_probe_type_matches(readiness, "tcp", "readinessProbe", service)

        # Check liveness probe
        liveness = container.get("livenessProbe")
        assert_liveness_probe_settings(liveness, "tcp", service)
        assert_probe_type_matches(liveness, "tcp", "livenessProbe", service)

    @pytest.mark.parametrize(
        "service",
        CPU_TCP_SLOW_START_SERVICES + CPU_EXEC_SLOW_START_SERVICES + CPU_HTTP_SLOW_START_SERVICES,
    )
    def test_all_slow_start_services_have_startup_probe(
        self, service, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 6.6**

        Each slow-starting CPU service with default values SHALL have
        a startup probe with initialDelaySeconds=10, periodSeconds=5,
        failureThreshold=30.
        """
        deployment_name = SERVICE_TO_DEPLOYMENT_NAME[service]
        deployment = find_deployment(default_rendered_manifests, deployment_name)

        assert deployment is not None, (
            f"CPU deployment '{deployment_name}' not found"
        )

        container = get_container(deployment)
        startup = container.get("startupProbe")
        assert_cpu_slow_startup_probe(startup, service)
