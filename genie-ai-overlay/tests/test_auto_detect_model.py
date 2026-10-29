# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
#
# Tests for vLLM model auto-detection (TTL-cached) across OPEA services.
#
# Probe logic lives in core/model_cache.py. Each service (chatqna, retriever,
# dataprep) calls get_model_id() to resolve the model served by a vLLM node —
# remote GPU endpoint when configured, compose-internal vLLM otherwise, always
# on. chatqna additionally discovers the served context window
# (get_max_model_len) the same way.

import logging
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from core import model_cache
from core.model_cache import clear_cache, get_max_model_len, get_model_id


# ---------------------------------------------------------------------------
# Shared fixture — clear TTL cache before every test
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _clean_cache():
    clear_cache()
    yield
    clear_cache()


# ---------------------------------------------------------------------------
# _probe — low-level /v1/models probe
# ---------------------------------------------------------------------------
class TestModelCacheProbe:
    """Tests for core.model_cache._probe function."""

    def test_returns_model_id_on_success_with_ssl_skip(self, monkeypatch):
        """When OPEA_SSL_SKIP_VERIFY=1, probe uses verify=False (self-signed certs)."""
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("OPEA_SSL_SKIP_VERIFY", "1")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "ibm-granite/granite-3.3-2b-instruct"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            result = model_cache._probe("https://gpu-host/llm")

        assert result["id"] == "ibm-granite/granite-3.3-2b-instruct"
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        assert call_kwargs.kwargs["verify"] is False
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer test-key"

    def test_returns_model_id_on_success_with_ca_certs(self, monkeypatch):
        """Without OPEA_SSL_SKIP_VERIFY, probe uses verify=True (CA-signed certs)."""
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.delenv("OPEA_SSL_SKIP_VERIFY", raising=False)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "ibm-granite/granite-3.3-2b-instruct"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            result = model_cache._probe("https://gpu-host/llm")

        assert result["id"] == "ibm-granite/granite-3.3-2b-instruct"
        assert mock_get.call_args.kwargs["verify"] is True

    def test_returns_none_when_no_models_in_response(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": []}

        with patch("httpx.get", return_value=mock_resp):
            result = model_cache._probe("https://gpu-host/llm")

        assert result is None

    def test_returns_none_on_http_error(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError("503", request=MagicMock(), response=mock_resp)

        with patch("httpx.get", return_value=mock_resp):
            result = model_cache._probe("https://gpu-host/llm")

        assert result is None

    def test_returns_none_on_connection_error(self):
        with patch("httpx.get", side_effect=httpx.ConnectError("Connection refused")):
            result = model_cache._probe("https://gpu-host/llm")

        assert result is None

    def test_returns_none_on_timeout(self):
        with patch("httpx.get", side_effect=httpx.TimeoutException("Timeout")):
            result = model_cache._probe("https://gpu-host/llm")

        assert result is None

    def test_sends_vllm_api_key_as_bearer(self, monkeypatch):
        monkeypatch.setenv("VLLM_API_KEY", "test-api-key-123")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            model_cache._probe("https://gpu-host/llm")

        headers = mock_get.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer test-api-key-123"

    def test_no_header_when_vllm_api_key_unset(self, monkeypatch):
        monkeypatch.delenv("VLLM_API_KEY", raising=False)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            model_cache._probe("https://gpu-host/llm")

        headers = mock_get.call_args.kwargs["headers"]
        assert headers == {}

    def test_timeout_is_10_seconds(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            model_cache._probe("https://gpu-host/llm")

        assert mock_get.call_args.kwargs["timeout"] == 10

    def test_returns_first_model_from_list(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "data": [
                {"id": "model-first"},
                {"id": "model-second"},
            ]
        }

        with patch("httpx.get", return_value=mock_resp):
            result = model_cache._probe("https://gpu-host/llm")

        assert result["id"] == "model-first"


# ---------------------------------------------------------------------------
# get_model_id — TTL cache behaviour
# ---------------------------------------------------------------------------
class TestModelCacheTtl:
    """Tests for core.model_cache.get_model_id TTL caching."""

    def test_cache_hit_skips_probe(self):
        """Within TTL, a second call does not re-probe."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            first = get_model_id("https://gpu-host/llm", ttl_seconds=60)
            second = get_model_id("https://gpu-host/llm", ttl_seconds=60)

        assert first == "model-a"
        assert second == "model-a"
        assert mock_get.call_count == 1  # probed once, cached the second time

    def test_cache_expiry_reprobes(self):
        """When TTL is 0, every call re-probes."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            get_model_id("https://gpu-host/llm", ttl_seconds=0)
            get_model_id("https://gpu-host/llm", ttl_seconds=0)

        assert mock_get.call_count == 2

    def test_probe_failure_returns_stale_cached_value(self):
        """After a successful probe, a failed re-probe returns the stale value."""
        ok_resp = MagicMock()
        ok_resp.json.return_value = {"data": [{"id": "stale-model"}]}

        with patch("httpx.get", return_value=ok_resp):
            first = get_model_id("https://gpu-host/llm", ttl_seconds=0)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            second = get_model_id("https://gpu-host/llm", ttl_seconds=0)

        assert first == "stale-model"
        assert second == "stale-model"  # stale served on failure

    def test_first_probe_failure_returns_none(self):
        """With no cache and a failed first probe, returns None."""
        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            result = get_model_id("https://gpu-host/llm")

        assert result is None

    def test_empty_endpoint_returns_none(self):
        assert get_model_id("") is None

    def test_ttl_env_override(self, monkeypatch):
        """MODEL_DETECT_TTL env var overrides the default TTL."""
        monkeypatch.setenv("MODEL_DETECT_TTL", "120")
        assert model_cache._resolve_ttl(None) == 120

    def test_ttl_env_invalid_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("MODEL_DETECT_TTL", "not-a-number")
        assert model_cache._resolve_ttl(None) == model_cache.MODEL_TTL_DEFAULT


# ---------------------------------------------------------------------------
# get_max_model_len — context-window discovery from the same /v1/models probe
# ---------------------------------------------------------------------------
class TestModelCacheMaxModelLen:
    """Tests for core.model_cache.get_max_model_len.

    The vLLM /v1/models payload carries max_model_len alongside the model id;
    both must be parsed from the SAME probe and served from the SAME cache
    entry (no second HTTP call).
    """

    def test_returns_max_model_len_on_success(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": 65536}]}

        with patch("httpx.get", return_value=mock_resp):
            result = get_max_model_len("https://gpu-host/llm")

        assert result == 65536

    def test_missing_field_returns_none(self):
        """Strict OpenAI providers omit max_model_len (vLLM extension) → None."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp):
            result = get_max_model_len("https://gpu-host/llm")

        assert result is None

    @pytest.mark.parametrize("access_order", [["id", "len"], ["len", "id"]])
    def test_id_and_len_share_one_probe(self, access_order):
        """get_model_id and get_max_model_len hit /v1/models once for both
        values, in either access order."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": 8192}]}

        accessors = {
            "id": lambda: get_model_id("https://gpu-host/llm", ttl_seconds=60),
            "len": lambda: get_max_model_len("https://gpu-host/llm", ttl_seconds=60),
        }

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            first, second = accessors[access_order[0]](), accessors[access_order[1]]()

        values = {"id": "model-a", "len": 8192}
        assert first == values[access_order[0]]
        assert second == values[access_order[1]]
        assert mock_get.call_count == 1

    def test_stale_max_model_len_served_on_probe_failure(self):
        """After a successful probe, a failed re-probe serves the stale window."""
        ok_resp = MagicMock()
        ok_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": 65536}]}

        with patch("httpx.get", return_value=ok_resp):
            first = get_max_model_len("https://gpu-host/llm", ttl_seconds=0)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            second = get_max_model_len("https://gpu-host/llm", ttl_seconds=0)

        assert first == 65536
        assert second == 65536

    def test_first_probe_failure_returns_none(self):
        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            result = get_max_model_len("https://gpu-host/llm")

        assert result is None

    def test_empty_endpoint_returns_none(self):
        assert get_max_model_len("") is None

    def test_negative_stub_does_not_suppress_model_id_retries(self):
        """The window getter's failure stub must not let the model-id accessor
        TTL-hit it: dataprep/retriever keep retrying on every call."""
        with patch("httpx.get", side_effect=httpx.ConnectError("down")) as mock_get:
            assert get_max_model_len("https://gpu-host/llm") is None  # creates the stub
            assert get_model_id("https://gpu-host/llm") is None  # must re-probe

        assert mock_get.call_count == 2

    def test_string_max_model_len_is_coerced_to_int(self):
        """A proxy returning max_model_len as a JSON string must not poison the
        cache with a value the callers cannot do arithmetic on."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": "65536"}]}

        with patch("httpx.get", return_value=mock_resp):
            result = get_max_model_len("https://gpu-host/llm")

        assert result == 65536
        assert isinstance(result, int)

    def test_non_numeric_max_model_len_is_dropped(self):
        """A value no arithmetic can use (garbage string, dict, float) → None +
        the missing-field warning path, instead of a poisoned cache entry."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": {"tokens": 65536}}]}

        with patch("httpx.get", return_value=mock_resp):
            result = get_max_model_len("https://gpu-host/llm")

        assert result is None

    def test_non_positive_max_model_len_is_dropped(self):
        """Zero or negative values (plausible 'unknown' sentinels like -1) are
        unusable as windows: dropping them keeps every budget arithmetic sane."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": -1}]}

        with patch("httpx.get", return_value=mock_resp):
            assert get_max_model_len("https://gpu-host/llm") is None

        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": 0}]}
        clear_cache()
        with patch("httpx.get", return_value=mock_resp):
            assert get_max_model_len("https://gpu-host/llm") is None

    def test_absurd_windows_are_dropped(self):
        """An integral-but-absurd window (a 1e20 'unknown' from a broken proxy)
        would silently disable the truncation guard: anything above a sane
        ceiling drops to None."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": int(1e20)}]}

        with patch("httpx.get", return_value=mock_resp):
            assert get_max_model_len("https://gpu-host/llm") is None

    def test_unparseable_digit_strings_are_dropped(self):
        """Strings str.isdigit() accepts but int() rejects (superscripts etc.)
        must fall back to None, not raise out of the accessor."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": "²"}]}

        with patch("httpx.get", return_value=mock_resp):
            assert get_max_model_len("https://gpu-host/llm") is None

    @pytest.mark.parametrize("poison", [float("nan"), float("inf"), float("-inf")])
    def test_non_finite_floats_are_dropped(self, poison):
        """json.loads accepts bare NaN/Infinity; int() raises on them and the
        coercion runs outside _probe's broad except — they must drop to None."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": poison}]}

        with patch("httpx.get", return_value=mock_resp):
            assert get_max_model_len("https://gpu-host/llm") is None

    def test_integral_float_is_accepted(self):
        """A proxy serializing the window as a JSON float (65536.0) still
        discovers the window — dropping it would resurface the history wipe."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": 65536.0}]}

        with patch("httpx.get", return_value=mock_resp):
            assert get_max_model_len("https://gpu-host/llm") == 65536

    def test_entry_without_id_is_treated_as_failed_probe(self, caplog):
        """A payload entry with no 'id' is an invalid probe: warn and follow the
        failure path instead of caching None as a silent success."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"max_model_len": 4096}]}

        with (
            patch("httpx.get", return_value=mock_resp),
            caplog.at_level(logging.WARNING, logger="core.model_cache"),
        ):
            assert get_max_model_len("https://gpu-host/llm") is None

        assert any("no model id" in r.getMessage() for r in caplog.records)

    def test_model_id_probe_failure_retries_on_every_call(self):
        """The negative cache is a window-discovery concern: model-id consumers
        (dataprep chunk labeling) keep retrying immediately on the next call."""
        with patch("httpx.get", side_effect=httpx.ConnectError("down")) as mock_get:
            assert get_model_id("https://gpu-host/llm") is None
            assert get_model_id("https://gpu-host/llm") is None

        assert mock_get.call_count == 2

    def test_failed_probe_is_negatively_cached_then_serves_stale(self):
        """A failed probe is remembered briefly (one probe per negative TTL, not
        one per request), and a previously known window keeps being served."""
        ok_resp = MagicMock()
        ok_resp.json.return_value = {"data": [{"id": "model-a", "max_model_len": 65536}]}

        with patch("httpx.get", return_value=ok_resp):
            assert get_max_model_len("https://gpu-host/llm", ttl_seconds=0) == 65536

        with patch("httpx.get", side_effect=httpx.ConnectError("down")) as mock_get:
            # Within the negative-cache window (ttl 0 forces the expiry): no
            # re-probe, stale value served.
            assert get_max_model_len("https://gpu-host/llm", ttl_seconds=0) == 65536
            assert get_max_model_len("https://gpu-host/llm", ttl_seconds=0) == 65536
            assert mock_get.call_count == 1

    def test_failed_probe_with_no_history_caches_none_briefly(self):
        """Same negative cache when no window was ever known: one probe per
        window instead of one per request."""
        with patch("httpx.get", side_effect=httpx.ConnectError("down")) as mock_get:
            assert get_max_model_len("https://gpu-host/llm") is None
            assert get_max_model_len("https://gpu-host/llm") is None
            assert mock_get.call_count == 1


