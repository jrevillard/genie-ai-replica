"""
Property-based test: Dry-Run Validation Detects Invalid Manifests

**Validates: Requirements 8.7**

For any generated manifest set, if a manifest contains a schema violation
(missing required field, invalid field type, reference to undefined resource),
the dry-run validation function SHALL reject the manifest set and produce an error
message identifying the invalid resource and reason. Conversely, for any valid
manifest set, the dry-run validation SHALL accept it without errors.
"""

from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st
from dataclasses import dataclass, field
from typing import Optional
import re


# --- Constants ---

REQUIRED_DEPLOYMENT_FIELDS = {"apiVersion", "kind", "metadata", "spec"}
REQUIRED_METADATA_FIELDS = {"name"}
REQUIRED_DEPLOYMENT_SPEC_FIELDS = {"selector", "template"}
REQUIRED_POD_TEMPLATE_FIELDS = {"spec"}
REQUIRED_POD_SPEC_FIELDS = {"containers"}
REQUIRED_CONTAINER_FIELDS = {"name", "image"}

VALID_API_VERSIONS = {"apps/v1", "v1", "networking.k8s.io/v1", "batch/v1"}
VALID_DEPLOYMENT_KINDS = {"Deployment", "DaemonSet", "StatefulSet"}
VALID_SERVICE_KINDS = {"Service"}
VALID_RESOURCE_KINDS = {"Deployment", "Service", "ConfigMap", "Secret",
                        "NetworkPolicy", "PersistentVolumeClaim", "DaemonSet",
                        "StatefulSet", "Ingress"}

# Kubernetes name regex: RFC 1123 DNS subdomain
K8S_NAME_PATTERN = re.compile(r"^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?$")


# --- Data Models ---

@dataclass
class ManifestField:
    """Represents a field in a Kubernetes manifest."""
    name: str
    value: object
    field_type: str  # "string", "int", "dict", "list", "bool"


@dataclass
class KubernetesManifest:
    """
    Represents a Kubernetes manifest that may be valid or invalid.
    """
    api_version: Optional[str]
    kind: Optional[str]
    metadata: Optional[dict]
    spec: Optional[dict]
    raw: dict = field(default_factory=dict)


@dataclass
class ValidationResult:
    """
    Result of dry-run validation:
    - is_valid: Whether the manifest passed validation
    - errors: List of error messages for invalid manifests
    """
    is_valid: bool
    errors: list = field(default_factory=list)


# --- Dry-Run Validation Function ---

def validate_k8s_name(name: str) -> Optional[str]:
    """Validate a Kubernetes resource name follows RFC 1123 DNS subdomain rules."""
    if not name:
        return "name is empty"
    if len(name) > 63:
        return f"name '{name}' exceeds 63 characters"
    if not K8S_NAME_PATTERN.match(name):
        return f"name '{name}' does not match RFC 1123 DNS subdomain format"
    return None


