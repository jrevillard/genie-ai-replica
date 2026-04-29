"""
Tier 2 — SDOH Intelligence Service
Gambia-specific Social Determinants of Health scoring:
  - AccessibilityScorer     : region → nearest health facility + travel time + seasonal penalty
  - SeasonalRiskAdjuster    : rainy season, Ramadan, farming calendar effects
  - LiteracyAdaptiveResponder: system-prompt modifier from caregiver specialization
  - FamilySupportMapper     : household support network inference
  - SDOHScore               : composite vulnerability dataclass
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

# ---------------------------------------------------------------------------
# Gambia Health Facility Table  (embedded, keyed by PatientVertex.region)
# Sources: MOH Gambia NCD Strategy 2018-2022, WHO SARA 2018
# Regions: Banjul, WCR (West Coast Region), NBR (North Bank Region),
#          LRR (Lower River Region), CRR (Central River Region),
#          URR (Upper River Region)
# ---------------------------------------------------------------------------
_FACILITY_MAP: dict[str, dict] = {
    "banjul": {
        "primary": "Royal Victoria Teaching Hospital",
        "secondary": "Banjul Health Centre",
        "type": "tertiary",
        "est_travel_min_dry": 10,
        "est_travel_min_rain": 20,
        "chw_ratio": 1 / 800,      # CHWs per population
        "road_paved_pct": 0.95,
        "electricity_pct": 0.92,
        "water_access_pct": 0.88,
        "lat": 13.4531,
        "lon": -16.5775,
    },
    "wcr": {
        "primary": "Brikama Major Health Centre",
        "secondary": "Sukuta Health Centre",
        "type": "major_hc",
        "est_travel_min_dry": 35,
        "est_travel_min_rain": 65,
        "chw_ratio": 1 / 1200,
        "road_paved_pct": 0.70,
        "electricity_pct": 0.75,
        "water_access_pct": 0.72,
        "lat": 13.2762,
        "lon": -16.6522,
    },
    "nbr": {
        "primary": "Farafenni Regional Health Centre",
        "secondary": "Kerewan Health Centre",
        "type": "regional_hc",
        "est_travel_min_dry": 55,
        "est_travel_min_rain": 90,
        "chw_ratio": 1 / 1500,
        "road_paved_pct": 0.55,
        "electricity_pct": 0.55,
        "water_access_pct": 0.60,
        "lat": 13.5677,
        "lon": -15.5996,
    },
    "lrr": {
        "primary": "Mansa Konko Health Centre",
        "secondary": "Soma Health Centre",
        "type": "regional_hc",
        "est_travel_min_dry": 70,
        "est_travel_min_rain": 120,
        "chw_ratio": 1 / 1800,
        "road_paved_pct": 0.40,
        "electricity_pct": 0.45,
        "water_access_pct": 0.55,
        "lat": 13.4667,
        "lon": -15.5333,
    },
    "crr": {
        "primary": "Bansang District Hospital",
        "secondary": "Janjanbureh Health Centre",
        "type": "district_hospital",
        "est_travel_min_dry": 90,
        "est_travel_min_rain": 150,
        "chw_ratio": 1 / 2000,
        "road_paved_pct": 0.35,
        "electricity_pct": 0.40,
        "water_access_pct": 0.50,
        "lat": 13.4167,
        "lon": -14.6500,
    },
    "urr": {
        "primary": "Basse District Hospital",
        "secondary": "Gambissara Health Centre",
        "type": "district_hospital",
        "est_travel_min_dry": 120,
        "est_travel_min_rain": 200,
        "chw_ratio": 1 / 2200,
        "road_paved_pct": 0.25,
        "electricity_pct": 0.30,
        "water_access_pct": 0.42,
        "lat": 13.3167,
        "lon": -14.2167,
    },
}

# Fallback for unknown regions
_DEFAULT_FACILITY = _FACILITY_MAP["wcr"]

# ---------------------------------------------------------------------------
# Seasonal calendar constants
# ---------------------------------------------------------------------------
# Rainy season: June 1 – October 31 (months 6-10)
_RAINY_SEASON_MONTHS = {6, 7, 8, 9, 10}

# Ramadan 2026: March 1 – March 30 (approximate; moon-sighting dependent)
_RAMADAN_2026_START = date(2026, 3, 1)
_RAMADAN_2026_END   = date(2026, 3, 30)

# Harvest season: November – January (impacts rural food security)
_HARVEST_MONTHS = {11, 12, 1}

# Lean / hunger season: June – September (crops not yet in)
_LEAN_MONTHS = {6, 7, 8, 9}

# ---------------------------------------------------------------------------
# Caregiver specialization → literacy / complexity proxy
# ---------------------------------------------------------------------------
_SPECIALIZATION_LITERACY: dict[str, str] = {
    "doctor": "professional",
    "physician": "professional",
    "nurse": "clinical",
    "midwife": "clinical",
    "nurse_practitioner": "clinical",
    "chw": "community",
    "community_health_worker": "community",
    "village_health_worker": "community",
    "volunteer": "community",
    "family": "lay",
    "caregiver": "lay",
    "relative": "lay",
    "": "lay",
}

_LITERACY_PROMPTS: dict[str, str] = {
    "professional": (
        "Use clinical terminology and ICD-10 language. "
        "Include quantitative risk metrics. "
        "Reference WHO/ADA/JNC8 guidelines by name."
    ),
    "clinical": (
        "Use clear nursing-level language. "
        "Avoid heavy medical jargon; define acronyms on first use. "
        "Highlight actionable steps and red-flag signs."
    ),
    "community": (
        "Use simple, plain language. Avoid medical jargon entirely. "
        "Focus on practical actions the CHW can take today. "
        "Use bullet points and short sentences."
    ),
    "lay": (
        "Use the simplest everyday language. "
        "Give very specific, step-by-step instructions. "
        "Avoid numbers or percentages; use plain comparisons instead."
    ),
}

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class AccessibilityProfile:
    region: str
    nearest_facility: str
    facility_type: str
    travel_minutes_dry: int
    travel_minutes_current: int   # adjusted for current season
    is_rainy_season: bool
    road_paved_pct: float
    electricity_pct: float
    water_access_pct: float
    access_score: float            # 0-1, higher = better access
    access_label: str              # "good" / "moderate" / "poor" / "critical"


@dataclass
class SeasonalContext:
    current_date: str
    is_rainy_season: bool
    is_ramadan: bool
    is_lean_season: bool
    is_harvest_season: bool
    active_risks: list[str]        # human-readable risk labels
    seasonal_modifier: float       # 1.0 baseline, >1.0 = higher vulnerability


@dataclass
class LiteracyProfile:
    caregiver_specialization: str
    literacy_level: str            # professional / clinical / community / lay
    system_prompt_modifier: str    # prepended to AMINA system prompt
    simplify_numbers: bool
    use_analogies: bool


@dataclass
class FamilySupportProfile:
    household_size: int            # inferred from patient data
    has_primary_caregiver: bool
    support_level: str             # "strong" / "moderate" / "limited" / "isolated"
    support_score: float           # 0-1, higher = more support
    notes: list[str]


@dataclass
class SDOHScore:
    patient_id: str
    computed_at: str
    # Sub-scores (0-1 each, higher = more vulnerable)
    access_vulnerability: float
    seasonal_vulnerability: float
    social_vulnerability: float
    overall_sdoh_score: float      # weighted composite 0-1
    sdoh_label: str                # "low" / "moderate" / "high" / "critical"
    # Profiles
    accessibility: AccessibilityProfile
    seasonal: SeasonalContext
    literacy: LiteracyProfile
    family_support: FamilySupportProfile
    # Actionable outputs
    escalation_pathway: str        # which facility to route to
    sdoh_flags: list[str]          # specific concerns
    sdoh_recommendations: list[str]


# ---------------------------------------------------------------------------
# AccessibilityScorer
# ---------------------------------------------------------------------------

class AccessibilityScorer:
    """Scores geographic/infrastructure access based on patient region."""

    def score(self, region: str, today: date | None = None) -> AccessibilityProfile:
        today = today or date.today()
        region_key = (region or "").lower().strip()

        # Normalise common spellings
        _aliases = {
            "west coast": "wcr", "west coast region": "wcr",
            "north bank": "nbr", "north bank region": "nbr",
            "lower river": "lrr", "lower river region": "lrr",
            "central river": "crr", "central river region": "crr",
            "upper river": "urr", "upper river region": "urr",
        }
        region_key = _aliases.get(region_key, region_key)
        fac = _FACILITY_MAP.get(region_key, _DEFAULT_FACILITY)

        is_rainy = today.month in _RAINY_SEASON_MONTHS
        travel_now = fac["est_travel_min_rain"] if is_rainy else fac["est_travel_min_dry"]

        # Access score: weighted average of infrastructure indicators
        # Travel penalty: 10min=1.0, 30min=0.85, 60min=0.65, 120min=0.40, 200min=0.15
        travel_score = max(0.0, 1.0 - (travel_now - 10) / 200)
        infra_score = (fac["road_paved_pct"] + fac["electricity_pct"] + fac["water_access_pct"]) / 3
        access_score = round(0.5 * travel_score + 0.5 * infra_score, 3)

        if access_score >= 0.75:
            label = "good"
        elif access_score >= 0.55:
            label = "moderate"
        elif access_score >= 0.35:
            label = "poor"
        else:
            label = "critical"

        return AccessibilityProfile(
            region=region or "unknown",
            nearest_facility=fac["primary"],
            facility_type=fac["type"],
            travel_minutes_dry=fac["est_travel_min_dry"],
            travel_minutes_current=travel_now,
            is_rainy_season=is_rainy,
            road_paved_pct=fac["road_paved_pct"],
            electricity_pct=fac["electricity_pct"],
            water_access_pct=fac["water_access_pct"],
            access_score=access_score,
            access_label=label,
        )


# ---------------------------------------------------------------------------
# SeasonalRiskAdjuster
# ---------------------------------------------------------------------------

class SeasonalRiskAdjuster:
    """Identifies active seasonal risk windows and computes a vulnerability modifier."""

    def assess(self, today: date | None = None) -> SeasonalContext:
        today = today or date.today()
        m = today.month

        is_rainy    = m in _RAINY_SEASON_MONTHS
        is_lean     = m in _LEAN_MONTHS
        is_harvest  = m in _HARVEST_MONTHS
        is_ramadan  = _RAMADAN_2026_START <= today <= _RAMADAN_2026_END

        active_risks: list[str] = []
        modifier = 1.0

        if is_rainy:
            active_risks.append("Rainy season — road access degraded, malaria risk elevated")
            modifier += 0.20
        if is_lean:
            active_risks.append("Lean season — food insecurity, risk of hypoglycaemia in diabetic patients")
            modifier += 0.15
        if is_ramadan:
            active_risks.append("Ramadan — fasting may affect medication timing and glucose control")
            modifier += 0.10
        if is_harvest:
            active_risks.append("Harvest season — increased physical activity, potential missed clinic visits")
            modifier += 0.05

        # Cap modifier at 1.5
        modifier = min(1.5, round(modifier, 2))

        return SeasonalContext(
            current_date=today.isoformat(),
            is_rainy_season=is_rainy,
            is_ramadan=is_ramadan,
            is_lean_season=is_lean,
            is_harvest_season=is_harvest,
            active_risks=active_risks,
            seasonal_modifier=modifier,
        )


# ---------------------------------------------------------------------------
# LiteracyAdaptiveResponder
# ---------------------------------------------------------------------------

class LiteracyAdaptiveResponder:
    """Derives communication complexity level from caregiver specialization."""

    def profile(self, caregiver_data: dict | None) -> LiteracyProfile:
        caregiver_data = caregiver_data or {}
        spec = str(caregiver_data.get("specialization", "")).lower().strip()

        # Try direct match, then partial match
        level = _SPECIALIZATION_LITERACY.get(spec)
        if level is None:
            for key, val in _SPECIALIZATION_LITERACY.items():
                if key and key in spec:
                    level = val
                    break
            else:
                level = "lay"

        return LiteracyProfile(
            caregiver_specialization=spec or "unspecified",
            literacy_level=level,
            system_prompt_modifier=_LITERACY_PROMPTS[level],
            simplify_numbers=(level in ("community", "lay")),
            use_analogies=(level == "lay"),
        )


# ---------------------------------------------------------------------------
# FamilySupportMapper
# ---------------------------------------------------------------------------

class FamilySupportMapper:
    """Infers family/social support from available patient profile fields."""

    def map_support(self, patient_data: dict | None) -> FamilySupportProfile:
        patient_data = patient_data or {}

        # Infer household size from profile fields (none guaranteed)
        household_size: int = int(patient_data.get("household_size", 0))
        contact_name:   str = str(patient_data.get("emergency_contact", "")).strip()
        has_caregiver:  bool = bool(patient_data.get("primary_caregiver") or contact_name)

        notes: list[str] = []

        if household_size == 0:
            # Unknown household — assume average Gambian household 8.3 persons (GBoS 2019)
            household_size = 8
            notes.append("Household size not recorded; assumed average (8 persons, GBoS 2019)")

        # Simple heuristic support scoring
        support_score = 0.5  # baseline unknown
        if has_caregiver:
            support_score += 0.25
            notes.append(f"Emergency contact/primary caregiver recorded: {contact_name or 'yes'}")
        if household_size >= 4:
            support_score += 0.15
        elif household_size <= 1:
            support_score -= 0.25
            notes.append("Possible social isolation — single-person household")

        support_score = max(0.0, min(1.0, round(support_score, 2)))

        if support_score >= 0.75:
            level = "strong"
        elif support_score >= 0.55:
            level = "moderate"
        elif support_score >= 0.35:
            level = "limited"
        else:
            level = "isolated"

        return FamilySupportProfile(
            household_size=household_size,
            has_primary_caregiver=has_caregiver,
            support_level=level,
            support_score=support_score,
            notes=notes,
        )


# ---------------------------------------------------------------------------
# Master SDOH scorer
# ---------------------------------------------------------------------------

_accessibility_scorer = AccessibilityScorer()
_seasonal_adjuster    = SeasonalRiskAdjuster()
_literacy_responder   = LiteracyAdaptiveResponder()
_support_mapper       = FamilySupportMapper()


def get_sdoh_score(
    patient_id: str,
    patient_data: dict,
    caregiver_data: dict | None = None,
    today: date | None = None,
) -> SDOHScore:
    """
    Compute a composite SDOH vulnerability score for a patient.

    Parameters
    ----------
    patient_id   : str
    patient_data : PatientVertex dict (expects .region, optionally .household_size, etc.)
    caregiver_data : CaregiverVertex dict (expects .specialization)
    today        : date override for testing

    Returns
    -------
    SDOHScore dataclass
    """
    today = today or date.today()
    region = str(patient_data.get("region", "")).strip()

    # --- Sub-scorers --------------------------------------------------------
    accessibility = _accessibility_scorer.score(region, today)
    seasonal      = _seasonal_adjuster.assess(today)
    literacy      = _literacy_responder.profile(caregiver_data)
    family        = _support_mapper.map_support(patient_data)

    # --- Vulnerability sub-scores (0-1, higher = more vulnerable) ----------
    access_vuln    = round(1.0 - accessibility.access_score, 3)
    seasonal_vuln  = round((seasonal.seasonal_modifier - 1.0) / 0.5, 3)   # 0-1 scale
    social_vuln    = round(1.0 - family.support_score, 3)

    # Weighted composite
    overall = round(
        0.45 * access_vuln +
        0.30 * seasonal_vuln +
        0.25 * social_vuln,
        3
    )

    if overall >= 0.65:
        label = "critical"
    elif overall >= 0.45:
        label = "high"
    elif overall >= 0.25:
        label = "moderate"
    else:
        label = "low"

    # --- Escalation pathway ------------------------------------------------
    # Adjust referral target based on access + seasonal context
    if accessibility.access_label in ("poor", "critical"):
        pathway = (
            f"Refer to nearest CHW first; transport to {accessibility.nearest_facility} "
            f"may require {accessibility.travel_minutes_current} min travel. "
            "Arrange transport ahead of any planned referral."
        )
    else:
        pathway = (
            f"Refer to {accessibility.nearest_facility} "
            f"({accessibility.travel_minutes_current} min)."
        )

    if seasonal.is_rainy_season:
        pathway += " Note: rainy season — road conditions may delay transfer."

    # --- Flags --------------------------------------------------------------
    flags: list[str] = []
    if access_vuln >= 0.55:
        flags.append(f"Poor facility access ({accessibility.access_label}) — region: {region or 'unknown'}")
    if seasonal.is_rainy_season:
        flags.append("Rainy season active — transport and malaria risk elevated")
    if seasonal.is_lean_season:
        flags.append("Lean season — monitor for hypoglycaemia and food insecurity")
    if seasonal.is_ramadan:
        flags.append("Ramadan fasting — review medication timing with patient")
    if family.support_level in ("limited", "isolated"):
        flags.append(f"Limited social support ({family.support_level}) — increased CHW monitoring needed")

    # --- Recommendations ----------------------------------------------------
    recs: list[str] = []
    if seasonal.is_ramadan:
        recs.append("Counsel patient on safe Ramadan fasting practices for their condition")
        recs.append("Review medication schedule: pre-dawn (Suhoor) and post-dusk (Iftar) dosing")
    if seasonal.is_lean_season:
        recs.append("Assess food security; consider community nutrition programme referral")
    if accessibility.access_label in ("poor", "critical"):
        recs.append("Conduct home visit rather than expecting patient to travel to facility")
        recs.append("Ensure CHW has adequate supply of essential medications for remote dispensing")
    if family.support_level in ("limited", "isolated"):
        recs.append("Enrol patient in community support group or assign buddy caregiver")
    if not recs:
        recs.append("Continue standard monitoring; SDOH risk is low at this time")

    return SDOHScore(
        patient_id=patient_id,
        computed_at=datetime.utcnow().isoformat() + "Z",
        access_vulnerability=access_vuln,
        seasonal_vulnerability=seasonal_vuln,
        social_vulnerability=social_vuln,
        overall_sdoh_score=overall,
        sdoh_label=label,
        accessibility=accessibility,
        seasonal=seasonal,
        literacy=literacy,
        family_support=family,
        escalation_pathway=pathway,
        sdoh_flags=flags,
        sdoh_recommendations=recs,
    )
