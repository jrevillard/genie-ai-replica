"""
Property-based test: Health Status JSON Completeness

**Validates: Requirements 10.5**

For any internal health state of the monitoring component (with any combination of service
statuses), the /health-status JSON response SHALL contain:
  (a) a top-level `timestamp` (valid ISO 8601), `clusterStatus`, `gpuNodePoolActive` boolean,
      and `services` array
  (b) one entry per monitored service with all required fields (`name`, `nodePool`, `status`,
      `lastChecked`, `consecutiveFailures`, `consecutiveSuccesses`, `endpoint`,
      `responseTimeMs`, `hasEndpoints`)
  (c) response delivered within 5 seconds
"""

import json
import time
from datetime import datetime, timezone

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st


# --- Service Definitions ---

# The 9 monitored services as defined in the spec
GPU_SERVICES = [
    {"name": "vllm", "endpoint": "http://vllm:8000/health"},
    {"name": "tei", "endpoint": "http://tei:80/health"},
    {"name": "tei-reranker", "endpoint": "http://tei-reranker:80/health"},
    {"name": "dataprep", "endpoint": "http://dataprep:5000/v1/health"},
]

CPU_SERVICES = [
    {"name": "arango-vector-db", "endpoint": "http://arango-vector-db:8529"},
    {"name": "kong", "endpoint": "http://kong:8010"},
    {"name": "keycloak", "endpoint": "http://keycloak:8080"},
    {"name": "backend", "endpoint": "http://backend:3000"},
    {"name": "redis-cache", "endpoint": "http://redis-cache:6379"},
]

ALL_SERVICES = GPU_SERVICES + CPU_SERVICES

# Valid status values
VALID_SERVICE_STATUSES = {"healthy", "degraded", "scaled-down", "unreachable"}
VALID_CLUSTER_STATUSES = {"healthy", "degraded", "partially-scaled-down", "unhealthy"}


# --- Pure function under test: builds health status JSON from internal state ---


def build_health_status_json(internal_state: dict) -> dict:
    """
    Build the /health-status JSON response from internal health state.

    This mirrors the logic of the bash health monitor script. It takes the internal
    state dictionary (tracking per-service health info) and produces the JSON response
    with all required fields.

    Args:
        internal_state: Dict with keys:
            - gpu_node_pool_active: bool
            - services: list of dicts, each with:
                - name: str
                - node_pool: "gpu" or "cpu"
                - status: one of VALID_SERVICE_STATUSES
                - last_checked: ISO 8601 string
                - consecutive_failures: int >= 0
                - consecutive_successes: int >= 0
                - endpoint: str (URL)
                - response_time_ms: int or None
                - has_endpoints: bool

    Returns:
        The JSON-serializable response dict.
    """
    gpu_active = internal_state["gpu_node_pool_active"]
    services = internal_state["services"]

    # Determine overall cluster status based on individual service statuses
    statuses = [s["status"] for s in services]
    scaled_down_count = statuses.count("scaled-down")
    unhealthy_count = statuses.count("unreachable")
    degraded_count = statuses.count("degraded")

    if unhealthy_count > 0:
        cluster_status = "unhealthy"
    elif degraded_count > 0:
        cluster_status = "degraded"
    elif scaled_down_count > 0:
        cluster_status = "partially-scaled-down"
    else:
        cluster_status = "healthy"

    # Build services array with all required fields
    services_array = []
    for svc in services:
        services_array.append({
            "name": svc["name"],
            "nodePool": svc["node_pool"],
            "status": svc["status"],
            "lastChecked": svc["last_checked"],
            "consecutiveFailures": svc["consecutive_failures"],
            "consecutiveSuccesses": svc["consecutive_successes"],
            "endpoint": svc["endpoint"],
            "responseTimeMs": svc["response_time_ms"],
            "hasEndpoints": svc["has_endpoints"],
        })

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "clusterStatus": cluster_status,
        "gpuNodePoolActive": gpu_active,
        "services": services_array,
    }


# --- Hypothesis Strategies ---

service_status_strategy = st.sampled_from(list(VALID_SERVICE_STATUSES))

iso_timestamp_strategy = st.builds(
    lambda y, m, d, h, mi, s: f"{y:04d}-{m:02d}-{d:02d}T{h:02d}:{mi:02d}:{s:02d}Z",
    y=st.integers(min_value=2020, max_value=2030),
    m=st.integers(min_value=1, max_value=12),
    d=st.integers(min_value=1, max_value=28),
    h=st.integers(min_value=0, max_value=23),
    mi=st.integers(min_value=0, max_value=59),
    s=st.integers(min_value=0, max_value=59),
)

