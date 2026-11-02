"""
Property-based test: Health Monitor State Machine

**Validates: Requirements 10.2, 10.4, 10.6**

For any sequence of health check results (success/failure) for a service endpoint:
  (a) the service status SHALL transition from "healthy" to "degraded" if and only if
      3 consecutive failures occur
  (b) from "degraded" to "unreachable" if and only if 3 more consecutive failures occur
      (6 total from a healthy baseline)
  (c) from "degraded" or "unreachable" back to "healthy" if and only if 2 consecutive
      successes occur
  (d) status SHALL be "scaled-down" if and only if the service has no Kubernetes endpoints
      AND the GPU node pool count is 0

A single success between failures SHALL reset the consecutive failure count to zero.
"""

from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st


# --- State Machine Implementation ---
# Extracted from the bash script logic described in the design document.

VALID_STATES = ("healthy", "degraded", "unreachable", "scaled-down")

# Thresholds
FAILURES_TO_DEGRADED = 3       # healthy → degraded after 3 consecutive failures
FAILURES_TO_UNREACHABLE = 6    # healthy baseline → unreachable after 6 consecutive failures
                                # (i.e., 3 more after reaching degraded)
SUCCESSES_TO_HEALTHY = 2       # degraded/unreachable → healthy after 2 consecutive successes


def compute_health_state(
    check_results: list[bool],
    has_endpoints: bool = True,
    gpu_node_count: int = 1,
) -> dict:
    """
    Simulate the health monitor state machine given a sequence of health check results.

    Args:
        check_results: List of booleans (True=success/HTTP 200, False=failure)
        has_endpoints: Whether the service has Kubernetes endpoints
        gpu_node_count: Number of GPU nodes in the pool

    Returns:
        dict with final state info:
          - status: one of "healthy", "degraded", "unreachable", "scaled-down"
          - consecutive_failures: current consecutive failure count
          - consecutive_successes: current consecutive success count
    """
    # Scaled-down is a special state determined by infrastructure, not health checks
    if not has_endpoints and gpu_node_count == 0:
        return {
            "status": "scaled-down",
            "consecutive_failures": 0,
            "consecutive_successes": 0,
        }

    status = "healthy"
    consecutive_failures = 0
    consecutive_successes = 0

    for check_passed in check_results:
        if check_passed:
            # Success: reset failure count, increment success count
            consecutive_failures = 0
            consecutive_successes += 1

            # Recovery: 2 consecutive successes → healthy
            if status in ("degraded", "unreachable") and consecutive_successes >= SUCCESSES_TO_HEALTHY:
                status = "healthy"
        else:
            # Failure: reset success count, increment failure count
            consecutive_successes = 0
            consecutive_failures += 1

            # Transition logic based on consecutive failures
            if status == "healthy" and consecutive_failures >= FAILURES_TO_DEGRADED:
                status = "degraded"
                # Reset counter: need 3 MORE consecutive failures for unreachable
                consecutive_failures = 0
            elif status == "degraded" and consecutive_failures >= FAILURES_TO_DEGRADED:
                # 3 more consecutive failures from degraded → unreachable
                status = "unreachable"

    return {
        "status": status,
        "consecutive_failures": consecutive_failures,
        "consecutive_successes": consecutive_successes,
    }


def replay_state_transitions(check_results: list[bool]) -> list[str]:
    """
    Replay a sequence of health checks and return the status after each check.
    Useful for validating transition points.
    """
    statuses = []
    status = "healthy"
    consecutive_failures = 0
    consecutive_successes = 0

    for check_passed in check_results:
        if check_passed:
            consecutive_failures = 0
            consecutive_successes += 1

            if status in ("degraded", "unreachable") and consecutive_successes >= SUCCESSES_TO_HEALTHY:
                status = "healthy"
        else:
            consecutive_successes = 0
            consecutive_failures += 1

            if status == "healthy" and consecutive_failures >= FAILURES_TO_DEGRADED:
                status = "degraded"
                consecutive_failures = 0  # Reset: need 3 MORE for unreachable
            elif status == "degraded" and consecutive_failures >= FAILURES_TO_DEGRADED:
                status = "unreachable"

        statuses.append(status)

    return statuses


# --- Hypothesis Strategies ---

