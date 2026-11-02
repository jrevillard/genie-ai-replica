# Contract test: every key the parameter sweep posts must be a declared
# ChatCompletionRequest field whose value survives validation. Guards the
# silent-drop class (upstream's sweep posted `reranker_top_n`, which pydantic
# quietly ignored — a whole swept dimension varying nothing, every check still
# green). Runs offline; rides the canary suite. Review finding N.3/E12.
import importlib.util
from pathlib import Path

import pytest

from core.genieai_api_protocol import ChatCompletionRequest, RequestContext

_SWEEP_PATH = Path(__file__).resolve().parents[2] / "tests" / "run_rag_config_test_async.py"


def _load_sweep():
    # sweep module imports aiohttp/pandas (not overlay runtime deps)
    pytest.importorskip("aiohttp")
    pytest.importorskip("pandas")
    spec = importlib.util.spec_from_file_location("run_rag_config_test_async", _SWEEP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_swept_key_is_a_chatqna_request_field():
    sweep = _load_sweep()
    allowed = set(ChatCompletionRequest.model_fields)
    configs = sweep.generate_configurations() + [sweep.DEFAULT_CONFIGS] + sweep.TARGET_TEST_CONFIGS
    assert configs, "sweep produced no configurations"
    for i, cfg in enumerate(configs):
        unknown = set(cfg) - allowed
        assert not unknown, f"sweep config {i} posts keys the request model drops: {unknown}"


def test_representative_sweep_payload_validates_and_keeps_values():
    sweep = _load_sweep()
    cfg = sweep.TARGET_TEST_CONFIGS[0]
    req = ChatCompletionRequest(
        messages=[{"role": "user", "content": "ping"}],
        context=RequestContext(serviceLabels=[]),
        **cfg,
    )
    # values survive validation (not dropped, not mangled)
    assert req.k == cfg["k"]
    assert req.top_n == cfg["top_n"]
    assert req.reranking_strategy == cfg["reranking_strategy"]
    assert req.enable_traversal == cfg["enable_traversal"]