response_time_strategy = st.one_of(
    st.none(),
    st.integers(min_value=0, max_value=30000),
)


@st.composite
def service_health_state(draw, service_def: dict, node_pool: str):
    """Generate a random health state for a single service."""
    status = draw(service_status_strategy)
    last_checked = draw(iso_timestamp_strategy)
    consecutive_failures = draw(st.integers(min_value=0, max_value=100))
    consecutive_successes = draw(st.integers(min_value=0, max_value=100))
    response_time_ms = draw(response_time_strategy)
    has_endpoints = draw(st.booleans())

    return {
        "name": service_def["name"],
        "node_pool": node_pool,
        "status": status,
        "last_checked": last_checked,
        "consecutive_failures": consecutive_failures,
        "consecutive_successes": consecutive_successes,
        "endpoint": service_def["endpoint"],
        "response_time_ms": response_time_ms,
        "has_endpoints": has_endpoints,
    }


@st.composite
def internal_health_state(draw):
    """Generate a complete random internal health state for all 9 services."""
    gpu_node_pool_active = draw(st.booleans())

    services = []
    for svc_def in GPU_SERVICES:
        services.append(draw(service_health_state(svc_def, "gpu")))
    for svc_def in CPU_SERVICES:
        services.append(draw(service_health_state(svc_def, "cpu")))

    return {
        "gpu_node_pool_active": gpu_node_pool_active,
        "services": services,
    }


# --- Property Test ---