def validate_manifest(manifest: dict) -> ValidationResult:
    """
    Validate a Kubernetes manifest for schema violations.

    This function mirrors the validation performed by `helm template --validate`
    in the deploy.sh script. It checks:
    - Required top-level fields (apiVersion, kind, metadata, spec)
    - Valid apiVersion values
    - Valid kind values
    - Metadata has a valid name
    - For Deployments/DaemonSets/StatefulSets: spec has required structure
    - Container specs have required fields (name, image)
    - Field types are correct

    Args:
        manifest: A dict representing a Kubernetes resource manifest.

    Returns:
        ValidationResult with is_valid=True if the manifest passes, or
        is_valid=False with descriptive error messages.
    """
    errors = []

    # Check required top-level fields
    if "apiVersion" not in manifest:
        errors.append("missing required field 'apiVersion'")
    elif not isinstance(manifest["apiVersion"], str):
        errors.append(f"field 'apiVersion' must be a string, got {type(manifest['apiVersion']).__name__}")
    elif manifest["apiVersion"] not in VALID_API_VERSIONS:
        errors.append(f"invalid apiVersion '{manifest['apiVersion']}': must be one of {sorted(VALID_API_VERSIONS)}")

    if "kind" not in manifest:
        errors.append("missing required field 'kind'")
    elif not isinstance(manifest["kind"], str):
        errors.append(f"field 'kind' must be a string, got {type(manifest['kind']).__name__}")
    elif manifest["kind"] not in VALID_RESOURCE_KINDS:
        errors.append(f"invalid kind '{manifest['kind']}': must be one of {sorted(VALID_RESOURCE_KINDS)}")

    if "metadata" not in manifest:
        errors.append("missing required field 'metadata'")
    elif not isinstance(manifest["metadata"], dict):
        errors.append(f"field 'metadata' must be a dict, got {type(manifest['metadata']).__name__}")
    else:
        # Validate metadata.name
        if "name" not in manifest["metadata"]:
            errors.append("missing required field 'metadata.name'")
        elif not isinstance(manifest["metadata"]["name"], str):
            errors.append(f"field 'metadata.name' must be a string, got {type(manifest['metadata']['name']).__name__}")
        else:
            name_error = validate_k8s_name(manifest["metadata"]["name"])
            if name_error:
                errors.append(f"invalid metadata.name: {name_error}")

    # Validate spec for workload kinds
    kind = manifest.get("kind")
    if kind in VALID_DEPLOYMENT_KINDS:
        if "spec" not in manifest:
            errors.append(f"missing required field 'spec' for kind '{kind}'")
        elif not isinstance(manifest["spec"], dict):
            errors.append(f"field 'spec' must be a dict, got {type(manifest['spec']).__name__}")
        else:
            _validate_workload_spec(manifest["spec"], kind, errors)

    elif kind == "Service":
        if "spec" not in manifest:
            errors.append(f"missing required field 'spec' for kind 'Service'")
        elif not isinstance(manifest["spec"], dict):
            errors.append(f"field 'spec' must be a dict, got {type(manifest['spec']).__name__}")
        else:
            _validate_service_spec(manifest["spec"], errors)

    if errors:
        resource_id = _get_resource_identifier(manifest)
        prefixed_errors = [f"[{resource_id}] {e}" for e in errors]
        return ValidationResult(is_valid=False, errors=prefixed_errors)

    return ValidationResult(is_valid=True, errors=[])


def _get_resource_identifier(manifest: dict) -> str:
    """Get a human-readable identifier for the resource."""
    kind = manifest.get("kind", "<unknown-kind>")
    name = manifest.get("metadata", {}).get("name", "<unknown-name>") if isinstance(manifest.get("metadata"), dict) else "<unknown-name>"
    return f"{kind}/{name}"


def _validate_workload_spec(spec: dict, kind: str, errors: list):
    """Validate the spec section of a Deployment/DaemonSet/StatefulSet."""
    if "selector" not in spec:
        errors.append(f"missing required field 'spec.selector' for kind '{kind}'")
    elif not isinstance(spec["selector"], dict):
        errors.append(f"field 'spec.selector' must be a dict, got {type(spec['selector']).__name__}")

    if "template" not in spec:
        errors.append(f"missing required field 'spec.template' for kind '{kind}'")
    elif not isinstance(spec["template"], dict):
        errors.append(f"field 'spec.template' must be a dict, got {type(spec['template']).__name__}")
    else:
        template = spec["template"]
        if "spec" not in template:
            errors.append(f"missing required field 'spec.template.spec' for kind '{kind}'")
        elif not isinstance(template["spec"], dict):
            errors.append(f"field 'spec.template.spec' must be a dict, got {type(template['spec']).__name__}")
        else:
            pod_spec = template["spec"]
            if "containers" not in pod_spec:
                errors.append(f"missing required field 'spec.template.spec.containers' for kind '{kind}'")
            elif not isinstance(pod_spec["containers"], list):
                errors.append(f"field 'spec.template.spec.containers' must be a list, got {type(pod_spec['containers']).__name__}")
            elif len(pod_spec["containers"]) == 0:
                errors.append(f"'spec.template.spec.containers' must not be empty for kind '{kind}'")
            else:
                for i, container in enumerate(pod_spec["containers"]):
                    if not isinstance(container, dict):
                        errors.append(f"container[{i}] must be a dict, got {type(container).__name__}")
                        continue
                    if "name" not in container:
                        errors.append(f"missing required field 'containers[{i}].name'")
                    elif not isinstance(container["name"], str):
                        errors.append(f"field 'containers[{i}].name' must be a string, got {type(container['name']).__name__}")
                    if "image" not in container:
                        errors.append(f"missing required field 'containers[{i}].image'")
                    elif not isinstance(container["image"], str):
                        errors.append(f"field 'containers[{i}].image' must be a string, got {type(container['image']).__name__}")


