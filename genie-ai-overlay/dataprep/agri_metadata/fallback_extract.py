# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Regex / heuristic extraction when the LLM path fails."""

from __future__ import annotations

import re
from typing import Any

from agri_metadata.schema import AgricultureModel, LlmTaxonomyOutput, LocationModel, SecondaryRefModel

_LESOTHO = re.compile(r"\b(lesotho|mosotho|maseru)\b", re.I)
_RSA = re.compile(
    r"\b(south africa|republic of south africa|\bra\b|gauteng|kwazulu|limpopo|"
    r"mpumalanga|eastern cape|western cape|northern cape|free state|north west)\b",
    re.I,
)
# Generic Africa / other — mark secondary
_OTHER_COUNTRY = re.compile(
    r"\b(tanzania|uganda|zimbabwe|zambia|botswana|namibia|mozambique|malawi|ethiopia|nigeria)\b",
    re.I,
)
_MAIZE = re.compile(r"\b(corn|maize|mealies)\b", re.I)
_BEANS = re.compile(r"\b(yellow bean|dry beans|common bean|beans)\b", re.I)


def fallback_extract(text: str) -> LlmTaxonomyOutput:
    """Minimal heuristic structure to keep ingestion alive."""
    if not text or len(text.strip()) < 20:
        return LlmTaxonomyOutput(isRelevant=False, fieldConfidence={"fallback": 0.15})

    sample = text[:8000]
    countries: list[str] = []
    secondary: list[str] = []

    if _LESOTHO.search(sample):
        countries.append("Lesotho")
    if _RSA.search(sample):
        countries.append("South Africa")
    for m in _OTHER_COUNTRY.finditer(sample):
        c = m.group(1).title()
        if c not in secondary:
            secondary.append(c)

    crops: list[str] = []
    vars_: list[str] = []
    if _MAIZE.search(sample):
        crops.append("Maize")
    if _BEANS.search(sample):
        crops.append("Yellow Beans")
        vars_.append("Yellow Beans")

    is_relevant = bool(countries) or bool(crops) or "agriculture" in sample.lower() or "crop" in sample.lower()

    loc = LocationModel(Country=countries)
    agr = AgricultureModel(CropName=crops, Varietal=vars_)

    sec_model = SecondaryRefModel(countries=secondary) if secondary else None

    return LlmTaxonomyOutput(
        isRelevant=is_relevant,
        Location=loc,
        Agriculture=agr,
        secondaryReferences=sec_model,
        fieldConfidence={"fallback": 0.25},
    )
