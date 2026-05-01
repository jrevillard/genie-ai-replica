"""Minimal NLLB-200 translation API (fallback for the ghcr prebuilt image).

Endpoints match the prebuilt image so the v4.2 client code works against
either container without changes:

    GET /api/v4/health
    GET /api/v4/translator?text=...&source=eng_Latn&target=bam_Latn
    GET /api/v4/languages

Single worker, single in-memory CTranslate2 instance. Keep it that way:
the model is ~1.5 GB and there is no benefit to multiple replicas in
the same container.
"""
from __future__ import annotations

import time
from typing import Optional

import ctranslate2
import transformers
from fastapi import FastAPI, Query

app = FastAPI(title="AMINA NLLB Translation API", version="v4.2")

_translator: Optional[ctranslate2.Translator] = None
_tokenizer = None


def _get_model():
    global _translator, _tokenizer
    if _translator is None:
        _translator = ctranslate2.Translator(
            "/app/model",
            device="cpu",          # GPU support: change to "cuda" + nvidia-runtime
            compute_type="int8",
        )
        _tokenizer = transformers.AutoTokenizer.from_pretrained(
            "facebook/nllb-200-distilled-600M",
            clean_up_tokenization_spaces=True,
        )
    return _translator, _tokenizer


@app.get("/api/v4/health")
def api_v4_health():
    return {"status": "ok", "model": "nllb-200-distilled-600M", "compute_type": "int8"}


# /health alias so old probes still pass.
@app.get("/health")
def health():
    return api_v4_health()


@app.get("/api/v4/translator")
def translate(
    text:   str = Query(..., min_length=1, max_length=2048),
    source: str = Query("eng_Latn"),
    target: str = Query("bam_Latn"),
):
    started = time.perf_counter()
    translator, tokenizer = _get_model()

    tokenizer.src_lang = source
    src_tokens = tokenizer.convert_ids_to_tokens(tokenizer.encode(text))
    results = translator.translate_batch(
        [src_tokens],
        target_prefix=[[target]],
        beam_size=5,
    )
    out_tokens = results[0].hypotheses[0][1:]  # strip the language tag
    out_text = tokenizer.decode(tokenizer.convert_tokens_to_ids(out_tokens))

    return {
        "text":         out_text,
        "source":       source,
        "target":       target,
        "latency_ms":   round((time.perf_counter() - started) * 1000, 1),
    }


@app.get("/api/v4/languages")
def languages():
    return {
        "supported": {
            "english":  "eng_Latn",
            "bambara":  "bam_Latn",
            "french":   "fra_Latn",
            "wolof":    "wol_Latn",
            "fula":     "ful_Latn",
        }
    }
