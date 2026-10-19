# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Contract test — the vendored dataprep budget this repo configures really exists.

``docker-compose.yaml`` injects ``VLLM_TIMEOUT`` into the dataprep service
precisely because the vendored ``comps`` graph transformer reads it: that is what
bounds the slowest phase of an ingest without an override patch. The claim is
repeated in four places (compose, ``OVERRIDES.yaml``, the debt record, the
CHANGELOG), and until now nothing could check it — ``tests/conftest.py`` stubs
``comps`` in ``sys.modules``, so the mocked suite is blind to it by
construction.

This is that check. It only runs in-image, where the real ``comps`` is importable
(see ``conftest.py``); in the dev venv it skips rather than passing against the
mock, which would prove nothing.

The three halves are asserted separately on purpose, because each one alone is
worthless:

* the vendored module reads ``VLLM_TIMEOUT`` into a client timeout — without
  this, the compose injection is a no-op;
* the overlay runs that same module in-process — without this, setting the var
  would reach a different process;
* compose actually injects it into the dataprep service — without this, both of
  the above are true and the budget still is not applied.
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
    return _overlay_root().parent


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
    """The load-bearing claim: comps binds ``VLLM_TIMEOUT`` to its LLM client.

    ``OpeaArangoDataprep``'s ``LLMGraphTransformer`` is the slowest stage of an
    ingest and the only vendored call this repository can bound with an env var
    instead of a patch. If an OPEA bump renames the variable or drops the
    binding, this fails instead of the compose injection silently becoming a
    no-op while four files still claim the phase is bounded.
    """
    module = importlib.import_module("comps.dataprep.integrations.arangodb")
    assert hasattr(module, "VLLM_TIMEOUT"), (
        "the vendored comps dataprep no longer defines VLLM_TIMEOUT — docker-compose.yaml "
        "injects it for exactly this reader, so the graph-transformer phase is unbounded again "
        "and every place documenting it as bounded is now wrong"
    )
    assert _vllm_timeout_is_a_client_timeout(module), (
        "VLLM_TIMEOUT exists in the vendored dataprep but is no longer passed to any client's "
        "timeout= — defining it is not the same as honouring it, and the CHANGELOG's "
        "'the vendored graph-transformation phase is now bounded too' depends on the binding"
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


def test_compose_injects_vllm_timeout_into_the_dataprep_service():
    """The injection itself, so the two halves above have something to bind to.

    Pure repo check — no comps needed, so it runs everywhere. Read as text
    because a compose parse would also succeed on the mapping/sequence style
    mismatch this deck has hit once already.
    """
    compose = (_repo_root() / "docker-compose.yaml").read_text(encoding="utf-8")
    dataprep_block = _service_block(compose, "dataprep-arango-service")
    assert dataprep_block, "no dataprep-arango-service block found in docker-compose.yaml"
    assert re.search(r"^\s*VLLM_TIMEOUT:", dataprep_block, re.M), (
        "the dataprep service no longer receives VLLM_TIMEOUT — the vendored graph transformer "
        "reads it from the environment, so dropping the injection unbounds the slowest ingest phase"
    )
    assert re.search(r"^\s*MODEL_LLM_TIMEOUT_SECONDS:", dataprep_block, re.M), (
        "the dataprep service no longer receives MODEL_LLM_TIMEOUT_SECONDS — its own labelling "
        "client would fall back to the VLLM_TIMEOUT meant for the vendored graph transformer"
    )


def test_the_graph_transformer_keeps_the_budget_it_had_before_this_policy():
    """The one default here that must NOT tighten, and why.

    ``VLLM_TIMEOUT`` is read by a phase with no degradation path: a graph batch
    cancelled mid-flight loses its chunks outright and the document still
    reports "Ingested". Chaining it to MODEL_LLM_TIMEOUT_SECONDS — which is what
    this service block used to do, 180 s — converts a slow-but-successful graph
    extraction into silent data loss on an upgrade that edited no ``.env``.

    So the two names are deliberately independent here: ours tightens because
    every call behind it degrades, comps' does not because none of them do.
    """
    compose = (_repo_root() / "docker-compose.yaml").read_text(encoding="utf-8")
    block = _service_block(compose, "dataprep-arango-service")
    match = re.search(r"^\s*VLLM_TIMEOUT:\s*(\S+)", block, re.M)
    assert match, "no VLLM_TIMEOUT assignment in the dataprep service block"
    default = match.group(1)
    assert default == "${VLLM_TIMEOUT:-600}", (
        f"the dataprep service now injects VLLM_TIMEOUT={default}. The graph-insertion phase "
        "has no fallback, so anything below the 600 s it ran at before this policy silently "
        "drops chunks from the knowledge graph on upgrade"
    )
    assert "MODEL_LLM_TIMEOUT_SECONDS" not in default, (
        "VLLM_TIMEOUT is chained to MODEL_LLM_TIMEOUT_SECONDS again — that couples the "
        "no-fallback graph phase to the fallback-capable labelling phase, so raising the "
        "labelling budget for a slow model would also multiply the graph phase's wait"
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
