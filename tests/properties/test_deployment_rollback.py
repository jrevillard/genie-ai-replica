"""
Property-based test: Deployment Rollback State Machine

**Validates: Requirements 8.5, 8.8**

For any deployment timeline where a Deployment fails to reach desired ready replicas:
  (a) if unready for exactly 300 seconds, rollback SHALL be triggered
  (b) if rollback succeeds (previous revision healthy within 120s), the system SHALL
      report success and exit non-zero
  (c) if rollback fails to restore health within 120 seconds, the system SHALL preserve
      current state, report failure with Deployment name and error details, and exit non-zero
  (d) if deployment succeeds within 300s, the system SHALL report success and exit zero
"""

from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st
from dataclasses import dataclass
from typing import Optional


# --- Constants ---

DEPLOY_TIMEOUT_SECONDS = 300    # Deployment must reach ready state within 300s
ROLLBACK_TIMEOUT_SECONDS = 120  # Rollback must restore health within 120s


# --- Data Models ---

@dataclass
class DeploymentTimeline:
    """
    Represents a deployment timeline:
    - ready_at_second: The second at which the deployment becomes ready.
      None means the deployment never becomes ready.
    - deployment_name: Name of the deployment being tracked.
    """
    ready_at_second: Optional[int]
    deployment_name: str


@dataclass
class RollbackTimeline:
    """
    Represents a rollback timeline:
    - healthy_at_second: The second (relative to rollback start) at which the
      previous revision becomes healthy. None means rollback never succeeds.
    """
    healthy_at_second: Optional[int]


@dataclass
class DeploymentResult:
    """
    The result of a deployment operation:
    - exit_code: 0 for success, non-zero for failure
    - rollback_triggered: Whether a rollback was triggered
    - rollback_succeeded: Whether the rollback restored the previous revision
    - report_message: Human-readable status message
    - deployment_name: Name of the deployment (included in failure reports)
    - error_details: Error details (included in failure reports)
    - state_preserved: Whether the current cluster state was preserved (on rollback failure)
    """
    exit_code: int
    rollback_triggered: bool
    rollback_succeeded: Optional[bool]
    report_message: str
    deployment_name: str
    error_details: Optional[str]
    state_preserved: bool


# --- State Machine Implementation ---

def evaluate_deployment(
    deploy_timeline: DeploymentTimeline,
    rollback_timeline: RollbackTimeline,
) -> DeploymentResult:
    """
    Evaluate a deployment operation based on the deployment and rollback timelines.

    State machine rules:
    1. If deployment becomes ready within 300s → success, exit 0
    2. If deployment does NOT become ready within 300s → trigger rollback
    3. If rollback restores health within 120s → report rollback success, exit non-zero
    4. If rollback fails (health not restored within 120s) → preserve state, report failure, exit non-zero

    Args:
        deploy_timeline: When (if ever) the deployment becomes ready
        rollback_timeline: When (if ever) the rollback restores health

    Returns:
        DeploymentResult with all outcome details
    """
    deployment_name = deploy_timeline.deployment_name

    # Case 1: Deployment succeeds within timeout
    if deploy_timeline.ready_at_second is not None and deploy_timeline.ready_at_second <= DEPLOY_TIMEOUT_SECONDS:
        return DeploymentResult(
            exit_code=0,
            rollback_triggered=False,
            rollback_succeeded=None,
            report_message=f"Deployment '{deployment_name}' succeeded.",
            deployment_name=deployment_name,
            error_details=None,
            state_preserved=False,
        )

    # Case 2: Deployment timeout reached → trigger rollback
    # (ready_at_second is None OR > 300)

    # Evaluate rollback outcome
    if (
        rollback_timeline.healthy_at_second is not None
        and rollback_timeline.healthy_at_second <= ROLLBACK_TIMEOUT_SECONDS
    ):
        # Case 3: Rollback succeeds
        return DeploymentResult(
            exit_code=1,
            rollback_triggered=True,
            rollback_succeeded=True,
            report_message=(
                f"Deployment '{deployment_name}' failed to reach ready state within "
                f"{DEPLOY_TIMEOUT_SECONDS}s. Rollback to previous revision succeeded."
            ),
            deployment_name=deployment_name,
            error_details=f"Deployment timed out after {DEPLOY_TIMEOUT_SECONDS}s",
            state_preserved=False,
        )
    else:
        # Case 4: Rollback fails
        error_details = (
            f"Deployment '{deployment_name}' timed out after {DEPLOY_TIMEOUT_SECONDS}s. "
            f"Rollback failed: previous revision did not become healthy within "
            f"{ROLLBACK_TIMEOUT_SECONDS}s."
        )
        return DeploymentResult(
            exit_code=1,
            rollback_triggered=True,
            rollback_succeeded=False,
            report_message=(
                f"Deployment '{deployment_name}' failed. Rollback also failed. "
                f"Cluster state preserved for manual investigation."
            ),
            deployment_name=deployment_name,
            error_details=error_details,
            state_preserved=True,
        )


# --- Hypothesis Strategies ---

