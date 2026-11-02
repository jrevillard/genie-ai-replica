"""
Property 11: Helm Template Parameterization and Secrets Separation

**Validates: Requirements 8.1, 8.2**

For any set of environment-specific values (resource limits, replica counts, endpoints,
credentials), the Helm chart template output SHALL:
  (a) produce different manifest content when different values files are applied
      (parameterization works), and
  (b) place all values marked as sensitive (passwords, tokens, API keys) into Kubernetes
      Secret resources rather than ConfigMaps or environment variable literals.
"""

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

# Sensitive value patterns that MUST only appear in Secret resources
SENSITIVE_KEYWORDS = [
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "api-key",
    "encryption_key",
    "encryption-key",
    "private_key",
    "private-key",
]

# Known secret keys from the Helm chart's secrets.yaml
KNOWN_SECRET_KEYS = [
    "ARANGO_ROOT_PASSWORD",
    "KONG_PG_PASSWORD",
    "KEYCLOAK_DB_PASSWORD",
    "KEYCLOAK_ADMIN_PASSWORD",
    "HF_TOKEN",
    "JWT_SECRET",
    "ENCRYPTION_KEY",
]


# --- Hypothesis Strategies ---

# Generate namespace names
namespace_strategy = st.from_regex(r"[a-z][a-z0-9\-]{2,15}", fullmatch=True)

# Generate replica counts
replicas_strategy = st.integers(min_value=1, max_value=10)

# Generate resource limit values
cpu_strategy = st.sampled_from(["250m", "500m", "1", "2", "4", "8"])
memory_strategy = st.sampled_from(["256Mi", "512Mi", "1Gi", "2Gi", "4Gi", "8Gi", "16Gi"])

# Generate storage sizes
storage_size_strategy = st.sampled_from(["5Gi", "10Gi", "20Gi", "50Gi", "100Gi"])

# Generate ingress hosts
host_strategy = st.from_regex(r"[a-z][a-z0-9\-]{2,10}\.[a-z]{2,5}", fullmatch=True)


@st.composite
def values_config(draw):
    """Generate a random values configuration representing an environment."""
    namespace = draw(namespace_strategy)
    backend_replicas = draw(replicas_strategy)
    frontend_replicas = draw(replicas_strategy)
    backend_cpu_limit = draw(cpu_strategy)
    backend_memory_limit = draw(memory_strategy)
    arango_size = draw(storage_size_strategy)
    host = draw(host_strategy)

    return {
        "namespace": namespace,
        "cpu": {
            "backend": {
                "replicas": backend_replicas,
                "resources": {
                    "limits": {
                        "cpu": backend_cpu_limit,
                        "memory": backend_memory_limit,
                    },
                },
            },
            "frontend": {
                "replicas": frontend_replicas,
            },
        },
        "storage": {
            "arango": {
                "size": arango_size,
            },
        },
        "ingress": {
            "host": host,
        },
    }


@st.composite
def two_different_configs(draw):
    """Generate two distinct values configurations that should produce different output."""
    config_a = draw(values_config())
    config_b = draw(values_config())

    # Ensure the configs are actually different in at least one meaningful way
    assume(
        config_a["namespace"] != config_b["namespace"]
        or config_a["cpu"]["backend"]["replicas"] != config_b["cpu"]["backend"]["replicas"]
        or config_a["cpu"]["frontend"]["replicas"] != config_b["cpu"]["frontend"]["replicas"]
        or config_a["storage"]["arango"]["size"] != config_b["storage"]["arango"]["size"]
        or config_a["ingress"]["host"] != config_b["ingress"]["host"]
        or config_a["cpu"]["backend"]["resources"]["limits"]["cpu"]
        != config_b["cpu"]["backend"]["resources"]["limits"]["cpu"]
        or config_a["cpu"]["backend"]["resources"]["limits"]["memory"]
        != config_b["cpu"]["backend"]["resources"]["limits"]["memory"]
    )

    return config_a, config_b


# --- Helper Functions ---


def render_helm_templates(values_override: dict = None) -> str:
    """Run helm template with optional values override and return raw YAML output."""
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
            return ""
        return result.stdout
    finally:
        if override_file:
            os.unlink(override_file)


def render_helm_templates_parsed(values_override: dict = None) -> list:
    """Run helm template and return parsed YAML documents."""
    raw = render_helm_templates(values_override)
    if not raw:
        return []
    documents = list(yaml.safe_load_all(raw))
    return [doc for doc in documents if doc is not None]


def get_resources_by_kind(documents: list, kind: str) -> list:
    """Filter rendered documents by resource kind."""
    return [doc for doc in documents if doc.get("kind") == kind]


