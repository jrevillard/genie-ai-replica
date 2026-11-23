"""Unit tests for harness.py primitives.

Covers:
  - write_json atomicity (no .tmp left, content round-trips with UTF-8)
  - read_json UTF-8 round-trip with accents
  - docker_exec error path (mock subprocess.run rc=1 → HarnessError)
  - docker_exec pass_env flag order (-e inserted BEFORE container name)
  - exec_in_container venue dispatch (docker | kubectl | unknown)
  - kubectl_exec: the forwarded env values travel on STDIN, never on argv
  - resolve_k8s_pod: the operator's pin wins, then the label selectors
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402
from harness import (  # noqa: E402
    HarnessError,
    docker_exec,
    exec_in_container,
    kubectl_exec,
    read_json,
    resolve_k8s_pod,
    write_json,
)


class TestWriteJson:
    def test_round_trips_utf8_with_accents(self, tmp_path):
        """Spanish chars survive the atomic write + re-read."""
        out = tmp_path / "out.json"
        payload = {"name": "FERROMÁS", "city": "Bogotá"}
        write_json(out, payload)
        assert json.loads(out.read_text(encoding="utf-8")) == payload

    def test_no_tmp_left_behind(self, tmp_path):
        """On success, no .tmp file remains at the destination path."""
        out = tmp_path / "out.json"
        write_json(out, {"k": "v"})
        assert not (tmp_path / "out.json.tmp").exists()
        assert out.is_file()

    def test_atomic_on_serialization_error(self, tmp_path):
        """When json.dump raises, no half-written file lands at out and no .tmp survives."""
        out = tmp_path / "out.json"
        with mock.patch("json.dump", side_effect=TypeError("bad obj")):
            with pytest.raises(TypeError, match="bad obj"):
                write_json(out, {"k": "v"})
        assert not out.exists()
        assert not (tmp_path / "out.json.tmp").exists()

    def test_ensure_ascii_off_keeps_unicode_chars(self, tmp_path):
        out = tmp_path / "out.json"
        write_json(out, {"x": "café"}, ensure_ascii=False)
        # The on-disk bytes include the literal "café" (not "é")
        assert "café".encode("utf-8") in out.read_bytes()


class TestReadJson:
    def test_round_trip(self, tmp_path):
        out = tmp_path / "data.json"
        out.write_text(json.dumps({"key": "FERROMÁS", "n": 3}, ensure_ascii=False), encoding="utf-8")
        assert read_json(out) == {"key": "FERROMÁS", "n": 3}


class TestDockerExec:
    def test_error_path_raises_harness_error(self):
        """rc=1 → HarnessError with stderr prefix."""
        fake = mock.Mock()
        fake.returncode = 1
        fake.stderr = "some docker error message"
        fake.stdout = ""
        with mock.patch("harness.subprocess.run", return_value=fake) as run:
            with pytest.raises(HarnessError, match="docker exec .* failed.*some docker"):
                docker_exec("ctr", "echo hi", timeout=10)
        # Args: docker exec ctr sh -c <cmd>
        assert run.call_args.args[0] == ["docker", "exec", "ctr", "sh", "-c", "echo hi"]

    def test_pass_env_inserted_before_container(self):
        """``-e VAR`` flags land BEFORE the container name (parsed as exec flags)."""
        fake = mock.Mock()
        fake.returncode = 0
        fake.stdout = "ok"
        fake.stderr = ""
        with mock.patch("harness.subprocess.run", return_value=fake) as run:
            assert docker_exec("ctr", "echo $X", pass_env=("E2E_BEARER_TOKEN",)) == "ok"
        args = run.call_args.args[0]
        assert args == [
            "docker", "exec",
            "-e", "E2E_BEARER_TOKEN",
            "ctr", "sh", "-c", "echo $X",
        ]
        # Defence-in-depth: container must come AFTER every -e so docker
        # doesn't treat the env flag as a positional arg.
        e_idx = [i for i, a in enumerate(args) if a == "-e"]
        ctr_idx = args.index("ctr")
        assert all(i < ctr_idx for i in e_idx)

    def test_subprocess_timeout_propagates(self):
        with mock.patch("harness.subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="docker", timeout=1)):
            with pytest.raises(subprocess.TimeoutExpired):
                docker_exec("ctr", "sleep 99", timeout=1)


class TestKubectlExec:
    def test_forwarded_env_travels_on_stdin_never_on_argv(self):
        """The bearer token must not be visible in ``ps`` — it goes through stdin."""
        fake = mock.Mock()
        fake.returncode = 0
        fake.stdout = "ok"
        fake.stderr = ""
        with mock.patch.dict(os.environ, {"E2E_BEARER_TOKEN": "s3cret"}):
            with mock.patch("harness.subprocess.run", return_value=fake) as run:
                assert kubectl_exec("pod-1", "echo $E2E_BEARER_TOKEN", pass_env=("E2E_BEARER_TOKEN",)) == "ok"
        args = run.call_args.args[0]
        assert args[0] == "kubectl" and args[1] == "exec"
        assert "pod-1" in args
        assert not any("s3cret" in str(a) for a in args)
        # The export prelude rides the sh -c argument (the shell imports the
        # stdin lines into the environment before the command runs)…
        assert 'export "$__e"' in args[-1]
        # …and the value reaches the pod through the exec's stdin only.
        assert run.call_args.kwargs["input"] == "E2E_BEARER_TOKEN=s3cret\n"

    def test_error_path_raises_harness_error(self):
        fake = mock.Mock()
        fake.returncode = 1
        fake.stdout = ""
        fake.stderr = "pod not found"
        with mock.patch("harness.subprocess.run", return_value=fake):
            with pytest.raises(HarnessError, match="kubectl exec .* failed.*pod not found"):
                kubectl_exec("pod-1", "echo hi")


class TestResolveK8sPod:
    def test_operator_pin_wins(self, monkeypatch):
        monkeypatch.setenv("EVAL_K8S_POD_CHATQNA", "chatqna-abc")
        exists = mock.Mock(return_value=True)
        with mock.patch("harness._pod_exists", exists):
            assert resolve_k8s_pod("chatqna") == "chatqna-abc"
        exists.assert_called_once_with("chatqna-abc", "genieai")

    def test_stale_pin_falls_back_to_the_labels_with_a_warning(self, monkeypatch, capsys):
        """A pin naming a pod the rollout rotated away must not pin the run
        to a corpse — it falls through to the label selectors."""
        harness._warned_stale_pins.clear()
        monkeypatch.setenv("EVAL_K8S_POD_CHATQNA", "chatqna-dead")
        fake = mock.Mock()
        fake.returncode = 0
        fake.stdout = "chatqna-live\n"
        fake.stderr = ""
        with mock.patch("harness._pod_exists", return_value=False):
            with mock.patch("harness._run_kubectl", return_value="chatqna-live\n"):
                assert resolve_k8s_pod("chatqna") == "chatqna-live"
        out = capsys.readouterr().err
        assert "chatqna-dead" in out and "falling back" in out

    def test_label_selector_resolves_the_live_pod(self, monkeypatch):
        monkeypatch.delenv("EVAL_K8S_POD_CHATQNA", raising=False)
        with mock.patch("harness._run_kubectl", return_value="chatqna-xyz\n") as run:
            assert resolve_k8s_pod("chatqna") == "chatqna-xyz"
        args = run.call_args.args[0]
        assert "genieai.io/component=chatqna" in args
        # The running-only filter: an eviction tombstone or a Terminating pod
        # (venues collect them) must never be resolved.
        assert "status.phase=Running" in args

    def test_a_failed_lookup_names_the_real_cause(self, monkeypatch):
        """A kubectl failure (wrong namespace, RBAC denial) is not quietly
        read as 'no pod found' — the refusal carries kubectl's own stderr."""
        monkeypatch.delenv("EVAL_K8S_POD_CHATQNA", raising=False)
        with mock.patch(
            "harness._run_kubectl",
            mock.Mock(side_effect=HarnessError('kubectl get pods failed: namespaces "nope" not found')),
        ):
            with pytest.raises(HarnessError, match='namespaces "nope" not found'):
                resolve_k8s_pod("chatqna")

    def test_a_docker_style_identity_is_refused_with_the_remedy(self, monkeypatch):
        monkeypatch.delenv("EVAL_K8S_POD_CHATQNA_XEON_BACKEND_SERVER", raising=False)
        with mock.patch("harness._run_kubectl", return_value=""):
            with pytest.raises(HarnessError, match="COMPONENT name"):
                resolve_k8s_pod("chatqna-xeon-backend-server")

    def test_no_match_is_a_refusal_not_a_guess(self, monkeypatch):
        monkeypatch.delenv("EVAL_K8S_POD_CHATQNA", raising=False)
        with mock.patch("harness._run_kubectl", return_value=""):
            with pytest.raises(HarnessError, match="no running pod found"):
                resolve_k8s_pod("chatqna")


