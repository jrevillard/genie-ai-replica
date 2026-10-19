# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Contract test — the vendored graph transformer's budget is NOT ours to set.

The dataprep service runs the vendored comps graph transformer in-process, and
that transformer reads ``VLLM_TIMEOUT``. Injecting it looked like a free win —
bound the slowest phase of an ingest with no override patch — and it is not.

comps takes the value verbatim from ``os.getenv``, so an injected value arrives
as a string. httpx 0.28 does not coerce a string timeout:

    httpx.Timeout("5").connect                          -> "5"
    httpx.Client(timeout=httpx.Timeout("5")).get(...)   -> TypeError
    socket.create_connection(("host", 1), "600")        -> TypeError

``_process_batch`` swallows that. Every batch would fail graph extraction and
the document would still report "Ingested" with an empty knowledge graph —
silently, on every deployment including the default one. So ``docker-compose``
deliberately does not inject the key, and the phase keeps comps' own ``int``
600 s default, which is also the right value: it is the one phase here with no
degradation path.

This file pins that decision from both sides. In ``contract:unit`` (repo-side)
the compose assertions run for real and re-adding the key fails. The ``comps``
assertion skips there — no vendored library outside the image — and runs in the
in-image contract jobs, where it checks that the reader still exists so the debt
record's "closing this needs a patch" stays an accurate description rather than a
guess.

It runs in CI via ``contract:unit``; wiring matters as much as the code here,
because ``pytest.ini`` sets ``testpaths = tests`` and a file in this directory
that no job names is a suite that never runs.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import re
from pathlib import Path


def _overlay_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _repo_root() -> Path:
    """The repo root, or None when this suite is mounted without one.

    The in-image contract jobs copy ``contracts/`` to ``/contracts``, so
    ``parents[1]`` is ``/`` there and the compose file does not exist. The
    assertions that need it skip rather than failing, so the same file is safe
    in either venue instead of only in the one it was written for.
    """
    root = _overlay_root().parent
    return root if (root / "docker-compose.yaml").is_file() else None


def _require_repo_root():
    root = _repo_root()
    if root is None:
        import pytest

        pytest.skip("repo tree not mounted — the compose assertions run repo-side in contract:unit")
    return root


def _vllm_timeout_is_a_client_timeout(module) -> bool:
    """True if ``VLLM_TIMEOUT`` reaches a client ``timeout=`` in *module*.

    Parsed rather than substring-matched so a mention in a docstring or a
    comment cannot satisfy it — that mistake would read as "the budget applies"
    when the variable is read and then dropped.
    """
    source = inspect.getsource(module)
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        for kw in node.keywords:
            if kw.arg != "timeout":
                continue
            names = {n.id for n in ast.walk(kw.value) if isinstance(n, ast.Name)}
            names |= {n.attr for n in ast.walk(kw.value) if isinstance(n, ast.Attribute)}
            if "VLLM_TIMEOUT" in names:
                return True
    return False


def test_the_vendored_graph_transformer_reads_vllm_timeout(comps):
    """The reader still exists, so the debt record's "needs a patch" is accurate.

    Not a claim that the phase CAN be bounded by env var — it cannot, because
    comps takes the value verbatim from ``os.getenv`` and httpx 0.28 rejects a
    string timeout (the module docstring, and
    ``test_compose_does_not_inject_vllm_timeout_into_the_dataprep_service``).
    What this pins is the other half of that statement: that the variable and
    its binding survive in the vendored source, so "closing this needs a patch
    to comps" describes a real change rather than a variable an OPEA bump has
    since renamed away — which would make OVERRIDES.yaml's prescription stale.
    """
    module = importlib.import_module("comps.dataprep.integrations.arangodb")
    assert hasattr(module, "VLLM_TIMEOUT"), (
        "the vendored comps dataprep no longer defines VLLM_TIMEOUT — OVERRIDES.yaml records "
        "that closing this entry requires a patch to the vendored source, and such a patch "
        "would have nothing to bind if the variable is gone"
    )
    assert _vllm_timeout_is_a_client_timeout(module), (
        "VLLM_TIMEOUT exists in the vendored dataprep but is no longer passed to any client's "
        "timeout= — defining it is not the same as honouring it, and the binding is what makes "
        "OVERRIDES.yaml's 'patch comps to coerce the env string' a route rather than a guess"
    )