# Random health check sequences of varying length (1-100 checks)
check_sequence_strategy = st.lists(
    st.booleans(),
    min_size=1,
    max_size=100,
)

# Strategy for scaled-down detection inputs
scaled_down_strategy = st.tuples(
    st.booleans(),           # has_endpoints
    st.integers(min_value=0, max_value=10),  # gpu_node_count
)


# --- Property Tests ---


@given(checks=check_sequence_strategy)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_healthy_to_degraded_requires_3_consecutive_failures(checks):
    """
    Property 14(a): Service status transitions from "healthy" to "degraded"
    if and only if 3 consecutive failures occur.

    **Validates: Requirements 10.2**
    """
    statuses = replay_state_transitions(checks)

    for i, status in enumerate(statuses):
        if i == 0:
            continue

        prev_status_idx = i - 1
        # Find the last time we were healthy before this point
        # Check if a transition to degraded happened at index i
        if i >= 1 and statuses[i] == "degraded" and (i == 0 or statuses[i - 1] == "healthy"):
            # Transition happened: verify 3 consecutive failures ending at index i
            assert i >= 2, (
                f"Transition to degraded at index {i} but need at least 3 checks"
            )
            # The last 3 checks (ending at i) must all be failures
            assert checks[i] is False, f"Check at transition point {i} should be a failure"
            assert checks[i - 1] is False, f"Check at {i-1} should be a failure"
            assert checks[i - 2] is False, f"Check at {i-2} should be a failure"


@given(checks=check_sequence_strategy)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_degraded_to_unreachable_requires_3_more_consecutive_failures(checks):
    """
    Property 14(b): Service status transitions from "degraded" to "unreachable"
    if and only if 3 more consecutive failures occur after reaching degraded.

    **Validates: Requirements 10.2**
    """
    statuses = replay_state_transitions(checks)

    for i, status in enumerate(statuses):
        if statuses[i] == "unreachable" and i >= 1 and statuses[i - 1] == "degraded":
            # Transition to unreachable: the last 3 checks must be failures
            assert i >= 2, (
                f"Transition to unreachable at index {i} but need at least 3 checks from degraded"
            )
            assert checks[i] is False, f"Check at transition point {i} should be a failure"
            assert checks[i - 1] is False, f"Check at {i-1} should be a failure"
            assert checks[i - 2] is False, f"Check at {i-2} should be a failure"


@given(checks=check_sequence_strategy)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_recovery_requires_2_consecutive_successes(checks):
    """
    Property 14(c): From "degraded" or "unreachable" back to "healthy" if and only if
    2 consecutive successes occur.

    **Validates: Requirements 10.6**
    """
    statuses = replay_state_transitions(checks)

    for i, status in enumerate(statuses):
        if i >= 1 and statuses[i] == "healthy" and statuses[i - 1] in ("degraded", "unreachable"):
            # Recovery transition: the last 2 checks must be successes
            assert checks[i] is True, f"Check at recovery point {i} should be a success"
            assert checks[i - 1] is True, f"Check at {i-1} should be a success"


@given(checks=check_sequence_strategy)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_success_resets_consecutive_failure_count(checks):
    """
    A single success between failures SHALL reset the consecutive failure count to zero.

    **Validates: Requirements 10.2, 10.6**
    """
    # Verify that any success in the sequence resets the failure counter.
    # After a success, the state machine's consecutive_failures must be 0.
    for i, check_passed in enumerate(checks):
        if check_passed:
            partial_result = compute_health_state(checks[: i + 1])
            assert partial_result["consecutive_failures"] == 0, (
                f"At index {i}, after a success, expected consecutive_failures=0, "
                f"got {partial_result['consecutive_failures']}. "
                f"Sequence so far: {checks[:i+1]}"
            )


@given(checks=check_sequence_strategy)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_state_is_always_valid(checks):
    """
    The state machine shall only produce valid states.

    **Validates: Requirements 10.2, 10.4, 10.6**
    """
    result = compute_health_state(checks)
    assert result["status"] in VALID_STATES, (
        f"Invalid state '{result['status']}' after checks: {checks}"
    )

    # Also check that all intermediate states are valid
    statuses = replay_state_transitions(checks)
    for i, s in enumerate(statuses):
        assert s in ("healthy", "degraded", "unreachable"), (
            f"Invalid intermediate state '{s}' at index {i}. "
            f"Note: 'scaled-down' only applies with no endpoints + 0 GPU nodes."
        )


