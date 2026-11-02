"""
Integration tests for GenieAI AKS networking.

Tests cross-pool DNS resolution, NetworkPolicy enforcement (block/allow),
and Ingress TLS termination with HTTP→HTTPS redirect.

Requirements validated: 3.2, 4.2, 4.5, 9.1, 9.2
"""

import time

import pytest
import yaml


# --- Helper: Deploy a test pod with a specific label and wait for it to be ready ---


def deploy_test_pod(
    kubectl,
    name: str,
    namespace: str,
    label: str,
    image: str = "curlimages/curl:8.4.0",
    command: list[str] | None = None,
) -> None:
    """Deploy a lightweight pod with a given app label for NetworkPolicy testing."""
    if command is None:
        command = ["sleep", "3600"]

    manifest = yaml.dump(
        {
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": name,
                "namespace": namespace,
                "labels": {
                    "app.kubernetes.io/name": label,
                },
            },
            "spec": {
                "containers": [
                    {
                        "name": "test",
                        "image": image,
                        "command": command,
                    }
                ],
                "restartPolicy": "Never",
            },
        }
    )
    result = kubectl.apply(manifest, namespace=namespace)
    assert result.success, f"Failed to deploy pod {name}: {result.stderr}"

    # Wait for pod to be running
    wait_result = kubectl.wait(
        f"pod/{name}",
        condition="condition=Ready",
        timeout=120,
        namespace=namespace,
    )
    assert wait_result.success, f"Pod {name} did not become ready: {wait_result.stderr}"


def deploy_target_service(
    kubectl,
    name: str,
    namespace: str,
    port: int,
    label: str,
) -> None:
    """Deploy a simple HTTP server pod and a ClusterIP Service for testing connectivity."""
    # Deploy a simple HTTP echo server pod
    pod_manifest = yaml.dump(
        {
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": f"{name}-pod",
                "namespace": namespace,
                "labels": {
                    "app.kubernetes.io/name": label,
                },
            },
            "spec": {
                "containers": [
                    {
                        "name": "server",
                        "image": "hashicorp/http-echo:0.2.3",
                        "args": [f"-listen=:{port}", f"-text={name}-ok"],
                        "ports": [{"containerPort": port}],
                    }
                ],
                "restartPolicy": "Never",
            },
        }
    )
    result = kubectl.apply(pod_manifest, namespace=namespace)
    assert result.success, f"Failed to deploy target pod {name}: {result.stderr}"

    # Deploy the corresponding Service
    svc_manifest = yaml.dump(
        {
            "apiVersion": "v1",
            "kind": "Service",
            "metadata": {
                "name": name,
                "namespace": namespace,
            },
            "spec": {
                "selector": {
                    "app.kubernetes.io/name": label,
                },
                "ports": [
                    {
                        "protocol": "TCP",
                        "port": port,
                        "targetPort": port,
                    }
                ],
                "type": "ClusterIP",
            },
        }
    )
    result = kubectl.apply(svc_manifest, namespace=namespace)
    assert result.success, f"Failed to deploy service {name}: {result.stderr}"

    # Wait for the server pod to be ready
    wait_result = kubectl.wait(
        f"pod/{name}-pod",
        condition="condition=Ready",
        timeout=120,
        namespace=namespace,
    )
    assert wait_result.success, f"Target pod {name}-pod not ready: {wait_result.stderr}"


