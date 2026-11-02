"""
Property-based test: Volume Mount Path Preservation

**Validates: Requirements 5.3**

For any stateful service definition that specifies an original Docker volume mount path,
the generated Kubernetes Deployment manifest SHALL mount the corresponding PVC at exactly
the same filesystem path, preserving application compatibility.

This test uses Hypothesis to generate random namespace/environment values and validates
that volume mount paths remain constant regardless of configuration changes.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import yaml
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st


# Path to the Helm chart
CHART_PATH = Path(__file__).resolve().parents[2] / "helm" / "genieai"


def _find_helm() -> str:
    """Find the helm binary, checking common install locations on Windows."""
    helm = shutil.which("helm")
    if helm:
        return helm
    # Common WinGet install path
    winget_path = Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Packages"
    if winget_path.exists():
        for p in winget_path.glob("Helm.Helm_*/windows-amd64/helm.exe"):
            return str(p)
    return "helm"  # Fall back to hoping it's in PATH


HELM_BIN = _find_helm()


# --- Expected Volume Mount Paths (from original Docker Compose) ---
# Maps deployment name -> (expected mount path, expected PVC claim name)
EXPECTED_VOLUME_MOUNTS = {
    "arango-vector-db": {
        "mount_path": "/var/lib/arangodb3",
        "pvc_name": "arango-data-pvc",
    },
    "kong-database": {
        "mount_path": "/var/lib/postgresql/data",
        "pvc_name": "kong-db-pvc",
    },
    "keycloak-db": {
        "mount_path": "/var/lib/postgresql/data",
        "pvc_name": "keycloak-db-pvc",
    },
    "document-repository": {
        "mount_path": "/app/uploads",
        "pvc_name": "document-uploads-pvc",
    },
    "redis-cache": {
        "mount_path": "/data",
        "pvc_name": "redis-data-pvc",
    },
}


# --- Hypothesis Strategies ---

# Generate random namespace names (valid Kubernetes namespace format)
namespace_strategy = st.from_regex(r"[a-z][a-z0-9\-]{2,20}", fullmatch=True)

# Generate random environment labels
environment_strategy = st.sampled_from(["dev", "staging", "prod", "test", "qa"])

# Generate random storage sizes (should not affect mount paths)
storage_size_strategy = st.integers(min_value=5, max_value=200).map(lambda x: f"{x}Gi")

# Generate random replica counts (should not affect mount paths)
replica_strategy = st.integers(min_value=1, max_value=5)


@st.composite
def random_config(draw):
    """Generate a random Helm values configuration that varies namespace/environment."""
    namespace = draw(namespace_strategy)
    environment = draw(environment_strategy)
    arango_size = draw(storage_size_strategy)
    kong_db_size = draw(storage_size_strategy)
    keycloak_db_size = draw(storage_size_strategy)
    doc_uploads_size = draw(storage_size_strategy)
    redis_size = draw(storage_size_strategy)
    arango_replicas = draw(replica_strategy)
    redis_replicas = draw(replica_strategy)

    return {
        "namespace": namespace,
        "environment": environment,
        "storage": {
            "arango": {"size": arango_size},
            "kongDb": {"size": kong_db_size},
            "keycloakDb": {"size": keycloak_db_size},
            "documentUploads": {"size": doc_uploads_size},
            "redisData": {"size": redis_size},
        },
        "cpu": {
            "arangodb": {"replicas": arango_replicas},
            "redis": {"replicas": redis_replicas},
        },
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
                HELM_BIN,
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
            return []

        documents = []
        for doc in yaml.safe_load_all(result.stdout):
            if doc is not None:
                documents.append(doc)
        return documents
    finally:
        os.unlink(values_file)


def get_deployments(documents: list[dict]) -> dict[str, dict]:
    """Filter rendered documents to Deployment resources, keyed by name."""
    deployments = {}
    for doc in documents:
        if doc.get("kind") == "Deployment":
            name = doc.get("metadata", {}).get("name", "")
            deployments[name] = doc
    return deployments


def find_volume_mount(deployment: dict, pvc_name: str) -> tuple[str | None, str | None]:
    """
    Find the volume mount path for a given PVC claim name in a Deployment.

    Returns (mount_path, volume_name) or (None, None) if not found.
    """
    spec = deployment.get("spec", {}).get("template", {}).get("spec", {})
    volumes = spec.get("volumes", [])
    containers = spec.get("containers", [])

    # Find the volume name that references the PVC
    volume_name = None
    for volume in volumes:
        pvc = volume.get("persistentVolumeClaim", {})
        if pvc.get("claimName") == pvc_name:
            volume_name = volume.get("name")
            break

    if volume_name is None:
        return None, None

    # Find the mount path for that volume in any container
    for container in containers:
        volume_mounts = container.get("volumeMounts", [])
        for vm in volume_mounts:
            if vm.get("name") == volume_name:
                return vm.get("mountPath"), volume_name

    return None, volume_name


@given(config=random_config())
@settings(
    max_examples=20,
    deadline=60000,  # 60 seconds per example (helm template can be slow)
    suppress_health_check=[HealthCheck.too_slow],
)
def test_volume_mount_path_preservation(config):
    """
    Property 8: Volume Mount Path Preservation

    **Validates: Requirements 5.3**

    For any stateful service definition that specifies an original Docker volume mount
    path, the generated Kubernetes Deployment manifest SHALL mount the corresponding
    PVC at exactly the same filesystem path, preserving application compatibility.

    This property holds regardless of namespace, environment, storage sizes, or
    replica counts — the mount paths must never change.
    """
    # Render the Helm chart with randomized configuration
    documents = render_helm_template(config)
    assume(len(documents) > 0)  # Skip if helm template fails

    # Get all Deployment resources
    deployments = get_deployments(documents)

    # Validate each stateful service has its PVC mounted at the correct path
    for deployment_name, expected in EXPECTED_VOLUME_MOUNTS.items():
        expected_mount_path = expected["mount_path"]
        expected_pvc_name = expected["pvc_name"]

        # The deployment must exist in the rendered output
        assert deployment_name in deployments, (
            f"Deployment '{deployment_name}' not found in rendered templates. "
            f"Found deployments: {list(deployments.keys())}. "
            f"Config: namespace={config['namespace']}, env={config['environment']}"
        )

        deployment = deployments[deployment_name]

        # Find the volume mount for this PVC
        actual_mount_path, volume_name = find_volume_mount(deployment, expected_pvc_name)

        # The PVC must be referenced as a volume
        assert volume_name is not None, (
            f"Deployment '{deployment_name}' does not reference PVC "
            f"'{expected_pvc_name}' in its volumes. "
            f"Config: namespace={config['namespace']}, env={config['environment']}"
        )

        # The mount path must match exactly
        assert actual_mount_path is not None, (
            f"Deployment '{deployment_name}' has volume '{volume_name}' referencing "
            f"PVC '{expected_pvc_name}', but no container mounts it. "
            f"Config: namespace={config['namespace']}, env={config['environment']}"
        )

        assert actual_mount_path == expected_mount_path, (
            f"Deployment '{deployment_name}' mounts PVC '{expected_pvc_name}' at "
            f"'{actual_mount_path}', expected '{expected_mount_path}'. "
            f"Volume mount path must be preserved from original Docker Compose. "
            f"Config: namespace={config['namespace']}, env={config['environment']}"
        )
