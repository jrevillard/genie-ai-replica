# Copyright (c) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Language identification microservice using fastText.

Loads a fastText language-identification model (e.g., facebook/fasttext-language-identification)
from a mounted volume and exposes a /detect endpoint returning the top-k predicted languages.
"""

import logging
import os

import fasttext
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_PATH = os.getenv("LID_MODEL_PATH", "/models/lid.bin")
DEFAULT_TOPK = int(os.getenv("LID_DEFAULT_TOPK", "3"))

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("lid")

logger.info(f"Loading fastText model from {MODEL_PATH}")
model = fasttext.load_model(MODEL_PATH)
logger.info("Model loaded")

app = FastAPI(title="GENIE.AI Language Identification")


class DetectRequest(BaseModel):
    text: str = Field(..., min_length=1)
    k: int = Field(DEFAULT_TOPK, ge=1, le=10)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/detect")
def detect(req: DetectRequest):
    cleaned = req.text.replace("\n", " ").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="empty text")
    labels, scores = model.predict(cleaned, k=req.k)
    return {
        "input": req.text,
        "predictions": [
            {"label": lbl.replace("__label__", ""), "score": float(s)}
            for lbl, s in zip(labels, scores)
        ],
    }