# ---------------------------------------------------------------------------
# require_model_id — the loud twin of get_model_id
# ---------------------------------------------------------------------------
class TestRequireModelId:
    """Payloads that must carry the name the endpoint actually serves
    (tokenize, direct chat/completions) raise instead of guessing a name
    vLLM would reject with a 404."""

    def test_returns_discovered_id(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "served/model"}]}

        with patch("httpx.get", return_value=mock_resp):
            assert model_cache.require_model_id("https://gpu-host/llm") == "served/model"

    def test_raises_when_probe_has_no_answer(self):
        with (
            patch("httpx.get", side_effect=httpx.ConnectError("down")),
            pytest.raises(model_cache.ModelDiscoveryError),
        ):
            model_cache.require_model_id("https://gpu-host/llm")


class TestResolveModelId:
    """The env-wins-else-discover precedence, single-sourced next to
    require_model_id for every payload-building consumer."""

    def test_explicit_env_wins_without_probe(self, monkeypatch):
        monkeypatch.setenv("VLLM_MODEL_ID", "explicit/model")

        with patch("httpx.get") as mock_get:
            assert model_cache.resolve_model_id("https://gpu-host/llm") == "explicit/model"
        mock_get.assert_not_called()

    def test_discovers_when_env_empty(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "served/model"}]}

        with patch("httpx.get", return_value=mock_resp):
            assert model_cache.resolve_model_id("https://gpu-host/llm") == "served/model"

    def test_raises_actionable_error_when_no_endpoint_and_no_env(self, monkeypatch):
        """Neither knob configured: the error must name the two env vars to
        set, not point at a '/v1/models' URL with an empty base."""
        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)

        with pytest.raises(model_cache.ModelDiscoveryError) as exc_info:
            model_cache.resolve_model_id("")

        assert "VLLM_MODEL_ID" in str(exc_info.value)
        assert "VLLM_ENDPOINT" in str(exc_info.value)


