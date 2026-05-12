# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Map free-text labels to canonical vocabulary entries."""

from __future__ import annotations

import re
from typing import Any

from agri_metadata.schema import LlmTaxonomyOutput, NormalizedTaxonomyPayload
from agri_metadata.vocabularies import (
    CLIMATE_SEED,
    COUNTRY_SYNONYMS,
    CROP_SYNONYMS,
    DOCUMENT_TYPE_SEED,
    FARMING_SYSTEM_SEED,
    IRRIGATION_TYPE_SEED,
    ORGANIC_STATUS_CANONICAL,
    PHRASE_SYNONYMS,
    PRIMARY_COUNTRIES_CANONICAL,
    REGION_SYNONYMS,
    merge_synonym_map,
)


def _norm_key(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def map_synonym(text: str, synonym_map: dict[str, str]) -> str:
    k = _norm_key(text)
    if k in synonym_map:
        return synonym_map[k]
    for sk, canonical in synonym_map.items():
        if len(sk) > 3 and (sk in k or k in sk):
            return canonical
    return text.strip()


def _canonical_in_set(value: str, allowed: frozenset[str]) -> str | None:
    for a in allowed:
        if a.lower() == value.lower():
            return a
    return None


def normalize_list(
    values: list[Any],
    synonym_map: dict[str, str],
    allowed: frozenset[str] | None,
) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        if not isinstance(v, str) or not v.strip():
            continue
        mapped = map_synonym(v, synonym_map)
        if allowed is not None:
            cn = _canonical_in_set(mapped, allowed)
            if cn:
                mapped = cn
            else:
                continue
        if mapped and mapped not in seen:
            seen.add(mapped)
            out.append(mapped)
    return out


def _split_primary_countries(countries: list[str]) -> tuple[list[str], list[str]]:
    syn = merge_synonym_map(COUNTRY_SYNONYMS)
    primary: list[str] = []
    secondary: list[str] = []
    for c in countries:
        if not isinstance(c, str):
            continue
        m = map_synonym(c, syn)
        if m in PRIMARY_COUNTRIES_CANONICAL:
            if m not in primary:
                primary.append(m)
        elif m:
            secondary.append(m)
    return primary, secondary


def normalize_llm_output(raw: LlmTaxonomyOutput) -> NormalizedTaxonomyPayload:
    """Apply controlled vocabulary and geographic policy to LLM / fallback output."""
    crop_syn = merge_synonym_map(CROP_SYNONYMS)
    phrase_syn = merge_synonym_map(PHRASE_SYNONYMS)
    region_syn = merge_synonym_map(REGION_SYNONYMS)

    loc = raw.Location.model_dump()
    env = raw.Environment.model_dump()
    agr = raw.Agriculture.model_dump()
    content = raw.Content.model_dump()
    risk = raw.Risk.model_dump()
    econ = raw.Economics.model_dump()
    gov = raw.Governance.model_dump()

    raw_countries = loc.get("Country") if isinstance(loc.get("Country"), list) else []
    primary, secondary_countries = _split_primary_countries([str(x) for x in raw_countries])
    loc["Country"] = primary
    loc["Region"] = normalize_list(loc.get("Region") or [], region_syn, None)
    loc["District"] = _title_case_list(loc.get("District") or [])
    loc["Village"] = _title_case_list(loc.get("Village") or [])
    loc["GeoScope"] = normalize_list(loc.get("GeoScope") or [], {}, None)

    agr["CropName"] = normalize_list(agr.get("CropName") or [], crop_syn, None)
    agr["Varietal"] = normalize_list(agr.get("Varietal") or [], crop_syn, None)
    agr["CropCategory"] = normalize_list(agr.get("CropCategory") or [], {}, None)
    agr["Livestock"] = normalize_list(agr.get("Livestock") or [], {}, None)
    agr["FarmingSystem"] = normalize_list(agr.get("FarmingSystem") or [], {}, FARMING_SYSTEM_SEED)
    agr["IrrigationType"] = normalize_list(agr.get("IrrigationType") or [], {}, IRRIGATION_TYPE_SEED)
    agr["Season"] = normalize_list(agr.get("Season") or [], {}, None)
    agr["ProductionScale"] = normalize_list(agr.get("ProductionScale") or [], {}, None)
    agr["OrganicStatus"] = normalize_list(agr.get("OrganicStatus") or [], {}, ORGANIC_STATUS_CANONICAL)

    env["Climate"] = normalize_list(env.get("Climate") or [], {}, CLIMATE_SEED)
    for k in ("RainfallPattern", "Altitude", "TemperatureRange", "Soil", "WaterAvailability", "AgroEcologicalZone"):
        env[k] = normalize_list(env.get(k) or [], {}, None)

    content["DocumentType"] = normalize_list(content.get("DocumentType") or [], {}, DOCUMENT_TYPE_SEED)
    for k in ("Topic", "SubTopic", "UseCase", "Audience", "Methodology"):
        content[k] = normalize_list(content.get(k) or [], {}, None)

    for rk in ("Pest", "Disease", "ClimateRisk", "SoilRisk"):
        risk[rk] = [
            map_synonym(x, phrase_syn)
            for x in (risk.get(rk) or [])
            if isinstance(x, str) and x.strip()
        ]

    for k in econ:
        econ[k] = normalize_list(econ.get(k) or [], {}, None)
    for k in gov:
        gov[k] = normalize_list(gov.get(k) or [], {}, None)

    secondary = {"countries": secondary_countries}
    if raw.secondaryReferences and raw.secondaryReferences.countries:
        extra = [str(c) for c in raw.secondaryReferences.countries if c]
        secondary["countries"] = list(dict.fromkeys(secondary["countries"] + extra))

    fc = raw.fieldConfidence or {}
    scores = list(fc.values()) if fc else []
    if scores:
        agg = float(sum(scores) / len(scores))
    else:
        agg = 0.55 if raw.isRelevant else 0.35

    return NormalizedTaxonomyPayload(
        taxonomyVersion="v1",
        isRelevant=raw.isRelevant,
        secondaryReferences=secondary,
        Location=loc,
        Environment=env,
        Agriculture=agr,
        Content=content,
        Risk=risk,
        Economics=econ,
        Governance=gov,
        metadataConfidenceScore=max(0.0, min(1.0, agg)),
        fieldConfidence=fc,
    )


def _title_case_list(items: list[Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for x in items:
        if not isinstance(x, str) or not x.strip():
            continue
        t = " ".join(w.capitalize() for w in x.strip().split())
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out
