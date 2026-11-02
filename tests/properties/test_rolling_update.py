"""
Property 10: Rolling Update Strategy

**Validates: Requirements 8.3**

For any generated Deployment manifest (GPU or CPU), the strategy field SHALL specify
type: RollingUpdate with maxUnavailable: 0 and maxSurge: 1, ensuring zero-downtime updates.
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

# GPU services
GPU_SERVICES = ["vllm", "tei", "tei-reranker", "dataprep"]

# CPU services - deployment names as they appear in rendered manifests
CPU_DEPLOYMENT_NAMES = [
    "backend",
    "frontend",
    "document-repository",
    "nginx",
    "kong",
    "arango-vector-db",
    "redis-cache",
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
    "health-monitor",
]

ALL_DEPLOYMENT_NAMES = GPU_SERVICES + CPU_DEPLOYMENT_NAMES


# --- Hypothesis Strategies ---

# Generate valid Docker image names
image_strategy = st.from_regex(
    r"[a-z][a-z0-9\-]*(/[a-z][a-z0-9\-]*)*:[a-z0-9][a-z0-9\.\-]{0,10}",
    fullmatch=True,
)

# Generate valid container ports
port_strategy = st.integers(min_value=1024, max_value=65535)

# Generate replica counts
replicas_strategy = st.integers(min_value=1, max_value=5)


@st.composite
def deployment_config(draw):
    """Generate random deployment configurations for GPU and CPU services."""
    # Randomize GPU service configs
    gpu_vllm_image = draw(image_strategy)
    gpu_vllm_port = draw(port_strategy)
    gpu_tei_image = draw(image_strategy)
    gpu_tei_port = draw(port_strategy)
    gpu_tei_reranker_image = draw(image_strategy)
    gpu_tei_reranker_port = draw(port_strategy)
    gpu_dataprep_image = draw(image_strategy)
    gpu_dataprep_port = draw(port_strategy)

    # Randomize a subset of CPU service configs
    cpu_backend_replicas = draw(replicas_strategy)
    cpu_frontend_replicas = draw(replicas_strategy)
    cpu_embedding_replicas = draw(replicas_strategy)

    return {
        "gpu": {
            "vllm": {"image": gpu_vllm_image, "port": gpu_vllm_port},
            "tei": {"image": gpu_tei_image, "port": gpu_tei_port},
            "teiReranker": {"image": gpu_tei_reranker_image, "port": gpu_tei_reranker_port},
            "dataprep": {"image": gpu_dataprep_image, "port": gpu_dataprep_port},
        },
        "cpu": {
            "backend": {"replicas": cpu_backend_replicas},
            "frontend": {"replicas": cpu_frontend_replicas},
            "embedding": {"replicas": cpu_embedding_replicas},
        },
    }


# --- Helper Functions ---


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
            return []

        documents = list(yaml.safe_load_all(result.stdout))
        return [doc for doc in documents if doc is not None]
    finally:
        os.unlink(override_file)


def get_all_deployments(documents: list) -> list:
    """Extract all Deployment resources from rendered documents."""
    return [
        doc for doc in documents
        if doc.get("kind") == "Deployment"
    ]


def check_rolling_update_strategy(deployment: dict) -> tuple[bool, str]:
    """
    Verify deployment has strategy type RollingUpdate with maxUnavailable=0, maxSurge=1.

    Returns (success, error_message).
    """
    name = deployment.get("metadata", {}).get("name", "unknown")
    spec = deployment.get("spec", {})
    strategy = spec.get("strategy", {})

    # Check strategy type
    strategy_type = strategy.get("type")
    if strategy_type != "RollingUpdate":
        return False, (
            f"Deployment '{name}' has strategy.type='{strategy_type}', "
            f"expected 'RollingUpdate'"
        )

    rolling_update = strategy.get("rollingUpdate", {})

    # Check maxUnavailable
    max_unavailable = rolling_update.get("maxUnavailable")
    if str(max_unavailable) != "0":
        return False, (
            f"Deployment '{name}' has maxUnavailable={max_unavailable}, "
            f"expected 0"
        )

    # Check maxSurge
    max_surge = rolling_update.get("maxSurge")
    if str(max_surge) != "1":
        return False, (
            f"Deployment '{name}' has maxSurge={max_surge}, "
            f"expected 1"
        )

    return True, ""


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


class TestRollingUpdateStrategy:
    """
    **Validates: Requirements 8.3**

    Property 10: Rolling Update Strategy

    For any generated Deployment manifest (GPU or CPU), the strategy field SHALL
    specify type: RollingUpdate with maxUnavailable: 0 and maxSurge: 1,
    ensuring zero-downtime updates.
    """

    @given(config=deployment_config())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_rolling_update_strategy_with_random_configs(self, config, helm_available):
        """
        **Validates: Requirements 8.3**

        For any random GPU/CPU service configuration (varying images, ports,
        replicas), ALL generated Deployments SHALL have RollingUpdate strategy
        with maxUnavailable=0 and maxSurge=1.
        """
        values_override = {
            "gpu": {
                "vllm": {
                    "image": config["gpu"]["vllm"]["image"],
                    "port": config["gpu"]["vllm"]["port"],
                    "replicas": 1,
                    "healthPath": "/health",
                    "resources": {
                        "requests": {"cpu": "2", "memory": "16Gi", "nvidia.com/gpu": "1"},
                        "limits": {"cpu": "4", "memory": "32Gi", "nvidia.com/gpu": "1"},
                    },
                    "env": {"model": "test-model", "maxModelLen": "8192", "gpuMemoryUtilization": "0.9", "dtype": "float16", "trustRemoteCode": "true"},
                },
                "tei": {
                    "image": config["gpu"]["tei"]["image"],
                    "port": config["gpu"]["tei"]["port"],
                    "replicas": 1,
                    "healthPath": "/health",
                    "resources": {
                        "requests": {"cpu": "1", "memory": "4Gi", "nvidia.com/gpu": "1"},
                        "limits": {"cpu": "2", "memory": "8Gi", "nvidia.com/gpu": "1"},
                    },
                    "env": {"model": "BAAI/bge-base-en-v1.5", "maxBatchRequests": "64"},
                },
                "teiReranker": {
                    "image": config["gpu"]["teiReranker"]["image"],
                    "port": config["gpu"]["teiReranker"]["port"],
                    "replicas": 1,
                    "healthPath": "/health",
                    "resources": {
                        "requests": {"cpu": "1", "memory": "4Gi", "nvidia.com/gpu": "1"},
                        "limits": {"cpu": "2", "memory": "8Gi", "nvidia.com/gpu": "1"},
                    },
                    "env": {"model": "BAAI/bge-reranker-base"},
                },
                "dataprep": {
                    "image": config["gpu"]["dataprep"]["image"],
                    "port": config["gpu"]["dataprep"]["port"],
                    "replicas": 1,
                    "healthPath": "/v1/health",
                    "resources": {
                        "requests": {"cpu": "2", "memory": "8Gi", "nvidia.com/gpu": "1"},
                        "limits": {"cpu": "4", "memory": "16Gi", "nvidia.com/gpu": "1"},
                    },
                },
            },
            "cpu": {
                "backend": {"replicas": config["cpu"]["backend"]["replicas"]},
                "frontend": {"replicas": config["cpu"]["frontend"]["replicas"]},
                "embedding": {"replicas": config["cpu"]["embedding"]["replicas"]},
            },
        }

        documents = render_helm_templates(values_override)
        assume(len(documents) > 0)

        deployments = get_all_deployments(documents)
        assert len(deployments) > 0, "No Deployments found in rendered templates"

        # Validate every single Deployment has the correct rolling update strategy
        for deployment in deployments:
            success, error_msg = check_rolling_update_strategy(deployment)
            assert success, (
                f"{error_msg}\n"
                f"Full strategy: {json.dumps(deployment.get('spec', {}).get('strategy'), indent=2)}"
            )

    def test_all_deployments_have_rolling_update_with_defaults(
        self, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 8.3**

        With default values, ALL rendered Deployments SHALL have
        RollingUpdate strategy with maxUnavailable=0 and maxSurge=1.
        """
        deployments = get_all_deployments(default_rendered_manifests)
        assert len(deployments) > 0, "No Deployments found in rendered templates"

        for deployment in deployments:
            success, error_msg = check_rolling_update_strategy(deployment)
            assert success, (
                f"{error_msg}\n"
                f"Full strategy: {json.dumps(deployment.get('spec', {}).get('strategy'), indent=2)}"
            )

    @pytest.mark.parametrize("deployment_name", ALL_DEPLOYMENT_NAMES)
    def test_each_deployment_has_rolling_update(
        self, deployment_name, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 8.3**

        Each individual Deployment (GPU and CPU) rendered with default
        values SHALL have RollingUpdate strategy with correct parameters.
        """
        deployments = [
            doc for doc in default_rendered_manifests
            if doc.get("kind") == "Deployment"
            and doc.get("metadata", {}).get("name") == deployment_name
        ]

        assert len(deployments) > 0, (
            f"No Deployment found with name '{deployment_name}'"
        )

        for deployment in deployments:
            success, error_msg = check_rolling_update_strategy(deployment)
            assert success, (
                f"{error_msg}\n"
                f"Full strategy: {json.dumps(deployment.get('spec', {}).get('strategy'), indent=2)}"
            )
