"""NLLB-200 GPU translation sidecar (DEC-25, F6).

facebook/nllb-200-3.3B bf16 on CUDA. NLLB is an encoder-decoder translation
model: target language is selected via the tokenizer's FLORES-200 codes
(src_lang / forced_bos_token_id), which is exactly why it cannot ride the
OpenAI-compatible vLLM API. Consumers: chatqna (_translate_text_chunk) and the
backend GpuTranslateBackend — both POST {texts, source, target} in FLORES codes
and read {"translations": [...]} back, one entry per input (empty in → empty out).
"""

import logging
import os
import threading

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

MODEL_ID = os.getenv("NLLB_MODEL_ID", "facebook/nllb-200-3.3B")
MAX_TEXT_CHARS = int(os.getenv("MAX_TEXT_CHARS", "4000"))
# Upper bound on a parked /translate during the cold load (health-gated callers
# should never sit here this long; bounded so requests can't pin the pool).
LOAD_WAIT_TIMEOUT = int(os.getenv("LOAD_WAIT_TIMEOUT", "600"))

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("nllb-translate")

app = FastAPI()

_state = {"ready": threading.Event(), "error": None, "model": None, "tokenizer": None}


def _load_model():
    try:
        # CUDA check BEFORE the ~6.6 GB download — a CPU-only scheduling mistake
        # (missing gpu-models profile / device env) must fail in seconds, not gigs.
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable — this sidecar requires the gpu-models profile")
        log.info(f"Loading {MODEL_ID} (bf16, cuda) — first boot also downloads ~6.6 GB")
        tok = AutoTokenizer.from_pretrained(MODEL_ID)
        model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
        model.to("cuda")
        model.eval()
        _state["tokenizer"], _state["model"] = tok, model
        _state["ready"].set()
        log.info("Model ready")
    except Exception as e:  # noqa: BLE001 — record, wake parked waits, then die loudly
        _state["error"] = str(e)
        _state["ready"].set()
        # Terminal by design: a 503-forever app would hide the failure from the
        # restart policy. Exiting lets compose restart (backoff) retry the load.
        log.error(f"Model load failed: {e} — exiting for a container-restart retry")
        os._exit(1)


threading.Thread(target=_load_model, daemon=True).start()


class TranslateRequest(BaseModel):
    # 64 texts max: the batch shares one beam-4 generate() on the GPU — an
    # unbounded document batch can OOM the card it shares with vLLM/TEI.
    texts: list[str] = Field(min_length=1, max_length=64)
    source: str
    target: str


def _flores_token_id(tok, code):
    token_id = tok.convert_tokens_to_ids(code)
    if not token_id or token_id == tok.unk_token_id:
        raise HTTPException(status_code=400, detail=f"unknown FLORES-200 code: {code}")
    return token_id


@app.get("/health")
def health():
    if not _state["ready"].is_set():
        raise HTTPException(status_code=503, detail="model loading")
    if _state["error"]:
        raise HTTPException(status_code=503, detail=f"model load failed: {_state['error']}")
    return {"status": "ok", "model": MODEL_ID, "device": "cuda"}


@app.post("/translate")
def translate(req: TranslateRequest):
    # Bounded wait: 503 (not an unbounded park) if the cold load outlasts it;
    # re-check error AFTER the wait so a load that failed mid-wait reports the
    # failure instead of dereferencing a None model.
    if not _state["ready"].wait(LOAD_WAIT_TIMEOUT):
        raise HTTPException(status_code=503, detail="model still loading")
    if _state["error"]:
        raise HTTPException(status_code=503, detail=f"model load failed: {_state['error']}")
    tok, model = _state["tokenizer"], _state["model"]

    for text in req.texts:
        if len(text) > MAX_TEXT_CHARS:
            raise HTTPException(status_code=400, detail=f"text exceeds {MAX_TEXT_CHARS} chars")

    _flores_token_id(tok, req.source)  # validate both codes up front → 400, not a 500 mid-generate
    keep = [i for i, t in enumerate(req.texts) if t.strip()]
    out = [""] * len(req.texts)
    if keep:
        batch = [req.texts[i] for i in keep]
        inputs = tok(batch, return_tensors="pt", padding=True, truncation=True, src_lang=req.source).to("cuda")
        with torch.no_grad():
            generated = model.generate(
                **inputs,
                forced_bos_token_id=_flores_token_id(tok, req.target),
                num_beams=4,
                max_new_tokens=1024,
            )
        # strict: a decode-count divergence must blow up, not silently emit
        # empty strings against the order/count contract the backend pins.
        for slot, text in zip(keep, tok.batch_decode(generated, skip_special_tokens=True), strict=True):
            out[slot] = text.strip()
    return {"translations": out}
