from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Dict, Iterator, Optional

from app.services.core.logging import get_logger  # because your core is under app/services/core

log = get_logger("timing")


@dataclass
class TimerResult:
    name: str
    elapsed_ms: float


class Stopwatch:
    """
    Lightweight stopwatch that can track multiple named stages.
    Useful for: convert_ms, stt_ms, llm_ms, total_ms.
    """
    def __init__(self):
        self._t0 = time.perf_counter()
        self._marks: Dict[str, float] = {}

    def mark(self, name: str) -> None:
        self._marks[name] = time.perf_counter()

    def elapsed_ms(self) -> float:
        return (time.perf_counter() - self._t0) * 1000.0

    def since_mark_ms(self, name: str) -> Optional[float]:
        if name not in self._marks:
            return None
        return (time.perf_counter() - self._marks[name]) * 1000.0


@contextmanager
def timed(name: str, extra: dict | None = None) -> Iterator[dict]:
    """
    Context manager for timing blocks.

    Usage:
        with timed("stt") as meta:
            ...
        # logs: {"event":"timed","name":"stt","ms":...}

    It yields a dict so you can attach more info (chars, size, etc.)
    """
    start = time.perf_counter()
    meta = extra or {}
    try:
        yield meta
    finally:
        ms = (time.perf_counter() - start) * 1000.0
        log.info("timed", name=name, ms=round(ms, 2), **meta)
