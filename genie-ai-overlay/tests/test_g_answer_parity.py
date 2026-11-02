# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
#
# Epic G answer parity (DEC-26), spec-g-answer-parity:
#   G.2b — MANDATORY-English system-prompt injection fires for ALL sessions
#          (was EN-only; the 10-01 hole behind the Sesotho degenerate loop).
#   G.3  — repetition_penalty (and presence_penalty when set) survive the LLM
#          align_inputs key-pick into the vLLM request payload; the default is
#          the CHATQNA_REPETITION_PENALTY env knob (SSOT).
#   G.4  — streaming degeneration guard: a consecutive n-gram loop is withheld,
#          then on confirm the stream stops, the tail is trimmed, and the
#          metadata event carries degenerate_truncated. Healthy text — lists,
#          crop names, doubled words, markdown tables — passes untouched.

from enum import Enum
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import chatqna.genieai_chatqna as chatqna_module
from chatqna.genieai_chatqna import ChatQnAService, GenieUserProfileClient, _scan_degeneration, align_inputs


# ---------------------------------------------------------------------------
# Local helpers (per-file convention — tests/ modules stay self-contained)
# ---------------------------------------------------------------------------
class FakeServiceType(Enum):
    TRANSLATOR = "translator"
    EMBEDDING = "embedding"
    RETRIEVER = "retriever"
    RERANK = "reranker"
    LLM = "llm"


def create_mock_service_node(service_type_value):
    node = MagicMock()
    node.service_type = service_type_value
    return node


def create_mock_tokenizer():
    tokenizer = MagicMock()
    tokenizer.encode = lambda text: []
    return tokenizer


def create_chatqna_service():
    svc = ChatQnAService.__new__(ChatQnAService)
    svc.host = "0.0.0.0"
    svc.port = 8888
    svc.megaservice = MagicMock()
    svc.endpoint = "/v1/chatqna"
    svc.user_profile_client = GenieUserProfileClient()
    return svc


