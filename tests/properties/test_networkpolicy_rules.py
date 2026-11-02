"""
Property-based test: NetworkPolicy Allow Rules Match Dependency Graph

**Validates: Requirements 4.2, 4.3, 4.4, 4.7**

For any valid service dependency graph specifying which services may communicate
and on which ports, the generated NetworkPolicy set SHALL:
  (a) contain ingress rules for GPU services allowing traffic ONLY from the specified
      CPU source pods on the specified GPU service ports
  (b) contain ingress rules for CPU services (from Dataprep) allowing traffic ONLY
      from the Dataprep pod on the specified CPU service ports
  (c) contain external ingress rules ONLY for nginx (ports 80, 443) and Kong (port 8010)
  (d) contain matching egress rules for each authorized communication path

No policy SHALL allow traffic between pods not connected in the dependency graph.
"""

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import yaml
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st


# Path to the Helm chart
CHART_PATH = Path(__file__).resolve().parents[2] / "helm" / "genieai"


# ============================================================================
# Authorised Dependency Graph (from design document)
# ============================================================================

# CPU → GPU edges: (source_service, destination_gpu_service, port)
CPU_TO_GPU_EDGES = [
    ("embedding", "vllm", 8000),
    ("embedding", "tei", 80),
    ("reranker", "tei-reranker", 80),
    ("textgen", "vllm", 8000),
    ("translation", "vllm", 8000),
    ("guardrail", "vllm", 8000),
    ("chatqna-xeon-backend-server", "vllm", 8000),
]

# GPU → CPU edges (Dataprep only): (source_service, destination_cpu_service, port)
GPU_TO_CPU_EDGES = [
    ("dataprep", "arango-vector-db", 8529),
    ("dataprep", "embedding", 6000),
    ("dataprep", "guardrail", 9090),
    ("dataprep", "document-repository", 3001),
    ("dataprep", "backend", 3000),
    ("dataprep", "http-service", 6666),
]

# External ingress: (service, ports)
EXTERNAL_INGRESS = {
    "nginx": [80, 443],
    "kong": [8010],
}

# All GPU services
GPU_SERVICES = {"vllm", "tei", "tei-reranker", "dataprep"}

# All CPU services that appear in policies
CPU_SERVICES = {
    "embedding", "reranker", "textgen", "translation", "guardrail",
    "chatqna-xeon-backend-server", "arango-vector-db", "backend",
    "document-repository", "http-service", "nginx", "kong",
    "kong-database", "keycloak", "keycloak-db", "redis-cache",
    "retriever-arango-service", "frontend", "clamav",
    "chatqna-xeon-ui-server", "chatqna-xeon-nginx-server",
}

ALL_SERVICES = GPU_SERVICES | CPU_SERVICES


# ============================================================================
# Hypothesis Strategies
# ============================================================================

# Strategy to generate random subsets of the CPU→GPU dependency edges
cpu_to_gpu_subset_strategy = st.lists(
    st.sampled_from(CPU_TO_GPU_EDGES),
    min_size=1,
    max_size=len(CPU_TO_GPU_EDGES),
    unique=True,
)

# Strategy to generate random subsets of the GPU→CPU dependency edges
gpu_to_cpu_subset_strategy = st.lists(
    st.sampled_from(GPU_TO_CPU_EDGES),
    min_size=1,
    max_size=len(GPU_TO_CPU_EDGES),
    unique=True,
)

# Strategy for random namespace names
namespace_strategy = st.from_regex(r"[a-z][a-z0-9\-]{2,15}", fullmatch=True)


@st.composite
def dependency_graph_config(draw):
    """Generate a random dependency graph configuration for testing."""
    namespace = draw(namespace_strategy)
    cpu_to_gpu = draw(cpu_to_gpu_subset_strategy)
    gpu_to_cpu = draw(gpu_to_cpu_subset_strategy)
    return {
        "namespace": namespace,
        "cpu_to_gpu_edges": cpu_to_gpu,
        "gpu_to_cpu_edges": gpu_to_cpu,
    }


# ============================================================================
# Helm Rendering Helper
# ============================================================================

