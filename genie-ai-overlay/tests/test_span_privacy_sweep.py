# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""End-to-end privacy sweep: spans produced by the REAL code paths.

The traces pipeline has no collector-side redaction. ``transform/pii_redact``
runs on the logs branch of the collector config only, so whatever reaches a span
attribute reaches VictoriaTraces verbatim for the retention window. Whatever
does not appear here is gone forever.

Every assertion below drives a production ENTRY POINT -- ``retriever.invoke``,
``chatqna.handle_request``, the reranker's ``invoke`` -- with user text, chat
markers and document prose flowing through it, and reads the finished,
exported spans.

Deliberately NOT a helper-only sweep. Calling ``_retrieval_parameter_attributes``
directly proves the helper is clean; it cannot see a leak introduced at the
emission site, and the emission site is where leaks actually happen: a span
attribute added by hand at a call site never passes through the helper whose
shape was tested. The reranker here is fed real document prose, the retriever a
real marker-laden query, and the chat turn a real history -- so a single
stray ``span.set_attribute("...", doc_text)`` fails this suite.

Chat markers are checked by CONTENT, not by shape. ``assert_no_free_text`` is a
whitespace-and-length rule; the markers below are what a chunk of retrieved
context looks like after it has been through a template, and they are asserted
literally so that a future value short enough to pass the shape rule still
cannot smuggle a prompt section through.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import chatqna.genieai_chatqna as chatqna_module
from core.label_contract import encode_filter_labels
from core.span_attrs import ATTRIBUTE_NAMES as A
from core.span_attrs import assert_no_free_text, free_text_violations

# The mocked ArangoDB / embedding stack and the request/service builders the
# behavioural suites already drive. Imported rather than restated: a second copy
# would drift, and this suite's value is that it runs the SAME environment the
# behavioural tests do, with user text flowing through it.
from tests.test_chatqna import (
    _fake_parms,
    _patched_chat_request,
    create_chatqna_service,
    create_mock_chat_request_data,
    create_mock_request,
)

# Autouse inside test_reranker; imported so the reranker's isinstance() checks
# see real types. Under the comps mock SearchedDoc is a MagicMock and invoke()
# raises TypeError before emitting anything.
from tests.test_reranker import (
    create_mock_aiohttp_session,
    create_mock_searched_doc,
    create_reranker,
    create_tei_rerank_response,
    patch_reranker_types,  # noqa: F401  (pytest fixture)
)
from tests.test_retriever import _make_happy_path_db, _make_mock_vector_db, create_mock_input, create_retriever
from tests.test_retriever_span_attributes import _FakeDoc

# Real strings the chatqna prompt template splices user and document text into.
# Asserted literally: they are the vocabulary of a prompt leak, and they are
# what a chunk of retrieved context looks like once templated.
CHAT_MARKERS = (
    "USER INFORMATION",
    "Retrieved Document",
    "CHAT HISTORY",
    "Related Information",
)

# Prose deliberately long and whitespace-bearing: this is the shape layer-2
# exists to reject, and it travels through every path below.
LEAKY_PROSE = (
    "USER INFORMATION: the farmer in Santa Ana reports sandy loam soil on the "
    "north field and CHAT HISTORY mentions irrigation scheduling last season. "
    "Related Information follows from the Retrieved Document excerpt."
)


def _serialize(span) -> str:
    """Flatten a span's attributes to text, for the literal marker check."""
    return repr(dict(span.attributes))


def _assert_spans_carry_no_chat_markers(spans) -> None:
    offenders = [f"{span.name}: {marker}" for span in spans for marker in CHAT_MARKERS if marker in _serialize(span)]
    assert not offenders, f"chat prompt content reached span attributes: {offenders}"


def _assert_clean(spans, expected_span_names) -> None:
    """The non-vacuous sweep: named spans must exist, then all of them check."""
    produced = {span.name for span in spans}
    assert produced, "the driven path emitted no span — the sweep would be vacuous"
    missing = set(expected_span_names) - produced
    assert not missing, f"expected spans not produced, sweep would be vacuous: {sorted(missing)}"
    for span in spans:
        assert_no_free_text(dict(span.attributes))
    _assert_spans_carry_no_chat_markers(spans)


# ---------------------------------------------------------------------------
# Retriever
# ---------------------------------------------------------------------------


