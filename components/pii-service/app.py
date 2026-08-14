# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""OKF PII sidecar — authoritative PII detection/redaction (ADR-okf-004 rev 2026-08-14).

FastAPI + Presidio (MIT) + spaCy NER model baked into the image. The Node
okf-server calls POST /v1/pii/scan (fail-closed on its side). Air-gap sovereign:
no runtime egress; the spaCy model is downloaded at BUILD time only. CPU-only.
Internal service (behind Kong, like dataprep — never publicly routed).

Per-jurisdiction national-ID recognizers are CONFIG (NATIONAL_ID_PATTERNS
below) — adding a jurisdiction is a config entry, not a code change. The
shipped patterns are conservative placeholders validated per deployment.
"""

import logging

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
# Patterns are CONSERVATIVE PLACEHOLDERS: confirm each format with the
# deployment before enabling beyond flag-score. score is kept moderate so a
# hit surfaces for steward review rather than auto-redacting aggressively.
NATIONAL_ID_PATTERNS: dict[str, list[dict]] = {
    # Lesotho national ID (placeholder — confirm format per deployment)
    "LS_NATIONAL_ID": [{"name": "ls-nid", "regex": r"\b\d{8}\b", "score": 0.4}],
    # Bangladesh NID: legacy 13-digit, current 10-digit, smart-card 17-digit
    "BD_NATIONAL_ID": [
        {"name": "bd-nid-10", "regex": r"\b\d{10}\b", "score": 0.3},
        {"name": "bd-nid-13", "regex": r"\b\d{13}\b", "score": 0.35},
        {"name": "bd-nid-17", "regex": r"\b\d{17}\b", "score": 0.3},
    ],
    # Gambia (placeholder — confirm format per deployment)
    "GM_NATIONAL_ID": [{"name": "gm-nid", "regex": r"\b\d{9}\b", "score": 0.3}],
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
anonymizer = AnonymizerEngine()


def get_analyzer() -> AnalyzerEngine:
    """Lazy singleton so /health answers before the (slow) first model load."""
    global analyzer
    if analyzer is None:
        logger.info("Loading spaCy model %s (first use)", SPACY_MODEL)
        analyzer = create_analyzer()
    return analyzer


# ------------------------------------------------------------------------------
# API models
# ------------------------------------------------------------------------------


class ScanItem(BaseModel):
    id: str
    text: str
    language: str = "en"


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
    except Exception as exc:  # pragma: no cover - model load failure path
        raise HTTPException(status_code=503, detail=f"model not loaded: {exc}") from exc


@app.post("/v1/pii/scan", response_model=ScanResponse)
def scan(req: ScanRequest):
    """Batch scan + redact. Typed-placeholder strategy preserves readability."""
    engine = get_analyzer()
    entities = req.entities or DEFAULT_ENTITIES + list(NATIONAL_ID_PATTERNS.keys())
    out: list[ScanResult] = []
    for item in req.texts:
        # Raw text is never logged (NFR-P2) — only lengths/counts.
        results = engine.analyze(
            text=item.text, language=item.language, entities=entities, score_threshold=req.threshold
        )
        entity_types = {r.entity_type for r in results}
        operators = {e: OperatorConfig("replace", params={"new_value": f"[PII:{e}]"}) for e in entity_types}
        anon = anonymizer.anonymize(text=item.text, analyzer_results=results, operators=operators)
        counts: dict[str, int] = {}
        for r in results:
            counts[r.entity_type] = counts.get(r.entity_type, 0) + 1
        logger.info(
            "scanned id=%s hits=%d entities=%s",
            item.id,
            len(results),
            counts,  # counts only, never text
        )
        out.append(
            ScanResult(
                id=item.id,
                hits=[Hit(type=r.entity_type, start=r.start, end=r.end, score=r.score) for r in results],
                counts_by_type=counts,
                redacted_text=anon.text,
            )
        )
    return ScanResponse(results=out)