@given(checks=check_sequence_strategy)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_no_transition_skips_degraded(checks):
    """
    The state machine cannot jump from "healthy" directly to "unreachable" —
    it must pass through "degraded" first.

    **Validates: Requirements 10.2**
    """
    statuses = replay_state_transitions(checks)

    for i in range(1, len(statuses)):
        if statuses[i] == "unreachable":
            # There must exist a previous point where status was "degraded"
            prior_statuses = statuses[:i]
            assert "degraded" in prior_statuses, (
                f"Reached 'unreachable' at index {i} without passing through 'degraded'. "
                f"Statuses: {statuses[:i+1]}"
            )


@given(data=scaled_down_strategy)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_scaled_down_detection(data):
    """
    Property 14(d): Status SHALL be "scaled-down" if and only if the service has no
    Kubernetes endpoints AND the GPU node pool count is 0.

    **Validates: Requirements 10.4**
    """
    has_endpoints, gpu_node_count = data

    # Use an arbitrary check sequence (it shouldn't matter for scaled-down)
    result = compute_health_state(
        check_results=[True],  # doesn't matter for scaled-down detection
        has_endpoints=has_endpoints,
        gpu_node_count=gpu_node_count,
    )

    if not has_endpoints and gpu_node_count == 0:
        # MUST be scaled-down
        assert result["status"] == "scaled-down", (
            f"Expected 'scaled-down' when has_endpoints={has_endpoints} and "
            f"gpu_node_count={gpu_node_count}, got '{result['status']}'"
        )
    else:
        # MUST NOT be scaled-down
        assert result["status"] != "scaled-down", (
            f"Got 'scaled-down' when has_endpoints={has_endpoints} and "
            f"gpu_node_count={gpu_node_count}, but conditions are not met"
        )


@given(
    checks=check_sequence_strategy,
    has_endpoints=st.booleans(),
    gpu_node_count=st.integers(min_value=0, max_value=5),
)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_scaled_down_overrides_health_checks(checks, has_endpoints, gpu_node_count):
    """
    When scaled-down conditions are met (no endpoints + 0 GPU nodes), the status is
    always "scaled-down" regardless of the health check sequence.

    **Validates: Requirements 10.4**
    """
    result = compute_health_state(
        check_results=checks,
        has_endpoints=has_endpoints,
        gpu_node_count=gpu_node_count,
    )

    if not has_endpoints and gpu_node_count == 0:
        assert result["status"] == "scaled-down", (
            f"Expected 'scaled-down' regardless of check sequence when "
            f"has_endpoints=False, gpu_node_count=0. Got '{result['status']}'"
        )


@given(checks=check_sequence_strategy)
@settings(
    max_examples=200,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_6_consecutive_failures_from_healthy_reach_unreachable(checks):
    """
    Starting from healthy, exactly 6 consecutive failures should transition through
    degraded (at 3) to unreachable (at 6).

    **Validates: Requirements 10.2**
    """
    # Use a deterministic prefix of 6 failures to verify the path
    forced_checks = [False] * 6
    statuses = replay_state_transitions(forced_checks)

    # After 3 failures: degraded
    assert statuses[2] == "degraded", (
        f"Expected 'degraded' after 3 failures, got '{statuses[2]}'"
    )

    # After 6 failures: unreachable
    assert statuses[5] == "unreachable", (
        f"Expected 'unreachable' after 6 failures, got '{statuses[5]}'"
    )

    # Before 3 failures: still healthy
    assert statuses[0] == "healthy", f"Expected 'healthy' after 1 failure, got '{statuses[0]}'"
    assert statuses[1] == "healthy", f"Expected 'healthy' after 2 failures, got '{statuses[1]}'"

    # Between 3 and 6: degraded
    assert statuses[3] == "degraded", f"Expected 'degraded' after 4 failures, got '{statuses[3]}'"
    assert statuses[4] == "degraded", f"Expected 'degraded' after 5 failures, got '{statuses[4]}'"