def test_the_overlay_runs_that_module_in_process():
    """The var has to reach the process that builds the transformer.

    Without this, both halves below could hold and the budget would still not
    apply: a service that shells out, or points at a remote dataprep, would read
    its own environment rather than the one compose configured.
    """
    source = (_overlay_root() / "dataprep" / "genieai_dataprep_arangodb.py").read_text(encoding="utf-8")
    assert re.search(r"from\s+comps\.dataprep[.\w]*\s+import|import\s+comps\.dataprep", source), (
        "the overlay no longer imports comps.dataprep directly — if the graph transformer moved "
        "to a remote service, VLLM_TIMEOUT injected into this container no longer bounds it"
    )


def test_compose_does_not_inject_vllm_timeout_into_the_dataprep_service():
    """The regression this guards, stated as an absence.

    The vendored comps reads VLLM_TIMEOUT with a bare ``os.getenv``, so an
    injected value arrives as the STRING "600". httpx 0.28 stopped coercing a
    string timeout and ``socket.create_connection`` rejects it outright, so the
    request dies with ``TypeError: 'str' object cannot be interpreted as an
    integer`` instead of timing out. ``_process_batch`` swallows that: every
    batch would fail graph extraction and the document would still report
    "Ingested" with an empty knowledge graph — silently, on every deployment
    including the default one.

    So the dataprep block must not carry the key. The graph phase keeps comps'
    own int 600 s default, which is also the right value for the one phase here
    with no degradation path. Changing it needs a patch to the vendored source
    (OVERRIDES.yaml), not a compose line.
    """
    root = _require_repo_root()
    block = _service_block((root / "docker-compose.yaml").read_text(encoding="utf-8"), "dataprep-arango-service")
    assert block, "no dataprep-arango-service block found in docker-compose.yaml"
    assert not re.search(r"^\s*VLLM_TIMEOUT:", block, re.M), (
        "the dataprep service injects VLLM_TIMEOUT. The vendored comps reads it with a bare "
        "os.getenv, so it reaches httpx as a string; httpx 0.28 does not coerce it and the "
        "client raises TypeError instead of timing out. _process_batch swallows that, so graph "
        "extraction fails silently and the document still reports Ingested"
    )


def test_the_dataprep_block_still_exposes_its_own_budget_knob():
    """The operator's knob must reach the container the overlay actually runs in.

    ``MODEL_LLM_TIMEOUT_SECONDS`` is what the dataprep service's own labelling
    and context clients read (``core/model_http_policy.py``). Drop the compose
    line and nothing raises — the policy falls back to its 180 s default — but
    every ``.env`` an operator edits becomes inert for this one service, with
    no error anywhere. That is the same class of silent no-op as injecting the
    key in the first place, so it is worth its own assertion.

    Deliberately NOT asserted here: that the graph transformer keeps comps' own
    600 s. Nothing this MR writes can move it — there is no shared key left to
    chain, which is the point of the withdrawal asserted above.
    """
    root = _require_repo_root()
    block = _service_block((root / "docker-compose.yaml").read_text(encoding="utf-8"), "dataprep-arango-service")
    assert block, "no dataprep-arango-service block found in docker-compose.yaml"
    assert re.search(r"^\s*MODEL_LLM_TIMEOUT_SECONDS:", block, re.M), (
        "the dataprep service no longer injects MODEL_LLM_TIMEOUT_SECONDS — the policy then "
        "falls back to its built-in 180 s default and MODEL_LLM_TIMEOUT_SECONDS in the operator's "
        ".env becomes inert for this service, silently"
    )


def _service_block(compose: str, service: str) -> str:
    """The *effective* text of the ``service:`` block, comments stripped.

    Comments are removed because this block argues at length about which
    variable is deliberately NOT injected, and a check that reads raw text
    finds the name it mentions in its own explanation of why it is absent.
    """
    lines = compose.split("\n")
    start = None
    for i, line in enumerate(lines):
        if re.match(rf"^  {re.escape(service)}:\s*$", line):
            start = i + 1
            break
    if start is None:
        return ""
    out = []
    for line in lines[start:]:
        if line.strip() and not line.startswith("   "):
            break
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        out.append(line.split(" #", 1)[0].rstrip())
    return "\n".join(out)