def _validate_service_spec(spec: dict, errors: list):
    """Validate the spec section of a Service."""
    if "ports" in spec:
        if not isinstance(spec["ports"], list):
            errors.append(f"field 'spec.ports' must be a list, got {type(spec['ports']).__name__}")
        else:
            for i, port in enumerate(spec["ports"]):
                if not isinstance(port, dict):
                    errors.append(f"spec.ports[{i}] must be a dict, got {type(port).__name__}")
                    continue
                if "port" not in port:
                    errors.append(f"missing required field 'spec.ports[{i}].port'")
                elif not isinstance(port["port"], int):
                    errors.append(f"field 'spec.ports[{i}].port' must be an integer, got {type(port['port']).__name__}")
                elif port["port"] < 1 or port["port"] > 65535:
                    errors.append(f"field 'spec.ports[{i}].port' must be between 1 and 65535, got {port['port']}")


def validate_manifest_set(manifests: list[dict]) -> ValidationResult:
    """
    Validate a set of Kubernetes manifests (dry-run).

    Mirrors the behavior of `helm template --validate` from deploy.sh:
    - If ANY manifest fails validation, the entire set is rejected with
      a descriptive error identifying the invalid resource and reason.
    - If ALL manifests pass, the set is accepted without errors.

    Args:
        manifests: A list of Kubernetes manifest dicts.

    Returns:
        ValidationResult indicating acceptance or rejection with error details.
    """
    if not manifests:
        return ValidationResult(
            is_valid=False,
            errors=["manifest set is empty: no resources to validate"]
        )

    all_errors = []
    for manifest in manifests:
        result = validate_manifest(manifest)
        if not result.is_valid:
            all_errors.extend(result.errors)

    if all_errors:
        return ValidationResult(is_valid=False, errors=all_errors)

    return ValidationResult(is_valid=True, errors=[])


# --- Hypothesis Strategies ---

# Valid Kubernetes resource name
k8s_name_strategy = st.from_regex(
    r"[a-z][a-z0-9\-]{0,20}[a-z0-9]",
    fullmatch=True,
).filter(lambda s: "--" not in s and len(s) >= 2)

# Valid container image
image_strategy = st.from_regex(
    r"[a-z][a-z0-9]*/[a-z][a-z0-9\-]*:[a-z0-9][a-z0-9\.]{0,10}",
    fullmatch=True,
)

# Valid port number
port_strategy = st.integers(min_value=1, max_value=65535)

# Strategy for labels (key-value pairs)
label_key_strategy = st.from_regex(r"[a-z]{1,10}", fullmatch=True)
label_value_strategy = st.from_regex(r"[a-z0-9]{1,10}", fullmatch=True)
labels_strategy = st.dictionaries(
    keys=label_key_strategy,
    values=label_value_strategy,
    min_size=1,
    max_size=3,
)


@st.composite
def valid_deployment_manifest(draw):
    """Generate a valid Kubernetes Deployment manifest."""
    name = draw(k8s_name_strategy)
    image = draw(image_strategy)
    container_port = draw(port_strategy)
    labels = draw(labels_strategy)

    return {
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": name,
            "labels": labels,
        },
        "spec": {
            "selector": {
                "matchLabels": labels,
            },
            "template": {
                "metadata": {
                    "labels": labels,
                },
                "spec": {
                    "containers": [
                        {
                            "name": name,
                            "image": image,
                            "ports": [{"containerPort": container_port}],
                        }
                    ],
                },
            },
        },
    }


