"""
Integration test fixtures for GenieAI AKS infrastructure.

Provides reusable pytest fixtures for:
- Running kubectl commands with captured output
- Namespace setup/teardown (creating a test namespace, cleaning up after tests)
- Cluster connection verification
- Helm chart deployment (install/uninstall the chart in test namespace)

Requirements validated: 1.2, 2.1, 3.1, 4.1
"""

import json
import subprocess
import time
import uuid
from pathlib import Path
from typing import Generator

import pytest
import yaml


# Path to the Helm chart relative to project root
CHART_PATH = Path(__file__).resolve().parents[2] / "helm" / "genieai"

# Default timeout for kubectl operations (seconds)
KUBECTL_TIMEOUT = 60

# Helm deployment timeout (seconds)
HELM_DEPLOY_TIMEOUT = 300


class KubectlResult:
    """Represents the result of a kubectl command execution."""

    def __init__(self, returncode: int, stdout: str, stderr: str, command: list[str]):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.command = command

    @property
    def success(self) -> bool:
        return self.returncode == 0

    def json(self) -> dict | list:
        """Parse stdout as JSON."""
        return json.loads(self.stdout)

    def yaml_docs(self) -> list[dict]:
        """Parse stdout as YAML documents."""
        return [doc for doc in yaml.safe_load_all(self.stdout) if doc is not None]

    def __repr__(self) -> str:
        status = "OK" if self.success else f"FAILED(rc={self.returncode})"
        return f"KubectlResult({status}, cmd={' '.join(self.command)})"


class KubectlRunner:
    """Helper class to run kubectl commands with captured output."""

    def __init__(self, namespace: str | None = None, timeout: int = KUBECTL_TIMEOUT):
        self.namespace = namespace
        self.timeout = timeout

    def run(
        self,
        *args: str,
        namespace: str | None = None,
        timeout: int | None = None,
        input_data: str | None = None,
    ) -> KubectlResult:
        """
        Run a kubectl command and return the result.

        Args:
            *args: kubectl command arguments (e.g., "get", "pods", "-o", "json")
            namespace: Override the default namespace for this command
            timeout: Override the default timeout for this command
            input_data: Optional stdin data for the command
        """
        cmd = ["kubectl"]
        ns = namespace or self.namespace
        if ns:
            cmd.extend(["-n", ns])
        cmd.extend(args)

        effective_timeout = timeout or self.timeout

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=effective_timeout,
                input=input_data,
            )
            return KubectlResult(
                returncode=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
                command=cmd,
            )
        except subprocess.TimeoutExpired:
            return KubectlResult(
                returncode=-1,
                stdout="",
                stderr=f"Command timed out after {effective_timeout}s",
                command=cmd,
            )

    def get_json(self, *args: str, **kwargs) -> dict | list | None:
        """Run kubectl with -o json and return parsed output, or None on failure."""
        result = self.run(*args, "-o", "json", **kwargs)
        if result.success:
            return result.json()
        return None

    def apply(self, manifest: str, **kwargs) -> KubectlResult:
        """Apply a YAML manifest from string."""
        return self.run("apply", "-f", "-", input_data=manifest, **kwargs)

    def delete(self, resource_type: str, name: str, **kwargs) -> KubectlResult:
        """Delete a specific resource."""
        return self.run("delete", resource_type, name, "--ignore-not-found", **kwargs)

    def wait(
        self,
        resource: str,
        condition: str,
        timeout: int = 120,
        **kwargs,
    ) -> KubectlResult:
        """Wait for a resource to meet a condition."""
        return self.run(
            "wait",
            resource,
            f"--for={condition}",
            f"--timeout={timeout}s",
            timeout=timeout + 10,
            **kwargs,
        )

    def exec(
        self, pod: str, command: list[str], container: str | None = None, **kwargs
    ) -> KubectlResult:
        """Execute a command in a pod."""
        args = ["exec", pod]
        if container:
            args.extend(["-c", container])
        args.append("--")
        args.extend(command)
        return self.run(*args, **kwargs)

    def get_pods(self, label_selector: str | None = None, **kwargs) -> list[dict]:
        """Get pods, optionally filtered by label selector."""
        args = ["get", "pods"]
        if label_selector:
            args.extend(["-l", label_selector])
        result = self.get_json(*args, **kwargs)
        if result and "items" in result:
            return result["items"]
        return []

    def get_nodes(self, label_selector: str | None = None) -> list[dict]:
        """Get nodes, optionally filtered by label selector."""
        args = ["get", "nodes"]
        if label_selector:
            args.extend(["-l", label_selector])
        result = self.get_json(*args, namespace=None)
        if result and "items" in result:
            return result["items"]
        return []


