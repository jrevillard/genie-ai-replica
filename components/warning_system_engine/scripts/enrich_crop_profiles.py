"""
enrich_crop_profiles.py
=======================
Reads bamis_metadata.json and vector_ready_chunks.jsonl, then generates (or
overwrites) example_crop_profile.json with a rich profile for every
crop × region combination found in the source data.

Usage:
    python3 scripts/enrich_crop_profiles.py
    python3 scripts/enrich_crop_profiles.py --crop potato --region dhaka
    python3 scripts/enrich_crop_profiles.py --output /path/to/output.json

Output keys: "{crop}_{region}" e.g. "potato_dhaka", "tomato_bogura", ...

Schema per key:
  crop, region, crop_display_name
  season_span          — derived from observed weeks/months
  growth_stages        — per-stage climate stats (mean/min/max/sum/stdev)
  weekly_calendar      — one entry per week with stage mapping & raw values
  derived_thresholds   — season-level min/max/mean for each variable
  crop_rules           — alert thresholds derived from observed data
  disease_risks        — from advisory Pest/Disease records + known disease map
  weather_warnings     — from advisory Weather Warning records
  pest_disease_advisories — all raw advisory texts for this crop × region
  risk_by_stage        — which weeks exceed crop_rules thresholds
  source_chunks        — chunk IDs referencing vector_ready_chunks.jsonl
"""
import argparse
import json
import math
import re
import statistics
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (relative to the warning_system_engine directory)
# ---------------------------------------------------------------------------
_HERE = Path(__file__).parent.parent
_BAMIS_META = _HERE / "data" / "bamis_metadata.json"
_CHUNKS_FILE = _HERE / "data" / "vector_ready_chunks.jsonl"
_OUTPUT_FILE = _HERE / "data" / "example_crop_profile.json"

# ---------------------------------------------------------------------------
# Week/month ordering helpers
# ---------------------------------------------------------------------------
_MONTH_ORDER = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
}


def _week_sort_key(week: int) -> int:
    """
    Sort weeks so that seasons spanning year-end are ordered correctly.
    Weeks 1-26 → 53-78 (treated as "next year"), 27-52 → 27-52.
    This keeps Oct-Nov-Dec-Jan-Feb sorted naturally.
    """
    return week if week >= 27 else week + 52


# ---------------------------------------------------------------------------
# Stage name normalisation
# ---------------------------------------------------------------------------
_STAGE_ALIASES: dict[str, str] = {
    # Typos / variant spellings found in the raw data
    "spouting":                        "Sprouting",
    "harve sting":                     "Harvesting",
    "harves ting":                     "Harvesting",
    "harvetsing":                      "Harvesting",
    "vegetative growth":               "Vegetative Growth",
    "tuber bulking/ development":      "Tuber Bulking/Development",
    "tuber bulking/development":       "Tuber Bulking/Development",
    "tuber set/ initiation":           "Tuber Set/Initiation",
    "tuber set/initiation":            "Tuber Set/Initiation",
    "flowering and fruting":           "Flowering & Fruiting",
    "flowering& fruiting":             "Flowering & Fruiting",
    "germination and seedling planting": "Germination & Seedling",
    "spouting & seedling":             "Sprouting & Seedling",
}


def _normalise_stage(raw: str) -> str:
    low = raw.strip().lower()
    return _STAGE_ALIASES.get(low, raw.strip().title())


# ---------------------------------------------------------------------------
# Per-variable statistics
# ---------------------------------------------------------------------------

def _stats(values: list) -> dict:
    values = [v for v in values if v is not None]
    if not values:
        return {}
    n = len(values)
    mn = min(values)
    mx = max(values)
    total = sum(values)
    mean = round(total / n, 2)
    result = {
        "mean": mean,
        "min":  round(mn, 2),
        "max":  round(mx, 2),
        "sum":  round(total, 2),
    }
    if n > 1:
        result["stdev"] = round(statistics.stdev(values), 2)
    return result