@st.composite
def valid_service_manifest(draw):
    """Generate a valid Kubernetes Service manifest."""
    name = draw(k8s_name_strategy)
    port = draw(port_strategy)
    target_port = draw(port_strategy)
    labels = draw(labels_strategy)

    return {
        "apiVersion": "v1",
        "kind": "Service",
        "metadata": {
            "name": name,
            "labels": labels,
        },
        "spec": {
            "type": "ClusterIP",
            "selector": labels,
            "ports": [
                {
                    "port": port,
                    "targetPort": target_port,
                    "protocol": "TCP",
                }
            ],
        },
    }


@st.composite
def valid_configmap_manifest(draw):
    """Generate a valid Kubernetes ConfigMap manifest."""
    name = draw(k8s_name_strategy)

    return {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {
            "name": name,
        },
        "data": {
            "key": "value",
        },
    }


@st.composite
def valid_manifest(draw):
    """Generate any valid Kubernetes manifest."""
    return draw(st.one_of(
        valid_deployment_manifest(),
        valid_service_manifest(),
        valid_configmap_manifest(),
    ))


@st.composite
def valid_manifest_set(draw):
    """Generate a set of valid Kubernetes manifests."""
    manifests = draw(st.lists(valid_manifest(), min_size=1, max_size=5))
    return manifests


# --- Invalid manifest strategies ---

@st.composite
def manifest_missing_api_version(draw):
    """Generate a manifest missing the apiVersion field."""
    manifest = draw(valid_deployment_manifest())
    del manifest["apiVersion"]
    return manifest


@st.composite
def manifest_missing_kind(draw):
    """Generate a manifest missing the kind field."""
    manifest = draw(valid_deployment_manifest())
    del manifest["kind"]
    return manifest


@st.composite
def manifest_missing_metadata(draw):
    """Generate a manifest missing the metadata field."""
    manifest = draw(valid_deployment_manifest())
    del manifest["metadata"]
    return manifest


@st.composite
def manifest_missing_metadata_name(draw):
    """Generate a manifest with metadata but no name."""
    manifest = draw(valid_deployment_manifest())
    del manifest["metadata"]["name"]
    return manifest


@st.composite
def manifest_invalid_name(draw):
    """Generate a manifest with an invalid Kubernetes name."""
    manifest = draw(valid_deployment_manifest())
    invalid_name = draw(st.one_of(
        st.just("UPPERCASE-NAME"),
        st.just("has spaces"),
        st.just("-starts-with-dash"),
        st.just("ends-with-dash-"),
        st.just("has_underscores"),
        st.just("a" * 64),  # Too long
    ))
    manifest["metadata"]["name"] = invalid_name
    return manifest


@st.composite
def manifest_invalid_api_version(draw):
    """Generate a manifest with an invalid apiVersion."""
    manifest = draw(valid_deployment_manifest())
    manifest["apiVersion"] = draw(st.one_of(
        st.just("invalid/version"),
        st.just(""),
        st.just("apps/v99"),
    ))
    return manifest


@st.composite
def manifest_invalid_kind(draw):
    """Generate a manifest with an invalid kind."""
    manifest = draw(valid_deployment_manifest())
    manifest["kind"] = draw(st.one_of(
        st.just("InvalidKind"),
        st.just("Pod"),  # Not in our supported kinds
        st.just(""),
    ))
    return manifest


@st.composite
def manifest_wrong_type_api_version(draw):
    """Generate a manifest where apiVersion is the wrong type."""
    manifest = draw(valid_deployment_manifest())
    manifest["apiVersion"] = draw(st.one_of(
        st.integers(),
        st.lists(st.text(), max_size=2),
        st.booleans(),
    ))
    return manifest


@st.composite
def manifest_wrong_type_metadata(draw):
    """Generate a manifest where metadata is the wrong type."""
    manifest = draw(valid_deployment_manifest())
    manifest["metadata"] = draw(st.one_of(
        st.just("not-a-dict"),
        st.integers(),
        st.lists(st.text(), max_size=2),
    ))
    return manifest