@pytest.fixture
def invoke_env():
    """The mocked ArangoDB + embedding + vector-store environment ``invoke`` needs.

    Built from the SAME helper functions test_retriever.py and
    test_retriever_span_attributes.py build theirs from, so the three run the
    same environment with user text in it. Restated here rather than imported:
    importing the fixture from the neighbouring module is F811 on every
    signature that takes it, and suppressing that on each line would hide a
    genuine shadowing bug if one appeared. See the comment on the same-named
    fixture in test_retriever_span_attributes.py.
    """
    db = _make_happy_path_db()
    retriever = create_retriever(db_mock=db)
    embeddings = MagicMock()
    embeddings.embed_query.return_value = [0.1] * 768
    vector_db = _make_mock_vector_db(db)
    started = [
        patch("retriever.genieai_retriever_arangodb.HuggingFaceBgeEmbeddings", return_value=embeddings),
        patch("retriever.genieai_retriever_arangodb.ArangoVector", return_value=vector_db),
        patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", None),
        patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
        patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
        patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False),
    ]
    for patcher in started:
        patcher.start()
    yield {"db": db, "retriever": retriever, "embeddings": embeddings, "vector_db": vector_db}
    for patcher in started:
        patcher.stop()


class TestRetrieverSpansAreClean:
    """``retriever.hybrid_search`` carries per-candidate arrays; an array of
    chunk TEXTS instead of chunk KEYS is the obvious way for this to leak."""

    @pytest.mark.asyncio
    async def test_dense_only_query(self, invoke_env, captured_spans):
        hit = _FakeDoc(id="chunkA", page_content=LEAKY_PROSE, metadata={})
        invoke_env["vector_db"].asimilarity_search_with_relevance_scores.return_value = [(hit, 0.9)]
        await invoke_env["retriever"].invoke(create_mock_input(search_start="chunk", k=2))
        _assert_clean(captured_spans(), {"retriever.hybrid_search"})

    @pytest.mark.asyncio
    async def test_hybrid_query_with_both_legs(self, invoke_env, captured_spans):
        dense = _FakeDoc(id="chunkA", page_content=LEAKY_PROSE, metadata={})
        lexical = _FakeDoc(id="chunkB", page_content=LEAKY_PROSE, metadata={})
        invoke_env["vector_db"].asimilarity_search_with_relevance_scores.return_value = [(dense, 0.9)]
        with (
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", True),
            patch.object(
                invoke_env["retriever"],
                "_bm25_search",
                return_value=[{"doc": lexical, "score": 1.4}, {"doc": dense, "score": 0.3}],
            ),
        ):
            await invoke_env["retriever"].invoke(create_mock_input(search_start="chunk", k=2))
        _assert_clean(captured_spans(), {"retriever.hybrid_search"})

    @pytest.mark.asyncio
    async def test_traversal_and_label_filter_query(self, invoke_env, captured_spans):
        """The widest retriever span: traversal on, label digests, hybrid config."""
        hit = _FakeDoc(id="chunkA", page_content=LEAKY_PROSE, metadata={})
        invoke_env["vector_db"].asimilarity_search_with_relevance_scores.return_value = [(hit, 0.9)]
        invoke_env["retriever"].fetch_neighborhoods = MagicMock(
            return_value={"chunkA": [{"chunk_text": LEAKY_PROSE, "file_id": "f1"}]}
        )
        input_mock = create_mock_input(search_start="chunk", enable_traversal=True)
        input_mock.model_dump.return_value["search_start"] = encode_filter_labels(
            "chunk", ["Soil Management", "Irrigation"]
        )
        await invoke_env["retriever"].invoke(input_mock)
        _assert_clean(captured_spans(), {"retriever.hybrid_search"})


# ---------------------------------------------------------------------------
# chatqna
# ---------------------------------------------------------------------------