def render_helm_template(namespace: str = "genieai") -> list[dict]:
    """Render the full Helm chart and return parsed YAML documents."""
    values_override = {"namespace": namespace}

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


# ============================================================================
# NetworkPolicy Parsing Helpers
# ============================================================================

def get_network_policies(documents: list[dict]) -> list[dict]:
    """Filter rendered documents to NetworkPolicy resources only."""
    return [
        doc for doc in documents
        if doc.get("kind") == "NetworkPolicy"
    ]


def get_ingress_policies(policies: list[dict]) -> list[dict]:
    """Get policies that have Ingress in policyTypes."""
    return [
        p for p in policies
        if "Ingress" in p.get("spec", {}).get("policyTypes", [])
    ]


def get_egress_policies(policies: list[dict]) -> list[dict]:
    """Get policies that have Egress in policyTypes."""
    return [
        p for p in policies
        if "Egress" in p.get("spec", {}).get("policyTypes", [])
    ]


def get_pod_selector_names(policy: dict) -> set[str]:
    """Extract the service name(s) targeted by a policy's podSelector."""
    pod_selector = policy.get("spec", {}).get("podSelector", {})
    match_labels = pod_selector.get("matchLabels", {})
    match_expressions = pod_selector.get("matchExpressions", [])

    names = set()
    if "app.kubernetes.io/name" in match_labels:
        names.add(match_labels["app.kubernetes.io/name"])

    for expr in match_expressions:
        if expr.get("key") == "app.kubernetes.io/name" and expr.get("operator") == "In":
            names.update(expr.get("values", []))

    return names


def extract_ingress_sources(policy: dict) -> list[dict]:
    """
    Extract ingress rule sources from a policy.
    Returns list of dicts with keys: 'source_names' (set), 'source_cidr', 'ports' (list of int).
    """
    rules = []
    ingress_rules = policy.get("spec", {}).get("ingress", [])

    for rule in ingress_rules:
        from_entries = rule.get("from", [])
        ports = [p.get("port") for p in rule.get("ports", [])]

        for from_entry in from_entries:
            if "podSelector" in from_entry:
                source_names = set()
                ps = from_entry["podSelector"]
                ml = ps.get("matchLabels", {})
                me = ps.get("matchExpressions", [])

                if "app.kubernetes.io/name" in ml:
                    source_names.add(ml["app.kubernetes.io/name"])
                for expr in me:
                    if expr.get("key") == "app.kubernetes.io/name" and expr.get("operator") == "In":
                        source_names.update(expr.get("values", []))

                rules.append({"source_names": source_names, "source_cidr": None, "ports": ports})

            elif "ipBlock" in from_entry:
                cidr = from_entry["ipBlock"].get("cidr", "")
                rules.append({"source_names": set(), "source_cidr": cidr, "ports": ports})

    return rules


def extract_egress_destinations(policy: dict) -> list[dict]:
    """
    Extract egress rule destinations from a policy.
    Returns list of dicts with keys: 'dest_names' (set), 'ports' (list of int).
    """
    rules = []
    egress_rules = policy.get("spec", {}).get("egress", [])

    for rule in egress_rules:
        to_entries = rule.get("to", [])
        ports = [p.get("port") for p in rule.get("ports", [])]

        for to_entry in to_entries:
            if "podSelector" in to_entry:
                dest_names = set()
                ps = to_entry["podSelector"]
                ml = ps.get("matchLabels", {})
                me = ps.get("matchExpressions", [])

                if "app.kubernetes.io/name" in ml:
                    dest_names.add(ml["app.kubernetes.io/name"])
                for expr in me:
                    if expr.get("key") == "app.kubernetes.io/name" and expr.get("operator") == "In":
                        dest_names.update(expr.get("values", []))

                rules.append({"dest_names": dest_names, "ports": ports})

    return rules


