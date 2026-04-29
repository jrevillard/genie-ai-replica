"""Shared pytest fixtures for translation_v2 tests.

Handles the layout quirk that `haystack-chatqna/` is the project's
PYTHONPATH root (legacy code does `from src.config import settings`),
not the outer `haystack-stack/`. Adds both `haystack-chatqna/` and
`haystack-chatqna/src/` to sys.path so tests can import:
  - `translation_v2.*` (v2 code)
  - `services.translator.Translator` (legacy class, for construction
    of bare instances in detector-only tests)
without needing env-level PYTHONPATH changes.

Also provides reusable fakes for Redis and the OpenAI client so tests
never hit real services.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


# ── sys.path setup ────────────────────────────────────────────────────
_HERE = Path(__file__).resolve()
# .../haystack-chatqna/src/translation_v2/tests/conftest.py
# parents[0] = tests/
# parents[1] = translation_v2/
# parents[2] = src/
# parents[3] = haystack-chatqna/
_CHATQNA = _HERE.parents[3]
_SRC = _HERE.parents[2]
for p in (str(_CHATQNA), str(_SRC)):
    if p not in sys.path:
        sys.path.insert(0, p)


# ── Fakes ─────────────────────────────────────────────────────────────
class FakeRedis:
    """In-memory stand-in for the Redis client. Sync, matches legacy usage."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.set_calls: list[tuple[str, int, str]] = []
        self.get_calls: list[str] = []

    def get(self, key: str) -> str | None:
        self.get_calls.append(key)
        return self.store.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.set_calls.append((key, ttl, value))
        self.store[key] = value


def _make_fake_openai(return_text: str) -> MagicMock:
    """Build a MagicMock that mimics AsyncOpenAI enough for translate()."""
    msg = MagicMock()
    msg.content = return_text
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]

    client = MagicMock()
    client.chat.completions.create = AsyncMock(return_value=response)
    return client


# ── Fixtures ──────────────────────────────────────────────────────────
@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.fixture
def legacy_translator_class():
    """Import legacy Translator class once, for construction in tests."""
    from services.translator import Translator
    return Translator


@pytest.fixture
def bare_legacy_translator(legacy_translator_class):
    """A Translator instance with __init__ bypassed — detector-only use.

    The detector methods (detect_language, detect_mandinka_intent,
    _mandinka_probability) use only class-level constants. Bypassing
    __init__ lets us exercise them without a real OpenAI client or
    Redis connection.
    """
    return legacy_translator_class.__new__(legacy_translator_class)


@pytest.fixture
def legacy_translator_with_fakes(
    legacy_translator_class, fake_redis
) -> Any:
    """A Translator with __init__ bypassed AND fake client/redis attached.

    Suitable for tests that exercise translate() or translate_batch()
    end-to-end without hitting real services.
    """
    t = legacy_translator_class.__new__(legacy_translator_class)
    t.client = _make_fake_openai("Ŋ be kuuraŋo la")
    t.model = "gpt-4o-mini"
    t.backend = "openai"
    t._redis = fake_redis
    return t


@pytest.fixture
def openai_response_text() -> str:
    return "Ŋ be kuuraŋo la"


@pytest.fixture
def make_translator_with_response(legacy_translator_class, fake_redis):
    """Factory for translators that return a specific OpenAI reply."""

    def _make(reply: str):
        t = legacy_translator_class.__new__(legacy_translator_class)
        t.client = _make_fake_openai(reply)
        t.model = "gpt-4o-mini"
        t.backend = "openai"
        t._redis = fake_redis
        return t

    return _make


# ── PDF + embedder helpers for Step 4 RAG tests ──────────────────────
@pytest.fixture
def make_native_pdf(tmp_path):
    """Factory for small text-only PDFs.

    Usage:
        path = make_native_pdf("doc.pdf", ["page 1 text", "page 2 text"])
    """
    import pymupdf

    def _make(name: str, pages_text: list[str]):
        out = tmp_path / name
        doc = pymupdf.open()
        try:
            for text in pages_text:
                page = doc.new_page()
                page.insert_text((50, 80), text, fontsize=11)
            doc.save(out)
        finally:
            doc.close()
        return out

    return _make


@pytest.fixture
def make_scanned_pdf(tmp_path):
    """Factory for "scanned" PDFs — page contains an image, no text layer."""
    import pymupdf

    def _make(name: str = "scanned.pdf"):
        out = tmp_path / name
        doc = pymupdf.open()
        try:
            page = doc.new_page()
            # Generate a tiny grey pixmap in memory and embed it as an image.
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 50, 50))
            pix.clear_with(128)  # mid-grey fill
            img_bytes = pix.tobytes("png")
            page.insert_image(pymupdf.Rect(100, 100, 400, 400), stream=img_bytes)
            doc.save(out)
        finally:
            doc.close()
        return out

    return _make


class FakeEmbedder:
    """Deterministic hash-based pseudo-embedder for RAG tests.

    Maps each input string to a fixed-dimensional float vector using
    SHA-256 bytes. Two identical inputs produce identical vectors;
    different inputs produce vectors that are usually different (not
    guaranteed to be orthogonal — tests that care about similarity
    should construct their own vectors). The point is to exercise the
    pipeline shape without any network.
    """

    def __init__(self, dim: int = 16) -> None:
        if dim <= 0 or dim > 32:
            raise ValueError("FakeEmbedder.dim must be in 1..32")
        self._dim = dim
        self.calls: list[list[str]] = []

    @property
    def dim(self) -> int:
        return self._dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        import hashlib
        self.calls.append(list(texts))
        out: list[list[float]] = []
        for t in texts:
            digest = hashlib.sha256(t.encode("utf-8")).digest()
            # Map bytes → [-1, 1)
            vec = [((digest[i] - 128) / 128.0) for i in range(self._dim)]
            out.append(vec)
        return out


@pytest.fixture
def fake_embedder():
    return FakeEmbedder()


@pytest.fixture
def make_fake_embedder():
    def _make(dim: int = 16) -> FakeEmbedder:
        return FakeEmbedder(dim=dim)
    return _make
