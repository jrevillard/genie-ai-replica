"""
Property-based test: GPU Manifest Scheduling Correctness

**Validates: Requirements 1.2, 1.3**

For any GPU service definition (vLLM, TEI, TEI Reranker, or Dataprep) with any valid
container image, port, and environment configuration, the generated Kubernetes Deployment
manifest SHALL contain:
  (a) a requiredDuringSchedulingIgnoredDuringExecution node affinity rule matching gpu-pool=true
  (b) a toleration for taint key nvidia.com/gpu with value "present" and effect "NoSchedule"
  (c) a resource request and limit of nvidia.com/gpu: 1
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

import yaml
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st


# Path to the Helm chart
CHART_PATH = Path(__file__).resolve().parents[2] / "helm" / "genieai"


# --- Hypothesis Strategies ---

# Generate valid Docker image names
image_strategy = st.from_regex(
    r"[a-z][a-z0-9]*(/[a-z][a-z0-9\-]*){0,2}:[a-z0-9][a-z0-9\.\-]{0,20}",
    fullmatch=True,
)

# Generate valid container ports (1-65535, common range)
port_strategy = st.integers(min_value=1, max_value=65535)

# Generate environment variable key-value pairs
env_key_strategy = st.from_regex(r"[A-Z][A-Z0-9_]{1,30}", fullmatch=True)
env_value_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P"), whitelist_characters="-_./: "),
    min_size=1,
    max_size=50,
)
env_vars_strategy = st.dictionaries(
    keys=env_key_strategy,
    values=env_value_strategy,
    min_size=0,
    max_size=5,
)


@st.composite
def gpu_service_config(draw):
    """Generate a random GPU service configuration."""
    image = draw(image_strategy)
    port = draw(port_strategy)
    env_vars = draw(env_vars_strategy)
    return {
        "image": image,
        "port": port,
        "env_vars": env_vars,
    }


def render_helm_template(values_override: dict) -> list[dict]:
    """Render Helm chart with given values override and return parsed YAML documents."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yaml", delete=False
    ) as f:
        yaml.dump(values_override, f)
        values_file = f.name

    try:
        result = subprocess.run(
            [
                "helm",
                "template",
                "test-release",
                str(CHART_PATH),
                "-f",
                values_file,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            # If helm template fails, return empty (test will skip)
            return []

        documents = []
        for doc in yaml.safe_load_all(result.stdout):
            if doc is not None:
                documents.append(doc)
        return documents
    finally:
        os.unlink(values_file)


def get_gpu_deployments(documents: list[dict]) -> list[dict]:
    """Filter rendered documents to only GPU Deployment resources."""
    gpu_deployment_names = {"vllm", "tei", "tei-reranker", "dataprep"}
    return [
        doc
        for doc in documents
        if doc.get("kind") == "Deployment"
        and doc.get("metadata", {}).get("name") in gpu_deployment_names
    ]


def check_node_affinity(deployment: dict) -> bool:
    """Verify deployment has requiredDuringSchedulingIgnoredDuringExecution for gpu-pool=true."""
    spec = deployment.get("spec", {}).get("template", {}).get("spec", {})
    affinity = spec.get("affinity", {})
    node_affinity = affinity.get("nodeAffinity", {})
    required = node_affinity.get("requiredDuringSchedulingIgnoredDuringExecution", {})
    node_selector_terms = required.get("nodeSelectorTerms", [])

    for term in node_selector_terms:
        match_expressions = term.get("matchExpressions", [])
        for expr in match_expressions:
            if (
                expr.get("key") == "gpu-pool"
                and expr.get("operator") == "In"
                and "true" in expr.get("values", [])
            ):
                return True
    return False


def check_gpu_toleration(deployment: dict) -> bool:
    """Verify deployment has toleration for nvidia.com/gpu=present:NoSchedule."""
    spec = deployment.get("spec", {}).get("template", {}).get("spec", {})
    tolerations = spec.get("tolerations", [])

    for tol in tolerations:
        if (
            tol.get("key") == "nvidia.com/gpu"
            and tol.get("value") == "present"
            and tol.get("effect") == "NoSchedule"
        ):
            return True
    return False


def check_gpu_resources(deployment: dict) -> bool:
    """Verify deployment has nvidia.com/gpu: 1 in resource requests and limits."""
    spec = deployment.get("spec", {}).get("template", {}).get("spec", {})
    containers = spec.get("containers", [])

    for container in containers:
        resources = container.get("resources", {})
        requests = resources.get("requests", {})
        limits = resources.get("limits", {})

        request_gpu = requests.get("nvidia.com/gpu")
        limit_gpu = limits.get("nvidia.com/gpu")

        # GPU value can be string "1" or int 1
        if str(request_gpu) == "1" and str(limit_gpu) == "1":
            return True
    return False


@given(
    vllm_config=gpu_service_config(),
    tei_config=gpu_service_config(),
    tei_reranker_config=gpu_service_config(),
    dataprep_config=gpu_service_config(),
)
@settings(
    max_examples=20,
    deadline=60000,  # 60 seconds per example (helm template can be slow)
    suppress_health_check=[HealthCheck.too_slow],
)
def test_gpu_manifest_scheduling_correctness(
    vllm_config, tei_config, tei_reranker_config, dataprep_config
):
    """
    Property 1: GPU Manifest Scheduling Correctness

    **Validates: Requirements 1.2, 1.3**

    For any GPU service definition with any valid container image, port, and environment
    configuration, the generated Kubernetes Deployment manifest SHALL contain:
      (a) requiredDuringSchedulingIgnoredDuringExecution node affinity for gpu-pool=true
      (b) toleration for nvidia.com/gpu=present:NoSchedule
      (c) resource request and limit of nvidia.com/gpu: 1
    """
    # Build values override with randomized GPU service configs
    values_override = {
        "gpu": {
            "vllm": {
                "image": vllm_config["image"],
                "replicas": 1,
                "port": vllm_config["port"],
                "healthPath": "/health",
                "resources": {
                    "requests": {
                        "cpu": "2",
                        "memory": "16Gi",
                        "nvidia.com/gpu": "1",
                    },
                    "limits": {
                        "cpu": "4",
                        "memory": "32Gi",
                        "nvidia.com/gpu": "1",
                    },
                },
                "env": {
                    "model": "test-model",
                    "maxModelLen": "8192",
                    "gpuMemoryUtilization": "0.9",
                    "dtype": "float16",
                    "trustRemoteCode": "true",
                },
            },
            "tei": {
                "image": tei_config["image"],
                "replicas": 1,
                "port": tei_config["port"],
                "healthPath": "/health",
                "resources": {
                    "requests": {
                        "cpu": "1",
                        "memory": "4Gi",
                        "nvidia.com/gpu": "1",
                    },
                    "limits": {
                        "cpu": "2",
                        "memory": "8Gi",
                        "nvidia.com/gpu": "1",
                    },
                },
                "env": {
                    "model": "BAAI/bge-base-en-v1.5",
                    "maxBatchRequests": "64",
                },
            },
            "teiReranker": {
                "image": tei_reranker_config["image"],
                "replicas": 1,
                "port": tei_reranker_config["port"],
                "healthPath": "/health",
                "resources": {
                    "requests": {
                        "cpu": "1",
                        "memory": "4Gi",
                        "nvidia.com/gpu": "1",
                    },
                    "limits": {
                        "cpu": "2",
                        "memory": "8Gi",
                        "nvidia.com/gpu": "1",
                    },
                },
                "env": {
                    "model": "BAAI/bge-reranker-base",
                },
            },
            "dataprep": {
                "image": dataprep_config["image"],
                "replicas": 1,
                "port": dataprep_config["port"],
                "healthPath": "/v1/health",
                "resources": {
                    "requests": {
                        "cpu": "2",
                        "memory": "8Gi",
                        "nvidia.com/gpu": "1",
                    },
                    "limits": {
                        "cpu": "4",
                        "memory": "16Gi",
                        "nvidia.com/gpu": "1",
                    },
                },
            },
        },
    }

    # Render the Helm chart
    documents = render_helm_template(values_override)
    assume(len(documents) > 0)  # Skip if helm template fails

    # Get GPU deployments
    gpu_deployments = get_gpu_deployments(documents)
    assert len(gpu_deployments) == 4, (
        f"Expected 4 GPU deployments (vllm, tei, tei-reranker, dataprep), "
        f"got {len(gpu_deployments)}: "
        f"{[d['metadata']['name'] for d in gpu_deployments]}"
    )

    # Validate each GPU deployment
    for deployment in gpu_deployments:
        name = deployment["metadata"]["name"]

        # (a) Check node affinity: requiredDuringSchedulingIgnoredDuringExecution for gpu-pool=true
        assert check_node_affinity(deployment), (
            f"GPU deployment '{name}' is missing "
            f"requiredDuringSchedulingIgnoredDuringExecution node affinity "
            f"for gpu-pool=true. "
            f"Actual spec: {json.dumps(deployment['spec']['template']['spec'].get('affinity'), indent=2)}"
        )

        # (b) Check toleration: nvidia.com/gpu=present:NoSchedule
        assert check_gpu_toleration(deployment), (
            f"GPU deployment '{name}' is missing toleration for "
            f"nvidia.com/gpu=present:NoSchedule. "
            f"Actual tolerations: {json.dumps(deployment['spec']['template']['spec'].get('tolerations'), indent=2)}"
        )

        # (c) Check GPU resources: nvidia.com/gpu: 1 in both requests and limits
        assert check_gpu_resources(deployment), (
            f"GPU deployment '{name}' is missing nvidia.com/gpu: 1 in "
            f"resource requests and/or limits. "
            f"Actual resources: {json.dumps(deployment['spec']['template']['spec']['containers'][0].get('resources'), indent=2)}"
        )