class HelmRunner:
    """Helper class to run Helm commands for chart deployment."""

    def __init__(self, chart_path: Path, timeout: int = HELM_DEPLOY_TIMEOUT):
        self.chart_path = chart_path
        self.timeout = timeout

    def install(
        self,
        release_name: str,
        namespace: str,
        values_file: str | None = None,
        set_values: dict | None = None,
        wait: bool = True,
    ) -> subprocess.CompletedProcess:
        """
        Install the Helm chart.

        Args:
            release_name: Helm release name
            namespace: Target namespace
            values_file: Optional path to a values file override
            set_values: Optional dict of --set key=value pairs
            wait: Whether to wait for deployment to complete
        """
        cmd = [
            "helm",
            "upgrade",
            "--install",
            release_name,
            str(self.chart_path),
            "--namespace",
            namespace,
            "--create-namespace",
            f"--timeout={self.timeout}s",
        ]

        if wait:
            cmd.append("--wait")

        if values_file:
            cmd.extend(["-f", values_file])

        if set_values:
            for key, value in set_values.items():
                cmd.extend(["--set", f"{key}={value}"])

        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=self.timeout + 30,
        )

    def uninstall(self, release_name: str, namespace: str) -> subprocess.CompletedProcess:
        """Uninstall a Helm release."""
        cmd = [
            "helm",
            "uninstall",
            release_name,
            "--namespace",
            namespace,
            "--wait",
        ]
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )

    def template(
        self,
        release_name: str,
        namespace: str,
        values_file: str | None = None,
        set_values: dict | None = None,
    ) -> subprocess.CompletedProcess:
        """Render the chart templates locally without deploying."""
        cmd = [
            "helm",
            "template",
            release_name,
            str(self.chart_path),
            "--namespace",
            namespace,
        ]

        if values_file:
            cmd.extend(["-f", values_file])

        if set_values:
            for key, value in set_values.items():
                cmd.extend(["--set", f"{key}={value}"])

        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def lint(self, values_file: str | None = None) -> subprocess.CompletedProcess:
        """Lint the Helm chart."""
        cmd = ["helm", "lint", str(self.chart_path)]
        if values_file:
            cmd.extend(["-f", values_file])
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )


# --- Pytest Fixtures ---


@pytest.fixture(scope="session")
def cluster_connection() -> Generator[KubectlRunner, None, None]:
    """
    Verify cluster connectivity and provide a base kubectl runner.

    This fixture checks that kubectl can reach the cluster and that
    the current kubeconfig context is valid. Tests will be skipped
    if the cluster is unreachable.
    """
    runner = KubectlRunner()

    # Verify cluster access
    result = runner.run("cluster-info", timeout=15)
    if not result.success:
        pytest.skip(
            f"Cannot connect to Kubernetes cluster: {result.stderr.strip()}. "
            "Ensure kubectl is configured and the cluster is reachable."
        )

    # Verify we can list nodes
    result = runner.run("get", "nodes", timeout=15)
    if not result.success:
        pytest.skip(
            f"Cannot list cluster nodes: {result.stderr.strip()}. "
            "Check RBAC permissions."
        )

    yield runner


@pytest.fixture(scope="session")
def test_namespace(cluster_connection: KubectlRunner) -> Generator[str, None, None]:
    """
    Create a unique test namespace and clean it up after all tests complete.

    The namespace is named 'genieai-test-<short-uuid>' to avoid collisions
    with other test runs.
    """
    short_id = uuid.uuid4().hex[:8]
    namespace = f"genieai-test-{short_id}"

    # Create the namespace
    ns_manifest = yaml.dump(
        {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": namespace,
                "labels": {
                    "app.kubernetes.io/managed-by": "genieai-integration-tests",
                    "test-run-id": short_id,
                },
            },
        }
    )

    result = cluster_connection.apply(ns_manifest)
    if not result.success:
        pytest.fail(
            f"Failed to create test namespace '{namespace}': {result.stderr.strip()}"
        )

    yield namespace

    # Teardown: delete the namespace and all resources within it
    delete_result = cluster_connection.run(
        "delete", "namespace", namespace, "--ignore-not-found", "--wait=false",
        namespace=None,
        timeout=60,
    )
    if not delete_result.success:
        # Log but don't fail — namespace might have already been cleaned up
        print(
            f"Warning: Failed to delete test namespace '{namespace}': "
            f"{delete_result.stderr.strip()}"
        )