def align_llm_inputs(llm_params, **kwargs):
    """Run align_inputs against a fake LLM node and return the vLLM payload."""
    self_mock = MagicMock()
    self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
    inputs = {"inputs": "rag context", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
    with (
        patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
        patch("chatqna.genieai_chatqna.get_tokenizer", return_value=create_mock_tokenizer()),
    ):
        return align_inputs(self_mock, inputs, "llm_node", MagicMock(), llm_params, **kwargs)


# ===========================================================================
# G.2b — English-response rule for every session (DEC-26)
# ===========================================================================
class TestEnglishInjectionAllLanguages:
    """AC: a non-EN session cannot produce a non-English LLM generation —
    pinned at the prompt boundary: the MANDATORY-English instruction must be
    in the system message for EVERY original_language, including None."""

    @pytest.mark.parametrize("original_language", [None, "EN", "ST", "FR"])
    def test_mandatory_english_injected_for_all_languages(self, original_language):
        kwargs = {} if original_language is None else {"original_language": original_language}
        result = align_llm_inputs({"max_tokens": 512, "top_p": 0.9, "repetition_penalty": 1.03}, **kwargs)
        system_message = result["messages"][0]["content"]
        assert result["messages"][0]["role"] == "system"
        assert "MANDATORY: You MUST respond ONLY in English" in system_message


# ===========================================================================
# G.3 — anti-repetition params reach the vLLM request payload
# ===========================================================================
class TestLlmPayloadRepetitionParams:
    def test_repetition_penalty_present_in_payload(self):
        result = align_llm_inputs({"max_tokens": 512, "top_p": 0.9, "repetition_penalty": 1.03})
        assert result["repetition_penalty"] == 1.03

    def test_repetition_penalty_per_request_override(self):
        result = align_llm_inputs({"max_tokens": 512, "top_p": 0.9, "repetition_penalty": 1.2})
        assert result["repetition_penalty"] == 1.2

    def test_presence_penalty_included_when_set(self):
        result = align_llm_inputs(
            {"max_tokens": 512, "top_p": 0.9, "repetition_penalty": 1.03, "presence_penalty": 0.5}
        )
        assert result["presence_penalty"] == 0.5

    def test_presence_penalty_absent_when_unset(self):
        """Default 0.0 is a no-op — the key must NOT ride the payload."""
        result = align_llm_inputs(
            {"max_tokens": 512, "top_p": 0.9, "repetition_penalty": 1.03, "presence_penalty": 0.0}
        )
        assert "presence_penalty" not in result


class TestRepetitionPenaltyEnvKnob:
    def test_default_is_1_03(self, monkeypatch):
        # Isolated from a CHATQNA_REPETITION_PENALTY exported in the ambient
        # environment (CI, an active shell) — the module constant must be the
        # code default here regardless.
        monkeypatch.delenv("CHATQNA_REPETITION_PENALTY", raising=False)
        assert chatqna_module.REPETITION_PENALTY_DEFAULT == 1.03

    def test_non_numeric_env_falls_back_to_1_03(self):
        """A typo'd env value degrades with a WARNING, never a ValueError at
        import (which would crash-loop the container). Same subprocess idiom
        as the override test below — reload would rebind module objects that
        test_chatqna.py pins by identity."""
        import os
        import subprocess
        import sys
        from pathlib import Path

        overlay_root = Path(__file__).resolve().parents[1]
        code = (
            "import sys; sys.path[:0] = ['.', 'chatqna']\n"
            "import tests.conftest  # installs the vendored-comps stubs\n"
            "import os; os.environ['CHATQNA_REPETITION_PENALTY'] = 'not-a-number'\n"
            "import chatqna.genieai_chatqna as m\n"
            "assert m.REPETITION_PENALTY_DEFAULT == 1.03, m.REPETITION_PENALTY_DEFAULT\n"
        )
        subprocess.run([sys.executable, "-c", code], check=True, cwd=overlay_root)

    def test_env_feeds_the_default(self):
        """The env var must move the module-level default. Checked in a
        subprocess: importlib.reload would rebind the module's function/class
        objects and break the identity pins in test_chatqna.py
        (TestChatQnAServiceInit) for the rest of the session."""
        import os
        import subprocess
        import sys
        from pathlib import Path

        overlay_root = Path(__file__).resolve().parents[1]
        code = (
            "import sys; sys.path[:0] = ['.', 'chatqna']\n"
            "import tests.conftest  # installs the vendored-comps stubs\n"
            "import os; os.environ['CHATQNA_REPETITION_PENALTY'] = '1.15'\n"
            "import chatqna.genieai_chatqna as m\n"
            "assert m.REPETITION_PENALTY_DEFAULT == 1.15, m.REPETITION_PENALTY_DEFAULT\n"
        )
        subprocess.run([sys.executable, "-c", code], check=True, cwd=overlay_root)


# ===========================================================================
# G.4 — pure detector: _scan_degeneration
# ===========================================================================
class TestDegenerationDetector:
    def test_sustained_loop_confirmed(self):
        text = "The answer is no. " + "go tloga " * 300
        hold_char, confirmed = _scan_degeneration(text)
        assert confirmed
        # The hold point is the start of the SECOND repetition: exactly one
        # repetition stays emittable, the loop is trimmed from there on.
        assert text[:hold_char].endswith("go tloga ")
        assert text[hold_char:].startswith("go tloga ")

    def test_healthy_prose_returns_none(self):
        prose = (
            "Maize, beans and wheat grow well in Lesotho. Maize needs full sun. "
            "Beans fix nitrogen in the soil. Wheat is planted in winter. "
            "Maize, beans and wheat can rotate yearly on the same field."
        )
        assert _scan_degeneration(prose) is None

    def test_markdown_table_row_never_confirms(self):
        """Punctuation/dash-only units (wide table separators) are not loops."""
        table = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
        assert _scan_degeneration(table) is None

    def test_below_threshold_not_confirmed(self):
        result = _scan_degeneration("no. " + "go tloga " * 4)
        assert result is not None and result[1] is False

    def test_threshold_boundary_confirms(self):
        result = _scan_degeneration("no. " + "go tloga " * 6)
        assert result is not None and result[1] is True

    def test_split_across_chunks_loop_still_caught(self):
        """The looping unit's last word is still incomplete (mid-chunk) — the
        second scan base (minus the trailing partial word) must still confirm."""
        text = "go tloga " * 6 + "go tlo"
        hold_char, confirmed = _scan_degeneration(text)
        assert confirmed
        assert text[hold_char:].startswith("go tloga")

    def test_single_word_loop_confirmed(self):
        assert _scan_degeneration("ok. " + "ha " * 20)[1] is True

    def test_empty_and_whitespace_return_none(self):
        assert _scan_degeneration("") is None
        assert _scan_degeneration("   \n\t  ") is None

    def test_long_phrase_loop_confirmed(self):
        unit = "plant maize in spring and beans in autumn "  # 8 words
        assert _scan_degeneration("Advice: " + unit * 7)[1] is True

    def test_legit_two_quote_repeat_not_confirmed(self):
        unit = "plant maize in spring and beans in autumn "
        result = _scan_degeneration("Advice: " + unit * 2)
        assert result is None or result[1] is False

    def test_nine_word_looping_phrase_not_confirmed(self):
        """Boundary pin for DEGENERATION_MAX_NGRAM=8: a loop whose unit is 9
        words falls outside the guard (deliberate ceiling) — if the constant
        ever changes silently, this test flags it for a threshold re-review."""
        unit = "best crop to plant this season is maize now "  # exactly 9 words
        result = _scan_degeneration("Advice: " + unit * 8)
        assert result is None or result[1] is False


# ===========================================================================
# G.5 live bug (rtx6000): translation POST auth headers
# ===========================================================================
class TestTranslationAuthHeaders:
    """The translation POST used to send an unconditional
    ``Authorization: Bearer {OPENAI_API_KEY}``. With the key unset/empty the
    value is the illegal ``"Bearer "`` — httpx raises LocalProtocolError
    locally, the request never leaves chatqna, and BOTH translation legs
    (history st→en and finalize en→st) die with it. The NLLB sidecar is
    internal and needs no auth; keyed remote endpoints keep their header."""

    @staticmethod
    def _mock_client():
        mock_response = MagicMock()
        mock_response.json.return_value = {"translations": ["Karabelo"]}
        mock_response.raise_for_status = MagicMock()
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        return mock_client

    @pytest.mark.asyncio
    @pytest.mark.parametrize("api_key", [None, ""])
    async def test_nllb_request_carries_no_authorization_header_when_key_absent(self, api_key):
        svc = create_chatqna_service()
        mock_client = self._mock_client()
        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
            patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb:9201"),
            patch("chatqna.genieai_chatqna.OPENAI_API_KEY", api_key),
        ):
            result = await svc._translate_text_chunk("Hello", "Sesotho", iso_code="st", source_lang_code="en")
        # No Authorization key at all — an empty-Bearer value is unrepresentable.
        headers = mock_client.post.call_args.kwargs["headers"]
        assert "Authorization" not in headers
        assert result == "Karabelo"

    @pytest.mark.asyncio
    async def test_keyed_request_carries_well_formed_bearer(self):
        svc = create_chatqna_service()
        mock_client = self._mock_client()
        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
            patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb:9201"),
            patch("chatqna.genieai_chatqna.OPENAI_API_KEY", "sk-test"),
        ):
            await svc._translate_text_chunk("Hello", "Sesotho", iso_code="st", source_lang_code="en")
        assert mock_client.post.call_args.kwargs["headers"] == {"Authorization": "Bearer sk-test"}


