# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Controlled vocabulary seeds and synonym maps (Lesotho + South Africa focus)."""

# Primary geography — extraction must prioritize these; others → secondaryReferences
PRIMARY_COUNTRIES_CANONICAL: tuple[str, ...] = ("Lesotho", "South Africa")

# Canonical country synonyms (lowercase key → canonical)
COUNTRY_SYNONYMS: dict[str, str] = {
    "lesotho": "Lesotho",
    "kingdom of lesotho": "Lesotho",
    "south africa": "South Africa",
    "republic of south africa": "South Africa",
    "sa": "South Africa",
    "rsa": "South Africa",
    "za": "South Africa",
}

# Regional / macro labels (Southern Africa is common in development docs)
REGION_SYNONYMS: dict[str, str] = {
    "southern africa": "Southern Africa",
    "southern african": "Southern Africa",
    "sadc region": "SADC Region",
    "sadc": "SADC Region",
}

# Crop / product synonyms (user examples)
CROP_SYNONYMS: dict[str, str] = {
    "corn": "Maize",
    "maize": "Maize",
    "mealies": "Maize",
    "yellow bean": "Yellow Beans",
    "yellow beans": "Yellow Beans",
    "dry beans": "Dry Beans",
    "sorghum": "Sorghum",
    "wheat": "Wheat",
    "barley": "Barley",
    "potato": "Potatoes",
    "potatoes": "Potatoes",
    "tomato": "Tomatoes",
    "tomatoes": "Tomatoes",
    "cabbage": "Cabbage",
    "spinach": "Spinach",
    "onion": "Onions",
    "onions": "Onions",
}

# Content / risk normalized phrases
PHRASE_SYNONYMS: dict[str, str] = {
    "pest infestation": "Pest Control",
    "pests": "Pest Control",
    "pest pressure": "Pest Control",
    "drought risk": "Climate Risk — Drought",
    " soil erosion": "Soil Risk — Erosion",
    "soil erosion": "Soil Risk — Erosion",
}

# Organic / production enumerations
ORGANIC_STATUS_CANONICAL: frozenset[str] = frozenset(
    {
        "Certified Organic",
        "Organic-in-conversion",
        "Conventional",
        "Unspecified",
    }
)

DOCUMENT_TYPE_SEED: frozenset[str] = frozenset(
    {
        "Policy",
        "Guideline",
        "Research Report",
        "Extension Brief",
        "Training Manual",
        "Market Study",
        "Survey",
        "Project Report",
        "Factsheet",
        "Meeting Minutes",
        "Other",
    }
)

CLIMATE_SEED: frozenset[str] = frozenset(
    {
        "Temperate Highland",
        "Subtropical",
        "Semi-arid",
        "Arid",
        "Mediterranean",
        "Humid Subtropical",
    }
)

IRRIGATION_TYPE_SEED: frozenset[str] = frozenset(
    {
        "Rainfed",
        "Furrow",
        "Drip",
        "Sprinkler",
        "Centre Pivot",
        "Spate",
        "Mixed",
        "Unspecified",
    }
)

FARMING_SYSTEM_SEED: frozenset[str] = frozenset(
    {
        "Smallholder",
        "Commercial",
        "Subsistence",
        "Mixed Farming",
        "Agropastoral",
        "Pastoral",
    }
)


def merge_synonym_map(*maps: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in maps:
        for k, v in m.items():
            out[k.strip().lower()] = v
    return out
