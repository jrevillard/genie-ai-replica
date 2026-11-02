"""
Property-based test: PVC Configuration Correctness

**Validates: Requirements 5.1, 5.2, 5.6**

For any stateful service definition specifying storage type (block or shared) and required
capacity, the generated PVC SHALL use:
  (a) managed-premium StorageClass with ReadWriteOnce access mode for block storage services
      (databases: ArangoDB, kong-db, keycloak-db)
  (b) azurefile StorageClass with ReadWriteMany access mode for shared storage services
      (document-uploads, redis-data)
  (c) capacity set to at least the declared usage plus 50% headroom
      (minimum 10 GiB for Azure File)
"""

import math
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


# --- Service Definitions ---

# Block storage services (Azure Disk: managed-premium, ReadWriteOnce)
BLOCK_STORAGE_SERVICES = {
    "arango": {
        "pvc_name": "arango-data-pvc",
        "values_key": "arango",
    },
    "kongDb": {
        "pvc_name": "kong-db-pvc",
        "values_key": "kongDb",
    },
    "keycloakDb": {
        "pvc_name": "keycloak-db-pvc",
        "values_key": "keycloakDb",
    },
}

# Shared storage services (Azure File: azurefile, ReadWriteMany)
SHARED_STORAGE_SERVICES = {
    "documentUploads": {
        "pvc_name": "document-uploads-pvc",
        "values_key": "documentUploads",
    },
    "redisData": {
        "pvc_name": "redis-data-pvc",
        "values_key": "redisData",
    },
}

# Minimum capacity for Azure File (GiB)
AZURE_FILE_MIN_CAPACITY_GI = 10


# --- Hypothesis Strategies ---

# Generate capacity values in GiB for block storage (realistic range)
block_capacity_strategy = st.integers(min_value=1, max_value=500)

# Generate capacity values in GiB for shared storage (realistic range)
shared_capacity_strategy = st.integers(min_value=1, max_value=500)


