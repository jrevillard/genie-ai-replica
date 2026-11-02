"""Unit tests for harness.py primitives.

Covers:
  - write_json atomicity (no .tmp left, content round-trips with UTF-8)
  - read_json UTF-8 round-trip with accents
  - docker_exec error path (mock subprocess.run rc=1 → HarnessError)
  - docker_exec pass_env flag order (-e inserted BEFORE container name)
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import HarnessError, docker_exec, read_json, write_json  # noqa: E402


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