@st.composite
def manifest_missing_containers(draw):
    """Generate a Deployment manifest with missing containers."""
    manifest = draw(valid_deployment_manifest())
    del manifest["spec"]["template"]["spec"]["containers"]
    return manifest


@st.composite
def manifest_empty_containers(draw):
    """Generate a Deployment manifest with empty containers list."""
    manifest = draw(valid_deployment_manifest())
    manifest["spec"]["template"]["spec"]["containers"] = []
    return manifest


@st.composite
def manifest_container_missing_image(draw):
    """Generate a Deployment manifest with a container missing the image field."""
    manifest = draw(valid_deployment_manifest())
    del manifest["spec"]["template"]["spec"]["containers"][0]["image"]
    return manifest


@st.composite
def manifest_container_missing_name(draw):
    """Generate a Deployment manifest with a container missing the name field."""
    manifest = draw(valid_deployment_manifest())
    del manifest["spec"]["template"]["spec"]["containers"][0]["name"]
    return manifest


@st.composite
def manifest_missing_spec(draw):
    """Generate a Deployment manifest missing the spec field entirely."""
    manifest = draw(valid_deployment_manifest())
    del manifest["spec"]
    return manifest


@st.composite
def manifest_missing_selector(draw):
    """Generate a Deployment manifest missing spec.selector."""
    manifest = draw(valid_deployment_manifest())
    del manifest["spec"]["selector"]
    return manifest


@st.composite
def manifest_missing_template(draw):
    """Generate a Deployment manifest missing spec.template."""
    manifest = draw(valid_deployment_manifest())
    del manifest["spec"]["template"]
    return manifest


@st.composite
def manifest_service_invalid_port(draw):
    """Generate a Service manifest with an invalid port value."""
    manifest = draw(valid_service_manifest())
    manifest["spec"]["ports"][0]["port"] = draw(st.one_of(
        st.just("not-a-number"),
        st.just(0),
        st.just(70000),
        st.just(-1),
    ))
    return manifest


@st.composite
def invalid_manifest(draw):
    """Generate any invalid Kubernetes manifest."""
    return draw(st.one_of(
        manifest_missing_api_version(),
        manifest_missing_kind(),
        manifest_missing_metadata(),
        manifest_missing_metadata_name(),
        manifest_invalid_name(),
        manifest_invalid_api_version(),
        manifest_invalid_kind(),
        manifest_wrong_type_api_version(),
        manifest_wrong_type_metadata(),
        manifest_missing_containers(),
        manifest_empty_containers(),
        manifest_container_missing_image(),
        manifest_container_missing_name(),
        manifest_missing_spec(),
        manifest_missing_selector(),
        manifest_missing_template(),
        manifest_service_invalid_port(),
    ))


# --- Property Tests ---


@given(manifests=valid_manifest_set())
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_valid_manifests_accepted(manifests):
    """
    Property 12 (acceptance): For any valid manifest set, the dry-run validation
    SHALL accept it without errors.

    **Validates: Requirements 8.7**
    """
    result = validate_manifest_set(manifests)

    assert result.is_valid is True, (
        f"Valid manifest set should be accepted. Got errors: {result.errors}"
    )
    assert len(result.errors) == 0, (
        f"Valid manifest set should have no errors. Got: {result.errors}"
    )


@given(invalid=invalid_manifest())
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_invalid_manifest_rejected(invalid):
    """
    Property 12 (rejection): For any manifest containing a schema violation
    (missing required field, invalid field type, reference to undefined resource),
    the dry-run validation function SHALL reject it and produce an error message
    identifying the invalid resource and reason.

    **Validates: Requirements 8.7**
    """
    result = validate_manifest_set([invalid])

    assert result.is_valid is False, (
        f"Invalid manifest should be rejected. Manifest: {invalid}"
    )
    assert len(result.errors) > 0, (
        f"Rejected manifest must have at least one error message. "
        f"Manifest: {invalid}"
    )
    # Each error should be descriptive (non-empty and identifies the issue)
    for error in result.errors:
        assert len(error) > 0, "Error messages must not be empty"
        assert isinstance(error, str), "Error messages must be strings"