def _service_with_user_text():
    """A chatqna service whose request carries real prose end to end."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})
    return svc


def _request_carrying_marker_text():
    return create_mock_request(
        data=create_mock_chat_request_data(
            messages=[
                {"role": "user", "content": LEAKY_PROSE},
                {"role": "assistant", "content": "the soil is sandy loam"},
                {"role": "user", "content": "how should I irrigate it?"},
            ],
            stream=True,
        ),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )


async def _drain(gen):
    return [item async for item in gen]


class TestChatqnaSpansAreClean:
    @pytest.mark.asyncio
    async def test_streamed_answer(self, captured_spans):
        svc = _service_with_user_text()

        async def _body():
            yield f"data: {LEAKY_PROSE.encode('utf-8')!r}\n\n"
            yield "data: [DONE]\n\n"

        async def _schedule(*_args, **_kwargs):
            return {"llm-vllm": _streaming(_body)}, None

        svc.megaservice.schedule = _schedule
        svc._assemble_source_documents = AsyncMock(return_value=([{"document_id": "f1"}], 0.6, True))

        with (
            patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
            patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
            patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
            _patched_chat_request(stream=True, messages=[{"role": "user", "content": LEAKY_PROSE}]),
        ):
            response = await svc.handle_request(_request_carrying_marker_text())
            await _drain(response.body_iterator)

        _assert_clean(captured_spans(), {"chatqna.orchestrate", "chatqna.stream_outcome"})

    @pytest.mark.asyncio
    async def test_streamed_abstention(self, captured_spans):
        svc = _service_with_user_text()

        async def _raise_marker(*_args, **_kwargs):
            raise chatqna_module._RerankerInputTooLongError("TEI rejected input")

        svc.megaservice.schedule = _raise_marker

        with (
            patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
            patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
            patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
            _patched_chat_request(stream=True, messages=[{"role": "user", "content": LEAKY_PROSE}]),
        ):
            response = await svc.handle_request(_request_carrying_marker_text())
            await _drain(response.body_iterator)

        _assert_clean(captured_spans(), {"chatqna.orchestrate", "chatqna.stream_outcome"})


def _streaming(body):
    from fastapi.responses import StreamingResponse

    return StreamingResponse(body(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Reranker
# ---------------------------------------------------------------------------


class TestRerankerSpansAreClean:
    @pytest.mark.asyncio
    async def test_rerank_with_real_document_prose(self, captured_spans):
        reranker = create_reranker()
        input_doc = create_mock_searched_doc(
            texts=[LEAKY_PROSE, "second chunk: irrigation scheduling on sandy loam"],
            initial_query=LEAKY_PROSE,
            reranking_strategy="slice",
            top_n=2,
        )
        session = create_mock_aiohttp_session(create_tei_rerank_response([0.95, 0.82]))

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=session):
            await reranker.invoke(input_doc)

        _assert_clean(captured_spans(), {"reranker.tei_invoke"})


# ---------------------------------------------------------------------------
# The guard itself
# ---------------------------------------------------------------------------


class TestTheGuardIsNotHollow:
    """What the sweep above would NOT catch, asserted directly.

    The layer-2 shape rule accepts a value with no whitespace and no length. A
    one-word user query is exactly that: ``"onions"`` passes every shape check a
    sweep could apply. Only layer 1 -- the registered-key requirement -- rejects
    it, which is why the positive vocabulary check is the strong layer rather
    than the belt to the shape rule's braces.
    """

    def test_a_one_word_value_passes_the_shape_rule(self):
        """Pins the premise: this value has no free-text shape at all."""
        value = "onions"
        assert value.strip() == value
        assert len(value) < 96

    def test_an_unregistered_key_is_rejected_despite_having_no_free_text_shape(self):
        violations = free_text_violations({"rag.user_query": "onions"})
        assert violations, "an unregistered key carrying a single word must still be a violation"
        assert "unregistered attribute key" in violations[0]

    def test_the_same_value_under_a_registered_key_is_accepted(self):
        """Proves the rejection above came from the KEY, not the value."""
        assert free_text_violations({A["rag_search_type"]: "onions"}) == []

    def test_assert_no_free_text_raises_on_the_unregistered_key(self):
        with pytest.raises(AssertionError, match="unregistered attribute key"):
            assert_no_free_text({"rag.user_query": "onions"})

    def test_prose_on_a_registered_key_is_still_caught(self):
        """Layer 2 is not weakened by the registered-key allowance."""
        violations = free_text_violations({A["rag_search_type"]: LEAKY_PROSE})
        assert violations
        assert "free-text value" in violations[0]

    def test_the_sweep_would_notice_a_leaked_document_text(self):
        """A leak shaped like the one this suite exists to catch fails it."""
        with pytest.raises(AssertionError):
            assert_no_free_text({A["rag_candidate_keys"]: LEAKY_PROSE})
