# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for prove_kwargs_forwarding.py (schedule() kwargs-forwarding spike).

Pure-function tests + idempotency with the clone/orchestrator mocked — no live
network in CI. The real network run is the T3 spike execution.
"""

import prove_kwargs_forwarding as p


def _all_received():
    sent = dict(p.SPIKE_KWARGS)
    return {
        "align_inputs": dict(sent),
        "align_outputs": dict(sent),
        "execute": dict(sent),
    }


def _partial_received(dropped):
    full = dict(p.SPIKE_KWARGS)
    for d in dropped:
        full.pop(d)
    return {
        "align_inputs": dict(full),
        "align_outputs": dict(full),
        "execute": dict(full),
    }


# --- outcome_table ----------------------------------------------------------


def test_outcome_table_all_forwarded():
    t = p.outcome_table(_all_received())
    assert t["all_forwarded"] is True
    assert len(t["rows"]) == len(p.GENIE_KWARGS)
    for kwarg, hooks in t["rows"].items():
        assert all(hooks.values()), f"{kwarg} should be forwarded to all hooks"


def test_outcome_table_flags_each_dropped_kwarg():
    t = p.outcome_table(_partial_received(["user_details"]))
    assert t["all_forwarded"] is False
    assert t["rows"]["user_details"]["align_inputs"] is False
    assert t["rows"]["user_details"]["execute"] is False
    # the others still forwarded
    assert t["rows"]["original_language"]["align_inputs"] is True


def test_outcome_table_all_6_covered():
    t = p.outcome_table(_all_received())
    assert set(t["rows"].keys()) == set(p.GENIE_KWARGS)


def test_outcome_table_hook_absent_means_not_forwarded():
    # A hook that never ran (no entry) must NOT count as forwarding.
    t = p.outcome_table({"align_inputs": dict(p.SPIKE_KWARGS)})
    assert t["all_forwarded"] is False  # execute + align_outputs hooks absent
    for kwarg in p.GENIE_KWARGS:
        assert t["rows"][kwarg]["execute"] is False
        assert t["rows"][kwarg]["align_outputs"] is False


def test_outcome_table_value_mutation_not_forwarded():
    # Presence is NOT enough — a corrupted value must FAIL ("exact values").
    received = {
        "align_inputs": {**p.SPIKE_KWARGS, "original_language": "CHANGED"},
        "align_outputs": dict(p.SPIKE_KWARGS),
        "execute": dict(p.SPIKE_KWARGS),
    }
    t = p.outcome_table(received)
    assert t["all_forwarded"] is False
    assert t["rows"]["original_language"]["align_inputs"] is False
    # the value-identical ones still pass
    assert t["rows"]["user_details"]["align_inputs"] is True


def test_outcome_table_single_hook_drop_flags_that_hook():
    # A kwarg dropped from only ONE hop must fail that hop, not silently pass.
    received = {
        "align_inputs": dict(p.SPIKE_KWARGS),
        "align_outputs": dict(p.SPIKE_KWARGS),
        "execute": {k: v for k, v in p.SPIKE_KWARGS.items() if k != "user_details"},
    }
    t = p.outcome_table(received)
    assert t["all_forwarded"] is False
    assert t["rows"]["user_details"]["execute"] is False
    assert t["rows"]["user_details"]["align_inputs"] is True


def test_outcome_table_unknown_hook_raises():
    # A captured hook outside EXPECTED_HOOKS must never be silently dropped.
    import pytest

    with pytest.raises(ValueError):
        p.outcome_table({"align_inputs": dict(p.SPIKE_KWARGS), "mystery_hook": {}})


# --- summarize --------------------------------------------------------------


def test_summarize_forwards():
    s = p.summarize(_all_received())
    assert s["outcome"] == "FORWARDS"
    assert s["kwargs_forwarded_to_all_hooks"] == len(p.GENIE_KWARGS)
    assert s["kwargs_count"] == len(p.GENIE_KWARGS)


def test_summarize_drops():
    s = p.summarize(_partial_received(["retrieval_context"]))
    assert s["outcome"] == "DROPS"
    assert s["kwargs_forwarded_to_all_hooks"] == len(p.GENIE_KWARGS) - 1


# --- idempotency (clone + orchestrator mocked) ------------------------------


def _fake_orchestrator_mod(dropped=()):
    """A stand-in module exposing just what run_spike uses.

    Mirrors the real v1.5 execute() forwarding: align_inputs on the input path,
    then align_outputs on the non-streaming completion path (orchestrator.py:255
    and :384). ``dropped`` simulates a forwarding regression at those hops so the
    harness's fail-loudly path is tested end-to-end.
    """
    import types

    class LLMParams:
        stream = False

        def dict(self):
            return {}

    class ServiceType:
        LLM = "LLM"

    class DAG:
        def __init__(self):
            self.services = {}

        def add(self, service):
            if service.name not in self.services:
                self.services[service.name] = service
                self.add_node_if_not_exists(service.name)
            return self

        def add_node_if_not_exists(self, name):
            pass

        def ind_nodes(self):
            return list(self.services.keys())

    class ServiceOrchestrator(DAG):
        async def schedule(self, initial_inputs, llm_parameters=None, **kwargs):
            # Real schedule() forwards kwargs into execute() verbatim.
            for node in self.ind_nodes():
                await self.execute(
                    None,
                    0.0,
                    node,
                    dict(initial_inputs),
                    None,
                    llm_parameters,
                    **kwargs,
                )

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
            fwd = dict(kwargs)
            for d in dropped:
                fwd.pop(d, None)
            inputs = self.align_inputs(
                inputs, cur_node, runtime_graph, llm_parameters.dict(), **fwd
            )
            data = self.align_outputs(
                {}, cur_node, inputs, runtime_graph, llm_parameters.dict(), **fwd
            )
            return data, cur_node

        def align_inputs(self, inputs, *args, **kwargs):
            return inputs

        def align_outputs(self, data, *args, **kwargs):
            return data

        def align_generator(self, gen, *args, **kwargs):
            return gen

    mod = types.SimpleNamespace(
        ServiceOrchestrator=ServiceOrchestrator,
        ServiceType=ServiceType,
        LLMParams=LLMParams,
    )
    return mod


def test_run_spike_idempotent_same_input_same_outcome():
    import asyncio

    mod = _fake_orchestrator_mod()
    first = asyncio.run(p.run_spike(mod))
    second = asyncio.run(p.run_spike(mod))
    # Same kwargs in, same received kwargs out — deterministic.
    assert first == second
    received = first["align_inputs"]
    for kwarg in p.GENIE_KWARGS:
        assert kwarg in received, f"{kwarg} not forwarded by fake orchestrator"


def test_run_spike_all_6_kwargs_reach_handler():
    import asyncio

    mod = _fake_orchestrator_mod()
    kwargs_by_hook = asyncio.run(p.run_spike(mod))
    # The fake aligns mirror the real forwarding: kwargs land on align_inputs
    # (input path), align_outputs (non-streaming completion) and execute.
    assert set(kwargs_by_hook["align_inputs"].keys()) == set(p.GENIE_KWARGS)
    assert set(kwargs_by_hook["align_outputs"].keys()) == set(p.GENIE_KWARGS)
    assert set(kwargs_by_hook.get("execute", {}).keys()) == set(p.GENIE_KWARGS)
    # Exact values arrive, not just keys.
    for hook in ("align_inputs", "align_outputs", "execute"):
        assert kwargs_by_hook[hook] == p.SPIKE_KWARGS


def test_run_spike_dropped_kwarg_detected_end_to_end():
    # A regression that drops one kwarg at the execute→handler hop must yield
    # DROPS through the full harness path (run_spike → summarize), not a pass.
    import asyncio

    mod = _fake_orchestrator_mod(dropped=("user_details",))
    kwargs_by_hook = asyncio.run(p.run_spike(mod))
    assert "user_details" not in kwargs_by_hook["align_inputs"]
    # execute still received it — the drop is at the handler hop.
    assert "user_details" in kwargs_by_hook["execute"]
    s = p.summarize(kwargs_by_hook)
    assert s["outcome"] == "DROPS"
    assert s["kwargs_forwarded_to_all_hooks"] == len(p.GENIE_KWARGS) - 1


def test_clone_tag_missing_raises(tmp_path, monkeypatch):
    """A failed clone must raise, never silently record a 'drop'."""

    class _Failed:
        returncode = 128
        stdout = ""
        stderr = "fatal: Remote branch v1.5 not found"

    def fake_run(cmd, capture_output=True, text=True, timeout=180):
        return _Failed()

    monkeypatch.setattr(p.subprocess, "run", fake_run)
    try:
        p.clone_tag(tmp_path / "x", "v1.5")
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "failed" in str(exc) and "v1.5" in str(exc)
