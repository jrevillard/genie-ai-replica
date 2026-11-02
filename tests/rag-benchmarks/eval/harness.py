# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Shared harness primitives: docker exec + atomic UTF-8 JSON IO.

Consolidates the ``_docker_exec`` / JSON-write helpers previously duplicated
between ``run_eval.py`` and ``capture_baseline.py``. Behaviour is unchanged:
``docker_exec`` raises on non-zero returncode with the first 300 chars of
stderr; ``write_json`` writes to ``<path>.tmp`` then ``os.replace`` so a crash
or a serialization error never leaves a half-written file behind.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import Any


class HarnessError(RuntimeError):
    """Raised when a harness primitive fails (e.g. docker exec non-zero rc)."""


def docker_exec(
    container: str, cmd: str, timeout: float = 120, pass_env: tuple = ()
) -> str:
    """Run ``cmd`` inside ``container`` via ``docker exec``; return stdout.

    ``pass_env`` forwards host-side env var NAMES to the container via
    ``docker exec -e VAR`` (valueless flag = inherit from the calling
    process env), keeping secrets off argv. Inserted BEFORE the container
    name so docker parses them as exec flags, not positional args.
    """
    args = ["docker", "exec"]
    for var in pass_env:
        args.extend(["-e", var])
    args.extend([container, "sh", "-c", cmd])
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise HarnessError(
            f"docker exec {container} failed: {result.stderr.strip()[:300]}"
        )
    return result.stdout


def read_json(path) -> Any:
    """Read ``path`` as UTF-8 JSON; return the decoded value."""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj: Any, *, indent: int = 2, ensure_ascii: bool = False) -> None:
    """Atomically write ``obj`` to ``path`` as UTF-8 JSON.

    Writes to ``<path>.tmp`` first and then ``os.replace`` onto the final
    path so a crash or a serialization error never leaves a half-written
    file behind. The temp file is removed on any failure.
    """
    tmp = f"{path}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=indent, ensure_ascii=ensure_ascii)
        os.replace(tmp, path)
    except BaseException:
        # Cleanup the temp file (best-effort — itself may be missing on
        # some failure modes); re-raise so the caller sees the real error.
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        finally:
            raise