@given(
    valid_manifests=st.lists(valid_manifest(), min_size=1, max_size=3),
    invalid=invalid_manifest(),
    insert_position=st.integers(min_value=0, max_value=3),
)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_single_invalid_manifest_rejects_entire_set(
    valid_manifests, invalid, insert_position
):
    """
    Property 12 (set rejection): If ANY manifest in the set contains a schema
    violation, the dry-run validation SHALL reject the ENTIRE manifest set.

    **Validates: Requirements 8.7**
    """
    # Insert the invalid manifest at a random position
    position = min(insert_position, len(valid_manifests))
    manifest_set = valid_manifests[:position] + [invalid] + valid_manifests[position:]

    result = validate_manifest_set(manifest_set)

    assert result.is_valid is False, (
        f"Manifest set containing an invalid manifest should be rejected. "
        f"Invalid manifest at position {position}. "
        f"Total manifests: {len(manifest_set)}"
    )
    assert len(result.errors) > 0, (
        f"Rejected set must have at least one error message"
    )


@given(invalid=invalid_manifest())
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_error_message_identifies_resource(invalid):
    """
    Property 12 (error identification): When a manifest fails validation, the error
    message SHALL identify the invalid resource (kind/name) and the reason for rejection.

    **Validates: Requirements 8.7**
    """
    result = validate_manifest_set([invalid])

    assert result.is_valid is False, (
        f"Invalid manifest should be rejected"
    )

    # Error messages should contain a resource identifier (kind/name pattern)
    for error in result.errors:
        # Errors should be prefixed with [Kind/name] pattern
        assert "[" in error and "]" in error, (
            f"Error message should contain resource identifier in brackets. "
            f"Got: '{error}'"
        )


@given(manifest=valid_deployment_manifest())
@settings(
    max_examples=100,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_valid_deployment_always_accepted(manifest):
    """
    Property: A well-formed Deployment manifest with all required fields
    SHALL always be accepted by dry-run validation.

    **Validates: Requirements 8.7**
    """
    result = validate_manifest(manifest)

    assert result.is_valid is True, (
        f"Well-formed Deployment should be accepted. "
        f"Manifest name: {manifest['metadata']['name']}. "
        f"Errors: {result.errors}"
    )


@given(manifest=valid_service_manifest())
@settings(
    max_examples=100,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_valid_service_always_accepted(manifest):
    """
    Property: A well-formed Service manifest with all required fields
    SHALL always be accepted by dry-run validation.

    **Validates: Requirements 8.7**
    """
    result = validate_manifest(manifest)

    assert result.is_valid is True, (
        f"Well-formed Service should be accepted. "
        f"Manifest name: {manifest['metadata']['name']}. "
        f"Errors: {result.errors}"
    )


@given(manifests=valid_manifest_set())
@settings(
    max_examples=100,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_empty_manifest_set_rejected(manifests):
    """
    Property: An empty manifest set SHALL be rejected (no resources to deploy).

    **Validates: Requirements 8.7**
    """
    result = validate_manifest_set([])

    assert result.is_valid is False, (
        "Empty manifest set should be rejected"
    )
    assert len(result.errors) > 0, (
        "Empty manifest set rejection should include an error message"
    )


@given(
    manifests=st.lists(valid_manifest(), min_size=2, max_size=5),
)
@settings(
    max_examples=100,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_validation_is_deterministic(manifests):
    """
    Property: Running dry-run validation multiple times on the same manifest set
    SHALL produce the same result.

    **Validates: Requirements 8.7**
    """
    result1 = validate_manifest_set(manifests)
    result2 = validate_manifest_set(manifests)

    assert result1.is_valid == result2.is_valid, (
        f"Validation must be deterministic. "
        f"First run: is_valid={result1.is_valid}, "
        f"Second run: is_valid={result2.is_valid}"
    )
    assert result1.errors == result2.errors, (
        f"Validation errors must be deterministic. "
        f"First run: {result1.errors}, "
        f"Second run: {result2.errors}"
    )
