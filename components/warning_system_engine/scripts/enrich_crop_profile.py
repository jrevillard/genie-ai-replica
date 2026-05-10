#!/usr/bin/env python3
"""
enrich_crop_profile.py
======================
Transforms raw BAMIS data into structured, analytics-ready crop profiles.

Reads  (relative to this script's location)
-----
  ../data/bamis_metadata.json       — BAMIS weekly climate + advisory records
  ../data/vector_ready_chunks.jsonl — same data as LLM-ready text chunks
  ../data/crop_profiles.json        — manually-authored rules, merged when available

Writes
------
  ../../../../data/example_crop_profile.json  (mewa_v2/data/)

Profile structure per entry
---------------------------
  crop / region / crop_display_name
  season_span             — weeks, months, duration
  growth_stages           — per-stage climate statistics (mean/min/max/stdev/sum)
  weekly_calendar         — week-by-week rows with chunk_id + chunk_text cross-ref
  derived_thresholds      — auto-computed extremes across the full growing season
  risk_by_stage           — weeks where manual crop_rules thresholds are breached
  weather_warnings        — from "Weather Warning" advisory records
  pest_disease_advisories — from "Pest/Disease" advisory records
  source_chunks           — chunk IDs and counts
  crop_rules              — manual rules from crop_profiles.json (merged when found)
  disease_risks           — manual disease entries (merged when found)

Usage
-----
  python enrich_crop_profile.py                          # all 300 profiles
  python enrich_crop_profile.py --crop potato            # one crop, all regions
  python enrich_crop_profile.py --crop potato --region dhaka
  python enrich_crop_profile.py --out /custom/path.json
"""

import json
import re
import statistics
import argparse
from collections import defaultdict
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).resolve().parent          # .../weather-mcp-service/scripts
DATA_DIR    = SCRIPT_DIR.parent / "data"               # .../weather-mcp-service/data
REPO_ROOT   = SCRIPT_DIR.parents[2]                    # .../mewa_v2

BAMIS_PATH  = DATA_DIR / "bamis_metadata.json"
CHUNKS_PATH = DATA_DIR / "vector_ready_chunks.jsonl"
RULES_PATH  = DATA_DIR / "crop_profiles.json"
DEFAULT_OUT = DATA_DIR / "example_crop_profile.json"

# ── Stage name normalisation ───────────────────────────────────────────────────
# The source data contains many OCR artefacts (e.g. "Harve sting", "sowi ng").
# Map every known variant → one clean canonical string.
_STAGE_MAP = {
    # Sprouting / Germination
    "spouting":                             "Sprouting",
    "spouting & seedling":                  "Sprouting & Seedling",
    "germination":                          "Germination",
    "germination & emergence":              "Germination & Emergence",
    "germination & seedling":               "Germination & Seedling",
    "germination and seedling":             "Germination & Seedling",
    "germination and seedling planting":    "Germination & Seedling",
    "germination to emergence":             "Germination & Emergence",
    # Seedling
    "seedling":                             "Seedling",
    "seedbed":                              "Seedbed",
    "seedling establishment":               "Seedling Establishment",
    "seedling raising & planting":          "Seedling Raising & Planting",
    "seedling raising & transplantation":   "Seedling Raising & Transplantation",
    # Transplanting
    "transplanting":                        "Transplanting",
    "vine planting":                        "Vine Planting",
    # Vegetative
    "vegetative":                           "Vegetative Growth",
    "vegetative growth":                    "Vegetative Growth",
    "vegetative stage":                     "Vegetative Growth",
    "leaf area & canopy development":       "Leaf Area & Canopy Development",
    "grand growth":                         "Grand Growth",
    # Flowering
    "flowering":                            "Flowering",
    "flowering stage":                      "Flowering",
    "flowering & fruiting":                 "Flowering & Fruiting",
    "flowering & fruit setting.":           "Flowering & Fruit Setting",
    "flowering and fruit setting":          "Flowering & Fruit Setting",
    "flower bud formation":                 "Flower Bud Formation",
    "flower bud visible":                   "Flower Bud Visible",
    "flower opening":                       "Flower Opening",
    "flower panicle emergence":             "Panicle Flowering",
    "panicle elongation":                   "Panicle Elongation",
    "panicle growth & flowering":           "Panicle Growth & Flowering",
    "inflorescence emergence":              "Inflorescence Emergence",
    "appearance of flower buds":            "Flower Bud Formation",
    "swelling of apical buds":              "Bud Swelling",
    "silking & tasseling":                  "Silking & Tasseling",
    "heading":                              "Heading",
    # Tuber-specific
    "tuber set/ initiation":               "Tuber Set / Initiation",
    "tuber set/initiation":                "Tuber Set / Initiation",
    "tuber bulking/ development":          "Tuber Bulking / Development",
    "tuber bulking/development":           "Tuber Bulking / Development",
    # Fruit / grain
    "fruit development":                   "Fruit Development",
    "fruit growth":                        "Fruit Development",
    "fruit setting":                       "Fruit Setting",
    "pea stage":                           "Pea Stage",
    "pod initiation":                      "Pod Initiation",
    "grain formation":                     "Grain Formation",
    "grain filling":                       "Grain Filling",
    "cob formation":                       "Cob Formation",
    # Maturity / harvest
    "maturity":                            "Maturity",
    "maturity to harvesting":              "Maturity & Harvesting",
    "maturity/ripening/harvesting stage":  "Maturity & Harvesting",
    "fruit maturity and harvesting":       "Fruit Maturity & Harvesting",
    "fruit maturation/ripening":           "Fruit Maturation / Ripening",
    "fruit ripening & harvesting":         "Fruit Ripening & Harvesting",
    "fruit production and harvesting":     "Fruit Production & Harvesting",
    "harvesting":                          "Harvesting",
    # Pest/Disease labels that leaked into crop_stage (source data quality issue)
    "blast":                               "Blast",
    "common cut warm":                     "Common Cut Worm",
    "fruit borer":                         "Fruit Borer",
    "purple blotch":                       "Purple Blotch",
    "red spider mites":                    "Red Spider Mites",
    "tillering":                           "Tillering",
}