# ---------------------------------------------------------------------------
# Disease knowledge map
# Maps advisory name (lower-cased) → quantitative weather trigger conditions.
# Used when the advisory records have no embedded thresholds.
# ---------------------------------------------------------------------------
_DISEASE_CONDITIONS: dict[str, dict] = {
    "late blight": {
        "when": {
            "temperature_mean": {"min": 14, "max": 20},
            "humidity": {"min": 90},
            "precipitation": {"min": 1},
        },
    },
    "early blight": {
        "when": {
            "temperature_mean": {"min": 24, "max": 30},
            "humidity": {"min": 75},
        },
    },
    "blight disease": {
        "when": {
            "humidity": {"min": 85},
            "temperature_mean": {"min": 14, "max": 25},
        },
    },
    "bacterial leaf blight": {
        "when": {
            "temperature_mean": {"min": 25, "max": 30},
            "humidity": {"min": 85},
        },
    },
    "bacterial leaf blight (blb)": {
        "when": {
            "temperature_mean": {"min": 25, "max": 30},
            "humidity": {"min": 85},
        },
    },
    "sheath blight": {
        "when": {
            "temperature_mean": {"min": 28, "max": 32},
            "humidity": {"min": 90},
        },
    },
    "stem borer": {
        "when": {
            "temperature_mean": {"min": 25, "max": 35},
            "humidity": {"min": 70},
        },
    },
    "leaf miner": {
        "when": {
            "temperature_max": {"min": 28},
            "humidity": {"min": 60},
        },
    },
    "white fly": {
        "when": {
            "temperature_max": {"min": 28},
            "humidity": {"min": 55, "max": 75},
        },
    },
    "pod borer": {
        "when": {
            "temperature_mean": {"min": 22, "max": 32},
            "humidity": {"min": 65},
        },
    },
    "tomato fruit borer": {
        "when": {
            "temperature_mean": {"min": 24, "max": 30},
            "humidity": {"min": 60},
        },
    },
    "fungal wilting": {
        "when": {
            "humidity": {"min": 85},
            "temperature_mean": {"min": 20, "max": 30},
        },
    },
    "wilting": {
        "when": {
            "temperature_max": {"min": 30},
            "humidity": {"min": 75},
        },
    },
    "drought": {
        "when": {
            "rainfall_mm": {"max": 5},
        },
    },
    "hailstorm": {
        "when": {
            "rainfall_mm": {"min": 10},
        },
    },
    "hailstorms": {
        "when": {
            "rainfall_mm": {"min": 10},
        },
    },
    "cloudy weather": {
        "when": {
            "humidity": {"min": 80},
        },
    },
    "cloudy waether": {
        "when": {
            "humidity": {"min": 80},
        },
    },
}

# Potato-specific disease risks (no advisory records in BAMIS for potato)
_POTATO_DISEASE_RISKS = [
    {
        "name": "late_blight",
        "when": {
            "temperature_mean": {"min": 14, "max": 20},
            "humidity": {"min": 90},
            "precipitation": {"min": 1},
        },
        "applicable_stages": ["Tuber Set/Initiation", "Tuber Bulking/Development", "Maturity"],
        "source_section": "Pest/Disease",
        "message": "Cool, humid conditions favour late blight (Phytophthora infestans). Monitor leaf symptoms closely.",
    },
    {
        "name": "early_blight",
        "when": {
            "temperature_mean": {"min": 24, "max": 30},
            "humidity": {"min": 75},
        },
        "applicable_stages": ["Vegetative Growth", "Tuber Set/Initiation"],
        "source_section": "Pest/Disease",
        "message": "Warm, humid nights increase early blight (Alternaria solani) risk. Inspect lower leaves.",
    },
    {
        "name": "bacterial_wilt",
        "when": {
            "temperature_min": {"min": 25},
            "humidity": {"min": 80},
        },
        "applicable_stages": ["Sprouting", "Seedling", "Vegetative Growth"],
        "source_section": "Pest/Disease",
        "message": "High soil temperature and moisture favour bacterial wilt (Ralstonia solanacearum).",
    },
    {
        "name": "potato_aphid",
        "when": {
            "temperature_mean": {"min": 18, "max": 25},
            "humidity": {"min": 65, "max": 80},
        },
        "applicable_stages": ["Vegetative Growth", "Tuber Set/Initiation"],
        "source_section": "Pest/Disease",
        "message": "Mild, moderate-humidity conditions favour aphid populations and secondary virus spread.",
    },
    {
        "name": "wire_worm",
        "when": {
            "temperature_mean": {"min": 10, "max": 20},
        },
        "requires_additional_variables": ["soil_temperature"],
        "evaluable_with_current_feeds": False,
        "source_section": "Pest/Disease",
        "message": "Cool soil temperatures (10–20 °C) increase wireworm activity around tubers.",
    },
]