# ---------------------------------------------------------------------------
# chatqna getters — _get_llm_model / _get_translation_model_id
# ---------------------------------------------------------------------------
class TestChatqnaGetters:
    """chatqna model-id getters: discovery is ALWAYS ON.

    Both getters probe the same endpoint their callers' requests target
    (_LLM_DISCOVERY_ENDPOINT / _TRANSLATION_DISCOVERY_ENDPOINT — remote GPU
    node when configured, compose-internal vLLM otherwise), sharing the
    core.model_cache TTL cache with the context-window getters. A payload
    sent to a vLLM endpoint must carry the name that endpoint actually
    serves: vLLM validates the model name and 404s unknown ones, so a
    hardcoded fallback name kills every request that carries it.
    """

    def test_get_llm_model_returns_probed_id_without_gate(self):
        """Plain compose (no GPU_NODE_HOST): the internal vLLM is probed anyway."""
        import chatqna.genieai_chatqna as mod

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-llm"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            assert mod._get_llm_model() == "detected-llm"
        assert mock_get.call_args.args[0] == f"{mod._LLM_DISCOVERY_ENDPOINT}/v1/models"

    def test_get_llm_model_prefers_explicit_env(self, monkeypatch):
        """VLLM_MODEL_ID is the escape hatch for endpoints whose /v1/models is
        unreachable while generation works (ACL'd proxies, tunnels)."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setenv("VLLM_MODEL_ID", "explicit/model")
        with patch("httpx.get") as mock_get:
            assert mod._get_llm_model() == "explicit/model"
        mock_get.assert_not_called()

    def test_get_llm_model_raises_when_probe_has_no_answer(self):
        """Loud failure: without a discovered id no valid payload exists —
        a constant name would 404 at the endpoint."""
        import chatqna.genieai_chatqna as mod
        from core.model_cache import ModelDiscoveryError

        with patch("httpx.get", side_effect=httpx.ConnectError("down")), pytest.raises(ModelDiscoveryError):
            mod._get_llm_model()

    def test_get_translation_model_id_discovers_when_env_empty(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "TRANSLATION_MODEL_ID", "")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "google/translategemma-3-7b"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            assert mod._get_translation_model_id() == "google/translategemma-3-7b"
        assert mock_get.call_args.args[0] == f"{mod._TRANSLATION_DISCOVERY_ENDPOINT}/v1/models"

    def test_get_translation_model_id_prefers_explicit_env(self, monkeypatch):
        """The documented VLLM_TRANSLATION_MODEL_ID stays the deployer override:
        when it is set, no probe runs."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "TRANSLATION_MODEL_ID", "explicit/model")
        monkeypatch.setattr(mod, "_VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")

        with patch("httpx.get") as mock_get:
            assert mod._get_translation_model_id() == "explicit/model"
        mock_get.assert_not_called()

    def test_is_translategemma_true_for_translategemma(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "TRANSLATION_MODEL_ID", "")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "google/translategemma-3-7b"}]}

        with patch("httpx.get", return_value=mock_resp):
            assert mod._is_translategemma() is True

    def test_is_translategemma_false_when_undiscovered(self, monkeypatch):
        """Undiscovered translation model → the generic chat-completions path
        (which sends no model name), never a crash."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "TRANSLATION_MODEL_ID", "")

        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            assert mod._is_translategemma() is False

    def test_is_translategemma_false_for_generic_model(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "TRANSLATION_MODEL_ID", "gemma-3-4b-it")

        assert mod._is_translategemma() is False


# ---------------------------------------------------------------------------
# chatqna context-window getters — _get_max_model_len / _get_max_translation_chars
# ---------------------------------------------------------------------------
class TestChatqnaContextWindowGetters:
    """Fallback chain: runtime discovery → configured env value → nothing else.

    Probing is always on (the remote GPU endpoint when configured, otherwise
    the compose-internal vLLM); the configured constants apply only when the
    probe fails or the field is missing. The constants are read at call time
    so a deployer-set MAX_MODEL_LEN_TEXTGEN / MAX_TRANSLATION_CHARS wins over
    the code default.
    """

    def test_get_max_model_len_uses_remote_endpoint_when_configured(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_LLM_DISCOVERY_ENDPOINT", "https://10.0.0.110/llm")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "m", "max_model_len": 65536}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            assert mod._get_max_model_len() == 65536
        assert mock_get.call_args.args[0] == "https://10.0.0.110/llm/v1/models"

    def test_explicit_max_model_len_overrides_discovery(self, monkeypatch):
        """A deployer-set MAX_MODEL_LEN_TEXTGEN caps the usable window even when
        discovery answers — the deliberate consumer-side performance cap."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_LLM_DISCOVERY_ENDPOINT", "https://gpu-host/llm")
        monkeypatch.setenv("MAX_MODEL_LEN_TEXTGEN", "16384")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "m", "max_model_len": 65536}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            assert mod._get_max_model_len() == 16384
        mock_get.assert_not_called()

    def test_explicit_max_model_len_garbage_is_ignored(self, monkeypatch):
        """A non-numeric or non-positive override falls through to discovery."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_LLM_DISCOVERY_ENDPOINT", "https://gpu-host/llm")
        monkeypatch.setenv("MAX_MODEL_LEN_TEXTGEN", "not-a-number")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "m", "max_model_len": 8192}]}

        with patch("httpx.get", return_value=mock_resp):
            assert mod._get_max_model_len() == 8192

    def test_get_max_model_len_probes_without_gpu_node_host(self, monkeypatch):
        """Probing is always on: a compose deployment (LLM_SERVER_HOST_IP=vllm)
        discovers the real window without any GPU_NODE_HOST configured."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "m", "max_model_len": 65536}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            assert mod._get_max_model_len() == 65536
        assert mock_get.call_args.args[0] == "http://vllm:8000/v1/models"

    def test_get_max_translation_chars_probes_without_gpu_node_host(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_TRANSLATION_DISCOVERY_ENDPOINT", "http://vllm-translation-guardrail:9031")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "gemma", "max_model_len": 2048}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            assert mod._get_max_translation_chars() == (2048 - 512) // 2 * 3
        assert mock_get.call_args.args[0] == "http://vllm-translation-guardrail:9031/v1/models"

    def test_get_max_model_len_falls_back_when_probe_fails(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "MAX_MODEL_LEN_TEXTGEN", 4096)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            assert mod._get_max_model_len() == 4096

    def test_get_max_model_len_probe_failure_falls_back_to_configured(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setattr(mod, "MAX_MODEL_LEN_TEXTGEN", 4096)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            assert mod._get_max_model_len() == 4096

    def test_probe_failure_is_logged_as_warning(self, caplog):
        """Probe failures must be visible: a silent fallback hides window drift."""
        with (
            caplog.at_level(logging.WARNING, logger="core.model_cache"),
            patch("httpx.get", side_effect=httpx.ConnectError("down")),
        ):
            get_max_model_len("https://gpu-host/llm")

        assert any("probe failed" in r.getMessage() for r in caplog.records)

    def test_missing_field_is_logged_as_warning(self, caplog):
        """Strict-OpenAI endpoints without max_model_len must warn (fallback follows)."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with (
            caplog.at_level(logging.WARNING, logger="core.model_cache"),
            patch("httpx.get", return_value=mock_resp),
        ):
            get_max_model_len("https://gpu-host/llm")

        assert any("max_model_len" in r.getMessage() for r in caplog.records)

    def test_get_max_translation_chars_derived_from_discovered_window(self, monkeypatch):
        """8192-token window → (8192-512)/2 × 3 = 11520 chars (completion reserve ≈ input size)."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_TRANSLATION_DISCOVERY_ENDPOINT", "https://10.0.0.110/translation")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "gemma", "max_model_len": 8192}]}

        with patch("httpx.get", return_value=mock_resp):
            assert mod._get_max_translation_chars() == 11520

    def test_get_max_translation_chars_falls_back_when_probe_fails(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "MAX_TRANSLATION_CHARS", 2000)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            assert mod._get_max_translation_chars() == 2000

    def test_get_max_translation_chars_probe_failure_falls_back(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")
        monkeypatch.setattr(mod, "MAX_TRANSLATION_CHARS", 2000)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            assert mod._get_max_translation_chars() == 2000

    def test_explicit_max_translation_chars_caps_discovered_budget(self, monkeypatch):
        """A deployer-set MAX_TRANSLATION_CHARS caps the derived budget even when
        discovery wins — the documented dense-script (CJK) mitigation."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_TRANSLATION_DISCOVERY_ENDPOINT", "https://gpu-host/translation")
        monkeypatch.setenv("MAX_TRANSLATION_CHARS", "500")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "gemma", "max_model_len": 8192}]}

        with patch("httpx.get", return_value=mock_resp):
            assert mod._get_max_translation_chars() == 500


# ---------------------------------------------------------------------------
# Dataprep _build_vllm_client — source-level assertions
# (the auth + GPU auto-detect + shared cache logic; shared by _label_with_llm
# and Contextual Retrieval context generation.)
# ---------------------------------------------------------------------------
class TestDataprepAutoDetect:
    """dataprep._build_vllm_client: explicit VLLM_MODEL_ID env wins; otherwise
    the id discovered at VLLM_ENDPOINT — loud when nothing answers."""

    @pytest.fixture()
    def source(self):
        """Read the actual source file for assertions."""
        src = Path(__file__).resolve().parents[1] / "dataprep" / "genieai_dataprep_arangodb.py"
        return src.read_text()

    def test_client_auth_wiring(self, monkeypatch):
        """The AsyncOpenAI client authenticates with VLLM_API_KEY against the
        configured endpoint — behavioral pin of the constructor wiring (no
        custom default_headers, no OPEA_API_KEY)."""
        import dataprep.genieai_dataprep_arangodb as dp

        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_MODEL_ID", "m")

        with patch.object(dp, "AsyncOpenAI") as mock_client:
            dp._build_vllm_client()

        kwargs = mock_client.call_args.kwargs
        assert kwargs["api_key"] == "test-key"
        assert kwargs["base_url"] == "https://10.0.0.110/vllm/v1"
        assert "default_headers" not in kwargs

    def test_env_wins_without_probe(self, monkeypatch):
        """The explicit VLLM_MODEL_ID env is the deployer override: no probe."""
        from dataprep.genieai_dataprep_arangodb import _build_vllm_client

        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.setenv("VLLM_MODEL_ID", "explicit/model")

        with patch("httpx.get") as mock_get:
            _, model = _build_vllm_client()

        assert model == "explicit/model"
        mock_get.assert_not_called()

    def test_discovers_when_env_empty(self, monkeypatch):
        from dataprep.genieai_dataprep_arangodb import _build_vllm_client

        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "discovered/model"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            _, model = _build_vllm_client()

        assert model == "discovered/model"
        assert mock_get.call_args.args[0] == "https://10.0.0.110/vllm/v1/models"

    def test_raises_when_env_empty_and_probe_has_no_answer(self, monkeypatch):
        """Loud: a guessed name is rejected by vLLM's model-name validation."""
        from core.model_cache import ModelDiscoveryError
        from dataprep.genieai_dataprep_arangodb import _build_vllm_client

        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")), pytest.raises(ModelDiscoveryError):
            _build_vllm_client()


# ---------------------------------------------------------------------------
# Dataprep _initialize_llm — auto-detection of remote vLLM model
# ---------------------------------------------------------------------------
class TestDataprepInitializeLlmAutoDetect:
    """dataprep._initialize_llm override: the explicit VLLM_MODEL_ID env wins
    untouched; when it is unset, the discovered id is written into os.environ
    AND the parent module constant (captured at parent import time)."""

    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch):
        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        yield
        # The production discovery writes os.environ DIRECTLY (untracked by
        # monkeypatch); delenv here would record-and-RESTORE it at undo.
        os.environ.pop("VLLM_MODEL_ID", None)

    def _dp(self):
        from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep

        return GenieArangoDataprep.__new__(GenieArangoDataprep)

    def test_explicit_env_is_left_untouched(self, monkeypatch):
        """Env set: no probe, env keeps its value."""
        monkeypatch.setenv("VLLM_MODEL_ID", "explicit/model")

        with patch("httpx.get") as mock_get:
            self._dp()._initialize_llm(allowed_node_types=[], allowed_edge_types=[])

        mock_get.assert_not_called()
        assert os.getenv("VLLM_MODEL_ID") == "explicit/model"

    def test_discovered_id_written_to_env_and_parent_constant(self, monkeypatch):
        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "discovered-model"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("httpx.get", return_value=mock_resp):
            self._dp()._initialize_llm(allowed_node_types=[], allowed_edge_types=[])

        assert os.getenv("VLLM_MODEL_ID") == "discovered-model"
        # The parent reads the CONSTANT captured at its import time — the env
        # write alone would not reach it (comps parent module, mocked here).
        import comps.dataprep.src.integrations.arangodb as _parent_mod

        assert _parent_mod.VLLM_MODEL_ID == "discovered-model"

    def test_raises_when_env_unset_and_probe_has_no_answer(self, monkeypatch):
        from core.model_cache import ModelDiscoveryError

        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")), pytest.raises(ModelDiscoveryError):
            self._dp()._initialize_llm(allowed_node_types=[], allowed_edge_types=[])