# ===========================================================================
# G.4 — stream integration: detect → stop → trim → mark
# ===========================================================================
class TestStreamDegenerationGuard:
    @staticmethod
    async def _drain(gen):
        out = []
        async for item in gen:
            out.append(item)
        return out

    @staticmethod
    def _make_body(chunks):
        async def _aiter():
            for c in chunks:
                yield c

        return _aiter()

    @staticmethod
    def _streamed_text(joined):
        """User-visible text: the b'...'-repr token events concatenated."""
        import ast

        text = ""
        for part in joined.split("\n\n"):
            if part.startswith("data: b'") and part.endswith("'"):
                text += ast.literal_eval(part[len("data: ") :]).decode("utf-8")
        return text

    @pytest.mark.asyncio
    async def test_looping_stream_stopped_trimmed_and_marked(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        loop_chunk = "data: b'" + ("go tloga " * 300) + "'\n\n"
        body = self._make_body(["data: b'The knowledge base has no answer. '\n\n", loop_chunk, "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}))
        joined = "".join(out)
        # The loop was trimmed: at most ONE repetition reached the stream.
        assert joined.count("go tloga") == 1
        # The metadata event marks the truncation, before the terminal [DONE].
        assert '"degenerate_truncated": true' in joined
        assert joined.find('"type": "metadata"') < joined.find("[DONE]")
        assert joined.rstrip().endswith("data: [DONE]")

    @pytest.mark.asyncio
    async def test_loop_split_across_chunks_caught_and_trimmed(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        chunks = ["data: b'go tlo'\n\n", "data: b'ga go tlo'\n\n"]
        chunks += ["data: b'ga '\n\n", "data: b'go tlo'\n\n"] * 7
        out = await self._drain(svc._stream_with_metadata(self._make_body(chunks), {}))
        joined = "".join(out)
        assert '"degenerate_truncated": true' in joined
        # Exact pin: detection engages once two complete repetitions are
        # visible, so the stream yields rep 1 plus the (partial) rep-2 chunk
        # that was flushed while the last word was still split — one full
        # "go tloga" in the user-visible text, nothing more.
        assert self._streamed_text(joined).count("go tloga") == 1

    @pytest.mark.asyncio
    async def test_healthy_stream_untouched_no_flag(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(
            [
                "data: b'Maize, beans and wheat'\n\n",
                "data: b' grow well in Lesotho.'\n\n",
                "data: b' Maize needs full sun, beans fix nitrogen,'\n\n",
                "data: b' and wheat is planted in early winter.'\n\n",
                "data: [DONE]\n\n",
            ]
        )
        out = await self._drain(svc._stream_with_metadata(body, {}))
        joined = "".join(out)
        # Byte-identical forwarding + no degeneration flag.
        assert "data: b'Maize, beans and wheat'\n\n" in joined
        assert "data: b' grow well in Lesotho.'\n\n" in joined
        assert "degenerate_truncated" not in joined

    @pytest.mark.asyncio
    async def test_legit_doubled_tail_is_flushed_not_dropped(self):
        """A stream that ENDS on a legitimate doubled word (2 repetitions,
        far below the confirm threshold) must not lose that tail."""
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(
            ["data: b'Beans grow very '\n\n", "data: b'very well here.'\n\n", "data: [DONE]\n\n"]
        )
        out = await self._drain(svc._stream_with_metadata(body, {}))
        joined = "".join(out)
        assert "very well here" in joined
        assert "degenerate_truncated" not in joined

    @pytest.mark.asyncio
    async def test_trimmed_answer_is_what_gets_translated(self):
        """ST session (sidecar up): the translated_answer is the translation of
        the TRIMMED English answer — the loop never reaches the translator."""
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        svc.load_language_codes = MagicMock(return_value={"st": "Sesotho"})
        svc._translate_with_chunking = AsyncMock(return_value="Karabelo e khutlisitsoe")
        loop_chunk = "data: b'" + ("go tloga " * 300) + "'\n\n"
        body = self._make_body(["data: b'The knowledge base has no answer.'\n\n", loop_chunk, "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, "ST"))
        joined = "".join(out)
        svc._translate_with_chunking.assert_awaited_once()
        (translated_text, *_rest) = svc._translate_with_chunking.await_args.args
        assert translated_text.count("go tloga") == 1
        assert translated_text.startswith("The knowledge base has no answer.")
        assert '"type": "translated_answer"' in joined
        assert '"degenerate_truncated": true' in joined
