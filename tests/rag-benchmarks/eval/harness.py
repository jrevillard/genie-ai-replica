# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Shared harness primitives: container exec + atomic UTF-8 JSON IO.

Consolidates the ``_docker_exec`` / JSON-write helpers previously duplicated
between ``run_eval.py`` and ``capture_baseline.py``. Behaviour is unchanged:
``docker_exec`` raises on non-zero returncode with the first 300 chars of
stderr; ``write_json`` writes to ``<path>.tmp`` then ``os.replace`` so a crash
or a serialization error never leaves a half-written file behind.

The exec primitive is VENUE-DISPATCHING (:func:`exec_in_container`): the
toolchain runs against a Docker Compose / Swarm deployment (``docker exec``)
AND against a Kubernetes deployment (``kubectl exec``). The backend is
SELECTED by the operator (``EVAL_EXEC_BACKEND``), never detected — a silent
fallback to the wrong backend fails every row with a plausible-looking
error, which is worse than a loud refusal.
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


# --- venue dispatch --------------------------------------------------------
# The exec backend. "docker" (compose/swarm, the default) or "kubectl" (a
# Kubernetes venue). Selected, never detected.
EXEC_BACKEND_ENV = "EVAL_EXEC_BACKEND"
# The namespace a kubectl venue's pods live in.
K8S_NAMESPACE_ENV = "EVAL_K8S_NAMESPACE"
DEFAULT_K8S_NAMESPACE = "genieai"


def _k8s_namespace(namespace: str | None = None) -> str:
    return namespace or os.getenv(K8S_NAMESPACE_ENV, DEFAULT_K8S_NAMESPACE)


def _pod_env_key(container: str) -> str:
    """The env var that pins a pod name for a container identity."""
    ident = "".join(ch if ch.isalnum() else "_" for ch in container.upper())
    return f"EVAL_K8S_POD_{ident}"


def resolve_k8s_pod(container: str, namespace: str | None = None) -> str:
    """Resolve a container identity to a live pod name on a Kubernetes venue.

    Resolution order — first hit wins:

    1. ``EVAL_K8S_POD_<IDENT>`` — the operator's exact pin (the pod name
       changes with every rollout, so the pin is a snapshot, not a fact);
    2. a label selector — ``genieai.io/component=<container>`` then
       ``app.kubernetes.io/component=<container>``.

    No match is a :class:`HarnessError`, never a guess: a wrong pod would
    answer every query with someone else's service.
    """
    ns = _k8s_namespace(namespace)
    pinned = os.getenv(_pod_env_key(container))
    if pinned:
        return pinned
    for label in (
        f"genieai.io/component={container}",
        f"app.kubernetes.io/component={container}",
    ):
        result = subprocess.run(
            [
                "kubectl", "get", "pods", "-n", ns,
                "-l", label,
                "-o", "jsonpath={.items[0].metadata.name}",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        name = result.stdout.strip()
        if name:
            return name
    raise HarnessError(
        f"no pod found for container identity {container!r} in namespace {ns!r}"
        f" (labels tried: genieai.io/component, app.kubernetes.io/component;"
        f" pin it with {_pod_env_key(container)}=<pod>)"
    )


def kubectl_exec(
    pod: str,
    cmd: str,
    timeout: float = 120,
    pass_env: tuple = (),
    namespace: str | None = None,
) -> str:
    """Run ``cmd`` inside a pod via ``kubectl exec``; return stdout.

    ``pass_env`` forwards host-side env var NAMES to the pod. ``kubectl exec``
    has no ``-e`` flag, so the values travel through the exec's STDIN and the
    shell exports them — never on argv, where the token would be visible in
    ``ps``/procfs (the same contract ``docker exec -e`` gives).
    """
    ns = _k8s_namespace(namespace)
    prelude = ""
    payload = ""
    if pass_env:
        prelude = 'while IFS= read -r __e; do export "$__e"; done; '
        payload = "".join(f"{name}={os.environ.get(name, '')}\n" for name in pass_env)
    args = [
        "kubectl", "exec", "-i", "-n", ns, pod,
        "--", "sh", "-c", prelude + cmd,
    ]
    result = subprocess.run(
        args,
        input=payload,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise HarnessError(
            f"kubectl exec {pod} failed: {result.stderr.strip()[:300]}"
        )
    return result.stdout


def exec_in_container(
    container: str, cmd: str, timeout: float = 120, pass_env: tuple = ()
) -> str:
    """Run ``cmd`` inside the venue's container; return stdout.

    The venue decides how: ``EVAL_EXEC_BACKEND=docker`` (compose/swarm) or
    ``=kubectl`` (Kubernetes). An unknown backend is a :class:`HarnessError`
    — the toolchain never guesses a transport, because a wrong one produces
    per-row failures that look like data.
    """
    backend = os.getenv(EXEC_BACKEND_ENV, "docker").strip().lower()
    if backend == "docker":
        return docker_exec(container, cmd, timeout=timeout, pass_env=pass_env)
    if backend == "kubectl":
        pod = resolve_k8s_pod(container)
        return kubectl_exec(pod, cmd, timeout=timeout, pass_env=pass_env)
    raise HarnessError(
        f"unknown exec backend {backend!r} ({EXEC_BACKEND_ENV}) —"
        " use 'docker' or 'kubectl'"
    )


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