# Regex to collapse OCR-broken internal spaces before "-ing" words, e.g. "Harve sting"
_OCR_SPACE = re.compile(r'\b(\w+)\s+(\w+ing)\b', re.IGNORECASE)


def normalize_stage(raw: str) -> str:
    if not raw:
        return "Unknown"
    cleaned = _OCR_SPACE.sub(lambda m: m.group(1) + m.group(2), raw.strip())
    key = cleaned.lower().strip()
    if key in _STAGE_MAP:
        return _STAGE_MAP[key]
    return cleaned.title() if len(cleaned) < 60 else cleaned


def display_name(crop_id: str) -> str:
    overrides = {
        "rice_boro":         "Rice (Boro)",
        "rice_aman":         "Rice (Aman)",
        "rice_aus":          "Rice (Aus)",
        "green_gram_kharif": "Green Gram (Kharif)",
        "green_gram_robi":   "Green Gram (Robi)",
        "groundnut_kharif":  "Groundnut (Kharif)",
        "groundnut_robi":    "Groundnut (Robi)",
        "maize_kharif":      "Maize (Kharif)",
        "maize_rabi":        "Maize (Rabi)",
        "pointed_gourd":     "Pointed Gourd",
        "jujube":            "Jujube (Kul)",
    }
    return overrides.get(crop_id, crop_id.replace("_", " ").title())


# ── Statistics ─────────────────────────────────────────────────────────────────

def safe_stats(values: list) -> dict:
    vals = [v for v in values if v is not None]
    if not vals:
        return {}
    out = {
        "mean": round(statistics.mean(vals), 2),
        "min":  round(min(vals), 2),
        "max":  round(max(vals), 2),
        "sum":  round(sum(vals), 2),
    }
    if len(vals) > 1:
        out["stdev"] = round(statistics.stdev(vals), 2)
    return out


# ── Week ordering ──────────────────────────────────────────────────────────────

def order_weeks(weeks: list) -> list:
    """Return weeks in season order, handling year-boundary crops (e.g. wk 42–52 then 1–5)."""
    if not weeks:
        return []
    sw = sorted(set(weeks))
    for i in range(1, len(sw)):
        if sw[i] - sw[i - 1] > 10:          # gap → year boundary
            return sw[i:] + sw[:i]
    return sw


# ── I/O ────────────────────────────────────────────────────────────────────────

def load_bamis(path: Path) -> list:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_chunks(path: Path) -> dict:
    index = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                obj = json.loads(line)
                index[obj["id"]] = obj
    return index