def apply_network_policies(kubectl, namespace: str) -> None:
    """Apply the standard GenieAI NetworkPolicies to a namespace for testing."""
    # Default-deny
    default_deny = yaml.dump(
        {
            "apiVersion": "networking.k8s.io/v1",
            "kind": "NetworkPolicy",
            "metadata": {
                "name": "default-deny-all",
                "namespace": namespace,
            },
            "spec": {
                "podSelector": {},
                "policyTypes": ["Ingress", "Egress"],
            },
        }
    )
    result = kubectl.apply(default_deny, namespace=namespace)
    assert result.success, f"Failed to apply default-deny: {result.stderr}"

    # DNS egress (required for service discovery)
    dns_egress = yaml.dump(
        {
            "apiVersion": "networking.k8s.io/v1",
            "kind": "NetworkPolicy",
            "metadata": {
                "name": "allow-dns-egress",
                "namespace": namespace,
            },
            "spec": {
                "podSelector": {},
                "policyTypes": ["Egress"],
                "egress": [
                    {
                        "to": [
                            {
                                "namespaceSelector": {
                                    "matchLabels": {
                                        "kubernetes.io/metadata.name": "kube-system",
                                    }
                                },
                                "podSelector": {
                                    "matchLabels": {
                                        "k8s-app": "kube-dns",
                                    }
                                },
                            }
                        ],
                        "ports": [
                            {"protocol": "UDP", "port": 53},
                            {"protocol": "TCP", "port": 53},
                        ],
                    }
                ],
            },
        }
    )
    result = kubectl.apply(dns_egress, namespace=namespace)
    assert result.success, f"Failed to apply DNS egress policy: {result.stderr}"


# =============================================================================
# Test: Cross-Pool DNS Resolution
# Validates: Requirement 3.2 — CPU service resolves GPU service via Kubernetes DNS
# =============================================================================


class TestCrossPoolDNSResolution:
    """Test that CPU pods can resolve GPU service DNS names."""

    @pytest.mark.integration
    def test_cpu_pod_resolves_gpu_service_dns(
        self, kubectl, deployed_chart, test_namespace
    ):
        """
        A pod on CPU pool should resolve the vLLM service DNS name.

        Even if the GPU service has no running pods (replicas=0), the
        Service DNS record should still resolve to a valid address.

        Validates: Requirement 3.2
        """
        # Deploy a curl pod to test DNS resolution
        deploy_test_pod(
            kubectl,
            name="dns-test-cpu",
            namespace=test_namespace,
            label="dns-test",
        )

        # Attempt to resolve the vLLM service DNS name using nslookup
        result = kubectl.exec(
            "dns-test-cpu",
            command=["nslookup", f"vllm.{test_namespace}.svc.cluster.local"],
            namespace=test_namespace,
            timeout=30,
        )

        # DNS should resolve (even if no endpoints exist)
        assert result.success, (
            f"DNS resolution failed for vllm.{test_namespace}.svc.cluster.local: "
            f"{result.stderr}"
        )
        assert "Address" in result.stdout or "address" in result.stdout, (
            f"DNS lookup did not return an address: {result.stdout}"
        )

    @pytest.mark.integration
    def test_cpu_pod_resolves_tei_service_dns(
        self, kubectl, deployed_chart, test_namespace
    ):
        """
        A pod should resolve the TEI service DNS name across pools.

        Validates: Requirement 3.2
        """
        deploy_test_pod(
            kubectl,
            name="dns-test-tei",
            namespace=test_namespace,
            label="dns-test-tei",
        )

        result = kubectl.exec(
            "dns-test-tei",
            command=["nslookup", f"tei.{test_namespace}.svc.cluster.local"],
            namespace=test_namespace,
            timeout=30,
        )

        assert result.success, (
            f"DNS resolution failed for tei.{test_namespace}.svc.cluster.local: "
            f"{result.stderr}"
        )


# =============================================================================
# Test: NetworkPolicy Blocks Unauthorized Traffic
# Validates: Requirements 4.2, 4.5
# =============================================================================