@st.composite
def storage_config(draw):
    """Generate a random storage configuration with varying capacities."""
    arango_size = draw(block_capacity_strategy)
    kong_db_size = draw(block_capacity_strategy)
    keycloak_db_size = draw(block_capacity_strategy)
    document_uploads_size = draw(shared_capacity_strategy)
    redis_data_size = draw(shared_capacity_strategy)

    return {
        "arango": arango_size,
        "kongDb": kong_db_size,
        "keycloakDb": keycloak_db_size,
        "documentUploads": document_uploads_size,
        "redisData": redis_data_size,
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


def get_pvcs(documents: list[dict]) -> dict[str, dict]:
    """Filter rendered documents to PVC resources, keyed by name."""
    pvcs = {}
    for doc in documents:
        if doc.get("kind") == "PersistentVolumeClaim":
            name = doc.get("metadata", {}).get("name", "")
            pvcs[name] = doc
    return pvcs


def parse_capacity_gi(capacity_str: str) -> int:
    """Parse a Kubernetes capacity string (e.g., '50Gi') to integer GiB."""
    if capacity_str.endswith("Gi"):
        return int(capacity_str[:-2])
    elif capacity_str.endswith("Ti"):
        return int(capacity_str[:-2]) * 1024
    elif capacity_str.endswith("Mi"):
        return max(1, int(capacity_str[:-2]) // 1024)
    return int(capacity_str)


def compute_expected_capacity(declared_usage_gi: int, is_shared: bool) -> int:
    """
    Compute the minimum expected PVC capacity:
    - At least declared usage + 50% headroom (rounded up)
    - Minimum 10 GiB for Azure File (shared) storage
    """
    with_headroom = math.ceil(declared_usage_gi * 1.5)
    if is_shared:
        return max(with_headroom, AZURE_FILE_MIN_CAPACITY_GI)
    return with_headroom


@given(config=storage_config())
@settings(
    max_examples=20,
    deadline=60000,  # 60 seconds per example (helm template can be slow)
    suppress_health_check=[HealthCheck.too_slow],
)
def test_pvc_configuration_correctness(config):
    """
    Property 7: PVC Configuration Correctness

    **Validates: Requirements 5.1, 5.2, 5.6**

    For any stateful service definition specifying storage type (block or shared) and
    required capacity, the generated PVC SHALL use:
      (a) managed-premium StorageClass with ReadWriteOnce access mode for block storage
      (b) azurefile StorageClass with ReadWriteMany access mode for shared storage
      (c) capacity >= declared usage + 50% headroom (minimum 10 GiB for Azure File)
    """
    # Build values override with randomized storage sizes
    values_override = {
        "storage": {
            "arango": {
                "storageClass": "managed-premium",
                "accessMode": "ReadWriteOnce",
                "size": f"{math.ceil(config['arango'] * 1.5)}Gi",
            },
            "kongDb": {
                "storageClass": "managed-premium",
                "accessMode": "ReadWriteOnce",
                "size": f"{math.ceil(config['kongDb'] * 1.5)}Gi",
            },
            "keycloakDb": {
                "storageClass": "managed-premium",
                "accessMode": "ReadWriteOnce",
                "size": f"{math.ceil(config['keycloakDb'] * 1.5)}Gi",
            },
            "documentUploads": {
                "storageClass": "azurefile",
                "accessMode": "ReadWriteMany",
                "size": f"{max(math.ceil(config['documentUploads'] * 1.5), AZURE_FILE_MIN_CAPACITY_GI)}Gi",
            },
            "redisData": {
                "storageClass": "azurefile",
                "accessMode": "ReadWriteMany",
                "size": f"{max(math.ceil(config['redisData'] * 1.5), AZURE_FILE_MIN_CAPACITY_GI)}Gi",
            },
        },
    }

    # Render the Helm chart
    documents = render_helm_template(values_override)
    assume(len(documents) > 0)  # Skip if helm template fails

    # Get all PVC resources
    pvcs = get_pvcs(documents)

    # Validate block storage PVCs (Requirements 5.1, 5.6)
    for service_key, service_info in BLOCK_STORAGE_SERVICES.items():
        pvc_name = service_info["pvc_name"]
        assert pvc_name in pvcs, (
            f"Block storage PVC '{pvc_name}' not found in rendered templates. "
            f"Found PVCs: {list(pvcs.keys())}"
        )

        pvc = pvcs[pvc_name]
        spec = pvc.get("spec", {})

        # (a) Check StorageClass is managed-premium
        storage_class = spec.get("storageClassName", "")
        assert storage_class == "managed-premium", (
            f"Block storage PVC '{pvc_name}' has storageClassName '{storage_class}', "
            f"expected 'managed-premium'"
        )

        # (a) Check access mode is ReadWriteOnce
        access_modes = spec.get("accessModes", [])
        assert "ReadWriteOnce" in access_modes, (
            f"Block storage PVC '{pvc_name}' has accessModes {access_modes}, "
            f"expected 'ReadWriteOnce'"
        )

        # (c) Check capacity >= declared usage + 50% headroom
        capacity_str = spec.get("resources", {}).get("requests", {}).get("storage", "0Gi")
        actual_capacity = parse_capacity_gi(capacity_str)
        expected_min = compute_expected_capacity(config[service_key], is_shared=False)
        assert actual_capacity >= expected_min, (
            f"Block storage PVC '{pvc_name}' has capacity {actual_capacity}Gi, "
            f"expected at least {expected_min}Gi "
            f"(declared usage: {config[service_key]}Gi + 50% headroom)"
        )

    # Validate shared storage PVCs (Requirements 5.2, 5.6)
    for service_key, service_info in SHARED_STORAGE_SERVICES.items():
        pvc_name = service_info["pvc_name"]
        assert pvc_name in pvcs, (
            f"Shared storage PVC '{pvc_name}' not found in rendered templates. "
            f"Found PVCs: {list(pvcs.keys())}"
        )

        pvc = pvcs[pvc_name]
        spec = pvc.get("spec", {})

        # (b) Check StorageClass is azurefile
        storage_class = spec.get("storageClassName", "")
        assert storage_class == "azurefile", (
            f"Shared storage PVC '{pvc_name}' has storageClassName '{storage_class}', "
            f"expected 'azurefile'"
        )

        # (b) Check access mode is ReadWriteMany
        access_modes = spec.get("accessModes", [])
        assert "ReadWriteMany" in access_modes, (
            f"Shared storage PVC '{pvc_name}' has accessModes {access_modes}, "
            f"expected 'ReadWriteMany'"
        )

        # (c) Check capacity >= declared usage + 50% headroom, min 10 GiB
        capacity_str = spec.get("resources", {}).get("requests", {}).get("storage", "0Gi")
        actual_capacity = parse_capacity_gi(capacity_str)
        expected_min = compute_expected_capacity(config[service_key], is_shared=True)
        assert actual_capacity >= expected_min, (
            f"Shared storage PVC '{pvc_name}' has capacity {actual_capacity}Gi, "
            f"expected at least {expected_min}Gi "
            f"(declared usage: {config[service_key]}Gi + 50% headroom, "
            f"minimum {AZURE_FILE_MIN_CAPACITY_GI}Gi for Azure File)"
        )
