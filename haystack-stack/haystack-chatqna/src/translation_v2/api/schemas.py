"""Pydantic request/response models for the v2 translation endpoints."""
from __future__ import annotations

from pydantic import BaseModel, Field


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=0, max_length=20000)
    source: str = Field("en", min_length=2, max_length=10)
    target: str = Field("ma", min_length=2, max_length=10)


class TranslateResponse(BaseModel):
    translated: str
    source: str
    target: str
    provider: str | None = None


class HealthResponse(BaseModel):
    pipeline_active: bool
    primary_provider: str
    fallback_provider: str | None
    local_provider: str | None
    flags: dict
    available_providers: list[str]