# ---------------------------------------------------------------------------
# Crop rule derivation from observed climate data
# ---------------------------------------------------------------------------

def _derive_crop_rules(all_values: dict[str, list[float]]) -> dict:
    """
    Derive alert thresholds for a crop from observed season statistics.

    Strategy:
      temp_min  — warn if falls below (season absolute_min - 2 °C)
      temp_max  — warn if exceeds (season 90th-percentile of max_temp)
      humidity  — optimal window: [rh_min_mean, rh_max_mean × 0.92]
      rainfall  — medium = 2× weekly mean; critical = 8× weekly mean
    """
    rules: dict = {}

    tmin = [v for v in all_values.get("temp_min_c", []) if v is not None]
    if tmin:
        cold_threshold = round(min(tmin) - 2, 1)
        rules["temperature_min"] = {
            "min": cold_threshold,
            "source_section": "derived_from_season_data",
        }

    tmax = [v for v in all_values.get("temp_max_c", []) if v is not None]
    if tmax:
        vals = sorted(tmax)
        p90_idx = max(0, int(len(vals) * 0.9) - 1)
        heat_threshold = round(vals[p90_idx], 1)
        rules["temperature_max"] = {
            "max": heat_threshold,
            "source_section": "derived_from_season_data",
        }

    rh_min = [v for v in all_values.get("rh_min_pct", []) if v is not None]
    rh_max = [v for v in all_values.get("rh_max_pct", []) if v is not None]
    if rh_min and rh_max:
        rh_min_mean = round(statistics.mean(rh_min), 1)
        rh_max_mean = round(statistics.mean(rh_max) * 0.92, 1)
        rules["humidity"] = {
            "min": rh_min_mean,
            "max": rh_max_mean,
            "source_section": "derived_from_season_data",
        }

    rain = [v for v in all_values.get("rainfall_mm", []) if v is not None]
    if rain:
        non_zero = [v for v in rain if v > 0]
        if non_zero:
            weekly_mean = statistics.mean(non_zero)
            rules["rainfall_daily"] = [
                {
                    "severity": "medium",
                    "min": round(weekly_mean * 2, 1),
                    "source_section": "derived_from_season_data",
                },
                {
                    "severity": "critical",
                    "min": round(weekly_mean * 8, 1),
                    "source_section": "derived_from_season_data",
                },
            ]

    rules["wind_speed_kmh"] = {
        "max": 30,
        "source_section": "agronomy_default",
    }

    return rules


# ---------------------------------------------------------------------------
# Risk-by-stage computation
# ---------------------------------------------------------------------------

def _compute_risk_by_stage(
    weekly_calendar: list[dict],
    crop_rules: dict,
) -> list[dict]:
    """Flag weeks where observed values exceed crop_rules thresholds."""
    stage_map: dict[str, list[dict]] = defaultdict(list)
    for entry in weekly_calendar:
        stage_map[entry["stage"]].append(entry)

    result = []
    for stage, weeks in stage_map.items():
        risk_weeks = []
        for w in weeks:
            alerts = []
            tmax = w.get("temp_max_c")
            tmin = w.get("temp_min_c")
            rain = w.get("rainfall_mm")

            if tmax is not None and "temperature_max" in crop_rules:
                threshold = crop_rules["temperature_max"]["max"]
                if tmax > threshold:
                    alerts.append({
                        "type": "high_temperature",
                        "threshold": threshold,
                        "observed": tmax,
                        "severity": "critical" if tmax > threshold + 3 else "warning",
                    })

            if tmin is not None and "temperature_min" in crop_rules:
                threshold = crop_rules["temperature_min"]["min"]
                if tmin < threshold:
                    alerts.append({
                        "type": "cold_stress",
                        "threshold": threshold,
                        "observed": tmin,
                        "severity": "critical" if tmin < threshold - 3 else "warning",
                    })

            if rain is not None and "rainfall_daily" in crop_rules:
                for rule in crop_rules["rainfall_daily"]:
                    if rain >= rule["min"]:
                        alerts.append({
                            "type": "excess_rainfall",
                            "threshold": rule["min"],
                            "observed": rain,
                            "severity": rule["severity"],
                        })

            if alerts:
                risk_weeks.append({
                    "week": w["week"],
                    "month": w["month"],
                    "alerts": alerts,
                })

        result.append({
            "stage": stage,
            "has_manual_rules": True,
            "risk_weeks": risk_weeks,
            "risk_week_count": len(risk_weeks),
        })

    return result