@pytest.fixture(scope="session")
def kubectl(cluster_connection: KubectlRunner, test_namespace: str) -> KubectlRunner:
    """
    Provide a kubectl runner scoped to the test namespace.

    All commands run through this fixture will target the test namespace
    by default.
    """
    return KubectlRunner(namespace=test_namespace)


@pytest.fixture(scope="session")
def helm(cluster_connection: KubectlRunner) -> HelmRunner:
    """
    Provide a Helm runner for chart operations.

    Verifies that Helm CLI is available before yielding.
    """
    try:
        result = subprocess.run(
            ["helm", "version", "--short"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            pytest.skip(f"Helm CLI not working: {result.stderr.strip()}")
    except FileNotFoundError:
        pytest.skip("Helm CLI not found. Install Helm to run integration tests.")

    return HelmRunner(chart_path=CHART_PATH)


@pytest.fixture(scope="session")
def deployed_chart(
    helm: HelmRunner,
    test_namespace: str,
    cluster_connection: KubectlRunner,
) -> Generator[str, None, None]:
    """
    Deploy the GenieAI Helm chart into the test namespace.

    Installs the chart with minimal replicas (1 per service) and waits
    for the deployment to complete. Uninstalls after all tests finish.

    Yields the release name.
    """
    release_name = f"genieai-test-{uuid.uuid4().hex[:6]}"

    # Deploy with minimal resources for testing
    result = helm.install(
        release_name=release_name,
        namespace=test_namespace,
        set_values={
            "namespace": test_namespace,
            # Scale down replicas for test efficiency
            "gpu.vllm.replicas": "0",
            "gpu.tei.replicas": "0",
            "gpu.teiReranker.replicas": "0",
            "gpu.dataprep.replicas": "0",
        },
        wait=True,
    )

    if result.returncode != 0:
        pytest.fail(
            f"Failed to deploy Helm chart: {result.stderr.strip()}\n"
            f"stdout: {result.stdout.strip()}"
        )

    yield release_name

    # Teardown: uninstall the chart
    helm.uninstall(release_name, test_namespace)


@pytest.fixture(scope="function")
def temp_namespace(cluster_connection: KubectlRunner) -> Generator[str, None, None]:
    """
    Create a temporary namespace for a single test, cleaned up after.

    Use this for tests that need isolation from the main test namespace
    (e.g., testing NetworkPolicy default-deny behavior).
    """
    short_id = uuid.uuid4().hex[:8]
    namespace = f"genieai-tmp-{short_id}"

    ns_manifest = yaml.dump(
        {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": namespace,
                "labels": {
                    "app.kubernetes.io/managed-by": "genieai-integration-tests",
                    "purpose": "temp-test",
                },
            },
        }
    )

    result = cluster_connection.apply(ns_manifest)
    if not result.success:
        pytest.skip(f"Cannot create temp namespace: {result.stderr.strip()}")

    yield namespace

    cluster_connection.run(
        "delete", "namespace", namespace, "--ignore-not-found", "--wait=false",
        namespace=None,
        timeout=30,
    )


@pytest.fixture(scope="session")
def gpu_nodes(cluster_connection: KubectlRunner) -> list[dict]:
    """
    Get GPU node pool nodes (labeled gpu-pool=true).

    Returns an empty list if no GPU nodes are available.
    """
    return cluster_connection.get_nodes(label_selector="gpu-pool=true")


@pytest.fixture(scope="session")
def cpu_nodes(cluster_connection: KubectlRunner) -> list[dict]:
    """
    Get CPU node pool nodes (labeled cpu-pool=true).

    Returns an empty list if no CPU nodes are available.
    """
    return cluster_connection.get_nodes(label_selector="cpu-pool=true")


# --- Helper fixtures for common test patterns ---


@pytest.fixture(scope="session")
def chart_path() -> Path:
    """Return the path to the Helm chart directory."""
    return CHART_PATH


@pytest.fixture(scope="session")
def default_values() -> dict:
    """Load and return the default values.yaml from the Helm chart."""
    values_path = CHART_PATH / "values.yaml"
    if not values_path.exists():
        pytest.skip("Helm chart values.yaml not found")
    with open(values_path) as f:
        return yaml.safe_load(f)