class TestNetworkPolicyBlocksUnauthorized:
    """Test that NetworkPolicies correctly block unauthorized traffic."""

    @pytest.mark.integration
    def test_unauthorized_pod_cannot_reach_service(self, kubectl, temp_namespace):
        """
        A pod without an explicit allow rule should be blocked by default-deny.

        Deploys:
        - A target service (simulating backend on port 3000)
        - An unauthorized client pod (label: 'unauthorized-client')
        - Default-deny + DNS-only NetworkPolicies

        The unauthorized pod should NOT be able to curl the target service.

        Validates: Requirements 4.2, 4.5
        """
        ns = temp_namespace

        # Deploy a target service
        deploy_target_service(
            kubectl,
            name="backend",
            namespace=ns,
            port=3000,
            label="backend",
        )

        # Apply NetworkPolicies: default-deny + DNS egress only
        apply_network_policies(kubectl, ns)

        # Deploy an unauthorized client pod (no allow rule for this label)
        deploy_test_pod(
            kubectl,
            name="unauthorized-client",
            namespace=ns,
            label="unauthorized-client",
        )

        # Give network policies a moment to take effect
        time.sleep(3)

        # Attempt to curl the backend — should fail/timeout
        result = kubectl.exec(
            "unauthorized-client",
            command=[
                "curl",
                "--connect-timeout", "5",
                "--max-time", "10",
                "-s",
                "-o", "/dev/null",
                "-w", "%{http_code}",
                f"http://backend.{ns}.svc.cluster.local:3000",
            ],
            namespace=ns,
            timeout=20,
        )

        # The request should fail — either non-zero exit code (connection refused/timeout)
        # or we never get a successful HTTP response
        assert not result.success or result.stdout.strip() != "200", (
            f"Unauthorized pod should NOT reach backend, but got: "
            f"rc={result.returncode}, stdout={result.stdout}"
        )

    @pytest.mark.integration
    def test_default_deny_blocks_egress(self, kubectl, temp_namespace):
        """
        With only default-deny (no DNS egress), even DNS should be blocked.

        Validates: Requirement 4.5
        """
        ns = temp_namespace

        # Apply ONLY default-deny (no DNS egress)
        default_deny = yaml.dump(
            {
                "apiVersion": "networking.k8s.io/v1",
                "kind": "NetworkPolicy",
                "metadata": {
                    "name": "default-deny-all",
                    "namespace": ns,
                },
                "spec": {
                    "podSelector": {},
                    "policyTypes": ["Ingress", "Egress"],
                },
            }
        )
        result = kubectl.apply(default_deny, namespace=ns)
        assert result.success, f"Failed to apply default-deny: {result.stderr}"

        # Deploy a test pod (it will start since image is cached or already pulled)
        deploy_test_pod(
            kubectl,
            name="blocked-pod",
            namespace=ns,
            label="blocked-test",
            # Use busybox which might already be present in the cluster
            image="busybox:1.36",
            command=["sleep", "3600"],
        )

        # Give policy time to propagate
        time.sleep(3)

        # Attempt external connectivity — should be blocked
        result = kubectl.exec(
            "blocked-pod",
            command=["wget", "--timeout=5", "-q", "-O", "-", "http://1.1.1.1"],
            namespace=ns,
            timeout=15,
        )

        assert not result.success, (
            "Pod with default-deny should not reach external hosts"
        )


# =============================================================================
# Test: NetworkPolicy Allows Authorized Traffic
# Validates: Requirement 4.2
# =============================================================================


