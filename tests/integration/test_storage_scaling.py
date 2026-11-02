"""
Integration tests for PVC data persistence and GPU node pool scaling.

Tests verify:
- PVC data persists across pod restarts (Requirement 5.4)
- GPU scale-to-zero behavior — pods go Pending when no GPU nodes (Requirement 7.1, 7.2)
- GPU scale-up behavior — nodes provision when GPU pods are requested (Requirement 7.3)

These tests run against a REAL AKS cluster. They will be skipped if the
cluster is unavailable or required resources are not present.
"""

import time
import uuid

import pytest
import yaml


# --- Storage Persistence Tests ---


class TestPVCDataPersistence:
    """
    Test that PVC-backed data persists across pod restarts.

    Validates: Requirement 5.4
    WHEN a pod is rescheduled, THE Persistent_Volume SHALL remain accessible
    and retain all previously written data.
    """

    @pytest.fixture()
    def busybox_with_pvc(self, kubectl, test_namespace):
        """
        Deploy a busybox pod with a PVC mount for persistence testing.

        Creates a small PVC (1Gi) and a pod that mounts it at /data.
        Cleans up after the test.
        """
        test_id = uuid.uuid4().hex[:8]
        pvc_name = f"test-persist-pvc-{test_id}"
        pod_name = f"test-persist-pod-{test_id}"

        pvc_manifest = yaml.dump({
            "apiVersion": "v1",
            "kind": "PersistentVolumeClaim",
            "metadata": {
                "name": pvc_name,
                "namespace": test_namespace,
            },
            "spec": {
                "accessModes": ["ReadWriteOnce"],
                "storageClassName": "managed-premium",
                "resources": {
                    "requests": {
                        "storage": "1Gi",
                    },
                },
            },
        })

        pod_manifest = yaml.dump({
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": pod_name,
                "namespace": test_namespace,
                "labels": {
                    "app": "persistence-test",
                    "test-id": test_id,
                },
            },
            "spec": {
                "containers": [{
                    "name": "busybox",
                    "image": "busybox:1.36",
                    "command": ["sleep", "3600"],
                    "volumeMounts": [{
                        "name": "test-volume",
                        "mountPath": "/data",
                    }],
                }],
                "volumes": [{
                    "name": "test-volume",
                    "persistentVolumeClaim": {
                        "claimName": pvc_name,
                    },
                }],
                "restartPolicy": "Never",
            },
        })

        # Create PVC
        result = kubectl.apply(pvc_manifest)
        if not result.success:
            pytest.skip(f"Cannot create PVC (storage class may not exist): {result.stderr}")

        # Wait for PVC to be bound
        wait_result = kubectl.wait(
            f"pvc/{pvc_name}",
            condition="jsonpath={.status.phase}=Bound",
            timeout=120,
        )
        if not wait_result.success:
            kubectl.delete("pvc", pvc_name)
            pytest.skip(f"PVC did not bind (cluster may lack storage class): {wait_result.stderr}")

        # Create Pod
        result = kubectl.apply(pod_manifest)
        if not result.success:
            kubectl.delete("pvc", pvc_name)
            pytest.fail(f"Cannot create test pod: {result.stderr}")

        # Wait for pod to be running
        wait_result = kubectl.wait(
            f"pod/{pod_name}",
            condition="condition=Ready",
            timeout=120,
        )
        if not wait_result.success:
            kubectl.delete("pod", pod_name)
            kubectl.delete("pvc", pvc_name)
            pytest.skip(f"Test pod did not become ready: {wait_result.stderr}")

        yield {"pod_name": pod_name, "pvc_name": pvc_name, "test_id": test_id}

        # Teardown
        kubectl.delete("pod", pod_name)
        kubectl.delete("pvc", pvc_name)

    def test_data_persists_across_pod_restart(self, kubectl, test_namespace, busybox_with_pvc):
        """
        Verify that data written to a PVC persists after pod deletion and recreation.

        Steps:
        1. Write a unique marker file to the PVC via the pod
        2. Delete the pod (simulating a restart/reschedule)
        3. Create a new pod mounting the same PVC
        4. Verify the marker file still exists with correct content
        """
        pod_name = busybox_with_pvc["pod_name"]
        pvc_name = busybox_with_pvc["pvc_name"]
        test_id = busybox_with_pvc["test_id"]
        marker_content = f"persistence-test-{test_id}-{uuid.uuid4().hex[:8]}"

        # Step 1: Write data to PVC
        write_result = kubectl.exec(
            pod_name,
            ["sh", "-c", f"echo '{marker_content}' > /data/test-marker.txt"],
        )
        assert write_result.success, f"Failed to write to PVC: {write_result.stderr}"

        # Verify write was successful
        read_result = kubectl.exec(pod_name, ["cat", "/data/test-marker.txt"])
        assert read_result.success, f"Failed to read from PVC: {read_result.stderr}"
        assert marker_content in read_result.stdout

        # Step 2: Delete the pod
        delete_result = kubectl.delete("pod", pod_name)
        assert delete_result.success, f"Failed to delete pod: {delete_result.stderr}"

        # Wait for pod to be fully gone
        time.sleep(5)

        # Step 3: Create a new pod mounting the same PVC
        new_pod_name = f"test-persist-pod2-{test_id}"
        new_pod_manifest = yaml.dump({
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": new_pod_name,
                "namespace": test_namespace,
                "labels": {
                    "app": "persistence-test",
                    "test-id": test_id,
                },
            },
            "spec": {
                "containers": [{
                    "name": "busybox",
                    "image": "busybox:1.36",
                    "command": ["sleep", "3600"],
                    "volumeMounts": [{
                        "name": "test-volume",
                        "mountPath": "/data",
                    }],
                }],
                "volumes": [{
                    "name": "test-volume",
                    "persistentVolumeClaim": {
                        "claimName": pvc_name,
                    },
                }],
                "restartPolicy": "Never",
            },
        })

        apply_result = kubectl.apply(new_pod_manifest)
        assert apply_result.success, f"Failed to create new pod: {apply_result.stderr}"

        # Wait for new pod to be ready
        wait_result = kubectl.wait(
            f"pod/{new_pod_name}",
            condition="condition=Ready",
            timeout=120,
        )
        assert wait_result.success, f"New pod did not become ready: {wait_result.stderr}"

        # Step 4: Verify the data persists
        read_result = kubectl.exec(new_pod_name, ["cat", "/data/test-marker.txt"])
        assert read_result.success, f"Failed to read from PVC in new pod: {read_result.stderr}"
        assert marker_content in read_result.stdout, (
            f"Data did not persist across pod restart. "
            f"Expected '{marker_content}' in output, got: '{read_result.stdout.strip()}'"
        )

        # Cleanup the new pod
        kubectl.delete("pod", new_pod_name)

    def test_multiple_files_persist(self, kubectl, test_namespace, busybox_with_pvc):
        """
        Verify that multiple files written to a PVC all persist across pod restart.

        Validates that the entire filesystem state is preserved, not just a single file.
        """
        pod_name = busybox_with_pvc["pod_name"]
        pvc_name = busybox_with_pvc["pvc_name"]
        test_id = busybox_with_pvc["test_id"]

        # Write multiple files
        files = {
            "/data/file1.txt": f"content-1-{test_id}",
            "/data/subdir/file2.txt": f"content-2-{test_id}",
            "/data/subdir/nested/file3.txt": f"content-3-{test_id}",
        }

        # Create subdirectories and files
        for filepath, content in files.items():
            dir_path = "/".join(filepath.split("/")[:-1])
            mkdir_result = kubectl.exec(pod_name, ["mkdir", "-p", dir_path])
            assert mkdir_result.success, f"Failed to create dir {dir_path}: {mkdir_result.stderr}"

            write_result = kubectl.exec(
                pod_name,
                ["sh", "-c", f"echo '{content}' > {filepath}"],
            )
            assert write_result.success, f"Failed to write {filepath}: {write_result.stderr}"

        # Delete pod
        kubectl.delete("pod", pod_name)
        time.sleep(5)

        # Recreate pod
        new_pod_name = f"test-persist-multi-{test_id}"
        new_pod_manifest = yaml.dump({
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": new_pod_name,
                "namespace": test_namespace,
                "labels": {"app": "persistence-test", "test-id": test_id},
            },
            "spec": {
                "containers": [{
                    "name": "busybox",
                    "image": "busybox:1.36",
                    "command": ["sleep", "3600"],
                    "volumeMounts": [{
                        "name": "test-volume",
                        "mountPath": "/data",
                    }],
                }],
                "volumes": [{
                    "name": "test-volume",
                    "persistentVolumeClaim": {"claimName": pvc_name},
                }],
                "restartPolicy": "Never",
            },
        })

        apply_result = kubectl.apply(new_pod_manifest)
        assert apply_result.success, f"Failed to create new pod: {apply_result.stderr}"

        wait_result = kubectl.wait(
            f"pod/{new_pod_name}",
            condition="condition=Ready",
            timeout=120,
        )
        assert wait_result.success, f"New pod did not become ready: {wait_result.stderr}"

        # Verify all files persist
        for filepath, expected_content in files.items():
            read_result = kubectl.exec(new_pod_name, ["cat", filepath])
            assert read_result.success, f"File {filepath} not found after restart: {read_result.stderr}"
            assert expected_content in read_result.stdout, (
                f"Content mismatch for {filepath}. "
                f"Expected '{expected_content}', got: '{read_result.stdout.strip()}'"
            )

        # Cleanup
        kubectl.delete("pod", new_pod_name)