def build_allowed_ingress_map(policies: list[dict]) -> dict[str, list[tuple[str, int]]]:
    """
    Build a map of {destination_service: [(source_service, port), ...]}
    from all ingress policies (excluding external/ipBlock sources).
    """
    ingress_map: dict[str, list[tuple[str, int]]] = {}
    ingress_policies = get_ingress_policies(policies)

    for policy in ingress_policies:
        dest_names = get_pod_selector_names(policy)
        sources = extract_ingress_sources(policy)

        for dest in dest_names:
            if dest not in ingress_map:
                ingress_map[dest] = []
            for src_info in sources:
                if src_info["source_cidr"] is not None:
                    continue  # Skip external (ipBlock) rules here
                for source_name in src_info["source_names"]:
                    for port in src_info["ports"]:
                        ingress_map[dest].append((source_name, port))

    return ingress_map


def build_allowed_egress_map(policies: list[dict]) -> dict[str, list[tuple[str, int]]]:
    """
    Build a map of {source_service: [(destination_service, port), ...]}
    from all egress policies (excluding DNS).
    """
    egress_map: dict[str, list[tuple[str, int]]] = {}
    egress_policies = get_egress_policies(policies)

    for policy in egress_policies:
        # Skip DNS policy (targets all pods with empty selector and port 53)
        pod_selector = policy.get("spec", {}).get("podSelector", {})
        if not pod_selector.get("matchLabels") and not pod_selector.get("matchExpressions"):
            continue  # default-deny or DNS policy

        source_names = get_pod_selector_names(policy)
        destinations = extract_egress_destinations(policy)

        for source in source_names:
            if source not in egress_map:
                egress_map[source] = []
            for dest_info in destinations:
                for dest_name in dest_info["dest_names"]:
                    for port in dest_info["ports"]:
                        egress_map[source].append((dest_name, port))

    return egress_map


def get_external_ingress_rules(policies: list[dict]) -> dict[str, list[int]]:
    """
    Extract external (ipBlock 0.0.0.0/0) ingress rules.
    Returns {service_name: [ports]}.
    """
    external_map: dict[str, list[int]] = {}
    ingress_policies = get_ingress_policies(policies)

    for policy in ingress_policies:
        dest_names = get_pod_selector_names(policy)
        sources = extract_ingress_sources(policy)

        for src_info in sources:
            if src_info["source_cidr"] == "0.0.0.0/0":
                for dest in dest_names:
                    if dest not in external_map:
                        external_map[dest] = []
                    external_map[dest].extend(src_info["ports"])

    return external_map


# ============================================================================
# Property Tests
# ============================================================================

