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
import sys
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


def exec_backend() -> str:
    """The selected exec backend: ``"docker"`` (default) or ``"kubectl"``.

    The ONE place the backend is read. Every consumer calls this instead of
    re-parsing the env var, so a change to the default or to the
    normalization is a one-site edit (a site that misses ``.strip()`` would
    otherwise accept a value the dispatcher treats differently).
    """
    return os.getenv(EXEC_BACKEND_ENV, "docker").strip().lower()


def _k8s_namespace() -> str:
    """The venue's namespace: ``EVAL_K8S_NAMESPACE`` stripped, else the
    default. Normalized like ``exec_backend`` — a stray space in a quoted
    multi-line export would otherwise send every lookup at a namespace
    nothing lives in."""
    return os.getenv(K8S_NAMESPACE_ENV, "").strip() or DEFAULT_K8S_NAMESPACE


def _pod_env_key(container: str) -> str:
    """The env var that pins a pod name for a container identity."""
    ident = "".join(ch if ch.isalnum() else "_" for ch in container.upper())
    return f"EVAL_K8S_POD_{ident}"


def _run_kubectl(
    args: list[str],
    timeout: float = 30,
    input: str | None = None,
    label: str | None = None,
) -> str:
    """One kubectl call; stdout on success, a :class:`HarnessError` naming the
    real cause otherwise (a failed lookup is never quietly read as "no pod").

    ``input`` is forwarded to the process's stdin — the only way to carry
    values into a pod without putting them on argv. ``label`` names the
    call in the failure message (default: the subcommand).
    """
    what = label or args[1]
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout, input=input
        )
    except (OSError, subprocess.TimeoutExpired) as failed:
        raise HarnessError(f"kubectl {what} failed: {failed}") from failed
    if result.returncode != 0:
        raise HarnessError(
            f"kubectl {what} failed: {result.stderr.strip()[:300]}"
        )
    return result.stdout


_warned_stale_pins: set[str] = set()


def _pod_exists(pod: str, namespace: str) -> bool:
    """True when the pod object exists. Only a NOT-FOUND answer counts as
    "gone": an RBAC denial or an API outage raises, so the stale-pin
    warning never masks the real cause."""
    try:
        _run_kubectl(
            ["kubectl", "get", "pod", pod, "-n", namespace,
             "-o", "jsonpath={.metadata.name}"]
        )
    except HarnessError as failed:
        if "not found" in str(failed).lower():
            return False
        raise
    return True


def resolve_k8s_pod(container: str) -> str:
    """Resolve a container identity to a live pod name on a Kubernetes venue.

    Resolution order — first hit wins:

    1. ``EVAL_K8S_POD_<IDENT>`` — the operator's exact pin. The pin is
       existence-checked: a pod a rollout retired falls through to the
       labels with a once-only warning, so a stale pin cannot pin the run
       to a pod name nothing answers on. (Existence, not phase: a pin can
       still name a Terminating pod — the label path is the phase-guarded
       one; pin a live pod.)
    2. a label selector over RUNNING pods —
       ``genieai.io/component=<container>`` then
       ``app.kubernetes.io/component=<container>``. The running-only filter
       keeps a Terminating or evicted tombstone pod (venues collect them)
       from being resolved.

    The identity is the deployment's COMPONENT name (``chatqna``,
    ``agent-service``) — the same string the chart labels pods with. A
    docker-style container name (``chatqna-xeon-backend-server``) matches
    nothing; the refusal says so.

    No match is a :class:`HarnessError`, never a guess: a wrong pod would
    answer every query with someone else's service.
    """
    ns = _k8s_namespace()
    pinned = os.getenv(_pod_env_key(container))
    if pinned:
        if _pod_exists(pinned, ns):
            return pinned
        # The pin is a snapshot; a rollout retires it. Warn ONCE per pin —
        # the fallback runs per exec, and dozens of identical lines would
        # bury the run's own output.
        if pinned not in _warned_stale_pins:
            _warned_stale_pins.add(pinned)
            print(
                f"[harness] pinned {_pod_env_key(container)}={pinned!r} is"
                " gone; falling back to the label selectors for the rest of"
                " the run",
                file=sys.stderr,
            )
    for label in (
        f"genieai.io/component={container}",
        f"app.kubernetes.io/component={container}",
    ):
        # `.items[*]`, never `.items[0]`: on an empty match the [0] form makes
        # kubectl exit 1 with "array index out of bounds" (live-verified), which
        # would abort the loop before the second selector is consulted; the [*]
        # form exits 0 with empty stdout, which is exactly the "no match" the
        # loop is designed to fall through on.
        stdout = _run_kubectl(
            [
                "kubectl", "get", "pods", "-n", ns,
                "-l", label,
                "--field-selector", "status.phase=Running",
                "-o", "jsonpath={.items[*].metadata.name}",
            ]
        ).strip()
        if stdout:
            return stdout.split()[0]
    raise HarnessError(
        f"no running pod found for container identity {container!r} in"
        f" namespace {ns!r} — the identity must be the deployment's"
        " COMPONENT name (the chart labels pods"
        " genieai.io/component=<name>), not a docker container name;"
        f" pin a pod directly with {_pod_env_key(container)}=<pod>"
    )


def kubectl_exec(
    pod: str,
    cmd: str,
    timeout: float = 120,
    pass_env: tuple = (),
) -> str:
    """Run ``cmd`` inside a pod via ``kubectl exec``; return stdout.

    ``pass_env`` forwards host-side env var NAMES to the pod. ``kubectl exec``
    has no ``-e`` flag, so the values travel through the exec's STDIN and the
    shell exports them — never on argv, where the token would be visible in
    ``ps``/procfs (the same contract ``docker exec -e`` gives). A value
    carrying a newline cannot survive the line-based transport, so it is
    refused loudly rather than silently truncated.
    """
    ns = _k8s_namespace()
    prelude = ""
    payload = ""
    if pass_env:
        for name in pass_env:
            value = os.environ.get(name, "")
            if "\n" in value or "\r" in value:
                raise HarnessError(
                    f"cannot forward {name!r} through the kubectl exec"
                    " stdin transport: its value contains a newline"
                )
        prelude = 'while IFS= read -r __e; do export "$__e"; done; '
        payload = "".join(f"{name}={os.environ.get(name, '')}\n" for name in pass_env)
    args = [
        "kubectl", "exec", "-i", "-n", ns, pod,
        "--", "sh", "-c", prelude + cmd,
    ]
    return _run_kubectl(
        args, timeout=timeout, input=payload, label=f"exec {pod}"
    )


def exec_in_container(
    container: str, cmd: str, timeout: float = 120, pass_env: tuple = ()
) -> str:
    """Run ``cmd`` inside the venue's container; return stdout.

    The venue decides how: ``EVAL_EXEC_BACKEND=docker`` (compose/swarm) or
    ``=kubectl`` (Kubernetes). An unknown backend is a :class:`HarnessError`
    — the toolchain never guesses a transport, because a wrong one produces
    per-row failures that look like data.
    """
    backend = exec_backend()
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