# --- GPU Scaling Tests ---


class TestGPUScaleToZero:
    """
    Test GPU node pool scale-to-zero and scale-up behavior.

    Validates: Requirements 7.1, 7.2, 7.3
    - GPU node pool can scale to 0 when no GPU pods are running
    - GPU pods go to Pending state when no GPU nodes are available
    - GPU nodes scale up when GPU pods are requested
    """

    @pytest.fixture(autouse=True)
    def _check_cluster_has_autoscaler(self, kubectl):
        """Skip tests if cluster autoscaler is not configured."""
        # Check if the cluster has GPU node pool label configuration
        # by looking for the autoscaler config
        result = kubectl.run(
            "get", "nodes", "-l", "gpu-pool=true", "-o", "json",
            namespace=None,
        )
        if not result.success:
            pytest.skip("Cannot query nodes — cluster may be unreachable")

    def test_gpu_pod_pending_when_no_gpu_nodes(self, kubectl, test_namespace):
        """
        Verify that a GPU-requesting pod goes to Pending when no GPU nodes exist.

        When the GPU node pool is scaled to zero, any pod requesting
        nvidia.com/gpu resources should remain in Pending state because
        no nodes can satisfy the resource request.

        Validates: Requirement 7.1 (min=0), 7.2 (scale down to 0)
        """
        # First check if there are currently 0 GPU nodes
        nodes_result = kubectl.run(
            "get", "nodes", "-l", "gpu-pool=true", "-o", "json",
            namespace=None,
        )
        if not nodes_result.success:
            pytest.skip("Cannot list GPU nodes")

        import json
        nodes_data = json.loads(nodes_result.stdout)
        gpu_node_count = len(nodes_data.get("items", []))

        # If GPU nodes exist, we can still test — the pod should schedule
        # But ideally we test the Pending state when no GPU nodes are available
        if gpu_node_count > 0:
            pytest.skip(
                f"GPU nodes are currently available ({gpu_node_count} nodes). "
                "Scale-to-zero test requires GPU node pool at 0 nodes. "
                "Scale down the GPU node pool and re-run this test."
            )

        test_id = uuid.uuid4().hex[:8]
        pod_name = f"gpu-pending-test-{test_id}"

        # Create a pod that requests GPU resources
        gpu_pod_manifest = yaml.dump({
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": pod_name,
                "namespace": test_namespace,
                "labels": {
                    "app": "gpu-scale-test",
                    "test-id": test_id,
                },
            },
            "spec": {
                "containers": [{
                    "name": "gpu-test",
                    "image": "busybox:1.36",
                    "command": ["sleep", "60"],
                    "resources": {
                        "requests": {"nvidia.com/gpu": "1"},
                        "limits": {"nvidia.com/gpu": "1"},
                    },
                }],
                "tolerations": [{
                    "key": "nvidia.com/gpu",
                    "operator": "Equal",
                    "value": "present",
                    "effect": "NoSchedule",
                }],
                "affinity": {
                    "nodeAffinity": {
                        "requiredDuringSchedulingIgnoredDuringExecution": {
                            "nodeSelectorTerms": [{
                                "matchExpressions": [{
                                    "key": "gpu-pool",
                                    "operator": "In",
                                    "values": ["true"],
                                }],
                            }],
                        },
                    },
                },
                "restartPolicy": "Never",
            },
        })

        # Apply the GPU pod
        result = kubectl.apply(gpu_pod_manifest)
        assert result.success, f"Failed to create GPU test pod: {result.stderr}"

        # Wait a short time for the scheduler to evaluate the pod
        time.sleep(10)

        # Verify the pod is in Pending state
        pod_result = kubectl.get_json("get", "pod", pod_name)
        assert pod_result is not None, "Failed to get pod status"

        pod_phase = pod_result.get("status", {}).get("phase", "")
        assert pod_phase == "Pending", (
            f"GPU pod should be Pending when no GPU nodes available, "
            f"but is in phase: {pod_phase}"
        )

        # Verify the reason is related to scheduling (insufficient resources or unschedulable)
        conditions = pod_result.get("status", {}).get("conditions", [])
        pod_scheduled = next(
            (c for c in conditions if c.get("type") == "PodScheduled"),
            None,
        )
        if pod_scheduled:
            assert pod_scheduled.get("status") == "False", (
                "Pod should not be scheduled when no GPU nodes are available"
            )
            reason = pod_scheduled.get("reason", "")
            assert reason == "Unschedulable", (
                f"Expected Unschedulable reason, got: {reason}"
            )

        # Cleanup
        kubectl.delete("pod", pod_name)

    def test_gpu_scale_up_triggers_on_pending_pod(self, kubectl, test_namespace):
        """
        Verify that the cluster autoscaler provisions GPU nodes when GPU pods are pending.

        This test creates a GPU-requesting pod and verifies that either:
        - The autoscaler begins provisioning a node (ScaleUp event), OR
        - The pod eventually transitions from Pending to Running (node provisioned)

        Note: Full scale-up can take 5-15 minutes. This test verifies the
        autoscaler has been triggered rather than waiting for completion.

        Validates: Requirement 7.3
        """
        # Check current GPU node count
        nodes_result = kubectl.run(
            "get", "nodes", "-l", "gpu-pool=true", "-o", "json",
            namespace=None,
        )
        if not nodes_result.success:
            pytest.skip("Cannot list GPU nodes")

        import json
        nodes_data = json.loads(nodes_result.stdout)
        gpu_node_count = len(nodes_data.get("items", []))

        if gpu_node_count > 0:
            pytest.skip(
                f"GPU nodes already available ({gpu_node_count}). "
                "This test verifies scale-up from zero. "
                "Scale down the GPU node pool first."
            )

        test_id = uuid.uuid4().hex[:8]
        pod_name = f"gpu-scaleup-test-{test_id}"

        # Create GPU pod to trigger autoscaler
        gpu_pod_manifest = yaml.dump({
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": pod_name,
                "namespace": test_namespace,
                "labels": {
                    "app": "gpu-scaleup-test",
                    "test-id": test_id,
                },
            },
            "spec": {
                "containers": [{
                    "name": "gpu-test",
                    "image": "busybox:1.36",
                    "command": ["sleep", "300"],
                    "resources": {
                        "requests": {"nvidia.com/gpu": "1"},
                        "limits": {"nvidia.com/gpu": "1"},
                    },
                }],
                "tolerations": [{
                    "key": "nvidia.com/gpu",
                    "operator": "Equal",
                    "value": "present",
                    "effect": "NoSchedule",
                }],
                "affinity": {
                    "nodeAffinity": {
                        "requiredDuringSchedulingIgnoredDuringExecution": {
                            "nodeSelectorTerms": [{
                                "matchExpressions": [{
                                    "key": "gpu-pool",
                                    "operator": "In",
                                    "values": ["true"],
                                }],
                            }],
                        },
                    },
                },
                "restartPolicy": "Never",
            },
        })

        result = kubectl.apply(gpu_pod_manifest)
        assert result.success, f"Failed to create GPU scaleup test pod: {result.stderr}"

        # Wait for autoscaler to react (typically within 30-60s)
        # We check for either:
        # 1. TriggeredScaleUp event on the pod
        # 2. A new node appearing in the GPU pool
        # 3. Pod transitioning to a non-Pending state
        autoscaler_triggered = False
        max_wait_seconds = 120  # 2 minutes to detect autoscaler trigger
        poll_interval = 10

        for elapsed in range(0, max_wait_seconds, poll_interval):
            time.sleep(poll_interval)

            # Check pod events for autoscaler activity
            events_result = kubectl.run(
                "get", "events",
                "--field-selector", f"involvedObject.name={pod_name}",
                "-o", "json",
            )
            if events_result.success:
                events_data = json.loads(events_result.stdout)
                for event in events_data.get("items", []):
                    reason = event.get("reason", "")
                    message = event.get("message", "")
                    # Cluster autoscaler emits TriggeredScaleUp events
                    if "TriggeredScaleUp" in reason or "ScaleUp" in reason:
                        autoscaler_triggered = True
                        break
                    # Also check for messages indicating scale-up
                    if "scale up" in message.lower() or "scaling up" in message.lower():
                        autoscaler_triggered = True
                        break

            if autoscaler_triggered:
                break

            # Check if a new GPU node has appeared
            new_nodes_result = kubectl.run(
                "get", "nodes", "-l", "gpu-pool=true", "-o", "json",
                namespace=None,
            )
            if new_nodes_result.success:
                new_nodes_data = json.loads(new_nodes_result.stdout)
                if len(new_nodes_data.get("items", [])) > 0:
                    autoscaler_triggered = True
                    break

            # Check if pod has left Pending state
            pod_result = kubectl.get_json("get", "pod", pod_name)
            if pod_result:
                phase = pod_result.get("status", {}).get("phase", "")
                if phase != "Pending":
                    autoscaler_triggered = True
                    break

        assert autoscaler_triggered, (
            f"Cluster autoscaler did not trigger scale-up within {max_wait_seconds}s. "
            "Verify that the cluster autoscaler is enabled on the GPU node pool "
            "with minNodes=0 and the pool can scale up."
        )

        # Cleanup
        kubectl.delete("pod", pod_name)

    def test_gpu_node_pool_min_zero_config(self, kubectl, deployed_chart, test_namespace):
        """
        Verify the autoscaler configuration allows GPU node pool to scale to zero.

        Checks that the cluster-autoscaler-config ConfigMap specifies
        minNodes=0 for the GPU pool.

        Validates: Requirement 7.1
        """
        # Get the autoscaler config ConfigMap deployed by Helm
        result = kubectl.run(
            "get", "configmap", "-l", "app.kubernetes.io/component=cluster-autoscaler-config",
            "-o", "json",
        )
        if not result.success:
            # Try with a direct name pattern
            result = kubectl.run("get", "configmap", "-o", "json")

        if not result.success:
            pytest.skip("Cannot query ConfigMaps in test namespace")

        import json
        cm_data = json.loads(result.stdout)
        items = cm_data.get("items", [])

        # Find the autoscaler config ConfigMap
        autoscaler_cm = None
        for item in items:
            name = item.get("metadata", {}).get("name", "")
            if "cluster-autoscaler" in name:
                autoscaler_cm = item
                break

        if autoscaler_cm is None:
            pytest.skip("Cluster autoscaler ConfigMap not found in test namespace")

        data = autoscaler_cm.get("data", {})
        gpu_min_nodes = data.get("gpu.minNodes", None)

        assert gpu_min_nodes is not None, "gpu.minNodes not found in autoscaler config"
        assert gpu_min_nodes == "0", (
            f"GPU node pool minNodes should be 0 for scale-to-zero, got: {gpu_min_nodes}"
        )

    def test_gpu_scale_down_unneeded_time_configured(self, kubectl, deployed_chart, test_namespace):
        """
        Verify the scale-down-unneeded-time is configured (default 10m).

        The cluster autoscaler should wait 10 minutes of idle time before
        removing GPU nodes.

        Validates: Requirement 7.2
        """
        result = kubectl.run("get", "configmap", "-o", "json")
        if not result.success:
            pytest.skip("Cannot query ConfigMaps")

        import json
        cm_data = json.loads(result.stdout)
        items = cm_data.get("items", [])

        autoscaler_cm = None
        for item in items:
            name = item.get("metadata", {}).get("name", "")
            if "cluster-autoscaler" in name:
                autoscaler_cm = item
                break

        if autoscaler_cm is None:
            pytest.skip("Cluster autoscaler ConfigMap not found")

        data = autoscaler_cm.get("data", {})
        scale_down_time = data.get("gpu.scaleDownUnneededTime", None)

        assert scale_down_time is not None, (
            "gpu.scaleDownUnneededTime not found in autoscaler config"
        )
        assert scale_down_time == "10m", (
            f"Expected scale-down-unneeded-time of '10m', got: {scale_down_time}"
        )