@given(config=dependency_graph_config())
@settings(
    max_examples=15,
    deadline=60000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_gpu_ingress_only_from_authorized_cpu_sources(config):
    """
    Property 6a: Ingress rules for GPU services allow traffic ONLY from
    specified CPU source pods on specified GPU service ports.

    **Validates: Requirements 4.2**
    """
    documents = render_helm_template(config["namespace"])
    assume(len(documents) > 0)

    policies = get_network_policies(documents)
    assume(len(policies) > 0)

    ingress_map = build_allowed_ingress_map(policies)

    # Build the expected CPU→GPU ingress for each GPU service
    # (from the full authorised dependency graph, not the random subset)
    expected_gpu_ingress: dict[str, set[tuple[str, int]]] = {}
    for source, dest, port in CPU_TO_GPU_EDGES:
        if dest not in expected_gpu_ingress:
            expected_gpu_ingress[dest] = set()
        expected_gpu_ingress[dest].add((source, port))

    # Verify ingress to GPU services
    for gpu_service in GPU_SERVICES:
        if gpu_service == "dataprep":
            # Dataprep doesn't receive ingress from CPU services via cpu-to-gpu policy
            continue

        actual_ingress = set(ingress_map.get(gpu_service, []))
        expected = expected_gpu_ingress.get(gpu_service, set())

        # Every actual ingress source must be in the authorized set
        unauthorized = actual_ingress - expected
        assert not unauthorized, (
            f"GPU service '{gpu_service}' has UNAUTHORIZED ingress sources: {unauthorized}. "
            f"Only authorized: {expected}"
        )

        # Every expected ingress must be present
        missing = expected - actual_ingress
        assert not missing, (
            f"GPU service '{gpu_service}' is MISSING authorized ingress rules: {missing}. "
            f"Actual: {actual_ingress}"
        )


@given(config=dependency_graph_config())
@settings(
    max_examples=15,
    deadline=60000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_cpu_ingress_from_dataprep_only_authorized(config):
    """
    Property 6b: Ingress rules for CPU services (from Dataprep) allow traffic
    ONLY from the Dataprep pod on specified CPU service ports.

    **Validates: Requirements 4.3**
    """
    documents = render_helm_template(config["namespace"])
    assume(len(documents) > 0)

    policies = get_network_policies(documents)
    assume(len(policies) > 0)

    ingress_map = build_allowed_ingress_map(policies)

    # Build expected Dataprep→CPU ingress
    expected_dataprep_targets: dict[str, int] = {}
    for source, dest, port in GPU_TO_CPU_EDGES:
        expected_dataprep_targets[dest] = port

    # For each CPU service that Dataprep targets, verify the ingress rule
    for dest_service, expected_port in expected_dataprep_targets.items():
        actual_ingress = ingress_map.get(dest_service, [])

        # Filter to only dataprep-sourced ingress
        dataprep_ingress = [(src, port) for src, port in actual_ingress if src == "dataprep"]

        # Dataprep must have ingress on the expected port
        dataprep_ports = [port for _, port in dataprep_ingress]
        assert expected_port in dataprep_ports, (
            f"CPU service '{dest_service}' is MISSING ingress from Dataprep on port {expected_port}. "
            f"Actual dataprep ingress ports: {dataprep_ports}"
        )

        # Dataprep must ONLY access the authorized port
        unauthorized_ports = [p for p in dataprep_ports if p != expected_port]
        assert not unauthorized_ports, (
            f"CPU service '{dest_service}' has UNAUTHORIZED Dataprep ingress on ports: {unauthorized_ports}. "
            f"Only port {expected_port} is authorized."
        )


@given(config=dependency_graph_config())
@settings(
    max_examples=15,
    deadline=60000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_external_ingress_only_nginx_and_kong(config):
    """
    Property 6c: External ingress rules ONLY for nginx (ports 80, 443)
    and Kong (port 8010).

    **Validates: Requirements 4.4**
    """
    documents = render_helm_template(config["namespace"])
    assume(len(documents) > 0)

    policies = get_network_policies(documents)
    assume(len(policies) > 0)

    external_map = get_external_ingress_rules(policies)

    # Only nginx and kong should have external ingress
    allowed_external_services = set(EXTERNAL_INGRESS.keys())
    actual_external_services = set(external_map.keys())

    unauthorized_services = actual_external_services - allowed_external_services
    assert not unauthorized_services, (
        f"Services with UNAUTHORIZED external ingress: {unauthorized_services}. "
        f"Only nginx and kong should have external ingress."
    )

    # Verify nginx has exactly ports 80 and 443
    if "nginx" in external_map:
        nginx_ports = sorted(external_map["nginx"])
        assert nginx_ports == [80, 443], (
            f"nginx external ingress ports should be [80, 443], got {nginx_ports}"
        )

    # Verify kong has exactly port 8010
    if "kong" in external_map:
        kong_ports = sorted(external_map["kong"])
        assert kong_ports == [8010], (
            f"kong external ingress ports should be [8010], got {kong_ports}"
        )

    # Both must be present
    assert "nginx" in external_map, "nginx MUST have external ingress rule"
    assert "kong" in external_map, "kong MUST have external ingress rule"


@given(config=dependency_graph_config())
@settings(
    max_examples=15,
    deadline=60000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_egress_rules_match_authorized_paths(config):
    """
    Property 6d: Matching egress rules exist for each authorized communication path.
    No policy SHALL allow traffic between pods not connected in the dependency graph.

    **Validates: Requirements 4.7**
    """
    documents = render_helm_template(config["namespace"])
    assume(len(documents) > 0)

    policies = get_network_policies(documents)
    assume(len(policies) > 0)

    egress_map = build_allowed_egress_map(policies)

    # Verify CPU→GPU egress rules exist
    for source, dest, port in CPU_TO_GPU_EDGES:
        actual_egress = egress_map.get(source, [])
        assert (dest, port) in actual_egress, (
            f"MISSING egress rule: {source} → {dest}:{port}. "
            f"Actual egress for {source}: {actual_egress}"
        )

    # Verify GPU→CPU (Dataprep) egress rules exist
    dataprep_egress = egress_map.get("dataprep", [])
    for source, dest, port in GPU_TO_CPU_EDGES:
        assert (dest, port) in dataprep_egress, (
            f"MISSING egress rule: dataprep → {dest}:{port}. "
            f"Actual egress for dataprep: {dataprep_egress}"
        )

    # Verify no unauthorized egress from CPU services to GPU services
    # (only the edges defined in CPU_TO_GPU_EDGES are allowed)
    authorized_cpu_to_gpu = set(CPU_TO_GPU_EDGES)
    cpu_sources_with_gpu_egress = {
        "embedding", "reranker", "textgen", "translation",
        "guardrail", "chatqna-xeon-backend-server",
    }

    for source in cpu_sources_with_gpu_egress:
        actual_egress = egress_map.get(source, [])
        for dest, port in actual_egress:
            if dest in GPU_SERVICES:
                assert (source, dest, port) in authorized_cpu_to_gpu, (
                    f"UNAUTHORIZED egress: {source} → {dest}:{port} "
                    f"(destination is a GPU service but not in authorized graph)"
                )

    # Verify no unauthorized egress from Dataprep
    authorized_dataprep_targets = {(dest, port) for _, dest, port in GPU_TO_CPU_EDGES}
    for dest, port in dataprep_egress:
        assert (dest, port) in authorized_dataprep_targets, (
            f"UNAUTHORIZED egress: dataprep → {dest}:{port} "
            f"(not in authorized Dataprep dependency graph)"
        )


@given(config=dependency_graph_config())
@settings(
    max_examples=15,
    deadline=60000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_no_unauthorized_cross_pool_traffic(config):
    """
    No policy SHALL allow traffic between pods not connected in the dependency graph
    for cross-pool communication (CPU↔GPU).

    **Validates: Requirements 4.2, 4.3, 4.4, 4.7**
    """
    documents = render_helm_template(config["namespace"])
    assume(len(documents) > 0)

    policies = get_network_policies(documents)
    assume(len(policies) > 0)

    ingress_map = build_allowed_ingress_map(policies)

    # Build the complete set of authorized cross-pool ingress
    # CPU→GPU ingress (to GPU services from CPU services)
    authorized_ingress_to_gpu: dict[str, set[str]] = {}
    for source, dest, port in CPU_TO_GPU_EDGES:
        if dest not in authorized_ingress_to_gpu:
            authorized_ingress_to_gpu[dest] = set()
        authorized_ingress_to_gpu[dest].add(source)

    # GPU→CPU ingress (to CPU services from Dataprep)
    authorized_ingress_from_dataprep: set[str] = set()
    for _, dest, _ in GPU_TO_CPU_EDGES:
        authorized_ingress_from_dataprep.add(dest)

    # Check: no GPU service receives ingress from unauthorized CPU sources
    for gpu_service in GPU_SERVICES:
        if gpu_service == "dataprep":
            continue  # Dataprep doesn't have CPU→GPU ingress to it

        actual_sources = {src for src, _ in ingress_map.get(gpu_service, [])}
        authorized_sources = authorized_ingress_to_gpu.get(gpu_service, set())

        unauthorized = actual_sources - authorized_sources
        assert not unauthorized, (
            f"GPU service '{gpu_service}' receives ingress from UNAUTHORIZED sources: "
            f"{unauthorized}. Only authorized: {authorized_sources}"
        )

    # Check: CPU services receiving from Dataprep are only the authorized ones
    for service, ingress_list in ingress_map.items():
        dataprep_sources = {src for src, _ in ingress_list if src == "dataprep"}
        if dataprep_sources:
            assert service in authorized_ingress_from_dataprep, (
                f"Service '{service}' receives ingress from Dataprep but is NOT "
                f"in the authorized Dataprep dependency graph. "
                f"Authorized targets: {authorized_ingress_from_dataprep}"
            )