def load_rules(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ── Profile builder ────────────────────────────────────────────────────────────

def build_profile(crop: str, region: str, records: list,
                  chunk_index: dict, existing_rules: dict) -> dict:

    climate_recs = [r for r in records if r.get("week_number") and not r.get("category")]
    warning_recs = [r for r in records if r.get("category") == "Weather Warning"]
    pestdis_recs = [r for r in records if r.get("category") == "Pest/Disease"]

    # ── Season span ───────────────────────────────────────────────────────────
    ordered_weeks = order_weeks([r["week_number"] for r in climate_recs if r.get("week_number")])

    week_pos = {w: i for i, w in enumerate(ordered_weeks)}
    unique_months = []
    seen_m = set()
    for r in sorted(climate_recs, key=lambda x: week_pos.get(x.get("week_number"), 999)):
        m = r.get("month")
        if m and m not in seen_m:
            unique_months.append(m)
            seen_m.add(m)

    season_span = {
        "weeks":          ordered_weeks,
        "months":         unique_months,
        "duration_weeks": len(ordered_weeks),
    }

    # ── Growth stages ─────────────────────────────────────────────────────────
    stage_groups = defaultdict(list)
    for r in climate_recs:
        stage_groups[normalize_stage(r.get("crop_stage", ""))].append(r)

    def first_pos(stage_name):
        positions = [week_pos[r["week_number"]] for r in stage_groups[stage_name]
                     if r.get("week_number") in week_pos]
        return min(positions) if positions else 999

    growth_stages = []
    for stage_name in sorted(stage_groups, key=first_pos):
        recs_s      = stage_groups[stage_name]
        stage_weeks = order_weeks([r["week_number"] for r in recs_s if r.get("week_number")])
        sw_pos      = {w: i for i, w in enumerate(stage_weeks)}

        stage_months = []
        seen_sm = set()
        for r in sorted(recs_s, key=lambda x: sw_pos.get(x.get("week_number"), 999)):
            m = r.get("month")
            if m and m not in seen_sm:
                stage_months.append(m)
                seen_sm.add(m)

        def collect(field):
            return [r[field] for r in recs_s if r.get(field) is not None]

        min_t  = collect("min_temp_c")
        max_t  = collect("max_temp_c")
        rain   = collect("rainfall_mm")
        rh_max = collect("rh_max_percent")
        rh_min = collect("rh_min_percent")
        mean_t = [
            round((r["min_temp_c"] + r["max_temp_c"]) / 2, 2)
            for r in recs_s
            if r.get("min_temp_c") is not None and r.get("max_temp_c") is not None
        ]

        climate_stats = {}
        if min_t:  climate_stats["temp_min_c"]  = safe_stats(min_t)
        if max_t:  climate_stats["temp_max_c"]  = safe_stats(max_t)
        if mean_t: climate_stats["temp_mean_c"] = safe_stats(mean_t)
        if rain:   climate_stats["rainfall_mm"] = safe_stats(rain)
        if rh_max: climate_stats["rh_max_pct"]  = safe_stats(rh_max)
        if rh_min: climate_stats["rh_min_pct"]  = safe_stats(rh_min)

        growth_stages.append({
            "stage":         stage_name,
            "weeks":         stage_weeks,
            "months":        stage_months,
            "week_count":    len(stage_weeks),
            "climate_stats": climate_stats,
        })

    # ── Weekly calendar ───────────────────────────────────────────────────────
    week_map = {r["week_number"]: r for r in climate_recs if r.get("week_number")}
    weekly_calendar = []
    for week in ordered_weeks:
        r = week_map.get(week)
        if not r:
            continue
        chunk_id   = f"climate_{crop}_{region}_w{week}"
        chunk_data = chunk_index.get(chunk_id, {})
        row = {
            "week":       week,
            "month":      r.get("month"),
            "stage":      normalize_stage(r.get("crop_stage", "")),
            "chunk_id":   chunk_id,
            "chunk_text": chunk_data.get("text"),
        }
        for src, dst in [("min_temp_c", "temp_min_c"), ("max_temp_c", "temp_max_c"),
                         ("rainfall_mm", "rainfall_mm"),
                         ("rh_max_percent", "rh_max_pct"), ("rh_min_percent", "rh_min_pct")]:
            if r.get(src) is not None:
                row[dst] = r[src]
        if r.get("min_temp_c") is not None and r.get("max_temp_c") is not None:
            row["temp_mean_c"] = round((r["min_temp_c"] + r["max_temp_c"]) / 2, 2)
        weekly_calendar.append(row)

    # ── Derived thresholds ────────────────────────────────────────────────────
    def season_vals(field):
        return [r[field] for r in climate_recs if r.get(field) is not None]

    all_min   = season_vals("min_temp_c")
    all_max   = season_vals("max_temp_c")
    all_rain  = season_vals("rainfall_mm")
    all_rhmax = season_vals("rh_max_percent")
    all_rhmin = season_vals("rh_min_percent")

    derived_thresholds = {}
    if all_min:
        derived_thresholds["temp_min_observed_c"] = {
            "absolute_min": min(all_min),
            "absolute_max": max(all_min),
            "mean":         round(statistics.mean(all_min), 2),
        }
    if all_max:
        derived_thresholds["temp_max_observed_c"] = {
            "absolute_min": min(all_max),
            "absolute_max": max(all_max),
            "mean":         round(statistics.mean(all_max), 2),
        }
    if all_rain:
        derived_thresholds["rainfall_mm"] = {
            "weekly_mean":  round(statistics.mean(all_rain), 2),
            "weekly_max":   max(all_rain),
            "weekly_min":   min(all_rain),
            "season_total": round(sum(all_rain), 2),
        }
    if all_rhmax and all_rhmin:
        derived_thresholds["relative_humidity_pct"] = {
            "rh_max_mean":   round(statistics.mean(all_rhmax), 2),
            "rh_min_mean":   round(statistics.mean(all_rhmin), 2),
            "rh_max_peak":   max(all_rhmax),
            "rh_min_trough": min(all_rhmin),
        }

    # ── Risk assessment ───────────────────────────────────────────────────────
    profile_key  = f"{crop}_{region}"
    manual_rules = existing_rules.get(profile_key, {}).get("crop_rules", {})

    t_min_rule    = manual_rules.get("temperature_min", {}).get("min")
    t_max_rule    = manual_rules.get("temperature_max", {}).get("max")
    rain_rules    = manual_rules.get("rainfall_daily", [])
    critical_rain = next((r["min"] for r in rain_rules if r.get("severity") == "critical"), None)
    medium_rain   = next((r["min"] for r in rain_rules if r.get("severity") == "medium"),   None)

    risk_by_stage = []
    for stage_entry in growth_stages:
        stage_name = stage_entry["stage"]
        risks = []
        for r in stage_groups[stage_name]:
            alerts = []
            if t_min_rule is not None and r.get("min_temp_c") is not None:
                if r["min_temp_c"] < t_min_rule:
                    alerts.append({"type": "low_temperature",  "threshold": t_min_rule,
                                   "observed": r["min_temp_c"], "severity": "warning"})
            if t_max_rule is not None and r.get("max_temp_c") is not None:
                if r["max_temp_c"] > t_max_rule:
                    alerts.append({"type": "high_temperature", "threshold": t_max_rule,
                                   "observed": r["max_temp_c"], "severity": "warning"})
            if critical_rain is not None and r.get("rainfall_mm") is not None:
                if r["rainfall_mm"] >= critical_rain:
                    alerts.append({"type": "excessive_rainfall", "threshold": critical_rain,
                                   "observed": r["rainfall_mm"], "severity": "critical"})
            elif medium_rain is not None and r.get("rainfall_mm") is not None:
                if r["rainfall_mm"] >= medium_rain:
                    alerts.append({"type": "heavy_rainfall", "threshold": medium_rain,
                                   "observed": r["rainfall_mm"], "severity": "medium"})
            if alerts:
                risks.append({"week": r["week_number"], "month": r.get("month"), "alerts": alerts})

        if risks or not manual_rules:
            risk_by_stage.append({
                "stage":            stage_name,
                "has_manual_rules": bool(manual_rules),
                "risk_weeks":       risks,
                "risk_week_count":  len(risks),
            })

    # ── Weather warnings ──────────────────────────────────────────────────────
    seen_w = set()
    weather_warnings = []
    for r in warning_recs:
        name = r.get("name", "")
        if name in seen_w:
            continue
        seen_w.add(name)
        chunk_match = next(
            (c for c in chunk_index.values()
             if c["metadata"].get("crop") == crop
             and c["metadata"].get("category") == "Weather Warning"
             and c["metadata"].get("name") == name),
            {}
        )
        weather_warnings.append({
            "name":             name,
            "description":      r.get("description"),
            "applicable_period": r.get("applicable_period"),
            "chunk_id":         chunk_match.get("id"),
            "chunk_text":       chunk_match.get("text"),
        })

    # ── Pest/Disease advisories ───────────────────────────────────────────────
    seen_p = set()
    pest_disease_advisories = []
    for r in pestdis_recs:
        name = r.get("name", "")
        if name in seen_p:
            continue
        seen_p.add(name)
        chunk_match = next(
            (c for c in chunk_index.values()
             if c["metadata"].get("crop") == crop
             and c["metadata"].get("category") == "Pest/Disease"
             and c["metadata"].get("name") == name),
            {}
        )
        pest_disease_advisories.append({
            "name":             name,
            "description":      r.get("description"),
            "applicable_period": r.get("applicable_period"),
            "raw_condition":    r.get("raw_text"),
            "chunk_id":         chunk_match.get("id"),
            "chunk_text":       chunk_match.get("text"),
        })

    # ── Source chunk index ────────────────────────────────────────────────────
    climate_ids  = [f"climate_{crop}_{region}_w{w}" for w in ordered_weeks]
    advisory_ids = [
        c["id"] for c in chunk_index.values()
        if c["metadata"].get("crop") == crop
        and c["metadata"].get("category") in ("Weather Warning", "Pest/Disease")
    ]
    source_chunks = {
        "climate_count":      len([cid for cid in climate_ids if cid in chunk_index]),
        "advisory_count":     len(advisory_ids),
        "climate_chunk_ids":  [cid for cid in climate_ids if cid in chunk_index],
        "advisory_chunk_ids": advisory_ids,
    }

    # ── Assemble ──────────────────────────────────────────────────────────────
    profile = {
        "crop":                    crop,
        "region":                  region,
        "crop_display_name":       display_name(crop),
        "season_span":             season_span,
        "growth_stages":           growth_stages,
        "weekly_calendar":         weekly_calendar,
        "derived_thresholds":      derived_thresholds,
        "risk_by_stage":           risk_by_stage,
        "weather_warnings":        weather_warnings,
        "pest_disease_advisories": pest_disease_advisories,
        "source_chunks":           source_chunks,
    }

    # Merge manual rules from crop_profiles.json when available
    manual = existing_rules.get(profile_key, {})
    if manual.get("crop_rules"):
        profile["crop_rules"]    = manual["crop_rules"]
    if manual.get("disease_risks"):
        profile["disease_risks"] = manual["disease_risks"]

    return profile


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--crop",   help="Filter to one crop slug, e.g. potato")
    parser.add_argument("--region", help="Filter to one region, e.g. dhaka")
    parser.add_argument("--out",    help="Output JSON path", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] Loading {BAMIS_PATH.name} …")
    bamis = load_bamis(BAMIS_PATH)
    print(f"      {len(bamis):,} records")

    print(f"[2/4] Loading {CHUNKS_PATH.name} …")
    chunk_index = load_chunks(CHUNKS_PATH)
    print(f"      {len(chunk_index):,} chunks indexed")

    print(f"[3/4] Loading {RULES_PATH.name} …")
    existing_rules = load_rules(RULES_PATH)
    print(f"      {len(existing_rules)} manual profiles: {list(existing_rules.keys())}")

    # Group by (crop, region)
    groups = defaultdict(list)
    for r in bamis:
        crop   = r.get("crop",   "")
        region = r.get("region", "")
        if not crop or not region:
            continue
        if args.crop   and crop   != args.crop:
            continue
        if args.region and region != args.region:
            continue
        groups[(crop, region)].append(r)

    print(f"\n[4/4] Building {len(groups)} profile(s) …\n")

    output = {}
    for (crop, region), records in sorted(groups.items()):
        key     = f"{crop}_{region}"
        n_cli   = sum(1 for r in records if r.get("week_number") and not r.get("category"))
        n_adv   = sum(1 for r in records if r.get("category"))
        print(f"  {key:<42}  climate={n_cli:3d}  advisory={n_adv:3d}")
        output[key] = build_profile(crop, region, records, chunk_index, existing_rules)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    total_mb = out_path.stat().st_size / 1_048_576
    print(f"\nWrote {len(output)} profiles → {out_path}  ({total_mb:.2f} MB)")

    # Quick summary of first profile
    first_key = next(iter(output))
    p = output[first_key]
    ss = p["season_span"]
    print(f"\nSample — {first_key}")
    print(f"  Season  : week {ss['weeks'][0]} → {ss['weeks'][-1]} ({ss['duration_weeks']} weeks)")
    print(f"  Months  : {ss['months']}")
    print(f"  Stages  : {[s['stage'] for s in p['growth_stages']]}")
    print(f"  Chunks  : {p['source_chunks']['climate_count']} climate, "
          f"{p['source_chunks']['advisory_count']} advisory")
    dt = p.get("derived_thresholds", {})
    if dt.get("temp_min_observed_c"):
        t = dt["temp_min_observed_c"]
        print(f"  Tmin    : {t['absolute_min']}–{t['absolute_max']} °C (mean {t['mean']})")
    if dt.get("temp_max_observed_c"):
        t = dt["temp_max_observed_c"]
        print(f"  Tmax    : {t['absolute_min']}–{t['absolute_max']} °C (mean {t['mean']})")
    if dt.get("rainfall_mm"):
        t = dt["rainfall_mm"]
        print(f"  Rainfall: {t['weekly_min']}–{t['weekly_max']} mm/wk, season total {t['season_total']} mm")


if __name__ == "__main__":
    main()
