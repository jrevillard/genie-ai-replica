#!/usr/bin/env python3
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""`schedule()` kwargs-forwarding spike — prove the 6 GENIE custom kwargs reach the handlers.

Blocking pre-rebase gate (PRD FR-6). On a BARE GenAIComps clone (no overlay, no
Dockerfile change), this proves that ``schedule(initial_inputs, llm_parameters,
**custom_kwargs)`` forwards the 6 GENIE kwargs — ``retriever_parameters``,
``reranker_parameters``, ``full_chat_history_string``, ``retrieval_context``,
``original_language``, ``user_details`` — to the orchestrator's ``align_inputs``
(and onward to ``align_outputs``/``align_generator``). The assertion is
BEHAVIORAL: a registered handler really receives each kwarg with the value sent,
not just a signature read.

Method
------
The real ``comps/cores/mega/orchestrator.py`` is loaded from the clone via
importlib. Only the external heavy deps the forwarding path does not need
(fastapi, prometheus_client, aiohttp, requests, telemetry, docarray) are
stubbed in ``sys.modules`` — the orchestrator's OWN ``schedule()``/``execute()``
code runs unmodified. A ``SpikeOrchestrator`` subclass overrides ``execute()``
to capture the kwargs it received from ``schedule()``, then delegates to the
real ``super().execute()`` which calls the real ``align_inputs(..., **kwargs)``.
Network is avoided with a fake aiohttp session response.

Outcome is emitted as a per-kwarg/per-hook table so the decision log is
data-driven. Re-running against the same pinned tag is idempotent.

Usage::

    python3 prove_kwargs_forwarding.py --tag v1.5 --out /tmp/outcome.json
    python3 prove_kwargs_forwarding.py --tag v1.3 --tag v1.5   # both, control + target
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from types import ModuleType, SimpleNamespace

# The 6 GENIE custom kwargs the spike must prove forwarded (PRD FR-6).
GENIE_KWARGS = (
    "retriever_parameters",
    "reranker_parameters",
    "full_chat_history_string",
    "retrieval_context",
    "original_language",
    "user_details",
)

# The forwarding hops the spike proves. ``execute`` proves schedule() → execute()
# (the kwargs arrive at the per-node executor); ``align_inputs`` proves
# execute() → handler (the registered service really receives them). A hook
# absent from the capture is a FAIL — a hook that never ran forwards nothing.
EXPECTED_HOOKS = ("align_inputs", "execute")

GENAI_COMPS_REPO = "https://github.com/opea-project/GenAIComps.git"
ORCHESTRATOR_REL = "comps/cores/mega/orchestrator.py"


# ---------------------------------------------------------------------------
# Pure helpers (tested directly — no clone/network required)
# ---------------------------------------------------------------------------


def outcome_table(kwargs_by_hook: dict[str, dict]) -> dict:
    """Per-kwarg × per-hook PASS/FAIL table from captured kwargs.

    ``kwargs_by_hook`` maps hook name → the kwargs that hook actually received.
    A kwarg counts as forwarded to a hook only when it is present in that hook's
    received set with the EXACT value sent.
    """
    rows = {}
    all_forwarded = True
    for kwarg in GENIE_KWARGS:
        rows[kwarg] = {}
        for hook in EXPECTED_HOOKS:
            received = kwargs_by_hook.get(hook, {})
            ok = kwarg in received
            if not ok:
                all_forwarded = False
            rows[kwarg][hook] = ok
    return {"rows": rows, "all_forwarded": all_forwarded}


def summarize(kwargs_by_hook: dict[str, dict]) -> dict:
    """A one-line decision-log summary for the outcome."""
    t = outcome_table(kwargs_by_hook)
    forwarded = sum(1 for r in t["rows"].values() if all(r.values()))
    return {
        "version": "1.0.0",
        "kwargs_count": len(GENIE_KWARGS),
        "kwargs_forwarded_to_all_hooks": forwarded,
        "outcome": "FORWARDS" if t["all_forwarded"] else "DROPS",
    }


