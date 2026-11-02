# J.1 pins — the ST answer must keep the EN answer's markdown structure.
#
# The old _translate_with_chunking flattened the text
# (replace("\n\n","\n").split(". ")), rejoined chunks with " ", and fed the
# ** markers to NLLB (whose tokenizer spaces them: `**bold**` → `** bold **`).
# Result (Adem 10-04, live): the Sesotho answer arrived as ONE paragraph with
# literal asterisks while the EN version rendered fine.
#
# The new contract: lines are translated individually; markdown prefixes and
# markers never reach the model; lines rejoin with the original newlines.
# These tests mock the NLLB sidecar with an echo-style transform and pin the
# reassembled structure. Reverting to flatten-and-join must fail them.
from unittest.mock import AsyncMock, patch

import pytest

from chatqna.genieai_chatqna import (
    ChatQnAService,
    _is_translatable_text,
    _split_line_translation_segments,
)

# --- markdown the LLM actually emits for agronomy answers ---
SAMPLE = """Here are the main constraints:

1. **Climate and drought**: Lesotho has variable rainfall.
   - **Conservation agriculture**: plant early
2. **Soil fertility**: use `lime` and manure.

---

See [the guide](https://example.org) for details."""

# what the sidecar receives per translatable segment (order-faithful echo;
# the `---` horizontal rule must NOT be among them — syntax-only text never
# round-trips the tokenizer)
EXPECTED_SEGMENTS = [
    "Here are the main constraints:",
    "Climate and drought",
    ": Lesotho has variable rainfall.",
    "Conservation agriculture",
    ": plant early",
    "Soil fertility",
    ": use",
    "and manure.",
    "See",
    "for details.",
]


def _echo_sidecar(calls):
    """Mock httpx.AsyncClient whose sidecar echoes each text upper-cased,
    recording every request payload into `calls`."""

    def make_response(payload):
        resp = AsyncMock()
        resp.raise_for_status = lambda: None
        resp.json = lambda: {"translations": [t.upper() for t in payload["texts"]]}
        return resp

    client = AsyncMock()

    async def post(url, json=None, headers=None):
        calls.append(json)
        return make_response(json)

    client.post = post
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


def make_svc():
    return ChatQnAService(host="0.0.0.0", port=9999)


class TestSplitLineSegments:
    def test_prefix_bold_and_code(self):
        segments = _split_line_translation_segments("1. **Bold** and `code` span")
        assert segments == [
            ("1. ", False),
            ("**", False),
            ("Bold", True),
            ("**", False),
            (" ", False),
            ("and", True),
            (" ", False),
            ("`code`", False),
            (" ", False),
            ("span", True),
        ]

    def test_heading_prefix_kept(self):
        segments = _split_line_translation_segments("## A heading")
        assert segments[0] == ("## ", False)
        assert ("A heading", True) in segments

    def test_link_kept_verbatim(self):
        segments = _split_line_translation_segments("See [the guide](https://x.org) now")
        assert ("[the guide](https://x.org)", False) in segments
        assert ("See", True) in segments
        assert ("now", True) in segments

    def test_plain_line_single_segment(self):
        assert _split_line_translation_segments("Just text") == [("Just text", True)]

    def test_syntax_only_not_translatable(self):
        assert not _is_translatable_text("---")
        assert not _is_translatable_text("1.")
        assert _is_translatable_text("Bold content")