# ---------------------------------------------------------------------------
# Retriever _initialize_llm — auto-detection of remote vLLM model
# ---------------------------------------------------------------------------
class TestRetrieverInitializeLlmAutoDetect:
    """Behavioral tests for retriever model resolution.

    The explicit VLLM_MODEL_ID env wins; otherwise the id discovered at
    VLLM_ENDPOINT is passed to ChatOpenAI — loud when nothing answers, since
    a guessed name is rejected by vLLM's model-name validation."""

    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch):
        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        import retriever.genieai_retriever_arangodb as _mod

        monkeypatch.setattr(_mod, "VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        yield
        # The production discovery writes os.environ DIRECTLY (untracked by
        # monkeypatch); delenv here would record-and-RESTORE it at undo.
        os.environ.pop("VLLM_MODEL_ID", None)

    def _r(self):
        from retriever.genieai_retriever_arangodb import GenieaiArangoRetriever

        return GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)

    def test_explicit_env_used_in_chatopenai_without_probe(self, monkeypatch):
        from retriever.genieai_retriever_arangodb import ChatOpenAI

        monkeypatch.setenv("VLLM_MODEL_ID", "explicit/model")
        r = self._r()
        ChatOpenAI.reset_mock()

        with patch("httpx.get") as mock_get:
            r._initialize_llm()

        mock_get.assert_not_called()
        assert ChatOpenAI.call_args.kwargs["model"] == "explicit/model"

    def test_discovered_model_used_in_chatopenai(self):
        from retriever.genieai_retriever_arangodb import ChatOpenAI

        r = self._r()
        ChatOpenAI.reset_mock()

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-llm"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("httpx.get", return_value=mock_resp):
            r._initialize_llm()

        assert ChatOpenAI.call_args.kwargs["model"] == "detected-llm"

    def test_raises_when_env_unset_and_probe_has_no_answer(self):
        """No env, no probe answer → loud, never a compiled-in default."""
        from core.model_cache import ModelDiscoveryError

        r = self._r()

        with patch("httpx.get", side_effect=httpx.ConnectError("down")), pytest.raises(ModelDiscoveryError):
            r._initialize_llm()

    def test_get_llm_keeps_client_when_unchanged(self, monkeypatch):
        """Same resolved id → the existing client is reused, not rebuilt."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI

        monkeypatch.setenv("VLLM_MODEL_ID", "stable-model")
        r = self._r()
        ChatOpenAI.reset_mock()
        r._llm_backend = "vllm"
        r._llm_model_id = "stable-model"
        client = MagicMock()
        r.llm = client

        r._get_llm()

        assert r.llm is client
        ChatOpenAI.assert_not_called()

    def test_get_llm_keeps_openai_summarizer(self):
        """OpenAI-backed summarizer + VLLM_ENDPOINT set: the model re-check
        must not replace the OpenAI client with a vLLM one."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI

        r = self._r()
        ChatOpenAI.reset_mock()
        r._llm_backend = "openai"
        r._llm_model_id = "gpt-x"
        client = MagicMock()
        r.llm = client

        with patch("httpx.get") as mock_get:
            r._get_llm()

        assert r.llm is client
        ChatOpenAI.assert_not_called()
        mock_get.assert_not_called()

    def test_get_llm_recovers_to_vllm_when_openai_init_failed(self):
        """Transient OpenAI-key failure at boot leaves llm unset; the first
        _get_llm call degrades to the vLLM summarizer instead of handing
        back None (an AttributeError on every retrieve)."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI

        r = self._r()
        ChatOpenAI.reset_mock()
        r.llm = None

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "fallback-model"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("httpx.get", return_value=mock_resp):
            llm = r._get_llm()

        assert llm is not None
        assert r._llm_backend == "vllm"
        assert ChatOpenAI.call_args.kwargs["model"] == "fallback-model"

    def test_get_llm_recreates_on_model_change(self):
        """The re-check runs without any GPU_NODE_HOST gate: a changed
        discovered id recreates the client."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI

        r = self._r()
        ChatOpenAI.reset_mock()
        r._llm_backend = "vllm"
        r._llm_model_id = "old-model"
        old_client = MagicMock()
        r.llm = old_client

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "new-model"}]}

        with patch("httpx.get", return_value=mock_resp):
            r._get_llm()

        assert r._llm_model_id == "new-model"
        assert r.llm is not old_client  # ChatOpenAI was recreated, old client discarded


@pytest.fixture(autouse=True)
def discovered_llm_model():
    """Override the conftest stand-in: this file exercises the REAL probe
    path end-to-end (transport mocks, cache semantics, loud failure)."""
    yield