# ---------------------------------------------------------------------------
# Core builder: one crop × region
# ---------------------------------------------------------------------------

def _build_profile(
    crop: str,
    region: str,
    climate_records: list[dict],
    advisory_records: list[dict],
    chunk_lookup: dict[str, dict],
) -> dict:
    """Return a complete crop profile dict for this crop × region."""

    # ── 1. Sort records by season week order ─────────────────────────────────
    records = sorted(climate_records, key=lambda r: _week_sort_key(r["week_number"]))

    # ── 2. Build weekly_calendar ─────────────────────────────────────────────
    weekly_calendar = []
    seen_weeks: set[int] = set()
    for rec in records:
        week = rec["week_number"]
        if week in seen_weeks:
            continue
        seen_weeks.add(week)

        stage = _normalise_stage(rec["crop_stage"])
        chunk_id = f"climate_{crop}_{region}_w{week}"
        chunk = chunk_lookup.get(chunk_id, {})
        temp_mean = round((rec["min_temp_c"] + rec["max_temp_c"]) / 2, 2)

        entry = {
            "week":         week,
            "month":        rec["month"],
            "stage":        stage,
            "chunk_id":     chunk_id,
            "chunk_text":   chunk.get("text", ""),
            "temp_min_c":   rec.get("min_temp_c"),
            "temp_max_c":   rec.get("max_temp_c"),
            "temp_mean_c":  temp_mean if rec.get("min_temp_c") is not None and rec.get("max_temp_c") is not None else None,
            "rainfall_mm":  rec.get("rainfall_mm"),
            "rh_max_pct":   rec.get("rh_max_percent"),
            "rh_min_pct":   rec.get("rh_min_percent"),
        }
        weekly_calendar.append(entry)

    # ── 3. Build growth_stages ───────────────────────────────────────────────
    stage_buckets: dict[str, dict] = {}
    for entry in weekly_calendar:
        stage = entry["stage"]
        if stage not in stage_buckets:
            stage_buckets[stage] = {
                "weeks": [], "months": set(),
                "temp_min_c": [], "temp_max_c": [], "temp_mean_c": [],
                "rainfall_mm": [], "rh_max_pct": [], "rh_min_pct": [],
            }
        b = stage_buckets[stage]
        b["weeks"].append(entry["week"])
        b["months"].add(entry["month"])
        # Only append non-None values so _stats works cleanly
        for field in ("temp_min_c", "temp_max_c", "temp_mean_c", "rainfall_mm", "rh_max_pct", "rh_min_pct"):
            v = entry.get(field)
            if v is not None:
                b[field].append(v)

    growth_stages = []
    seen_stages: set[str] = set()
    for entry in weekly_calendar:
        stage = entry["stage"]
        if stage in seen_stages:
            continue
        seen_stages.add(stage)
        b = stage_buckets[stage]
        months_ordered = sorted(
            b["months"],
            key=lambda m: _MONTH_ORDER.get(m, 99),
        )
        growth_stages.append({
            "stage":       stage,
            "weeks":       b["weeks"],
            "months":      months_ordered,
            "week_count":  len(b["weeks"]),
            "climate_stats": {
                "temp_min_c":   _stats(b["temp_min_c"]),
                "temp_max_c":   _stats(b["temp_max_c"]),
                "temp_mean_c":  _stats(b["temp_mean_c"]),
                "rainfall_mm":  _stats(b["rainfall_mm"]),
                "rh_max_pct":   _stats(b["rh_max_pct"]),
                "rh_min_pct":   _stats(b["rh_min_pct"]),
            },
        })

    # ── 4. Season span ───────────────────────────────────────────────────────
    all_weeks  = [e["week"]  for e in weekly_calendar]
    all_months = list(dict.fromkeys(e["month"] for e in weekly_calendar))  # preserve order
    unique_months = sorted(set(all_months), key=lambda m: _MONTH_ORDER.get(m, 99))

    season_span = {
        "weeks":          all_weeks,
        "months":         unique_months,
        "duration_weeks": len(all_weeks),
    }

    # ── 5. Derived thresholds ────────────────────────────────────────────────
    def _notnull(key: str) -> list[float]:
        return [e[key] for e in weekly_calendar if e.get(key) is not None]

    all_vals: dict[str, list[float]] = {
        "temp_min_c":  _notnull("temp_min_c"),
        "temp_max_c":  _notnull("temp_max_c"),
        "temp_mean_c": _notnull("temp_mean_c"),
        "rainfall_mm": _notnull("rainfall_mm"),
        "rh_max_pct":  _notnull("rh_max_pct"),
        "rh_min_pct":  _notnull("rh_min_pct"),
    }

    rain_vals = all_vals["rainfall_mm"]
    season_total_rain = round(sum(rain_vals), 1) if rain_vals else None
    derived_thresholds: dict = {}

    if all_vals["temp_min_c"]:
        derived_thresholds["temp_min_observed_c"] = {
            "absolute_min": round(min(all_vals["temp_min_c"]), 2),
            "absolute_max": round(max(all_vals["temp_min_c"]), 2),
            "mean":         round(statistics.mean(all_vals["temp_min_c"]), 2),
        }
    if all_vals["temp_max_c"]:
        derived_thresholds["temp_max_observed_c"] = {
            "absolute_min": round(min(all_vals["temp_max_c"]), 2),
            "absolute_max": round(max(all_vals["temp_max_c"]), 2),
            "mean":         round(statistics.mean(all_vals["temp_max_c"]), 2),
        }
    if rain_vals:
        derived_thresholds["rainfall_mm"] = {
            "weekly_mean":  round(statistics.mean(rain_vals), 2),
            "weekly_max":   round(max(rain_vals), 2),
            "weekly_min":   round(min(rain_vals), 2),
            "season_total": season_total_rain,
        }
    if all_vals["rh_max_pct"] and all_vals["rh_min_pct"]:
        derived_thresholds["relative_humidity_pct"] = {
            "rh_max_mean":   round(statistics.mean(all_vals["rh_max_pct"]), 2),
            "rh_min_mean":   round(statistics.mean(all_vals["rh_min_pct"]), 2),
            "rh_max_peak":   round(max(all_vals["rh_max_pct"]), 2),
            "rh_min_trough": round(min(all_vals["rh_min_pct"]), 2),
        }

    # ── 6. Crop rules ────────────────────────────────────────────────────────
    crop_rules = _derive_crop_rules(all_vals)

    # ── 7. Disease risks ─────────────────────────────────────────────────────
    if crop == "potato":
        disease_risks = _POTATO_DISEASE_RISKS
    else:
        # Derive from Pest/Disease advisories for this crop
        disease_risks = []
        seen_names: set[str] = set()
        for adv in advisory_records:
            if adv.get("category") != "Pest/Disease":
                continue
            name = adv.get("name", "Unknown")
            slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
            if slug in seen_names:
                continue
            seen_names.add(slug)
            conditions = _DISEASE_CONDITIONS.get(name.lower(), {})
            entry = {
                "name":           slug,
                "source_section": "Pest/Disease",
                "description":    adv.get("description", ""),
                "applicable_period": adv.get("applicable_period", ""),
                "message":        adv.get("raw_text", ""),
            }
            if conditions:
                entry["when"] = conditions.get("when", {})
            disease_risks.append(entry)

    # ── 8. Weather warnings & pest/disease advisories ────────────────────────
    weather_warnings = []
    pest_disease_advisories = []
    seen_ww: set[str] = set()
    seen_pd: set[str] = set()

    for adv in advisory_records:
        cat = adv.get("category", "")
        name = adv.get("name", "Unknown")
        slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        entry = {
            "name":              name,
            "description":       adv.get("description", ""),
            "applicable_period": adv.get("applicable_period", ""),
            "raw_text":          adv.get("raw_text", ""),
        }
        conditions = _DISEASE_CONDITIONS.get(name.lower())
        if conditions:
            entry["when"] = conditions.get("when", {})

        if cat == "Weather Warning" and slug not in seen_ww:
            seen_ww.add(slug)
            weather_warnings.append(entry)
        elif cat == "Pest/Disease" and slug not in seen_pd:
            seen_pd.add(slug)
            pest_disease_advisories.append(entry)

    # ── 9. Risk by stage ─────────────────────────────────────────────────────
    risk_by_stage = _compute_risk_by_stage(weekly_calendar, crop_rules)

    # ── 10. Source chunks inventory ──────────────────────────────────────────
    climate_ids  = [e["chunk_id"] for e in weekly_calendar]
    advisory_ids = []
    for adv in advisory_records:
        cid = adv.get("chunk_id")
        if cid:
            advisory_ids.append(cid)

    # ── Assemble ─────────────────────────────────────────────────────────────
    return {
        "crop":              crop,
        "region":            region,
        "crop_display_name": crop.replace("_", " ").title(),
        "season_span":       season_span,
        "growth_stages":     growth_stages,
        "weekly_calendar":   weekly_calendar,
        "derived_thresholds": derived_thresholds,
        "crop_rules":        crop_rules,
        "disease_risks":     disease_risks,
        "weather_warnings":  weather_warnings,
        "pest_disease_advisories": pest_disease_advisories,
        "risk_by_stage":     risk_by_stage,
        "source_chunks": {
            "climate_count":      len(climate_ids),
            "advisory_count":     len(advisory_ids),
            "climate_chunk_ids":  climate_ids,
            "advisory_chunk_ids": advisory_ids,
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich crop profiles from BAMIS data")
    parser.add_argument("--crop",   default=None, help="Only process this crop (default: all)")
    parser.add_argument("--region", default=None, help="Only process this region (default: all)")
    parser.add_argument("--output", default=str(_OUTPUT_FILE), help="Output JSON path")
    args = parser.parse_args()

    # ── Load source data ─────────────────────────────────────────────────────
    print(f"[INFO] Loading {_BAMIS_META} ...")
    with open(_BAMIS_META, encoding="utf-8") as f:
        raw_meta = json.load(f)

    print(f"[INFO] Loading {_CHUNKS_FILE} ...")
    chunk_lookup: dict[str, dict] = {}
    advisory_by_chunk: dict[str, dict] = {}
    with open(_CHUNKS_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            chunk_lookup[obj["id"]] = obj
            if obj["id"].startswith("advisory_"):
                meta = obj.get("metadata", {})
                key = f"{meta.get('crop')}_{meta.get('region')}"
                advisory_by_chunk.setdefault(key, [])
                entry = dict(meta)
                entry["chunk_id"] = obj["id"]
                advisory_by_chunk[key].append(entry)

    # Separate climate vs advisory records from metadata
    climate_meta: list[dict] = []
    advisory_meta: list[dict] = []
    for rec in raw_meta:
        if "week_number" in rec:
            climate_meta.append(rec)
        else:
            advisory_meta.append(rec)

    # ── Group climate records by (crop, region) ───────────────────────────────
    climate_by_key: dict[str, list[dict]] = defaultdict(list)
    for rec in climate_meta:
        if args.crop and rec["crop"] != args.crop:
            continue
        if args.region and rec["region"] != args.region:
            continue
        climate_by_key[f"{rec['crop']}_{rec['region']}"].append(rec)

    # Group advisory metadata by (crop, region)
    advisory_by_key: dict[str, list[dict]] = defaultdict(list)
    for rec in advisory_meta:
        if args.crop and rec["crop"] != args.crop:
            continue
        if args.region and rec["region"] != args.region:
            continue
        advisory_by_key[f"{rec['crop']}_{rec['region']}"].append(rec)

    # ── Build profiles ────────────────────────────────────────────────────────
    profiles: dict[str, dict] = {}
    keys = sorted(climate_by_key.keys())
    print(f"[INFO] Building profiles for {len(keys)} crop×region combinations ...")

    for key in keys:
        crop, region = key.split("_", 1)
        adv_records = advisory_by_key.get(key, [])
        # Also include advisories that apply globally to this crop (any region)
        global_adv = advisory_by_key.get(f"{crop}_all", [])

        profile = _build_profile(
            crop=crop,
            region=region,
            climate_records=climate_by_key[key],
            advisory_records=adv_records + global_adv,
            chunk_lookup=chunk_lookup,
        )
        profiles[key] = profile
        print(f"  [OK] {key:40s} weeks={profile['season_span']['duration_weeks']:3d}  stages={len(profile['growth_stages'])}")

    # ── Write output ──────────────────────────────────────────────────────────
    output_path = Path(args.output)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(profiles, f, ensure_ascii=False, indent=2)

    print(f"\n[DONE] Written {len(profiles)} profiles → {output_path}")
    print(f"       File size: {output_path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