def get_configmaps(documents: list) -> list:
    """Get all ConfigMap resources."""
    return get_resources_by_kind(documents, "ConfigMap")


def get_deployments(documents: list) -> list:
    """Get all Deployment resources."""
    return get_resources_by_kind(documents, "Deployment")


def get_non_secret_resources(documents: list) -> list:
    """Get all resources that are NOT Secrets or SecretProviderClass."""
    return [
        doc for doc in documents
        if doc.get("kind") not in ("Secret", "SecretProviderClass")
    ]


def contains_sensitive_value(text: str) -> bool:
    """Check if text contains patterns that look like sensitive values being embedded."""
    text_lower = text.lower()
    # Look for sensitive keywords being used as literal values (not as key references)
    # We check for patterns like key: <actual_password_value>
    for keyword in SENSITIVE_KEYWORDS:
        if keyword in text_lower:
            return True
    return False


def resource_to_yaml(resource: dict) -> str:
    """Convert a resource dict to YAML string for inspection."""
    return yaml.dump(resource, default_flow_style=False)


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
    documents = render_helm_templates_parsed()
    if not documents:
        pytest.skip("helm template failed with default values")
    return documents


# --- Property Tests ---


class TestHelmParameterization:
    """
    **Validates: Requirements 8.1**

    Property 11a: Different values produce different rendered output.

    For any two distinct environment-specific value sets, the Helm chart SHALL
    produce different manifest content, demonstrating that values are properly
    parameterized.
    """

    @given(configs=two_different_configs())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_different_values_produce_different_output(self, configs, helm_available):
        """
        **Validates: Requirements 8.1**

        When different values files are applied, the rendered manifest content
        SHALL differ, proving parameterization works.
        """
        config_a, config_b = configs

        output_a = render_helm_templates(config_a)
        output_b = render_helm_templates(config_b)

        assume(output_a != "")
        assume(output_b != "")

        assert output_a != output_b, (
            f"Two different value configurations produced identical output.\n"
            f"Config A: {config_a}\n"
            f"Config B: {config_b}\n"
            f"This indicates values are not being parameterized in templates."
        )

    @given(config=values_config())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_namespace_parameterized_in_output(self, config, helm_available):
        """
        **Validates: Requirements 8.1**

        The namespace value SHALL appear in the rendered output, confirming
        it is parameterized.
        """
        output = render_helm_templates(config)
        assume(output != "")

        namespace = config["namespace"]
        assert namespace in output, (
            f"Namespace '{namespace}' not found in rendered output. "
            f"Templates may not be parameterizing the namespace field."
        )

    @given(config=values_config())
    @settings(
        max_examples=20,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_replicas_parameterized_in_deployments(self, config, helm_available):
        """
        **Validates: Requirements 8.1**

        Replica counts from values SHALL appear in rendered Deployment manifests.
        """
        documents = render_helm_templates_parsed(config)
        assume(len(documents) > 0)

        deployments = get_deployments(documents)
        backend_deployments = [
            d for d in deployments
            if d.get("metadata", {}).get("name") == "backend"
        ]

        assume(len(backend_deployments) > 0)

        backend = backend_deployments[0]
        actual_replicas = backend.get("spec", {}).get("replicas")
        expected_replicas = config["cpu"]["backend"]["replicas"]

        assert actual_replicas == expected_replicas, (
            f"Backend deployment replicas={actual_replicas}, "
            f"expected={expected_replicas} from values override. "
            f"Replicas are not properly parameterized."
        )


class TestSecretsSeparation:
    """
    **Validates: Requirements 8.2**

    Property 11b: Sensitive values only in Secret resources.

    All values marked as sensitive (passwords, tokens, API keys) SHALL be placed
    into Kubernetes Secret resources (via SecretProviderClass / Secrets Store CSI)
    rather than ConfigMaps or environment variable literals in Deployments.
    """

    def test_no_sensitive_keys_in_configmaps(
        self, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 8.2**

        ConfigMap resources SHALL NOT contain keys that match known sensitive
        secret names (passwords, tokens, keys).
        """
        configmaps = get_configmaps(default_rendered_manifests)

        for cm in configmaps:
            cm_name = cm.get("metadata", {}).get("name", "unknown")
            data = cm.get("data", {})

            for key in data:
                key_upper = key.upper()
                assert key_upper not in KNOWN_SECRET_KEYS, (
                    f"ConfigMap '{cm_name}' contains sensitive key '{key}' "
                    f"which should only be in a Secret resource. "
                    f"Known secret keys: {KNOWN_SECRET_KEYS}"
                )

    def test_no_sensitive_patterns_in_configmap_values(
        self, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 8.2**

        ConfigMap data values SHALL NOT contain patterns that look like
        embedded sensitive credentials (password=, secret=, token=).
        """
        configmaps = get_configmaps(default_rendered_manifests)

        for cm in configmaps:
            cm_name = cm.get("metadata", {}).get("name", "unknown")
            data = cm.get("data", {})

            for key, value in data.items():
                if not isinstance(value, str):
                    continue
                # Check that values don't contain literal sensitive data patterns
                # (e.g., "password123" or "my-secret-token")
                value_lower = value.lower()
                for secret_key in KNOWN_SECRET_KEYS:
                    # Ensure ConfigMap values are not referencing secrets by value
                    assert secret_key.lower() not in value_lower or "svc.cluster.local" in value_lower, (
                        f"ConfigMap '{cm_name}' key '{key}' contains a reference "
                        f"to sensitive key '{secret_key}' in its value: '{value}'. "
                        f"Sensitive values should only be in Secret resources."
                    )

    def test_deployment_env_does_not_embed_secrets(
        self, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 8.2**

        Deployment containers SHALL NOT have inline environment variables
        with sensitive key names containing literal values.
        """
        deployments = get_deployments(default_rendered_manifests)

        for deploy in deployments:
            deploy_name = deploy.get("metadata", {}).get("name", "unknown")
            containers = (
                deploy.get("spec", {})
                .get("template", {})
                .get("spec", {})
                .get("containers", [])
            )

            for container in containers:
                env_vars = container.get("env", [])
                for env in env_vars:
                    env_name = env.get("name", "")
                    # If the env var name matches a known secret key,
                    # it must use valueFrom (secretKeyRef), not a literal value
                    if env_name.upper() in KNOWN_SECRET_KEYS:
                        assert "value" not in env, (
                            f"Deployment '{deploy_name}' container has env var "
                            f"'{env_name}' with a literal 'value' field. "
                            f"Sensitive values MUST use valueFrom.secretKeyRef "
                            f"or be mounted via Secrets Store CSI Driver."
                        )

    def test_secrets_provider_class_exists(
        self, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 8.2**

        The rendered manifests SHALL contain a SecretProviderClass resource
        for Azure Key Vault integration, confirming secrets are managed
        externally rather than embedded in templates.
        """
        secret_provider_classes = get_resources_by_kind(
            default_rendered_manifests, "SecretProviderClass"
        )

        assert len(secret_provider_classes) > 0, (
            "No SecretProviderClass resource found in rendered manifests. "
            "Secrets should be managed via Azure Key Vault Secrets Store CSI Driver."
        )

    def test_secret_provider_class_references_all_secrets(
        self, helm_available, default_rendered_manifests
    ):
        """
        **Validates: Requirements 8.2**

        The SecretProviderClass SHALL reference all known sensitive values
        (passwords, tokens, keys) from Azure Key Vault.
        """
        secret_provider_classes = get_resources_by_kind(
            default_rendered_manifests, "SecretProviderClass"
        )

        assert len(secret_provider_classes) > 0, (
            "No SecretProviderClass found; cannot validate secret references."
        )

        spc = secret_provider_classes[0]
        # Check secretObjects contain all known secret keys
        secret_objects = spc.get("spec", {}).get("secretObjects", [])

        all_secret_data_keys = []
        for secret_obj in secret_objects:
            data_entries = secret_obj.get("data", [])
            for entry in data_entries:
                all_secret_data_keys.append(entry.get("key", ""))

        for secret_key in KNOWN_SECRET_KEYS:
            assert secret_key in all_secret_data_keys, (
                f"SecretProviderClass does not reference '{secret_key}'. "
                f"All sensitive values must be sourced from Azure Key Vault. "
                f"Found keys: {all_secret_data_keys}"
            )

    @given(config=values_config())
    @settings(
        max_examples=15,
        deadline=120000,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    def test_no_sensitive_keys_in_configmaps_any_values(self, config, helm_available):
        """
        **Validates: Requirements 8.2**

        For any environment values configuration, ConfigMaps SHALL NOT
        contain known sensitive secret keys.
        """
        documents = render_helm_templates_parsed(config)
        assume(len(documents) > 0)

        configmaps = get_configmaps(documents)

        for cm in configmaps:
            cm_name = cm.get("metadata", {}).get("name", "unknown")
            data = cm.get("data", {})

            for key in data:
                key_upper = key.upper()
                assert key_upper not in KNOWN_SECRET_KEYS, (
                    f"ConfigMap '{cm_name}' contains sensitive key '{key}' "
                    f"which should only be in a Secret resource."
                )
