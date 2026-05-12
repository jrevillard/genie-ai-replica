# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Pydantic schema for agricultural taxonomy metadata (v1)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

TaxonomyVersion = "v1"


class LocationModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Country: list[str] = Field(default_factory=list)
    Region: list[str] = Field(default_factory=list)
    District: list[str] = Field(default_factory=list)
    Village: list[str] = Field(default_factory=list)
    GeoScope: list[str] = Field(default_factory=list)


class EnvironmentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Climate: list[str] = Field(default_factory=list)
    RainfallPattern: list[str] = Field(default_factory=list)
    Altitude: list[str] = Field(default_factory=list)
    TemperatureRange: list[str] = Field(default_factory=list)
    Soil: list[str] = Field(default_factory=list)
    WaterAvailability: list[str] = Field(default_factory=list)
    AgroEcologicalZone: list[str] = Field(default_factory=list)


class AgricultureModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    CropCategory: list[str] = Field(default_factory=list)
    CropName: list[str] = Field(default_factory=list)
    Varietal: list[str] = Field(default_factory=list)
    Livestock: list[str] = Field(default_factory=list)
    FarmingSystem: list[str] = Field(default_factory=list)
    IrrigationType: list[str] = Field(default_factory=list)
    Season: list[str] = Field(default_factory=list)
    ProductionScale: list[str] = Field(default_factory=list)
    OrganicStatus: list[str] = Field(default_factory=list)


class ContentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Topic: list[str] = Field(default_factory=list)
    SubTopic: list[str] = Field(default_factory=list)
    DocumentType: list[str] = Field(default_factory=list)
    UseCase: list[str] = Field(default_factory=list)
    Audience: list[str] = Field(default_factory=list)
    Methodology: list[str] = Field(default_factory=list)


class RiskModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Pest: list[str] = Field(default_factory=list)
    Disease: list[str] = Field(default_factory=list)
    ClimateRisk: list[str] = Field(default_factory=list)
    SoilRisk: list[str] = Field(default_factory=list)


class EconomicsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    MarketFocus: list[str] = Field(default_factory=list)
    ValueChainStage: list[str] = Field(default_factory=list)
    FinancialTopic: list[str] = Field(default_factory=list)


class GovernanceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    PolicyMentioned: list[str] = Field(default_factory=list)
    NGOs: list[str] = Field(default_factory=list)
    GovernmentBodies: list[str] = Field(default_factory=list)
    Programs: list[str] = Field(default_factory=list)


class SecondaryRefModel(BaseModel):
    """Countries/regions mentioned but outside Lesotho / South Africa focus."""

    model_config = ConfigDict(extra="forbid")

    countries: list[str] = Field(default_factory=list)


class LlmTaxonomyOutput(BaseModel):
    """
    Raw LLM output before vocabulary normalization.
    All list fields use controlled labels only (validated after merge).
    """

    model_config = ConfigDict(extra="forbid")

    isRelevant: bool = True
    secondaryReferences: SecondaryRefModel | None = None
    Location: LocationModel = Field(default_factory=LocationModel)
    Environment: EnvironmentModel = Field(default_factory=EnvironmentModel)
    Agriculture: AgricultureModel = Field(default_factory=AgricultureModel)
    Content: ContentModel = Field(default_factory=ContentModel)
    Risk: RiskModel = Field(default_factory=RiskModel)
    Economics: EconomicsModel = Field(default_factory=EconomicsModel)
    Governance: GovernanceModel = Field(default_factory=GovernanceModel)
    fieldConfidence: dict[str, float] = Field(
        default_factory=dict,
        description="Optional per-field confidence scores in [0,1]",
    )


class NormalizedTaxonomyPayload(BaseModel):
    """Final stored payload after vocabulary mapping and validation."""

    model_config = ConfigDict(extra="forbid")

    taxonomyVersion: str = "v1"
    isRelevant: bool = True
    secondaryReferences: dict[str, Any] = Field(default_factory=dict)
    Location: dict[str, list[str]] = Field(default_factory=dict)
    Environment: dict[str, list[str]] = Field(default_factory=dict)
    Agriculture: dict[str, list[str]] = Field(default_factory=dict)
    Content: dict[str, list[str]] = Field(default_factory=dict)
    Risk: dict[str, list[str]] = Field(default_factory=dict)
    Economics: dict[str, list[str]] = Field(default_factory=dict)
    Governance: dict[str, list[str]] = Field(default_factory=dict)
    metadataConfidenceScore: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Aggregate confidence for the document-level extraction"
    )
    fieldConfidence: dict[str, float] = Field(default_factory=dict)

    @field_validator(
        "Location",
        "Environment",
        "Agriculture",
        "Content",
        "Risk",
        "Economics",
        "Governance",
        mode="before",
    )
    @classmethod
    def _ensure_dict(cls, v: Any) -> dict[str, list[str]]:
        if v is None:
            return {}
        if isinstance(v, dict):
            return {k: list(x) if isinstance(x, (list, tuple)) else [] for k, x in v.items()}
        return {}


def taxonomy_to_chunk_flat(tax: NormalizedTaxonomyPayload) -> dict[str, Any]:
    """Denormalized fields for ArangoDB filtering on SOURCE documents."""
    loc = tax.Location or {}
    ag = tax.Agriculture or {}
    cnt = tax.Content or {}
    env = tax.Environment or {}
    return {
        "tax_version": tax.taxonomyVersion,
        "tax_is_relevant": tax.isRelevant,
        "tax_countries": loc.get("Country") or [],
        "tax_crop_names": ag.get("CropName") or [],
        "tax_varietals": ag.get("Varietal") or [],
        "tax_topics": cnt.get("Topic") or [],
        "tax_subtopics": cnt.get("SubTopic") or [],
        "tax_climates": env.get("Climate") or [],
        "tax_document_types": cnt.get("DocumentType") or [],
        "tax_regions": loc.get("Region") or [],
        "taxonomy_metadata": tax.model_dump(),
    }
