# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""OKF PII sidecar — authoritative PII detection/redaction (ADR-okf-004 rev 2026-08-14).

FastAPI + Presidio (MIT) + spaCy NER model baked into the image. The Node
okf-server calls POST /v1/pii/scan directly on the overlay network
(container-to-container, like doc-repo -> dataprep) — it is an INTERNAL
service, not publicly routed (no Kong route). Air-gap sovereign: no runtime
egress; the spaCy model is downloaded at BUILD time only. CPU-only.

Per-jurisdiction national-ID recognizers are CONFIG (NATIONAL_ID_PATTERNS
below) — adding a jurisdiction is a config entry, not a code change. The
shipped patterns are conservative placeholders validated per deployment.
"""

import json
import logging
import os
import threading

from fastapi import FastAPI, HTTPException
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from pydantic import BaseModel, Field

# ------------------------------------------------------------------------------
# Config
# ------------------------------------------------------------------------------

SPACY_MODEL = "en_core_web_md"  # NER-capable, ~50MB; lg is a config swap
DEFAULT_SCORE_THRESHOLD = 0.35  # presidio default; tunable per request

DEFAULT_ENTITIES = [
    "PERSON",
    "LOCATION",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "CREDIT_CARD",
    "IBAN_CODE",
    "IP_ADDRESS",
    "DATE_TIME",
    "NRP",
]

# Per-jurisdiction national-ID recognizers — CONFIG, not code (AC 3).
# Overridable per deployment via OKF_PII_NATIONAL_ID_PATTERNS (JSON):
#   {"BD_NATIONAL_ID": [{"name": "bd-nid", "regex": "...", "score": 0.4}]}
# Defaults are conservative placeholders — confirm each format with the
# deployment before enabling beyond flag-score. CRITICAL: every shipped score
# must be >= DEFAULT_SCORE_THRESHOLD or the recognizer silently never fires
# (presidio filters score >= threshold) — a false-negative on the authoritative
# gate. The pytest suite asserts this invariant.
_DEFAULT_NATIONAL_ID_PATTERNS: dict[str, list[dict]] = {
    # Lesotho national ID (placeholder — confirm format per deployment)
    "LS_NATIONAL_ID": [{"name": "ls-nid", "regex": r"\b\d{8}\b", "score": 0.4}],
    # Bangladesh NID: legacy 13-digit, current 10-digit, smart-card 17-digit
    "BD_NATIONAL_ID": [
        {"name": "bd-nid-10", "regex": r"\b\d{10}\b", "score": 0.4},
        {"name": "bd-nid-13", "regex": r"\b\d{13}\b", "score": 0.4},
        {"name": "bd-nid-17", "regex": r"\b\d{17}\b", "score": 0.4},
    ],
    # Gambia (placeholder — confirm format per deployment)
    "GM_NATIONAL_ID": [{"name": "gm-nid", "regex": r"\b\d{9}\b", "score": 0.4}],
}


def _load_national_id_overrides() -> dict[str, list[dict]]:
    """OKF_PII_NATIONAL_ID_PATTERNS, parsed defensively (round 11, !622).

    Malformed JSON must not take the scan path down: log loudly and fall
    back to no overrides — the registry keeps its built-in defaults and the
    service keeps serving, instead of crash-looping the worker (which, with
    the fail-closed okf-server client, 502'd every scan and blocked every
    publish gate until the env was fixed by hand).
    """
    raw = os.getenv("OKF_PII_NATIONAL_ID_PATTERNS")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        # basicConfig runs after this — print to stderr so the alarm is
        # visible in the container log from the very first line.
        print(
            "CRITICAL: OKF_PII_NATIONAL_ID_PATTERNS is malformed JSON "
            f"({exc}) — ignoring the override and using the built-in "
            "national-ID registry. Fix the env value to restore the "
            "deployment's overrides.",
            flush=True,
        )
        return {}
    if not isinstance(parsed, dict):
        print(
            "CRITICAL: OKF_PII_NATIONAL_ID_PATTERNS must be a JSON object "
            f"(got {type(parsed).__name__}) — ignoring the override and "
            "using the built-in national-ID registry.",
            flush=True,
        )
        return {}
    return parsed


NATIONAL_ID_PATTERNS: dict[str, list[dict]] = {
    **_DEFAULT_NATIONAL_ID_PATTERNS,
    # Round 11 (!622): the env override used to json.loads() bare at module
    # import — one malformed value crash-looped the uvicorn worker, and the
    # okf-server PII client is fail-closed, so every repo-wide scan 502'd and
    # the publish gate blocked every repo until an operator fixed the env. A
    # config typo now degrades to the built-in defaults with a loud alarm
    # (fail-open-with-alarm — the overrides are gone, never silently wrong).
    **_load_national_id_overrides(),
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("okf-pii-service")

# ------------------------------------------------------------------------------
# Engines
# ------------------------------------------------------------------------------


def create_analyzer() -> AnalyzerEngine:
    """Build the analyzer with the configured spaCy model + national-ID registry."""
    provider = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": SPACY_MODEL}],
        }
    )
    analyzer = AnalyzerEngine(nlp_engine=provider.create_engine(), supported_languages=["en"])
    for entity, patterns in NATIONAL_ID_PATTERNS.items():
        analyzer.registry.add_recognizer(
            PatternRecognizer(
                supported_entity=entity,
                patterns=[Pattern(name=p["name"], regex=p["regex"], score=p["score"]) for p in patterns],
                supported_language="en",
            )
        )
    return analyzer


analyzer: AnalyzerEngine | None = None
_analyzer_lock = threading.Lock()  # guard the lazy singleton (code-review #12)
anonymizer = AnonymizerEngine()

# ------------------------------------------------------------------------------
# Region splitting — the fix for the WORKER DEATH (measured 2026-10-13)
# ------------------------------------------------------------------------------
#
# WHY THIS EXISTS. The uvicorn worker died repeatedly during bulk repo scans,
# stalling them. Measured, not assumed:
#
#   * 600 SEQUENTIAL 24 KB scans: 600/600 OK, 0 deaths, worker RSS FLAT
#     (~447/453 MB from request 60 to 540). No leak, no cumulative growth.
#   * A SINGLE 850 KB scan: the worker DIES EVERY TIME (8/8 reproductions),
#     the client sees `RemoteDisconnected`, and uvicorn respawns it.
#   * So the trigger is the LENGTH OF ONE analyze() CALL, not request count.
#
# The mechanism is uvicorn's own supervisor
# (uvicorn/supervisors/multiprocess.py, Multiprocess.keep_subprocess_alive):
# the parent process pings every child over a pipe and expects a pong within
# 5 s; a child that misses it is `process.kill()`-ed (SIGKILL) and respawned.
# The pong is served by a daemon thread (Process.always_pong), but the scan
# holds the GIL inside native spaCy/thinc/torch code for a single unbroken
# stretch, so the pong thread is not scheduled and the ping times out. The
# supervisor log shows exactly this sequence:
#     Waiting for child process [10] / Child process [10] died
#     Started server process [96]
#
# This is NOT an OOM (OOMKilled false) and NOT container memory pressure: the
# container has no memory limit. MALLOC_ARENA_MAX=2 was tested and made worker
# memory flat under concurrent load, but it did NOT prevent a single death
# (6/6 deaths with the arena cap). Recycling is therefore NOT the fix — and
# `--max-requests` does not even exist in the pinned uvicorn (see Dockerfile).
#
# THE FIX: bound how much text one analyze() call may hold the GIL over. A
# long document is split into regions, each analyzed separately, with offsets
# translated back to absolute positions so the response contract is unchanged.
# presidio NER already operates region-wise, so per-region recall is
# unchanged; only entity that STRADDLES a split boundary is affected, which is
# why splits are made on whitespace/newline rather than at a fixed offset.
#
# REGION_MAX_CHARS is sized from MEASUREMENT against the supervisor's 5 s pong
# window, not from taste. Measured single-call latency on this host:
#     25 000 chars -> 1.77 s mean / 2.41 s max
#     50 000 chars -> 3.11 s mean / 3.42 s max
#    100 000 chars -> 6.58 s mean / 6.87 s max   <-- ABOVE the 5 s window
# A 100 KB region still produced one death in 8 runs precisely because it can
# overrun the window. 50 000 chars leaves ~1.6 s of headroom against the 3.42 s
# observed max, so a region cannot starve the pong thread even on a busy host.
# An 850 KB page becomes ~17 regions. Override with PII_REGION_MAX_CHARS for a
# host materially faster or slower than this one (keep max latency < 5 s).
REGION_MAX_CHARS = int(os.getenv("PII_REGION_MAX_CHARS", "50000"))


def split_regions(text: str, max_chars: int = REGION_MAX_CHARS) -> list[tuple[int, str]]:
    """Split `text` into (offset, chunk) regions of at most `max_chars`.

    Splits land on whitespace so a split never lands mid-word, and never
    produces an empty region. The offset is the chunk's index in the ORIGINAL
    text, so a caller can translate region-local offsets back to absolute.
    """
    if max_chars <= 0 or len(text) <= max_chars:
        return [(0, text)]
    regions: list[tuple[int, str]] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + max_chars, n)
        if end < n:
            # Prefer the last whitespace in the window so the break falls
            # between words; fall back to the hard cut if the window has none
            # (a single very long token cannot be split safely).
            brk = text.rfind("\n", start + 1, end)
            if brk == -1:
                brk = text.rfind(" ", start + 1, end)
            if brk > start:
                # The separator at `brk` is deliberately left to the NEXT region
                # (start = end below), so the regions tile the original exactly
                # and redacted_text reassembles losslessly.
                end = brk
        chunk = text[start:end]
        if chunk:
            regions.append((start, chunk))
        if end >= n:
            break
        start = end
    return regions


# spaCy/thinc is NOT thread-safe. `scan` is a SYNC def, so FastAPI runs it in
# the anyio threadpool — with PII_WEB_CONCURRENCY>1 each worker process can have
# several scan() calls in flight at once, all driving the SAME module-global
# analyzer through native BLAS/tensor code. That crashes the worker process:
#
#     INFO:     Child process [2459] died
#     INFO:     Started server process [4655]
#
# observed roughly every 30-60s during a bulk repo scan. The crash resets the
# in-flight connection, the okf-server client sees ECONNRESET, and the concept is
# written off as permanently failed.
#
# Serializing analyze() WITHIN a process is the correct fix: it removes the native
# race outright while keeping the cross-process parallelism that PII_WEB_CONCURRENCY
# exists to provide. The analyzer stays a per-process singleton, so each worker
# still holds its own model copy.
_analyze_lock = threading.Lock()


def get_analyzer() -> AnalyzerEngine:
    """Lazy singleton so /health answers before the (slow) first model load.

    Thread-safe: uvicorn runs sync endpoints in the anyio threadpool, so two
    concurrent first calls must not double-load the ~50MB spaCy model.
    """
    global analyzer
    if analyzer is None:
        with _analyzer_lock:
            if analyzer is None:  # double-checked
                logger.info("Loading spaCy model %s (first use)", SPACY_MODEL)
                analyzer = create_analyzer()
    return analyzer


# ------------------------------------------------------------------------------
# API models
# ------------------------------------------------------------------------------


SUPPORTED_LANGUAGES = frozenset({"en"})  # only 'en' has a model loaded


class ScanItem(BaseModel):
    id: str
    text: str
    language: str = "en"

    def model_post_init(self, __context) -> None:
        if self.language not in SUPPORTED_LANGUAGES:
            raise ValueError(f"unsupported language '{self.language}' (supported: {sorted(SUPPORTED_LANGUAGES)})")


class ScanRequest(BaseModel):
    texts: list[ScanItem]
    entities: list[str] | None = None
    threshold: float = Field(default=DEFAULT_SCORE_THRESHOLD, ge=0.0, le=1.0)


class Hit(BaseModel):
    type: str
    start: int
    end: int
    score: float


class ScanResult(BaseModel):
    id: str
    hits: list[Hit]
    counts_by_type: dict[str, int]
    redacted_text: str


class ScanResponse(BaseModel):
    results: list[ScanResult]


# ------------------------------------------------------------------------------
# App
# ------------------------------------------------------------------------------

app = FastAPI(title="OKF PII Service", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    """Ready once the model has loaded (forces the lazy load)."""
    try:
        get_analyzer()
        return {"status": "ready", "model": SPACY_MODEL}
    except Exception:  # pragma: no cover - model load failure path
        # Do NOT echo the raw exception (code-review #20) — a generic 503.
        raise HTTPException(status_code=503, detail="model not loaded") from None


@app.post("/v1/pii/scan", response_model=ScanResponse)
def scan(req: ScanRequest):
    """Batch scan + redact. Typed-placeholder strategy preserves readability.

    Long texts are analyzed in REGIONS (see split_regions) so no single
    analyze() call holds the GIL long enough for the uvicorn supervisor to
    SIGKILL this worker. Region offsets are translated back to absolute
    positions, so the response contract is identical to a single-pass scan.
    """
    engine = get_analyzer()
    entities = req.entities if req.entities is not None else DEFAULT_ENTITIES + list(NATIONAL_ID_PATTERNS.keys())
    out: list[ScanResult] = []
    for item in req.texts:
        regions = split_regions(item.text)
        results: list = []
        redacted_parts: list[str] = []
        for offset, chunk in regions:
            # Serialized per process — see _analyze_lock. The lock is taken and
            # RELEASED per region: holding it across the whole document would
            # re-create the single long GIL-held span this split removes.
            with _analyze_lock:
                # Raw text is never logged (NFR-P2) — only lengths/counts.
                region_results = engine.analyze(
                    text=chunk, language=item.language, entities=entities, score_threshold=req.threshold
                )
                entity_types = {r.entity_type for r in region_results}
                operators = {e: OperatorConfig("replace", params={"new_value": f"[PII:{e}]"}) for e in entity_types}
                anon = anonymizer.anonymize(text=chunk, analyzer_results=region_results, operators=operators)
            # Translate region-local offsets back to absolute document offsets.
            for r in region_results:
                r.start += offset
                r.end += offset
            results.extend(region_results)
            redacted_parts.append(anon.text)

        counts: dict[str, int] = {}
        for r in results:
            counts[r.entity_type] = counts.get(r.entity_type, 0) + 1
        logger.info(
            "scanned id=%s hits=%d regions=%d entities=%s",
            item.id,
            len(results),
            len(regions),
            counts,  # counts only, never text
        )
        out.append(
            ScanResult(
                id=item.id,
                hits=[Hit(type=r.entity_type, start=r.start, end=r.end, score=r.score) for r in results],
                counts_by_type=counts,
                redacted_text="".join(redacted_parts),
            )
        )
    return ScanResponse(results=out)