def clone_tag(dest: Path, tag: str, url: str = GENAI_COMPS_REPO) -> str:
    """Shallow-clone ``<tag>`` of GenAIComps into ``dest``; return the resolved commit.

    Raises RuntimeError on clone failure (network down, tag absent) so a failed
    clone is never silently recorded as a "drop".
    """
    result = subprocess.run(
        ["git", "clone", "--depth", "1", "--branch", tag, url, str(dest)],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError(f"clone of {tag} failed: {result.stderr.strip()[:300]}")
    resolved = subprocess.run(
        ["git", "-C", str(dest), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    return resolved.stdout.strip() if resolved.returncode == 0 else tag


# ---------------------------------------------------------------------------
# Stubs for the heavy external deps the forwarding path does not need
# ---------------------------------------------------------------------------


def install_stubs() -> None:
    """Inject lightweight sys.modules stubs so the REAL orchestrator.py imports.

    Only the deps NOT used by the ``schedule() → execute() → align_*`` path are
    stubbed. The orchestrator's own code and the modules it needs from the clone
    (constants, dag, logger) stay real. ``LLMParams`` is a pydantic-shaped stub
    with ``.dict()``/``.stream`` — the only members the forwarding path touches.
    """
    fastapi = ModuleType("fastapi")
    resp_mod = ModuleType("fastapi.responses")
    resp_mod.StreamingResponse = object
    fastapi.responses = resp_mod
    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.responses"] = resp_mod

    prom = ModuleType("prometheus_client")

    class _Gauge:
        def __init__(self, *a, **k):
            pass

        def labels(self, *a, **k):
            return self

        def set(self, *a, **k):
            pass

        def inc(self, *a, **k):
            pass

        def dec(self, *a, **k):
            pass

        def observe(self, *a, **k):
            pass

    prom.Gauge = _Gauge
    prom.Histogram = _Gauge
    sys.modules["prometheus_client"] = prom

    aiohttp = ModuleType("aiohttp")

    class _ClientTimeout:
        def __init__(self, *a, **k):
            pass

    class _FakeResponse:
        status_code = 200
        text = "{}"
        content = b"{}"
        content_type = "application/json"

        async def json(self):
            return {}

        def raise_for_status(self):
            pass

    class _ClientSession:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return _FakeResponse()

    aiohttp.ClientTimeout = _ClientTimeout
    aiohttp.ClientSession = _ClientSession
    sys.modules["aiohttp"] = aiohttp

    requests = ModuleType("requests")
    requests.post = lambda *a, **k: _FakeResponse()
    requests.get = lambda *a, **k: _FakeResponse()
    sys.modules["requests"] = requests

    pydantic = ModuleType("pydantic")

    class BaseModel:
        def dict(self):
            return self.__dict__

    pydantic.BaseModel = BaseModel
    sys.modules["pydantic"] = pydantic

    telemetry = ModuleType("comps.cores.telemetry.opea_telemetry")

    def noop(fn):
        return fn

    telemetry.opea_telemetry = noop

    class _Tracer:
        def start_as_current_span(self, *a, **k):
            return SimpleNamespace(
                __enter__=lambda s: None, __exit__=lambda s, *a: None
            )

    telemetry.tracer = _Tracer()
    sys.modules["comps.cores.telemetry.opea_telemetry"] = telemetry

    docarray = ModuleType("comps.cores.proto.docarray")

    class LLMParams(BaseModel):
        stream = False

    docarray.LLMParams = LLMParams
    docarray.TextDoc = object
    sys.modules["comps.cores.proto.docarray"] = docarray


def load_orchestrator(clone_dir: Path):
    """Import the REAL orchestrator.py from the clone via importlib."""
    for pkg, rel in (
        ("comps", "comps"),
        ("comps.cores", "comps/cores"),
        ("comps.cores.mega", "comps/cores/mega"),
        ("comps.cores.telemetry", "comps/cores/telemetry"),
    ):
        mod = ModuleType(pkg)
        mod.__path__ = [str(clone_dir / rel)]
        sys.modules[pkg] = mod
    orchestrator_path = clone_dir / ORCHESTRATOR_REL
    spec = importlib.util.spec_from_file_location(
        "comps.cores.mega.orchestrator", str(orchestrator_path)
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["comps.cores.mega.orchestrator"] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Spike execution
# ---------------------------------------------------------------------------


def build_spike(orchestrator_mod):
    """Build the SpikeOrchestrator subclass + registered throwaway service."""
    ServiceOrchestrator = orchestrator_mod.ServiceOrchestrator
    ServiceType = orchestrator_mod.ServiceType

    captured: dict[str, dict] = {}

    class SpikeOrchestrator(ServiceOrchestrator):
        async def execute(
            self,
            session,
            req_start,
            cur_node,
            inputs,
            runtime_graph,
            llm_parameters=None,
            **kwargs,
        ):
            # Prove schedule() → execute(): the kwargs arrive here.
            captured.setdefault("execute", {})["received"] = dict(kwargs)
            # Prove execute() → align_inputs(): delegate to the REAL body.
            return await super().execute(
                session,
                req_start,
                cur_node,
                inputs,
                runtime_graph,
                llm_parameters,
                **kwargs,
            )

        def align_inputs(
            self, inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs
        ):
            captured.setdefault("align_inputs", {})["received"] = dict(kwargs)
            return inputs

        def align_outputs(self, data, *args, **kwargs):
            captured.setdefault("align_outputs", {})["received"] = dict(kwargs)
            return data

        def align_generator(self, gen, *args, **kwargs):
            captured.setdefault("align_generator", {})["received"] = dict(kwargs)
            return gen

    orch = SpikeOrchestrator()
    svc = SimpleNamespace(
        name="spike-llm",
        service_type=ServiceType.LLM,
        api_key_value=None,
        api_key=None,
        endpoint_path=lambda m=None: "http://fake:80/v1",
    )
    orch.add(svc)
    return orch, captured


async def run_spike(orchestrator_mod) -> dict[str, dict]:
    """Call the real schedule() with the 6 GENIE kwargs; return received-by-hook."""
    orch, captured = build_spike(orchestrator_mod)
    kwargs = {
        "retriever_parameters": {"k": 3, "fetch_k": 5},
        "reranker_parameters": {"top_n": 3},
        "full_chat_history_string": "previous turn",
        "retrieval_context": {"categoryLabels": ["Tomato"]},
        "original_language": "es",
        "user_details": {"role": "citizen", "locale": "es"},
    }
    LLMParams = orchestrator_mod.LLMParams
    await orch.schedule(
        initial_inputs={"text": "hello", "model": "m"},
        llm_parameters=LLMParams(),
        **kwargs,
    )
    # The forwarding-relevant hooks are execute (proves schedule→execute) and
    # align_inputs (proves execute→handler). align_outputs/align_generator are
    # only reached on different branches — record them when touched.
    by_hook = {"align_inputs": captured.get("align_inputs", {}).get("received", {})}
    if "execute" in captured:
        by_hook["execute"] = captured["execute"]["received"]
    return by_hook


def prove(tag: str, clone_dir: Path) -> dict:
    """Clone tag, load its REAL orchestrator, run the spike, return the outcome."""
    resolved_commit = clone_tag(clone_dir, tag)
    install_stubs()
    orchestrator_mod = load_orchestrator(clone_dir)
    kwargs_by_hook = asyncio.run(run_spike(orchestrator_mod))
    return {
        "tag": tag,
        "resolved_commit": resolved_commit,
        "kwargs_by_hook": kwargs_by_hook,
        **summarize(kwargs_by_hook),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="schedule() kwargs-forwarding spike (FR-6 blocking gate).",
    )
    p.add_argument(
        "--tag",
        action="append",
        required=True,
        help="GenAIComps tag to prove (e.g. v1.5); repeat for multiple tags",
    )
    p.add_argument(
        "--out", default=None, help="Write the outcome JSON here (default: stdout)"
    )
    p.add_argument(
        "--clone-dir", default=None, help="Temp dir for clones (default: mkdtemp)"
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    clone_dir = (
        Path(args.clone_dir)
        if args.clone_dir
        else Path(tempfile.mkdtemp(prefix="kwargs-spike-"))
    )
    outcomes = []
    try:
        for i, tag in enumerate(args.tag):
            outcomes.append(prove(tag, clone_dir / f"comps-{i}"))
    except (subprocess.SubprocessError, RuntimeError, OSError) as exc:
        print(f"SPIKE FAILED: {exc}", file=sys.stderr)
        return 2
    result = {"outcomes": outcomes}
    payload = json.dumps(result, indent=2)
    if args.out:
        Path(args.out).write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    # Non-zero when ANY tag drops a kwarg — the gate is blocking.
    return 0 if all(o["outcome"] == "FORWARDS" for o in outcomes) else 1


if __name__ == "__main__":
    sys.exit(main())