class TestNetworkPolicyAllowsAuthorized:
    """Test that NetworkPolicies correctly allow authorized traffic."""

    @pytest.mark.integration
    def test_authorized_pod_can_reach_service(self, kubectl, temp_namespace):
        """
        A pod matching an explicit allow rule should be able to reach the target.

        Deploys:
        - A target service (simulating vllm on port 8000)
        - An authorized client pod (label: 'embedding')
        - Default-deny + DNS egress + specific allow policy

        The authorized pod (embedding) should reach vllm on port 8000.

        Validates: Requirement 4.2
        """
        ns = temp_namespace

        # Deploy a target service simulating vLLM
        deploy_target_service(
            kubectl,
            name="vllm",
            namespace=ns,
            port=8000,
            label="vllm",
        )

        # Apply default-deny and DNS policies
        apply_network_policies(kubectl, ns)

        # Apply allow policy: embedding → vllm:8000 (egress from embedding)
        allow_egress = yaml.dump(
            {
                "apiVersion": "networking.k8s.io/v1",
                "kind": "NetworkPolicy",
                "metadata": {
                    "name": "allow-embedding-to-vllm-egress",
                    "namespace": ns,
                },
                "spec": {
                    "podSelector": {
                        "matchLabels": {
                            "app.kubernetes.io/name": "embedding",
                        }
                    },
                    "policyTypes": ["Egress"],
                    "egress": [
                        {
                            "to": [
                                {
                                    "podSelector": {
                                        "matchLabels": {
                                            "app.kubernetes.io/name": "vllm",
                                        }
                                    }
                                }
                            ],
                            "ports": [{"protocol": "TCP", "port": 8000}],
                        }
                    ],
                },
            }
        )
        result = kubectl.apply(allow_egress, namespace=ns)
        assert result.success, f"Failed to apply egress allow: {result.stderr}"

        # Apply allow policy: vllm ingress from embedding
        allow_ingress = yaml.dump(
            {
                "apiVersion": "networking.k8s.io/v1",
                "kind": "NetworkPolicy",
                "metadata": {
                    "name": "allow-vllm-ingress-from-embedding",
                    "namespace": ns,
                },
                "spec": {
                    "podSelector": {
                        "matchLabels": {
                            "app.kubernetes.io/name": "vllm",
                        }
                    },
                    "policyTypes": ["Ingress"],
                    "ingress": [
                        {
                            "from": [
                                {
                                    "podSelector": {
                                        "matchLabels": {
                                            "app.kubernetes.io/name": "embedding",
                                        }
                                    }
                                }
                            ],
                            "ports": [{"protocol": "TCP", "port": 8000}],
                        }
                    ],
                },
            }
        )
        result = kubectl.apply(allow_ingress, namespace=ns)
        assert result.success, f"Failed to apply ingress allow: {result.stderr}"

        # Deploy an authorized client pod labeled as 'embedding'
        deploy_test_pod(
            kubectl,
            name="embedding-client",
            namespace=ns,
            label="embedding",
        )

        # Give policies time to propagate
        time.sleep(3)

        # Attempt to curl vllm — should succeed
        result = kubectl.exec(
            "embedding-client",
            command=[
                "curl",
                "--connect-timeout", "10",
                "--max-time", "15",
                "-s",
                "-o", "/dev/null",
                "-w", "%{http_code}",
                f"http://vllm.{ns}.svc.cluster.local:8000",
            ],
            namespace=ns,
            timeout=25,
        )

        assert result.success, (
            f"Authorized pod (embedding) should reach vllm but failed: {result.stderr}"
        )
        assert result.stdout.strip() == "200", (
            f"Expected HTTP 200 from vllm, got: {result.stdout.strip()}"
        )


# =============================================================================
# Test: Ingress TLS Termination and HTTP→HTTPS Redirect
# Validates: Requirements 9.1, 9.2
# =============================================================================


