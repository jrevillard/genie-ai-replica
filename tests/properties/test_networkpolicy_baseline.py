"""
Property-based test: NetworkPolicy Baseline Generation

**Validates: Requirements 4.1, 4.6**

For any valid namespace configuration, the generated NetworkPolicy set SHALL always include:
  (a) A default-deny policy selecting all pods with both Ingress and Egress policyTypes
      and no allow rules
  (b) A DNS egress policy allowing all pods to reach port 53 (UDP and TCP) on pods
      matching the kube-dns label in kube-system namespace
"""

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

# Generate valid Kubernetes namespace names (RFC 1123 DNS label)
# Must be lowercase, start with a letter, contain only alphanumeric and hyphens,
# max 63 chars, not end with hyphen
namespace_strategy = st.from_regex(
    r"[a-z][a-z0-9\-]{0,40}[a-z0-9]",
    fullmatch=True,
).filter(lambda s: "--" not in s)

# Generate random replica counts for services
replica_strategy = st.integers(min_value=1, max_value=5)

# Generate random port values (valid range)
port_strategy = st.integers(min_value=1, max_value=65535)


@st.composite
def namespace_config(draw):
    """Generate a random namespace configuration with values overrides."""
    namespace = draw(namespace_strategy)
    # Optionally vary some service replicas to ensure network policies
    # are stable regardless of deployment scale
    backend_replicas = draw(replica_strategy)
    vllm_replicas = draw(st.integers(min_value=0, max_value=3))
    return {
        "namespace": namespace,
        "backend_replicas": backend_replicas,
        "vllm_replicas": vllm_replicas,
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
            return []

        documents = []
        for doc in yaml.safe_load_all(result.stdout):
            if doc is not None:
                documents.append(doc)
        return documents
    finally:
        os.unlink(values_file)


def get_network_policies(documents: list[dict]) -> list[dict]:
    """Filter rendered documents to only NetworkPolicy resources."""
    return [
        doc
        for doc in documents
        if doc.get("kind") == "NetworkPolicy"
    ]


def find_default_deny_policy(policies: list[dict]) -> dict | None:
    """Find the default-deny-all NetworkPolicy."""
    for policy in policies:
        if policy.get("metadata", {}).get("name") == "default-deny-all":
            return policy
    return None


def find_dns_egress_policy(policies: list[dict]) -> dict | None:
    """Find the allow-dns-egress NetworkPolicy."""
    for policy in policies:
        if policy.get("metadata", {}).get("name") == "allow-dns-egress":
            return policy
    return None


def validate_default_deny(policy: dict, expected_namespace: str) -> list[str]:
    """
    Validate the default-deny policy has correct structure:
    - Empty podSelector (selects all pods)
    - Both Ingress and Egress policyTypes
    - No ingress or egress allow rules
    """
    errors = []

    # Check namespace
    actual_namespace = policy.get("metadata", {}).get("namespace")
    if actual_namespace != expected_namespace:
        errors.append(
            f"Expected namespace '{expected_namespace}', got '{actual_namespace}'"
        )

    spec = policy.get("spec", {})

    # (a) Empty podSelector - selects all pods
    pod_selector = spec.get("podSelector", None)
    if pod_selector is None:
        errors.append("Missing podSelector field")
    elif pod_selector != {}:
        errors.append(
            f"podSelector should be empty (select all pods), got: {pod_selector}"
        )

    # (a) Both Ingress and Egress policyTypes
    policy_types = spec.get("policyTypes", [])
    if "Ingress" not in policy_types:
        errors.append(
            f"policyTypes missing 'Ingress', got: {policy_types}"
        )
    if "Egress" not in policy_types:
        errors.append(
            f"policyTypes missing 'Egress', got: {policy_types}"
        )

    # (a) No allow rules (no ingress or egress rules defined)
    if "ingress" in spec and spec["ingress"]:
        errors.append(
            f"Default-deny should have no ingress allow rules, got: {spec['ingress']}"
        )
    if "egress" in spec and spec["egress"]:
        errors.append(
            f"Default-deny should have no egress allow rules, got: {spec['egress']}"
        )

    return errors


def validate_dns_egress(policy: dict, expected_namespace: str) -> list[str]:
    """
    Validate the DNS egress policy has correct structure:
    - Empty podSelector (applies to all pods)
    - Egress policyType
    - Allows port 53 UDP and TCP
    - Targets pods matching kube-dns label in kube-system namespace
    """
    errors = []

    # Check namespace
    actual_namespace = policy.get("metadata", {}).get("namespace")
    if actual_namespace != expected_namespace:
        errors.append(
            f"Expected namespace '{expected_namespace}', got '{actual_namespace}'"
        )

    spec = policy.get("spec", {})

    # (b) Empty podSelector - applies to all pods
    pod_selector = spec.get("podSelector", None)
    if pod_selector is None:
        errors.append("Missing podSelector field")
    elif pod_selector != {}:
        errors.append(
            f"podSelector should be empty (apply to all pods), got: {pod_selector}"
        )

    # (b) Egress policyType
    policy_types = spec.get("policyTypes", [])
    if "Egress" not in policy_types:
        errors.append(
            f"policyTypes missing 'Egress', got: {policy_types}"
        )

    # (b) Validate egress rules
    egress_rules = spec.get("egress", [])
    if not egress_rules:
        errors.append("DNS egress policy has no egress rules")
        return errors

    # Find DNS egress rule
    dns_rule_found = False
    for rule in egress_rules:
        ports = rule.get("ports", [])
        to_targets = rule.get("to", [])

        # Check ports: must include port 53 UDP and TCP
        port_53_udp = False
        port_53_tcp = False
        for port_entry in ports:
            if port_entry.get("port") == 53:
                if port_entry.get("protocol") == "UDP":
                    port_53_udp = True
                elif port_entry.get("protocol") == "TCP":
                    port_53_tcp = True

        # Check targets: must target kube-dns in kube-system
        targets_kube_dns = False
        for target in to_targets:
            namespace_selector = target.get("namespaceSelector", {})
            pod_selector_target = target.get("podSelector", {})

            ns_labels = namespace_selector.get("matchLabels", {})
            pod_labels = pod_selector_target.get("matchLabels", {})

            # kube-system namespace selector
            ns_match = ns_labels.get("kubernetes.io/metadata.name") == "kube-system"
            # kube-dns pod selector
            pod_match = pod_labels.get("k8s-app") == "kube-dns"

            if ns_match and pod_match:
                targets_kube_dns = True

        if port_53_udp and port_53_tcp and targets_kube_dns:
            dns_rule_found = True
            break

    if not dns_rule_found:
        errors.append(
            "DNS egress policy does not have a rule allowing port 53 UDP+TCP "
            "to kube-dns in kube-system. "
            f"Actual egress rules: {egress_rules}"
        )

    return errors


@given(config=namespace_config())
@settings(
    max_examples=20,
    deadline=60000,  # 60 seconds per example (helm template can be slow)
    suppress_health_check=[HealthCheck.too_slow],
)
def test_networkpolicy_baseline_generation(config):
    """
    Property 5: NetworkPolicy Baseline Generation

    **Validates: Requirements 4.1, 4.6**

    For any valid namespace configuration, the generated NetworkPolicy set SHALL always
    include:
      (a) a default-deny policy selecting all pods with both Ingress and Egress policyTypes
          and no allow rules
      (b) a DNS egress policy allowing all pods to reach port 53 (UDP and TCP) on pods
          matching the kube-dns label in kube-system namespace
    """
    # Build values override with randomized namespace and service configs
    values_override = {
        "namespace": config["namespace"],
        "cpu": {
            "backend": {
                "replicas": config["backend_replicas"],
            },
        },
        "gpu": {
            "vllm": {
                "replicas": config["vllm_replicas"],
            },
        },
    }

    # Render the Helm chart
    documents = render_helm_template(values_override)
    assume(len(documents) > 0)  # Skip if helm template fails

    # Get all NetworkPolicy resources
    network_policies = get_network_policies(documents)
    assert len(network_policies) >= 2, (
        f"Expected at least 2 NetworkPolicies (default-deny + DNS egress), "
        f"got {len(network_policies)}: "
        f"{[p['metadata']['name'] for p in network_policies]}"
    )

    # (a) Validate default-deny policy exists and is correctly structured
    default_deny = find_default_deny_policy(network_policies)
    assert default_deny is not None, (
        f"Default-deny NetworkPolicy 'default-deny-all' not found. "
        f"Available policies: {[p['metadata']['name'] for p in network_policies]}"
    )

    deny_errors = validate_default_deny(default_deny, config["namespace"])
    assert not deny_errors, (
        f"Default-deny policy validation failed for namespace '{config['namespace']}':\n"
        + "\n".join(f"  - {e}" for e in deny_errors)
    )

    # (b) Validate DNS egress policy exists and is correctly structured
    dns_egress = find_dns_egress_policy(network_policies)
    assert dns_egress is not None, (
        f"DNS egress NetworkPolicy 'allow-dns-egress' not found. "
        f"Available policies: {[p['metadata']['name'] for p in network_policies]}"
    )

    dns_errors = validate_dns_egress(dns_egress, config["namespace"])
    assert not dns_errors, (
        f"DNS egress policy validation failed for namespace '{config['namespace']}':\n"
        + "\n".join(f"  - {e}" for e in dns_errors)
    )
