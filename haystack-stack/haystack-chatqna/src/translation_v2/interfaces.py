"""Protocols shared by legacy translator and v2 pipeline.

These describe the seams v2 code plugs into. Step 1 writes thin
adapters that make the legacy classes conform to these protocols
without modifying them.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class Chunk:
    text: str
    doc_id: str
    page: int | None = None
    section: str | None = None
    score: float | None = None
    metadata: dict | None = None


@dataclass(frozen=True)
class QEResult:
    score: float
    metric: str
    passed: bool
    threshold: float
    notes: str | None = None


@runtime_checkable
class TranslationProvider(Protocol):
    name: str

    async def translate(self, text: str, source: str, target: str) -> str: ...

    async def translate_batch(
        self, texts: list[str], source: str, target: str
    ) -> list[str]: ...


@runtime_checkable
class ChunkingStrategy(Protocol):
    def chunk(self, text: str, doc_meta: dict) -> list[Chunk]: ...


@runtime_checkable
class Embedder(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


@runtime_checkable
class Retriever(Protocol):
    async def retrieve(self, query: str, k: int) -> list[Chunk]: ...


@runtime_checkable
class Generator(Protocol):
    async def generate(self, query: str, context: list[Chunk]) -> str: ...


@runtime_checkable
class QualityEstimator(Protocol):
    async def score(self, source: str, target: str, lang_pair: str) -> QEResult: ...


@runtime_checkable
class LanguageDetector(Protocol):
    """Language classifier. Returns a short ISO-like code ('en', 'ma', ...)."""

    def detect_language(self, text: str) -> str: ...

    def detect_mandinka_intent(self, text: str) -> dict: ...