# Deployment name strategy: realistic Kubernetes deployment names
deployment_name_strategy = st.from_regex(
    r"[a-z][a-z0-9\-]{0,20}[a-z0-9]",
    fullmatch=True,
).filter(lambda s: "--" not in s and len(s) >= 2)

# Strategy for when deployment becomes ready (or never)
# None means never ready; int is the second it becomes ready
ready_at_strategy = st.one_of(
    st.none(),
    st.integers(min_value=0, max_value=600),
)

# Strategy for when rollback becomes healthy (or never)
rollback_healthy_strategy = st.one_of(
    st.none(),
    st.integers(min_value=1, max_value=300),
)

# Composite strategy for full deployment scenario
deployment_timeline_strategy = st.builds(
    DeploymentTimeline,
    ready_at_second=ready_at_strategy,
    deployment_name=deployment_name_strategy,
)

rollback_timeline_strategy = st.builds(
    RollbackTimeline,
    healthy_at_second=rollback_healthy_strategy,
)


# --- Property Tests ---


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_rollback_triggered_at_300s_timeout(deploy, rollback):
    """
    Property 13(a): If a deployment is unready for 300 seconds, rollback SHALL be triggered.

    **Validates: Requirements 8.5**
    """
    result = evaluate_deployment(deploy, rollback)

    deployment_exceeds_timeout = (
        deploy.ready_at_second is None or deploy.ready_at_second > DEPLOY_TIMEOUT_SECONDS
    )

    if deployment_exceeds_timeout:
        assert result.rollback_triggered is True, (
            f"Rollback should be triggered when deployment does not reach ready state "
            f"within {DEPLOY_TIMEOUT_SECONDS}s. ready_at_second={deploy.ready_at_second}"
        )
    else:
        assert result.rollback_triggered is False, (
            f"Rollback should NOT be triggered when deployment reaches ready state "
            f"within {DEPLOY_TIMEOUT_SECONDS}s. ready_at_second={deploy.ready_at_second}"
        )


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_successful_deployment_exits_zero(deploy, rollback):
    """
    Property: If deployment succeeds within 300s, the system SHALL report success
    and exit with code 0.

    **Validates: Requirements 8.5**
    """
    assume(
        deploy.ready_at_second is not None
        and deploy.ready_at_second <= DEPLOY_TIMEOUT_SECONDS
    )

    result = evaluate_deployment(deploy, rollback)

    assert result.exit_code == 0, (
        f"Deployment that succeeds within {DEPLOY_TIMEOUT_SECONDS}s should exit 0. "
        f"Got exit_code={result.exit_code}"
    )
    assert result.rollback_triggered is False, (
        f"No rollback should be triggered for successful deployment"
    )
    assert "succeeded" in result.report_message.lower(), (
        f"Report message should indicate success. Got: '{result.report_message}'"
    )


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)
def test_rollback_success_reports_correctly(deploy, rollback):
    """
    Property 13(b): If rollback succeeds (previous revision healthy within 120s),
    the system SHALL report success and exit non-zero.

    **Validates: Requirements 8.5, 8.8**
    """
    # Only test cases where deployment fails and rollback succeeds
    assume(
        deploy.ready_at_second is None or deploy.ready_at_second > DEPLOY_TIMEOUT_SECONDS
    )
    assume(
        rollback.healthy_at_second is not None
        and rollback.healthy_at_second <= ROLLBACK_TIMEOUT_SECONDS
    )

    result = evaluate_deployment(deploy, rollback)

    assert result.exit_code != 0, (
        f"Even with successful rollback, exit code must be non-zero. "
        f"Got exit_code={result.exit_code}"
    )
    assert result.rollback_triggered is True, (
        "Rollback must be triggered when deployment times out"
    )
    assert result.rollback_succeeded is True, (
        f"Rollback should be marked as succeeded when healthy within "
        f"{ROLLBACK_TIMEOUT_SECONDS}s. healthy_at_second={rollback.healthy_at_second}"
    )
    assert deploy.deployment_name in result.report_message, (
        f"Report message should contain deployment name '{deploy.deployment_name}'. "
        f"Got: '{result.report_message}'"
    )


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_rollback_failure_preserves_state_and_reports(deploy, rollback):
    """
    Property 13(c): If rollback fails to restore health within 120 seconds,
    the system SHALL preserve current state, report failure with Deployment name
    and error details, and exit non-zero.

    **Validates: Requirements 8.8**
    """
    # Only test cases where deployment fails and rollback also fails
    assume(
        deploy.ready_at_second is None or deploy.ready_at_second > DEPLOY_TIMEOUT_SECONDS
    )
    assume(
        rollback.healthy_at_second is None
        or rollback.healthy_at_second > ROLLBACK_TIMEOUT_SECONDS
    )

    result = evaluate_deployment(deploy, rollback)

    # Exit non-zero
    assert result.exit_code != 0, (
        f"Rollback failure must exit non-zero. Got exit_code={result.exit_code}"
    )
    # Rollback was triggered but failed
    assert result.rollback_triggered is True, (
        "Rollback must be triggered when deployment times out"
    )
    assert result.rollback_succeeded is False, (
        "Rollback should be marked as failed when health not restored within "
        f"{ROLLBACK_TIMEOUT_SECONDS}s. healthy_at_second={rollback.healthy_at_second}"
    )
    # State preserved
    assert result.state_preserved is True, (
        "Cluster state must be preserved when rollback fails"
    )
    # Deployment name in report
    assert deploy.deployment_name in result.report_message or deploy.deployment_name in (result.error_details or ""), (
        f"Failure report must include deployment name '{deploy.deployment_name}'. "
        f"report_message='{result.report_message}', error_details='{result.error_details}'"
    )
    # Error details present
    assert result.error_details is not None and len(result.error_details) > 0, (
        "Error details must be present when rollback fails"
    )


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_exit_code_is_always_nonzero_when_rollback_triggered(deploy, rollback):
    """
    Regardless of rollback outcome, if deployment failed and rollback was triggered,
    exit code must be non-zero.

    **Validates: Requirements 8.5, 8.8**
    """
    result = evaluate_deployment(deploy, rollback)

    if result.rollback_triggered:
        assert result.exit_code != 0, (
            f"Exit code must be non-zero when rollback is triggered. "
            f"deploy.ready_at={deploy.ready_at_second}, "
            f"rollback.healthy_at={rollback.healthy_at_second}"
        )


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_deployment_name_always_in_result(deploy, rollback):
    """
    The deployment name SHALL always be available in the result for error reporting.

    **Validates: Requirements 8.5, 8.8**
    """
    result = evaluate_deployment(deploy, rollback)

    assert result.deployment_name == deploy.deployment_name, (
        f"Result must always contain the deployment name. "
        f"Expected '{deploy.deployment_name}', got '{result.deployment_name}'"
    )


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_boundary_300s_triggers_rollback(deploy, rollback):
    """
    Boundary condition: deployment ready at exactly 300s should NOT trigger rollback
    (it's within the timeout). Ready at 301s should trigger rollback.

    **Validates: Requirements 8.5**
    """
    result = evaluate_deployment(deploy, rollback)

    if deploy.ready_at_second is not None and deploy.ready_at_second == DEPLOY_TIMEOUT_SECONDS:
        # Exactly at boundary: deployment succeeds (within timeout means <= 300)
        assert result.rollback_triggered is False, (
            f"Deployment ready at exactly {DEPLOY_TIMEOUT_SECONDS}s should succeed "
            f"(within timeout). Got rollback_triggered=True"
        )
        assert result.exit_code == 0, (
            f"Deployment ready at exactly {DEPLOY_TIMEOUT_SECONDS}s should exit 0"
        )

    if deploy.ready_at_second is not None and deploy.ready_at_second == DEPLOY_TIMEOUT_SECONDS + 1:
        # Just past boundary: rollback triggered
        assert result.rollback_triggered is True, (
            f"Deployment ready at {DEPLOY_TIMEOUT_SECONDS + 1}s should trigger rollback"
        )


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_boundary_120s_rollback_success(deploy, rollback):
    """
    Boundary condition: rollback healthy at exactly 120s should be considered success.
    Rollback healthy at 121s should be considered failure.

    **Validates: Requirements 8.8**
    """
    # Only test when rollback is triggered
    assume(
        deploy.ready_at_second is None or deploy.ready_at_second > DEPLOY_TIMEOUT_SECONDS
    )

    result = evaluate_deployment(deploy, rollback)

    if rollback.healthy_at_second is not None and rollback.healthy_at_second == ROLLBACK_TIMEOUT_SECONDS:
        # Exactly at boundary: rollback succeeds
        assert result.rollback_succeeded is True, (
            f"Rollback healthy at exactly {ROLLBACK_TIMEOUT_SECONDS}s should succeed"
        )

    if rollback.healthy_at_second is not None and rollback.healthy_at_second == ROLLBACK_TIMEOUT_SECONDS + 1:
        # Just past boundary: rollback fails
        assert result.rollback_succeeded is False, (
            f"Rollback healthy at {ROLLBACK_TIMEOUT_SECONDS + 1}s should fail"
        )
        assert result.state_preserved is True, (
            "State must be preserved when rollback fails"
        )


@given(
    deploy=deployment_timeline_strategy,
    rollback=rollback_timeline_strategy,
)
@settings(
    max_examples=300,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_state_preserved_only_on_rollback_failure(deploy, rollback):
    """
    State preservation (not rolling back further) only occurs when rollback itself fails.

    **Validates: Requirements 8.8**
    """
    result = evaluate_deployment(deploy, rollback)

    if result.state_preserved:
        # State preserved implies rollback was triggered and failed
        assert result.rollback_triggered is True, (
            "State preservation requires rollback to have been triggered"
        )
        assert result.rollback_succeeded is False, (
            "State preservation requires rollback to have failed"
        )
    elif result.rollback_triggered and result.rollback_succeeded is False:
        # If rollback was triggered and failed, state must be preserved
        assert result.state_preserved is True, (
            "When rollback is triggered and fails, state must be preserved"
        )
