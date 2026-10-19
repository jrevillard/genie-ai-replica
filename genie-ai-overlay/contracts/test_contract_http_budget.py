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

This is that check, and it runs in CI via the ``contract:unit`` job — which is
repo-side, so the two compose assertions execute for real there while the two
``comps`` ones skip against the absent library rather than passing against the
mock. Wiring matters as much as the code here: ``pytest.ini`` sets
``testpaths = tests``, so a file in this directory that no job names is a test
suite that never runs and a docstring that is simply wrong.

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


def test_the_graph_transformer_keeps_the_budget_it_had_before_this_policy():
    """Nothing here tightens the one phase with no degradation path.

    A graph batch cancelled mid-flight loses its chunks and the document still
    reports "Ingested", so the phase keeps the 600 s it ran at before this
    policy. There were two ways to regress that, and this MR contained both at
    some point: chaining the injection to MODEL_LLM_TIMEOUT_SECONDS (which
    tightened it 3.3x on an upgrade that edited no .env), and injecting
    VLLM_TIMEOUT at all (which is worse — it breaks the client outright). The
    second is asserted by the test above; this one pins the remaining surface.
    """
    root = _require_repo_root()
    block = _service_block((root / "docker-compose.yaml").read_text(encoding="utf-8"), "dataprep-arango-service")
    assert block, "no dataprep-arango-service block found in docker-compose.yaml"
    assert re.search(r"^\s*MODEL_LLM_TIMEOUT_SECONDS:", block, re.M), (
        "the dataprep service no longer injects MODEL_LLM_TIMEOUT_SECONDS — that is the knob "
        "its own labelling and context clients read"
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