@pytest.mark.asyncio
async def test_structure_preserved_end_to_end():
    """Line count, prefixes, ** markers, and inline code survive; only the
    readable spans come back translated (upper-cased by the mock)."""
    svc = make_svc()
    calls = []
    client = _echo_sidecar(calls)

    with (
        patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=client),
        patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
        patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb-translate:9201"),
    ):
        result = await svc._translate_with_chunking(
            SAMPLE, "Sesotho", iso_code="st", source_lang_code="en"
        )

    # every newline survived — same line count as the EN answer; the `---`
    # rule passed through untouched
    assert result.split("\n") == [
        "HERE ARE THE MAIN CONSTRAINTS:",
        "",
        "1. **CLIMATE AND DROUGHT**: LESOTHO HAS VARIABLE RAINFALL.",
        "   - **CONSERVATION AGRICULTURE**: PLANT EARLY",
        "2. **SOIL FERTILITY**: USE `lime` AND MANURE.",
        "",
        "---",
        "",
        "SEE [the guide](https://example.org) FOR DETAILS.",
    ]
    # markers never sent to the model: no payload text contains '**'
    sent = [t for c in calls for t in c["texts"]]
    assert sent == EXPECTED_SEGMENTS
    assert all("**" not in t for t in sent)
    assert all("`lime`" not in t for t in sent)


@pytest.mark.asyncio
async def test_batching_respects_sidecar_caps():
    """>64 translatable segments split into multiple sidecar requests with
    order-preserving reassembly."""
    svc = make_svc()
    # 70 plain lines → 70 segments → 64 + 6 in two batches
    text = "\n".join(f"Line number {i} here" for i in range(70))
    calls = []
    client = _echo_sidecar(calls)

    with (
        patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=client),
        patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
        patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb-translate:9201"),
    ):
        result = await svc._translate_with_chunking(text, "Sesotho", iso_code="st")

    assert [len(c["texts"]) for c in calls] == [64, 6]
    lines = result.split("\n")
    assert lines[0] == "LINE NUMBER 0 HERE"
    assert lines[69] == "LINE NUMBER 69 HERE"


@pytest.mark.asyncio
async def test_failure_semantics_unchanged():
    """Sidecar down: raise_on_error=True raises (stream → translation_unavailable
    notice, F4); default returns the ORIGINAL text with structure intact."""
    svc = make_svc()

    with (
        patch(
            "chatqna.genieai_chatqna.httpx.AsyncClient",
            side_effect=TimeoutError("sidecar down"),
        ),
        patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
        patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb-translate:9201"),
    ):
        with pytest.raises(TimeoutError):
            await svc._translate_with_chunking(
                SAMPLE, "Sesotho", iso_code="st", raise_on_error=True
            )
        fallback = await svc._translate_with_chunking(SAMPLE, "Sesotho", iso_code="st")

    assert fallback == SAMPLE  # structure intact even in the EN fallback


@pytest.mark.asyncio
async def test_sidecar_length_mismatch_falls_back():
    """A corrupt sidecar response (wrong translation count) never yields a
    misaligned answer — the batch falls back to the originals."""
    svc = make_svc()
    client = AsyncMock()

    async def post(url, json=None, headers=None):
        resp = AsyncMock()
        resp.raise_for_status = lambda: None
        resp.json = lambda: {"translations": ["only one"]}  # wrong length
        return resp

    client.post = post
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=client),
        patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
        patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb-translate:9201"),
    ):
        result = await svc._translate_with_chunking(SAMPLE, "Sesotho", iso_code="st")

    assert result == SAMPLE


# --- J.1 review-loop pins (edge-case + verification-gap findings) ---

@pytest.mark.asyncio
async def test_unterminated_bold_line_passes_through():
    """A line with an odd number of ** markers (bold spanning a line break)
    is kept verbatim — a half-marker span must never reach the tokenizer."""
    svc = make_svc()
    calls = []
    client = _echo_sidecar(calls)
    text = "**bold starts here\nand ends here**\nnormal line"

    with (
        patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=client),
        patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
        patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb-translate:9201"),
    ):
        result = await svc._translate_with_chunking(text, "Sesotho", iso_code="st")

    sent = [t for c in calls for t in c["texts"]]
    # BOTH halves of the broken span have an odd ** count → verbatim; only
    # the well-formed line is translated
    assert sent == ["normal line"]
    assert result.split("\n")[0] == "**bold starts here"  # verbatim
    assert result.split("\n")[1] == "and ends here**"  # verbatim too


