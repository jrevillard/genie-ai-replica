"""
Integration tests for workload scheduling on the AKS cluster.

Validates that GPU pods are scheduled on GPU nodes, CPU pods on CPU nodes,
and GPU pods remain Pending when no GPU capacity is available.

Requirements validated: 1.2, 1.6, 2.1
"""

import time

import pytest
import yaml


# GPU deployment names as defined in the Helm chart
GPU_DEPLOYMENTS = ["vllm", "tei", "tei-reranker", "dataprep"]

# A representative subset of CPU deployments to verify scheduling
CPU_DEPLOYMENTS = ["backend", "frontend", "nginx", "kong", "arango-vector-db"]


class TestGPUPodsOnGPUNodes:
    """Verify GPU pods are scheduled exclusively on GPU-labeled nodes.

    Validates: Requirements 1.2
    """

    def test_gpu_pods_run_on_gpu_labeled_nodes(
        self, kubectl, deployed_chart, gpu_nodes
    ):
        """GPU pods must be running on nodes with gpu-pool=true label."""
        if not gpu_nodes:
            pytest.skip("No GPU nodes available in the cluster")

        gpu_node_names = {
            node["metadata"]["name"] for node in gpu_nodes
        }

        # Get all running GPU pods
        gpu_pods_found = False
        for deployment_name in GPU_DEPLOYMENTS:
            pods = kubectl.get_pods(
                label_selector=f"app.kubernetes.io/name={deployment_name}"
            )
            running_pods = [
                p for p in pods
                if p.get("status", {}).get("phase") == "Running"
            ]

            for pod in running_pods:
                gpu_pods_found = True
                node_name = pod["spec"].get("nodeName")
                assert node_name is not None, (
                    f"Pod {pod['metadata']['name']} has no nodeName assigned"
                )
                assert node_name in gpu_node_names, (
                    f"GPU pod {pod['metadata']['name']} is on node '{node_name}' "
                    f"which is not a GPU node. GPU nodes: {gpu_node_names}"
                )

        if not gpu_pods_found:
            pytest.skip(
                "No running GPU pods found — GPU replicas may be scaled to 0"
            )

    def test_gpu_nodes_have_correct_labels(self, kubectl, gpu_nodes):
        """GPU nodes must have the gpu-pool=true label."""
        if not gpu_nodes:
            pytest.skip("No GPU nodes available in the cluster")

        for node in gpu_nodes:
            labels = node["metadata"].get("labels", {})
            assert labels.get("gpu-pool") == "true", (
                f"GPU node {node['metadata']['name']} missing gpu-pool=true label. "
                f"Labels: {labels}"
            )

    def test_gpu_nodes_have_nvidia_taint(self, kubectl, gpu_nodes):
        """GPU nodes must have the nvidia.com/gpu taint with NoSchedule effect."""
        if not gpu_nodes:
            pytest.skip("No GPU nodes available in the cluster")

        for node in gpu_nodes:
            taints = node["spec"].get("taints", [])
            nvidia_taints = [
                t for t in taints
                if t.get("key") == "nvidia.com/gpu"
                and t.get("effect") == "NoSchedule"
            ]
            assert len(nvidia_taints) > 0, (
                f"GPU node {node['metadata']['name']} missing "
                f"nvidia.com/gpu:NoSchedule taint. Taints: {taints}"
            )


class TestCPUPodsOnCPUNodes:
    """Verify CPU pods are scheduled exclusively on CPU-labeled nodes.

    Validates: Requirements 2.1
    """

    def test_cpu_pods_run_on_cpu_labeled_nodes(
        self, kubectl, deployed_chart, cpu_nodes
    ):
        """CPU pods must be running on nodes with cpu-pool=true label."""
        if not cpu_nodes:
            pytest.skip("No CPU nodes available in the cluster")

        cpu_node_names = {
            node["metadata"]["name"] for node in cpu_nodes
        }

        cpu_pods_found = False
        for deployment_name in CPU_DEPLOYMENTS:
            pods = kubectl.get_pods(
                label_selector=f"app.kubernetes.io/name={deployment_name}"
            )
            running_pods = [
                p for p in pods
                if p.get("status", {}).get("phase") == "Running"
            ]

            for pod in running_pods:
                cpu_pods_found = True
                node_name = pod["spec"].get("nodeName")
                assert node_name is not None, (
                    f"Pod {pod['metadata']['name']} has no nodeName assigned"
                )
                assert node_name in cpu_node_names, (
                    f"CPU pod {pod['metadata']['name']} is on node '{node_name}' "
                    f"which is not a CPU node. CPU nodes: {cpu_node_names}"
                )

        if not cpu_pods_found:
            pytest.skip("No running CPU pods found in the deployed chart")

    def test_cpu_nodes_have_correct_labels(self, kubectl, cpu_nodes):
        """CPU nodes must have the cpu-pool=true label."""
        if not cpu_nodes:
            pytest.skip("No CPU nodes available in the cluster")

        for node in cpu_nodes:
            labels = node["metadata"].get("labels", {})
            assert labels.get("cpu-pool") == "true", (
                f"CPU node {node['metadata']['name']} missing cpu-pool=true label. "
                f"Labels: {labels}"
            )

    def test_cpu_pods_not_on_gpu_nodes(
        self, kubectl, deployed_chart, gpu_nodes
    ):
        """No CPU pod should ever be scheduled on a GPU node."""
        if not gpu_nodes:
            pytest.skip("No GPU nodes available — cannot verify exclusion")

        gpu_node_names = {
            node["metadata"]["name"] for node in gpu_nodes
        }

        for deployment_name in CPU_DEPLOYMENTS:
            pods = kubectl.get_pods(
                label_selector=f"app.kubernetes.io/name={deployment_name}"
            )
            for pod in pods:
                node_name = pod["spec"].get("nodeName")
                if node_name:
                    assert node_name not in gpu_node_names, (
                        f"CPU pod {pod['metadata']['name']} incorrectly "
                        f"scheduled on GPU node '{node_name}'"
                    )