class TestIngressTLS:
    """Test Ingress TLS termination and HTTP→HTTPS redirect behavior."""

    @pytest.mark.integration
    def test_ingress_tls_termination(self, kubectl, deployed_chart, test_namespace):
        """
        The Ingress resource should be configured with TLS termination.

        Verifies the Ingress resource has TLS configuration with a secret reference.

        Validates: Requirement 9.1
        """
        # Get the Ingress resource
        result = kubectl.get_json("get", "ingress", namespace=test_namespace)
        if result is None:
            pytest.skip("No Ingress resources found — ingress may be disabled")

        items = result.get("items", [])
        if not items:
            pytest.skip("No Ingress resources deployed in test namespace")

        ingress = items[0]
        spec = ingress.get("spec", {})

        # Verify TLS is configured
        tls_config = spec.get("tls", [])
        assert len(tls_config) > 0, (
            "Ingress should have TLS configuration for TLS termination"
        )

        # Verify TLS references a secret
        tls_entry = tls_config[0]
        assert "secretName" in tls_entry, (
            "Ingress TLS must reference a Secret for the certificate"
        )
        assert tls_entry["secretName"] == "tls-secret", (
            f"Expected TLS secret 'tls-secret', got: {tls_entry['secretName']}"
        )

    @pytest.mark.integration
    def test_ingress_http_to_https_redirect(
        self, kubectl, deployed_chart, test_namespace
    ):
        """
        The Ingress should be configured to redirect HTTP to HTTPS (301).

        Verifies the Ingress annotations include ssl-redirect or force-ssl-redirect.

        Validates: Requirement 9.2
        """
        result = kubectl.get_json("get", "ingress", namespace=test_namespace)
        if result is None:
            pytest.skip("No Ingress resources found")

        items = result.get("items", [])
        if not items:
            pytest.skip("No Ingress resources deployed in test namespace")

        ingress = items[0]
        metadata = ingress.get("metadata", {})
        annotations = metadata.get("annotations", {})

        # Check for nginx redirect annotations
        ssl_redirect = annotations.get(
            "nginx.ingress.kubernetes.io/ssl-redirect", ""
        )
        force_ssl_redirect = annotations.get(
            "nginx.ingress.kubernetes.io/force-ssl-redirect", ""
        )

        assert ssl_redirect == "true" or force_ssl_redirect == "true", (
            f"Ingress should have ssl-redirect or force-ssl-redirect annotation set to 'true'. "
            f"Got ssl-redirect={ssl_redirect!r}, force-ssl-redirect={force_ssl_redirect!r}"
        )

    @pytest.mark.integration
    def test_ingress_has_correct_routing_rules(
        self, kubectl, deployed_chart, test_namespace
    ):
        """
        The Ingress should route /api/ to Kong and / to nginx.

        Validates: Requirement 9.1
        """
        result = kubectl.get_json("get", "ingress", namespace=test_namespace)
        if result is None:
            pytest.skip("No Ingress resources found")

        items = result.get("items", [])
        if not items:
            pytest.skip("No Ingress resources deployed in test namespace")

        ingress = items[0]
        spec = ingress.get("spec", {})
        rules = spec.get("rules", [])

        assert len(rules) > 0, "Ingress should have at least one routing rule"

        # Collect all paths from the first rule
        paths = rules[0].get("http", {}).get("paths", [])
        path_map = {}
        for path_entry in paths:
            path = path_entry.get("path", "")
            backend = path_entry.get("backend", {}).get("service", {})
            path_map[path] = backend.get("name", "")

        # Verify /api/ routes to kong
        assert "/api/" in path_map, (
            f"Ingress should have path /api/ — found paths: {list(path_map.keys())}"
        )
        assert path_map["/api/"] == "kong", (
            f"Path /api/ should route to 'kong', got: {path_map['/api/']}"
        )

        # Verify / routes to nginx
        assert "/" in path_map, (
            f"Ingress should have path / — found paths: {list(path_map.keys())}"
        )
        assert path_map["/"] == "nginx", (
            f"Path / should route to 'nginx', got: {path_map['/']}"
        )

    @pytest.mark.integration
    def test_ingress_default_backend(self, kubectl, deployed_chart, test_namespace):
        """
        The Ingress should have a default backend returning 404 for unmatched routes.

        Validates: Requirement 9.1
        """
        result = kubectl.get_json("get", "ingress", namespace=test_namespace)
        if result is None:
            pytest.skip("No Ingress resources found")

        items = result.get("items", [])
        if not items:
            pytest.skip("No Ingress resources deployed in test namespace")

        ingress = items[0]
        spec = ingress.get("spec", {})

        # Check for defaultBackend
        default_backend = spec.get("defaultBackend", {})
        assert default_backend, (
            "Ingress should have a defaultBackend for unmatched routes (404)"
        )

        service = default_backend.get("service", {})
        assert service.get("name") == "nginx", (
            f"Default backend should be 'nginx', got: {service.get('name')}"
        )

    @pytest.mark.integration
    def test_ingress_tls_minimum_version(
        self, kubectl, deployed_chart, test_namespace
    ):
        """
        The Ingress should enforce minimum TLS 1.2.

        Validates: Requirement 9.1
        """
        result = kubectl.get_json("get", "ingress", namespace=test_namespace)
        if result is None:
            pytest.skip("No Ingress resources found")

        items = result.get("items", [])
        if not items:
            pytest.skip("No Ingress resources deployed in test namespace")

        ingress = items[0]
        annotations = ingress.get("metadata", {}).get("annotations", {})

        min_tls = annotations.get(
            "nginx.ingress.kubernetes.io/ssl-min-protocol-version", ""
        )
        assert min_tls in ("TLSv1.2", "TLSv1.3"), (
            f"Ingress should enforce minimum TLS 1.2, got: {min_tls!r}"
        )
