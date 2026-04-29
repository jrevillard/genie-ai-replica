"""Structured logging + cheap token accounting.

Used by both legacy-wrapped and v2-native translation paths. The goal
is per-request visibility (what provider ran, how long it took,
approximate tokens consumed, cache state) without pulling in a heavy
observability framework. If/when the project adopts OpenTelemetry,
these helpers become thin shims over it.
"""
from __future__ import annotations

import json
import logging
import time
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger("translation_v2.observability")


def log_event(event: str, **fields: Any) -> None:
    """Emit a single JSON log line for a named event.

    Field values are serialized with `default=str` so non-JSON-safe
    objects (e.g., Paths, exceptions) don't blow up the log call.
    """
    record: dict[str, Any] = {"event": event, "ts": time.time(), **fields}
    logger.info(json.dumps(record, ensure_ascii=False, default=str))


class TokenCounter:
    """Approximate token counter.

    Rough heuristic: ~4 chars per token for English, ~3 for Mandinka
    (higher diacritic density). Not exact — intended for cost-trend
    visibility, not billing.
    """

    def __init__(self) -> None:
        self._prompt_tokens = 0
        self._completion_tokens = 0

    @staticmethod
    def estimate(text: str, lang: str = "en") -> int:
        if not text:
            return 0
        chars_per_token = 3 if lang == "ma" else 4
        return max(1, len(text) // chars_per_token)

    def add(self, prompt: str, completion: str, target_lang: str = "ma") -> None:
        self._prompt_tokens += self.estimate(prompt, "en")
        self._completion_tokens += self.estimate(completion, target_lang)

    def totals(self) -> dict[str, int]:
        return {
            "prompt_tokens": self._prompt_tokens,
            "completion_tokens": self._completion_tokens,
        }

    def reset(self) -> None:
        self._prompt_tokens = 0
        self._completion_tokens = 0


@contextmanager
def timed(event: str, **fields: Any) -> Iterator[None]:
    """Wrap a block of work; emit a structured log entry with duration.

    Fires one log line with status="ok" on success, or status="error"
    plus the exception message if the block raised (and the exception
    re-raises).
    """
    start = time.perf_counter()
    try:
        yield
        duration_ms = round((time.perf_counter() - start) * 1000.0, 3)
        log_event(event, duration_ms=duration_ms, status="ok", **fields)
        _registry.histogram_observe(
            f"{event}_duration_ms", duration_ms, status="ok", **_stringify(fields)
        )
    except Exception as e:
        duration_ms = round((time.perf_counter() - start) * 1000.0, 3)
        log_event(
            event,
            duration_ms=duration_ms,
            status="error",
            error=type(e).__name__,
            error_message=str(e),
            **fields,
        )
        _registry.histogram_observe(
            f"{event}_duration_ms", duration_ms, status="error", **_stringify(fields)
        )
        raise


# ─────────────────────────────────────────────────────────────────────
# Step 6 — in-process Prometheus-flavored metrics
# ─────────────────────────────────────────────────────────────────────
def _stringify(labels: dict) -> dict:
    """Coerce label values to strings (Prometheus labels must be strings)."""
    return {k: str(v) for k, v in labels.items()}


def _escape(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


class _Metric:
    __slots__ = ("name", "kind", "values")

    def __init__(self, name: str, kind: str) -> None:
        self.name = name
        self.kind = kind  # "counter" | "histogram"
        self.values: dict[tuple, Any] = {}


class MetricsRegistry:
    """Minimal Prometheus-text-format registry.

    Kept inline rather than taking a dependency on ``prometheus_client``
    — we only need counters + approximate quantile histograms, and we
    don't want to add a runtime dep that legacy isn't using.
    """

    def __init__(self) -> None:
        self._metrics: dict[str, _Metric] = {}

    def counter_inc(self, name: str, value: int = 1, **labels: Any) -> None:
        m = self._metrics.setdefault(name, _Metric(name, "counter"))
        if m.kind != "counter":
            raise ValueError(f"metric {name!r} is not a counter")
        key = tuple(sorted(_stringify(labels).items()))
        m.values[key] = m.values.get(key, 0) + value

    def histogram_observe(self, name: str, value: float, **labels: Any) -> None:
        m = self._metrics.setdefault(name, _Metric(name, "histogram"))
        if m.kind != "histogram":
            raise ValueError(f"metric {name!r} is not a histogram")
        key = tuple(sorted(_stringify(labels).items()))
        m.values.setdefault(key, []).append(float(value))

    def render_prometheus(self) -> str:
        out: list[str] = []
        for name in sorted(self._metrics):
            m = self._metrics[name]
            if m.kind == "counter":
                out.append(f"# TYPE {name} counter")
                for labels, v in sorted(m.values.items()):
                    out.append(_fmt_sample(name, labels, v))
            else:  # histogram → rendered as summary with P50/P95/P99
                out.append(f"# TYPE {name} summary")
                for labels, obs in sorted(m.values.items()):
                    if not obs:
                        continue
                    sorted_obs = sorted(obs)
                    n = len(sorted_obs)
                    for q in (0.5, 0.95, 0.99):
                        idx = max(0, min(n - 1, int(q * n)))
                        combined = labels + (("quantile", str(q)),)
                        out.append(_fmt_sample(name, combined, sorted_obs[idx]))
                    out.append(_fmt_sample(f"{name}_count", labels, n))
                    out.append(_fmt_sample(f"{name}_sum", labels, sum(sorted_obs)))
        return "\n".join(out) + "\n" if out else ""

    def reset(self) -> None:
        self._metrics.clear()


def _fmt_sample(name: str, labels: tuple, value: Any) -> str:
    if not labels:
        return f"{name} {value}"
    lbl_str = ",".join(f'{k}="{_escape(str(v))}"' for k, v in labels)
    return f"{name}{{{lbl_str}}} {value}"


_registry = MetricsRegistry()


def metrics_registry() -> MetricsRegistry:
    return _registry