@pytest.mark.asyncio
async def test_verbatim_nested_inside_bold():
    """A link nested inside a bold span never reaches the model (the bold
    content is recursed through the inline splitter)."""
    segments = _split_line_translation_segments(
        "Read **see [the guide](https://example.org) now** please"
    )
    sent = [t for t, translatable in segments if translatable]
    assert sent == ["Read", "see", "now", "please"]
    assert ("**", False) in segments
    assert ("[the guide](https://example.org)", False) in segments


def test_extended_inline_markers_verbatim():
    """*italic*, ~~strike~~, and titled links are protected like code."""
    line = "*italic* and ~~gone~~ and [t](https://x.org \"title\") end"
    segments = _split_line_translation_segments(line)
    verbatim = [t for t, translatable in segments if not translatable]
    assert "*italic*" in verbatim
    assert "~~gone~~" in verbatim
    assert '[t](https://x.org "title")' in verbatim


@pytest.mark.asyncio
async def test_overlong_segment_is_split_not_rejected():
    """A single >2000-char paragraph is sentence-split into ≤2000-char
    pieces (the old chunker's invariant, restored) instead of riding one
    batch into a sidecar 400 — which on the stream path kills the whole
    ST answer."""
    svc = make_svc()
    calls = []
    client = _echo_sidecar(calls)
    long_para = " ".join(f"Sentence number {i} about maize." for i in range(200))
    text = f"Short intro line.\n\n{long_para}\n\nOutro line."

    with (
        patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=client),
        patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
        patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb-translate:9201"),
    ):
        result = await svc._translate_with_chunking(text, "Sesotho", iso_code="st")

    sent = [t for c in calls for t in c["texts"]]
    assert all(len(t) <= 2000 for t in sent)
    assert len(sent) > 1  # the paragraph really was split
    lines = result.split("\n")
    assert lines[0] == "SHORT INTRO LINE."
    assert lines[2].startswith("SENTENCE NUMBER 0 ABOUT MAIZE.")
    assert lines[-1] == "OUTRO LINE."
    # pieces rejoin with spaces inside the segment — no structure damage
    assert "SENTENCE NUMBER 1 ABOUT MAIZE." in lines[2]


@pytest.mark.asyncio
async def test_empty_translation_keeps_original():
    """The sidecar returning an empty string for a non-empty input must not
    silently drop the span — the original text stands."""
    svc = make_svc()
    client = AsyncMock()

    async def post(url, json=None, headers=None):
        resp = AsyncMock()
        resp.raise_for_status = lambda: None
        # translate the first text, blank the second
        outs = [t.upper() if i == 0 else "" for i, t in enumerate(json["texts"])]
        resp.json = lambda: {"translations": outs}
        return resp

    client.post = post
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=client),
        patch("chatqna.genieai_chatqna._is_nllb", return_value=True),
        patch("chatqna.genieai_chatqna.NLLB_TRANSLATE_URL", "http://nllb-translate:9201"),
    ):
        result = await svc._translate_with_chunking(
            "first line\nsecond line", "Sesotho", iso_code="st"
        )

    assert result.split("\n") == ["FIRST LINE", "second line"]


@pytest.mark.asyncio
async def test_non_nllb_backend_translates_per_line_not_per_segment():
    """Instruction-LLM backends get ONE request per line (segments
    rejoined) — per-segment calls would explode request count."""
    svc = make_svc()
    seen = []

    async def fake_chunk(t, *args, **kwargs):
        seen.append(t)
        return t.upper()

    with (
        patch("chatqna.genieai_chatqna._is_nllb", return_value=False),
        patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
        patch.object(svc, "_translate_text_chunk", side_effect=fake_chunk),
    ):
        result = await svc._translate_with_chunking(
            "1. **Bold** and text\nplain line", "French"
        )

    assert seen == ["1. **Bold** and text", "plain line"]  # whole lines
    assert result.split("\n") == ["1. **BOLD** AND TEXT", "PLAIN LINE"]