class TestGPUPendingWithoutCapacity:
    """Verify GPU pods stay Pending when no GPU capacity is available.

    Validates: Requirements 1.6
    """

    def test_gpu_pod_pending_when_no_gpu_capacity(self, kubectl, test_namespace):
        """
        A GPU-requesting pod should remain Pending when no GPU capacity exists.

        Creates a temporary pod requesting a GPU resource with gpu-pool affinity.
        If GPU nodes are fully allocated or not present, the pod should stay Pending.
        """
        pod_name = "gpu-scheduling-test-pending"

        # Create a pod that requests GPU resources
        pod_manifest = yaml.dump({
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": pod_name,
                "namespace": test_namespace,
                "labels": {
                    "test": "gpu-pending-capacity",
                },
            },
            "spec": {
                "affinity": {
                    "nodeAffinity": {
                        "requiredDuringSchedulingIgnoredDuringExecution": {
                            "nodeSelectorTerms": [{
                                "matchExpressions": [{
                                    "key": "gpu-pool",
                                    "operator": "In",
                                    "values": ["true"],
                                }]
                            }]
                        }
                    }
                },
                "tolerations": [{
                    "key": "nvidia.com/gpu",
                    "operator": "Equal",
                    "value": "present",
                    "effect": "NoSchedule",
                }],
                "containers": [{
                    "name": "gpu-test",
                    "image": "busybox:latest",
                    "command": ["sleep", "3600"],
                    "resources": {
                        "requests": {"nvidia.com/gpu": "100"},
                        "limits": {"nvidia.com/gpu": "100"},
                    },
                }],
                # Prevent actual scheduling - high resource request ensures Pending
                "restartPolicy": "Never",
            },
        })

        try:
            # Apply the test pod
            result = kubectl.apply(pod_manifest)
            assert result.success, (
                f"Failed to create GPU test pod: {result.stderr}"
            )

            # Wait briefly for the scheduler to process the pod
            time.sleep(10)

            # Verify the pod is in Pending state
            pod_data = kubectl.get_json("get", "pod", pod_name)
            assert pod_data is not None, "Could not retrieve test pod status"

            phase = pod_data.get("status", {}).get("phase")
            assert phase == "Pending", (
                f"Expected GPU pod to be Pending (no capacity for 100 GPUs), "
                f"but got phase: {phase}"
            )

            # Verify the pod has an Unschedulable or FailedScheduling condition/event
            conditions = pod_data.get("status", {}).get("conditions", [])
            pod_scheduled_conditions = [
                c for c in conditions
                if c.get("type") == "PodScheduled"
                and c.get("status") == "False"
            ]

            # The pod should have a PodScheduled=False condition
            assert len(pod_scheduled_conditions) > 0, (
                f"Expected PodScheduled=False condition on Pending GPU pod. "
                f"Conditions: {conditions}"
            )

        finally:
            # Cleanup: delete the test pod
            kubectl.delete("pod", pod_name)

    def test_gpu_pod_without_toleration_stays_pending(
        self, kubectl, test_namespace, gpu_nodes
    ):
        """
        A pod targeting GPU nodes without the proper toleration stays Pending.

        This validates that the taint on GPU nodes prevents unauthorized scheduling.
        """
        if not gpu_nodes:
            pytest.skip("No GPU nodes available to test taint enforcement")

        pod_name = "gpu-no-toleration-test"

        # Create a pod with GPU node affinity but NO toleration
        pod_manifest = yaml.dump({
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": pod_name,
                "namespace": test_namespace,
                "labels": {
                    "test": "gpu-no-toleration",
                },
            },
            "spec": {
                "affinity": {
                    "nodeAffinity": {
                        "requiredDuringSchedulingIgnoredDuringExecution": {
                            "nodeSelectorTerms": [{
                                "matchExpressions": [{
                                    "key": "gpu-pool",
                                    "operator": "In",
                                    "values": ["true"],
                                }]
                            }]
                        }
                    }
                },
                # Deliberately NO tolerations for nvidia.com/gpu taint
                "containers": [{
                    "name": "test-no-toleration",
                    "image": "busybox:latest",
                    "command": ["sleep", "3600"],
                }],
                "restartPolicy": "Never",
            },
        })

        try:
            result = kubectl.apply(pod_manifest)
            assert result.success, (
                f"Failed to create test pod: {result.stderr}"
            )

            # Wait for scheduler to attempt placement
            time.sleep(10)

            # Pod should be Pending because it can't tolerate the GPU taint
            pod_data = kubectl.get_json("get", "pod", pod_name)
            assert pod_data is not None, "Could not retrieve test pod status"

            phase = pod_data.get("status", {}).get("phase")
            assert phase == "Pending", (
                f"Pod without GPU toleration should be Pending on GPU-only "
                f"affinity, but got phase: {phase}"
            )

        finally:
            kubectl.delete("pod", pod_name)