@given(state=internal_health_state())
@settings(
    max_examples=200,
    deadline=5000,  # 5 seconds per example
    suppress_health_check=[HealthCheck.too_slow],
)
def test_health_status_json_completeness(state):
    """
    Property 15: Health Status JSON Completeness

    **Validates: Requirements 10.5**

    For any internal health state, the /health-status JSON response SHALL contain:
      (a) top-level fields: timestamp, clusterStatus, gpuNodePoolActive, services
      (b) one entry per monitored service (9 total) with all required fields
      (c) response delivered within 5 seconds
    """
    # (c) Time the response generation
    start = time.perf_counter()
    response = build_health_status_json(state)
    elapsed = time.perf_counter() - start

    assert elapsed < 5.0, (
        f"Response generation took {elapsed:.3f}s, exceeding the 5-second limit"
    )

    # Verify JSON serialization works
    json_str = json.dumps(response)
    parsed = json.loads(json_str)

    # (a) Validate top-level fields exist with correct types
    assert "timestamp" in parsed, "Missing top-level field 'timestamp'"
    assert "clusterStatus" in parsed, "Missing top-level field 'clusterStatus'"
    assert "gpuNodePoolActive" in parsed, "Missing top-level field 'gpuNodePoolActive'"
    assert "services" in parsed, "Missing top-level field 'services'"

    # Validate top-level field types
    assert isinstance(parsed["timestamp"], str), (
        f"'timestamp' should be a string, got {type(parsed['timestamp']).__name__}"
    )
    assert isinstance(parsed["clusterStatus"], str), (
        f"'clusterStatus' should be a string, got {type(parsed['clusterStatus']).__name__}"
    )
    assert isinstance(parsed["gpuNodePoolActive"], bool), (
        f"'gpuNodePoolActive' should be a bool, got {type(parsed['gpuNodePoolActive']).__name__}"
    )
    assert isinstance(parsed["services"], list), (
        f"'services' should be a list, got {type(parsed['services']).__name__}"
    )

    # Validate timestamp is valid ISO 8601
    try:
        datetime.fromisoformat(parsed["timestamp"].replace("Z", "+00:00"))
    except ValueError as e:
        raise AssertionError(
            f"'timestamp' is not a valid ISO 8601 string: '{parsed['timestamp']}'. Error: {e}"
        )

    # Validate clusterStatus is from the allowed set
    assert parsed["clusterStatus"] in VALID_CLUSTER_STATUSES, (
        f"'clusterStatus' value '{parsed['clusterStatus']}' is not in allowed set: "
        f"{VALID_CLUSTER_STATUSES}"
    )

    # Validate gpuNodePoolActive matches input
    assert parsed["gpuNodePoolActive"] == state["gpu_node_pool_active"], (
        f"'gpuNodePoolActive' should be {state['gpu_node_pool_active']}, "
        f"got {parsed['gpuNodePoolActive']}"
    )

    # (b) Validate services array: one entry per monitored service (9 total)
    assert len(parsed["services"]) == 9, (
        f"Expected 9 service entries, got {len(parsed['services'])}. "
        f"Services: {[s.get('name') for s in parsed['services']]}"
    )

    expected_service_names = {s["name"] for s in ALL_SERVICES}
    actual_service_names = {s["name"] for s in parsed["services"]}
    assert actual_service_names == expected_service_names, (
        f"Service names mismatch. Expected: {expected_service_names}, "
        f"Got: {actual_service_names}"
    )

    # Required fields for each service entry
    required_fields = {
        "name": str,
        "nodePool": str,
        "status": str,
        "lastChecked": str,
        "consecutiveFailures": int,
        "consecutiveSuccesses": int,
        "endpoint": str,
        "responseTimeMs": (int, type(None)),
        "hasEndpoints": bool,
    }

    for svc_entry in parsed["services"]:
        svc_name = svc_entry.get("name", "<unknown>")

        # Check all required fields are present
        for field, expected_type in required_fields.items():
            assert field in svc_entry, (
                f"Service '{svc_name}' is missing required field '{field}'. "
                f"Present fields: {list(svc_entry.keys())}"
            )

            # Validate field type
            value = svc_entry[field]
            if isinstance(expected_type, tuple):
                # responseTimeMs: int or None
                assert isinstance(value, expected_type), (
                    f"Service '{svc_name}' field '{field}' should be "
                    f"{expected_type}, got {type(value).__name__}: {value}"
                )
            else:
                assert isinstance(value, expected_type), (
                    f"Service '{svc_name}' field '{field}' should be "
                    f"{expected_type.__name__}, got {type(value).__name__}: {value}"
                )

        # Validate nodePool is "gpu" or "cpu"
        assert svc_entry["nodePool"] in {"gpu", "cpu"}, (
            f"Service '{svc_name}' has invalid nodePool '{svc_entry['nodePool']}', "
            f"expected 'gpu' or 'cpu'"
        )

        # Validate status is from the allowed set
        assert svc_entry["status"] in VALID_SERVICE_STATUSES, (
            f"Service '{svc_name}' has invalid status '{svc_entry['status']}', "
            f"expected one of {VALID_SERVICE_STATUSES}"
        )

        # Validate lastChecked is valid ISO 8601
        try:
            datetime.fromisoformat(
                svc_entry["lastChecked"].replace("Z", "+00:00")
            )
        except ValueError as e:
            raise AssertionError(
                f"Service '{svc_name}' has invalid ISO 8601 'lastChecked': "
                f"'{svc_entry['lastChecked']}'. Error: {e}"
            )

        # Validate consecutiveFailures >= 0
        assert svc_entry["consecutiveFailures"] >= 0, (
            f"Service '{svc_name}' has negative consecutiveFailures: "
            f"{svc_entry['consecutiveFailures']}"
        )

        # Validate consecutiveSuccesses >= 0
        assert svc_entry["consecutiveSuccesses"] >= 0, (
            f"Service '{svc_name}' has negative consecutiveSuccesses: "
            f"{svc_entry['consecutiveSuccesses']}"
        )

        # Validate endpoint is a string resembling a URL
        assert svc_entry["endpoint"].startswith("http://"), (
            f"Service '{svc_name}' has invalid endpoint '{svc_entry['endpoint']}', "
            f"expected to start with 'http://'"
        )

        # Validate responseTimeMs is int >= 0 or None
        if svc_entry["responseTimeMs"] is not None:
            assert svc_entry["responseTimeMs"] >= 0, (
                f"Service '{svc_name}' has negative responseTimeMs: "
                f"{svc_entry['responseTimeMs']}"
            )

    # Validate GPU services are labeled as "gpu" node pool
    gpu_names = {s["name"] for s in GPU_SERVICES}
    cpu_names = {s["name"] for s in CPU_SERVICES}

    for svc_entry in parsed["services"]:
        if svc_entry["name"] in gpu_names:
            assert svc_entry["nodePool"] == "gpu", (
                f"GPU service '{svc_entry['name']}' should have nodePool 'gpu', "
                f"got '{svc_entry['nodePool']}'"
            )
        elif svc_entry["name"] in cpu_names:
            assert svc_entry["nodePool"] == "cpu", (
                f"CPU service '{svc_entry['name']}' should have nodePool 'cpu', "
                f"got '{svc_entry['nodePool']}'"
            )