class TestKubectlExecTransport:
    def test_a_newline_in_a_forwarded_value_is_refused(self, monkeypatch):
        """The stdin transport is line-based; a multiline value would be
        silently truncated — refused instead."""
        monkeypatch.setenv("BROKEN_TOKEN", "line1\nline2")
        with pytest.raises(HarnessError, match="contains a newline"):
            kubectl_exec("pod-1", "echo $BROKEN_TOKEN", pass_env=("BROKEN_TOKEN",))


class TestExecInContainer:
    def test_docker_is_the_default_backend(self, monkeypatch):
        monkeypatch.delenv("EVAL_EXEC_BACKEND", raising=False)
        with mock.patch("harness.docker_exec", return_value="from-docker") as docker:
            assert exec_in_container("ctr", "echo hi") == "from-docker"
        docker.assert_called_once()

    def test_kubectl_backend_dispatches_to_the_resolved_pod(self, monkeypatch):
        monkeypatch.setenv("EVAL_EXEC_BACKEND", "kubectl")
        with mock.patch("harness.resolve_k8s_pod", return_value="pod-1") as resolve:
            with mock.patch("harness.kubectl_exec", return_value="from-kubectl") as kubectl:
                assert exec_in_container("chatqna", "echo hi") == "from-kubectl"
        resolve.assert_called_once_with("chatqna")
        # The exec goes to the RESOLVED pod, not to the container identity.
        assert kubectl.call_args.args[0] == "pod-1"

    def test_unknown_backend_refuses_loudly(self, monkeypatch):
        monkeypatch.setenv("EVAL_EXEC_BACKEND", "podman")
        with pytest.raises(HarnessError, match="unknown exec backend"):
            exec_in_container("ctr", "echo hi")
