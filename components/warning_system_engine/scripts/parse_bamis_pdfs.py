"""
parse_bamis_pdfs.py
===================
Parses BAMIS crop-calendar PDFs into structured records for bamis_metadata.json.

Typical BAMIS calendar layout
──────────────────────────────
  Page 1 – Climate Calendar table (rows = weeks, columns = stage / month /
            week / max temp / min temp / rainfall / RH max / RH min)
  Page 2+ – Advisory sections: Insect Pest, Disease, Weather Warning,
             Favorable Weather Conditions (text or small tables)

Output record schemas
─────────────────────
Climate row:
  {"crop": "potato", "region": "dhaka",
   "week_number": 42, "month": "October", "crop_stage": "Sprouting",
   "max_temp_c": 32.0, "min_temp_c": 23.8,
   "rainfall_mm": 40.5, "rh_max_percent": 95.0, "rh_min_percent": 60.2}

Advisory item (best-effort):
  {"crop": "potato", "region": "dhaka",
   "category": "Pest/Disease" | "Weather Warning",
   "name": "Late Blight",
   "description": "...",
   "applicable_period": "November - December",
   "raw_text": "..."}

Usage
─────
  python parse_bamis_pdfs.py --pdf-dir /data/raw_pdfs --out /data/records.json
  python parse_bamis_pdfs.py --pdf /data/raw_pdfs/potato/dhaka/potato_dhaka.pdf
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    import pdfplumber
except ImportError:
    sys.exit(
        "pdfplumber is required: pip install pdfplumber\n"
        "Add 'pdfplumber>=0.11.0' to requirements.txt and rebuild the container."
    )

# ---------------------------------------------------------------------------
# Column header → canonical field name
# ---------------------------------------------------------------------------
_HEADER_MAP: dict[str, str] = {
    # Stage
    "stage": "crop_stage",
    "crop stage": "crop_stage",
    "growth stage": "crop_stage",
    "stages": "crop_stage",
    # Month
    "month": "month",
    "months": "month",
    # Week number
    "week": "week_number",
    "week no": "week_number",
    "week no.": "week_number",
    "week number": "week_number",
    "wk": "week_number",
    "wk.": "week_number",
    # Max temperature
    "max temp": "max_temp_c",
    "max temp (°c)": "max_temp_c",
    "max temp(°c)": "max_temp_c",
    "max. temp.": "max_temp_c",
    "max. temp. (°c)": "max_temp_c",
    "maximum temp": "max_temp_c",
    "maximum temp.": "max_temp_c",
    "maximum temperature": "max_temp_c",
    "max temperature": "max_temp_c",
    "max temperature (°c)": "max_temp_c",
    # Min temperature
    "min temp": "min_temp_c",
    "min temp (°c)": "min_temp_c",
    "min temp(°c)": "min_temp_c",
    "min. temp.": "min_temp_c",
    "min. temp. (°c)": "min_temp_c",
    "minimum temp": "min_temp_c",
    "minimum temp.": "min_temp_c",
    "minimum temperature": "min_temp_c",
    "min temperature": "min_temp_c",
    "min temperature (°c)": "min_temp_c",
    # Rainfall
    "rainfall": "rainfall_mm",
    "rainfall (mm)": "rainfall_mm",
    "rainfall(mm)": "rainfall_mm",
    "rain (mm)": "rainfall_mm",
    "rain": "rainfall_mm",
    "precipitation": "rainfall_mm",
    "precipitation (mm)": "rainfall_mm",
    # RH Max
    "rh max": "rh_max_percent",
    "rh max (%)": "rh_max_percent",
    "rh max(%)": "rh_max_percent",
    "rh maximum": "rh_max_percent",
    "relative humidity max": "rh_max_percent",
    "rh (max)": "rh_max_percent",
    "max rh": "rh_max_percent",
    "max rh (%)": "rh_max_percent",
    "max. rh (%)": "rh_max_percent",
    # RH Min
    "rh min": "rh_min_percent",
    "rh min (%)": "rh_min_percent",
    "rh min(%)": "rh_min_percent",
    "rh minimum": "rh_min_percent",
    "relative humidity min": "rh_min_percent",
    "rh (min)": "rh_min_percent",
    "min rh": "rh_min_percent",
    "min rh (%)": "rh_min_percent",
    "min. rh (%)": "rh_min_percent",
}

# Minimum fields needed to count a table as the climate calendar
_REQUIRED_CLIMATE_FIELDS = {"crop_stage", "week_number"}

# Advisory section header patterns → output category
_ADVISORY_SECTIONS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"insect\s+pest", re.IGNORECASE), "Pest/Disease"),
    (re.compile(r"\bdisease\b", re.IGNORECASE), "Pest/Disease"),
    (re.compile(r"pest\s*[&/]\s*disease", re.IGNORECASE), "Pest/Disease"),
    (re.compile(r"weather\s+warning", re.IGNORECASE), "Weather Warning"),
    (re.compile(r"favorable\s+weather", re.IGNORECASE), "Weather Warning"),
    (re.compile(r"favourable\s+weather", re.IGNORECASE), "Weather Warning"),
]

# Months used to extract applicable periods from advisory text
_MONTH_NAMES = (
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
)
_MONTH_PATTERN = re.compile(
    r"(" + "|".join(_MONTH_NAMES) + r")"
    r"(?:\s*[-–]\s*(" + "|".join(_MONTH_NAMES) + r"))?",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _norm_header(text: str) -> str | None:
    """Return canonical field name for a column header, or None if unknown."""
    cleaned = re.sub(r"\s+", " ", text.strip().lower())
    # Remove degree symbols / percent signs that appear inside the cell text
    cleaned = cleaned.replace("°", "°")
    return _HEADER_MAP.get(cleaned)


def _to_float(val: str) -> float | None:
    if not val:
        return None
    val = val.strip().replace(",", ".")
    # Strip stray unit characters
    val = re.sub(r"[°%cmm\s]+$", "", val)
    try:
        return float(val)
    except ValueError:
        return None


def _to_int(val: str) -> int | None:
    val = val.strip() if val else ""
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def _extract_period(text: str) -> str:
    """Pull the best applicable-period string from advisory text."""
    # Look for explicit week ranges first
    week_m = re.search(r"week[s]?\s*(\d+)\s*[-–to]+\s*(\d+)", text, re.IGNORECASE)
    if week_m:
        return f"Weeks {week_m.group(1)}–{week_m.group(2)}"
    # Month range
    month_m = _MONTH_PATTERN.search(text)
    if month_m:
        start = month_m.group(1).title()
        end = month_m.group(2).title() if month_m.group(2) else start
        return f"{start} – {end}" if start != end else start
    return "General / Spans multiple weeks"


# ---------------------------------------------------------------------------
# Filename → crop, region
# ---------------------------------------------------------------------------

# BAMIS calendars name their region in the header, e.g.
#   "Crop Weather Calendar of Rabi Eggplant: Rajshahi Region (Districts: ...)"
#   "Region: Rajshahi"
# The title form is checked first: "Region:" is sometimes followed by the crop
# name instead ("Region: Aman Rice"), with the region on the next line.
_REGION_HEADER_PATTERNS = [
    re.compile(r":\s*([A-Za-z]+)\s+Region\b", re.IGNORECASE),
    re.compile(r"Districts:\s*([A-Za-z]+)\b", re.IGNORECASE),
    re.compile(r"^\s*Region:\s*([A-Za-z]+)\s*$", re.MULTILINE),
]


def _region_from_header(text: str) -> str | None:
    """Return the region named in the calendar header, or None."""
    for pattern in _REGION_HEADER_PATTERNS:
        m = pattern.search(text or "")
        if m:
            return m.group(1).strip().lower()
    return None


def _infer_crop_region(
    pdf_path: Path, region_hint: str | None = None
) -> tuple[str, str]:
    """
    crawl_bamis.py writes: raw/<crop>/<region>/<crop>_<region>.pdf
    Fall back to splitting the stem on first underscore if path depth differs.

    When *region_hint* is given (read from the PDF header) the whole filename
    stem is the crop name, so multi-word crops such as "rice_aman" survive.
    """
    parts = pdf_path.parts
    # At least 3 levels: .../<crop>/<region>/<file>.pdf
    if len(parts) >= 3:
        region_candidate = parts[-2]
        crop_candidate = parts[-3]
        stem = pdf_path.stem  # e.g. "potato_dhaka"
        if stem == f"{crop_candidate}_{region_candidate}":
            return crop_candidate, region_candidate

    stem = pdf_path.stem
    if region_hint:
        return stem, region_hint

    # Fallback: split stem on first underscore
    if "_" in stem:
        idx = stem.index("_")
        return stem[:idx], stem[idx + 1 :]

    return stem, "unknown"


# ---------------------------------------------------------------------------
# Climate table extraction
# ---------------------------------------------------------------------------


def _build_col_map(header_row: list[Any]) -> dict[int, str]:
    """Map column index → canonical field name, skipping unknown headers."""
    col_map: dict[int, str] = {}
    for i, cell in enumerate(header_row):
        field = _norm_header(str(cell or ""))
        if field:
            col_map[i] = field
    return col_map


def _extract_climate_rows(
    table: list[list[Any]],
    crop: str,
    region: str,
) -> list[dict]:
    """Convert one pdfplumber table (list of rows) into climate records."""
    if len(table) < 2:
        return []

    col_map = _build_col_map(table[0])
    if not _REQUIRED_CLIMATE_FIELDS.issubset(col_map.values()):
        return []

    records: list[dict] = []
    # Track last-seen stage/month for merged cells that pdfplumber leaves as None
    last_stage: str = ""
    last_month: str = ""

    for row in table[1:]:
        rec: dict[str, Any] = {"crop": crop, "region": region}

        for i, field in col_map.items():
            cell = str(row[i] or "").strip() if i < len(row) else ""

            if field == "crop_stage":
                if cell:
                    last_stage = cell
                rec[field] = last_stage

            elif field == "month":
                if cell:
                    last_month = cell
                rec[field] = last_month

            elif field == "week_number":
                v = _to_int(cell)
                if v is not None:
                    rec[field] = v

            else:  # numeric climate fields
                v = _to_float(cell)
                if v is not None:
                    rec[field] = v

        # Only keep rows with both stage and week
        if rec.get("crop_stage") and "week_number" in rec:
            records.append(rec)

    return records


# ---------------------------------------------------------------------------
# Transposed (column-oriented) calendar extraction
#
# Many BAMIS calendars are printed the other way round from the layout handled
# above: one column per standard week, one row per variable.
#
#   Std.Week        44    45    46   …
#   Rainfall (mm)   7.0   5.0   1.0  …
#   Max. Temp (oC)  31.7  31.0  30.4 …
#   Stages          Germination and Seedling Planting │ Vegetative Growth │ …
#
# Week → value alignment uses the table's own column grid, so merged stage
# cells keep their exact week span.
# ---------------------------------------------------------------------------

# Row label → canonical field name (matched against the row's first label cell)
_TRANSPOSED_FIELDS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^rain(fall)?\b", re.IGNORECASE), "rainfall_mm"),
    (re.compile(r"^max\.?\s*temp", re.IGNORECASE), "max_temp_c"),
    (re.compile(r"^min\.?\s*temp", re.IGNORECASE), "min_temp_c"),
    (re.compile(r"^mean\s*temp", re.IGNORECASE), "mean_temp_c"),
    (re.compile(r"^rh\s*max", re.IGNORECASE), "rh_max_percent"),
    (re.compile(r"^rh\s*min", re.IGNORECASE), "rh_min_percent"),
    (re.compile(r"^ws\s*\(", re.IGNORECASE), "wind_speed_kmh"),
]

_WEEK_HEADER_ROW = re.compile(r"^std\.?\s*week", re.IGNORECASE)
_MONTH_HEADER_ROW = re.compile(r"^months?\b", re.IGNORECASE)
_STAGE_LABEL = re.compile(r"^stages?\b", re.IGNORECASE)

# Section headers that close the weekly block and open an advisory block
_PEST_SECTION = re.compile(
    r"(favou?rable\s+environmental\s+conditions?|congenial\s+weather\s+condition)",
    re.IGNORECASE,
)
_WARNING_SECTION = re.compile(r"^weather\s+warning", re.IGNORECASE)
_FAVORABLE_SECTION = re.compile(
    r"^favou?rable\s+(environment|weather\s+condition)", re.IGNORECASE
)


def _cells(row: list[Any]) -> list[tuple[int, str]]:
    """Return [(column_index, text)] for every non-empty cell in a row."""
    out: list[tuple[int, str]] = []
    for i, cell in enumerate(row):
        text = re.sub(r"\s+", " ", str(cell or "").strip())
        if text:
            out.append((i, text))
    return out


def _row_label(row: list[Any]) -> str:
    """First non-empty cell of a row — the variable/section name."""
    filled = _cells(row)
    return filled[0][1] if filled else ""


def _week_columns(table: list[list[Any]]) -> tuple[int, list[tuple[int, int]]]:
    """Find the Std.Week header row → (row_index, [(column_index, week)])."""
    for ri, row in enumerate(table):
        if _WEEK_HEADER_ROW.match(_row_label(row)):
            weeks = [
                (ci, int(float(text)))
                for ci, text in _cells(row)[1:]
                if re.fullmatch(r"\d{1,2}(\.0)?", text)
            ]
            if len(weeks) >= 3:
                return ri, weeks
    return -1, []


def _align_to_weeks(
    row: list[Any],
    week_cols: list[tuple[int, int]],
) -> dict[int, float]:
    """
    Map one variable row onto week numbers.

    Values normally sit in the same columns as the week headers. When the grid
    shifts, fall back to positional pairing (equal counts) or nearest column.
    """
    values = [(ci, _to_float(text)) for ci, text in _cells(row)[1:]]
    values = [(ci, v) for ci, v in values if v is not None]
    if not values:
        return {}

    by_col = {ci: week for ci, week in week_cols}
    exact = {by_col[ci]: v for ci, v in values if ci in by_col}
    if len(exact) == len(week_cols):
        return exact

    if len(values) == len(week_cols):
        return {week: v for (_, week), (_, v) in zip(week_cols, values)}

    # Nearest-column fallback — keeps partial rows usable
    result: dict[int, float] = {}
    for ci, v in values:
        week = min(week_cols, key=lambda kv: abs(kv[0] - ci))[1]
        result.setdefault(week, v)
    return result


def _span_labels(
    rows: list[list[Any]],
    week_cols: list[tuple[int, int]],
) -> dict[int, str]:
    """
    Map week → stage name from merged "Stages" cells.

    A stage label occupies the first column of its span; continuation lines
    (wrapped text such as "Flowe" / "ring") repeat the same column index and
    are appended to the label started above them.
    """
    labels: dict[int, str] = {}
    for row in rows:
        for ci, text in _cells(row):
            if _STAGE_LABEL.match(text):
                continue
            if ci in labels:
                labels[ci] = f"{labels[ci]} {text}"
            else:
                labels[ci] = text

    if not labels:
        return {}

    starts = sorted(labels)
    assigned: dict[int, str] = {}
    for ci, week in week_cols:
        # The stage whose span starts at or before this week's column
        candidates = [s for s in starts if s <= ci]
        if candidates:
            assigned[week] = labels[candidates[-1]]
    return assigned


def _extract_transposed_rows(
    table: list[list[Any]],
    crop: str,
    region: str,
) -> list[dict]:
    """Convert one column-oriented calendar table into climate records."""
    week_row_idx, week_cols = _week_columns(table)
    if not week_cols:
        return []

    months: dict[int, str] = {}
    fields: dict[str, dict[int, float]] = {}
    last_value_row = week_row_idx

    for ri, row in enumerate(table):
        label = _row_label(row)
        if not label:
            continue
        if _MONTH_HEADER_ROW.match(label) and ri < week_row_idx:
            # Month names sit above the week header and span several weeks
            month_cols = {ci: text.title() for ci, text in _cells(row)[1:]}
            for ci, week in week_cols:
                previous = [c for c in sorted(month_cols) if c <= ci]
                if previous:
                    months[week] = month_cols[previous[-1]]
            continue
        if ri <= week_row_idx:
            continue
        if (
            _PEST_SECTION.search(label)
            or _WARNING_SECTION.match(label)
            or _FAVORABLE_SECTION.match(label)
        ):
            break
        for pattern, field in _TRANSPOSED_FIELDS:
            if pattern.match(label):
                values = _align_to_weeks(row, week_cols)
                if values:
                    fields[field] = values
                    last_value_row = ri
                break

    if not fields:
        return []

    # Stage rows sit between the last numeric row and the first advisory section
    end = len(table)
    for ri in range(last_value_row + 1, len(table)):
        label = _row_label(table[ri])
        if label and (
            _PEST_SECTION.search(label)
            or _WARNING_SECTION.match(label)
            or _FAVORABLE_SECTION.match(label)
        ):
            end = ri
            break
    stages = _span_labels(table[last_value_row + 1 : end], week_cols)

    records: list[dict] = []
    for _, week in week_cols:
        rec: dict[str, Any] = {
            "crop": crop,
            "region": region,
            "week_number": week,
            "month": months.get(week, ""),
            "crop_stage": stages.get(week, ""),
        }
        for field, values in fields.items():
            if week in values:
                rec[field] = values[week]
        if rec["crop_stage"]:
            records.append(rec)

    return records


# ---------------------------------------------------------------------------
# Threshold mining from advisory cells
#
# Pest/disease and weather-warning rows carry their trigger conditions as text:
#   "Temperature : 24-30º C, RH: 55-75%"
#   "Temperature 28-300C, Relative Humidity 80-90%, Cloudiness, Rainfall >30mm"
# These become the `when` blocks the crop module generator turns into
# detect_<disease>() functions.
# ---------------------------------------------------------------------------

_NUM = r"\d+(?:\.\d+)?"

# The degree symbol is frequently extracted as a leading "0" of the unit
# ("28-300C" = 28–30 °C). Separate it before any number is read.
_DEGREE_NOISE = re.compile(r"(\d)0\s*C\b")

# Narrow cells wrap mid-number ("Humidity>9" / "0%") — glue the digits back
_WRAPPED_NUMBER = re.compile(r"(\d)\s+(\d)(?=\s*%)")

# Comparison words used instead of the symbols
_COMPARISON_WORDS = [
    (re.compile(r"\b(less than|lower than|below|under|at most)\b", re.IGNORECASE), "<"),
    (
        re.compile(
            r"\b(more than|greater than|exceeds?|above|at least|higher than)\b",
            re.IGNORECASE,
        ),
        ">",
    ),
]

_TEMP_QUALIFIERS = {
    "minimum": "temperature_min",
    "min": "temperature_min",
    "night": "temperature_min",
    "lower": "temperature_min",
    "low": "temperature_min",
    "maximum": "temperature_max",
    "max": "temperature_max",
    "higher": "temperature_max",
    "high": "temperature_max",
    "day": "temperature_max",
}

_TEMP_RULE = re.compile(
    rf"(?:(minimum|maximum|min|max|night|day|higher|high|lower|low|mean|optimum)\s+)?"
    rf"temperature[^0-9<>]{{0,12}}([<>]?)\s*({_NUM})\s*(?:(?:[-–]|to)\s*({_NUM}))?",
    re.IGNORECASE,
)
_RH_RULE = re.compile(
    rf"(?:rh|relative\s+humidity)[^0-9<>]{{0,12}}([<>]?)\s*({_NUM})"
    rf"\s*(?:(?:[-–]|to)\s*({_NUM}))?",
    re.IGNORECASE,
)
_RAIN_RULE = re.compile(
    rf"rain(?:fall)?[^0-9<>]{{0,15}}([<>]?)\s*({_NUM})\s*(?:(?:[-–]|to)\s*({_NUM}))?",
    re.IGNORECASE,
)

# Cues for conditions no weather feed in this stack provides
_EXTRA_VARIABLE_CUES = [
    (re.compile(r"cloud", re.IGNORECASE), "cloud_cover"),
    (re.compile(r"sunshine", re.IGNORECASE), "sunshine_hours"),
    (re.compile(r"soil", re.IGNORECASE), "soil_temperature"),
    (re.compile(r"\bfog\b", re.IGNORECASE), "fog"),
    (re.compile(r"wet\s+spell", re.IGNORECASE), "wet_spell_duration"),
    (re.compile(r"drizzle", re.IGNORECASE), "precipitation_intensity"),
]


def _bounds(op: str, low: str, high: str | None) -> dict[str, float]:
    """Build a {'min':…, 'max':…} block from a parsed numeric condition."""
    if high:
        return {"min": float(low), "max": float(high)}
    if op == ">":
        return {"min": float(low)}
    if op == "<":
        return {"max": float(low)}
    return {"min": float(low)}


# Daily alert thresholds printed in the "Weather warning" section, e.g.
#   "Rainfall exceeds 5-10 mm (one day)"   "Rain >50 mm/day >100 mm/day"
#   "Wind speed 40 Km/hr or more"          "High wind >50 km/hr >40 km/hr"
_RAIN_VALUES = re.compile(
    rf"({_NUM})(?:\s*(?:[-–]|to)\s*({_NUM}))?\s*mm", re.IGNORECASE
)
_WIND_VALUES = re.compile(
    rf"({_NUM})(?:\s*(?:[-–]|to)\s*({_NUM}))?\s*km\s*/?\s*hr?", re.IGNORECASE
)


def _numeric_series(pattern: re.Pattern[str], text: str) -> list[float]:
    """Every value (both ends of any range) matched by *pattern*, in order."""
    values: list[float] = []
    for m in pattern.finditer(text):
        for group in m.groups():
            if group:
                values.append(float(group))
    return values


def _warning_thresholds(text: str) -> dict[str, list[float]]:
    """Daily rainfall / wind thresholds quoted in a weather-warning row."""
    cleaned = _DEGREE_NOISE.sub(r"\1 C", text)
    thresholds: dict[str, list[float]] = {}

    if re.search(r"\brain", cleaned, re.IGNORECASE):
        values = _numeric_series(_RAIN_VALUES, cleaned)
        if values:
            thresholds["rainfall_mm"] = values
    if re.search(r"\bwind\b", cleaned, re.IGNORECASE):
        values = _numeric_series(_WIND_VALUES, cleaned)
        if values:
            thresholds["wind_speed_kmh"] = values

    return thresholds


def _parse_conditions(text: str) -> tuple[dict, list[str]]:
    """
    Return (when, requires_additional_variables) mined from an advisory cell.
    Only the first match per variable is kept — advisory prose often chains
    several alternative clauses.
    """
    cleaned = _DEGREE_NOISE.sub(r"\1 C", text)
    cleaned = _WRAPPED_NUMBER.sub(r"\1\2", cleaned)
    for pattern, symbol in _COMPARISON_WORDS:
        cleaned = pattern.sub(symbol, cleaned)

    when: dict[str, dict] = {}

    m = _TEMP_RULE.search(cleaned)
    if m:
        qualifier = (m.group(1) or "").lower()
        key = _TEMP_QUALIFIERS.get(qualifier, "temperature_mean")
        when[key] = _bounds(m.group(2), m.group(3), m.group(4))

    m = _RH_RULE.search(cleaned)
    if m:
        when["humidity"] = _bounds(m.group(1), m.group(2), m.group(3))

    m = _RAIN_RULE.search(cleaned)
    if m:
        when["rainfall_mm"] = _bounds(m.group(1), m.group(2), m.group(3))

    extras: list[str] = []
    for pattern, name in _EXTRA_VARIABLE_CUES:
        if pattern.search(cleaned) and name not in extras:
            extras.append(name)

    return when, extras


def _extract_transposed_advisories(
    table: list[list[Any]],
    crop: str,
    region: str,
) -> list[dict]:
    """Read pest/disease and weather-warning rows from a column calendar."""
    records: list[dict] = []
    category: str | None = None

    for row in table:
        filled = _cells(row)
        if not filled:
            continue
        label = filled[0][1]

        if _PEST_SECTION.search(label):
            category = "Pest/Disease"
            continue
        if _WARNING_SECTION.match(label):
            category = "Weather Warning"
            continue
        if _FAVORABLE_SECTION.match(label):
            # Per-stage optimum ranges — context, not an alert rule
            category = None
            continue
        if category is None or len(filled) < 2:
            continue

        description = " ".join(text for _, text in filled[1:])
        # Weather-warning rows name the variable in the label ("Rain", "High
        # wind") and keep only the value in the cells, so mine both together.
        when, extras = _parse_conditions(f"{label} {description}")

        record = {
            "crop": crop,
            "region": region,
            "category": category,
            "name": label.title(),
            "description": description[:300],
            "applicable_period": _extract_period(description),
            "raw_text": f"{label}: {description}"[:500],
        }
        if when:
            record["when"] = when
        if extras:
            record["requires_additional_variables"] = extras
        record["evaluable_with_current_feeds"] = bool(when)
        if category == "Weather Warning":
            thresholds = _warning_thresholds(f"{label} {description}")
            if thresholds:
                record["thresholds"] = thresholds
        records.append(record)

    return records


# ---------------------------------------------------------------------------
# Advisory section extraction (best-effort text mining)
# ---------------------------------------------------------------------------

_ADVISORY_ITEM_START = re.compile(
    r"^[\s•\-\*◆▪►]+(.+)",
    re.MULTILINE,
)
_NAME_FROM_COLON = re.compile(r"^([^:]{3,60}):\s*(.+)")


def _parse_advisory_text(
    section_text: str,
    category: str,
    crop: str,
    region: str,
) -> list[dict]:
    """Split a text block into individual advisory records heuristically."""
    records: list[dict] = []
    lines = [ln.strip() for ln in section_text.splitlines() if ln.strip()]

    # Try to find bullet/dash separated items
    items: list[str] = []
    current: list[str] = []

    for line in lines:
        if re.match(r"^[•\-\*◆▪►]", line):
            if current:
                items.append(" ".join(current))
            current = [line.lstrip("•-*◆▪► ")]
        else:
            current.append(line)
    if current:
        items.append(" ".join(current))

    if not items:
        # Whole block is one advisory
        items = [" ".join(lines)]

    for item in items:
        item = item.strip()
        if not item:
            continue

        m = _NAME_FROM_COLON.match(item)
        if m:
            name = m.group(1).strip().title()
            description = m.group(2).strip()
        else:
            # First few words become the name
            words = item.split()
            name = " ".join(words[: min(4, len(words))]).title()
            description = item

        period = _extract_period(item)

        records.append(
            {
                "crop": crop,
                "region": region,
                "category": category,
                "name": name,
                "description": description[:300],
                "applicable_period": period,
                "raw_text": item[:500],
            }
        )

    return records


def _extract_advisories(pdf: Any, crop: str, region: str) -> list[dict]:
    """Extract advisory records from all pages using text and tables."""
    records: list[dict] = []

    for page in pdf.pages:
        text = page.extract_text() or ""

        # Split text into segments by known section headers
        segments: list[tuple[str, str]] = []  # (category, text_block)
        current_cat: str | None = None
        current_lines: list[str] = []

        for line in text.splitlines():
            matched_cat: str | None = None
            for pattern, cat in _ADVISORY_SECTIONS:
                if pattern.search(line):
                    matched_cat = cat
                    break

            if matched_cat:
                if current_cat and current_lines:
                    segments.append((current_cat, "\n".join(current_lines)))
                current_cat = matched_cat
                current_lines = []
            elif current_cat:
                current_lines.append(line)

        if current_cat and current_lines:
            segments.append((current_cat, "\n".join(current_lines)))

        # Also scan tables on advisory pages for structured advisories
        for table in page.extract_tables():
            if not table or len(table) < 2:
                continue
            headers = [str(c or "").strip().lower() for c in table[0]]
            # If this table has a "name" column, treat rows as advisories
            if "name" not in headers:
                continue
            name_idx = headers.index("name")
            cat_col = next(
                (i for i, h in enumerate(headers) if "category" in h or "type" in h),
                None,
            )
            desc_col = next(
                (
                    i
                    for i, h in enumerate(headers)
                    if "description" in h or "condition" in h or "remark" in h
                ),
                None,
            )
            period_col = next(
                (
                    i
                    for i, h in enumerate(headers)
                    if "period" in h or "month" in h or "week" in h
                ),
                None,
            )

            for row in table[1:]:

                def _cell(idx: int | None, current_row: list = row) -> str:
                    if idx is None or idx >= len(current_row):
                        return ""
                    return str(current_row[idx] or "").strip()

                name = _cell(name_idx)
                if not name:
                    continue
                cat_text = _cell(cat_col)
                category: str
                if "warning" in cat_text.lower():
                    category = "Weather Warning"
                else:
                    category = "Pest/Disease"

                raw = " | ".join(str(c or "") for c in row)
                records.append(
                    {
                        "crop": crop,
                        "region": region,
                        "category": category,
                        "name": name.title(),
                        "description": _cell(desc_col)[:300],
                        "applicable_period": _extract_period(_cell(period_col) or raw),
                        "raw_text": raw[:500],
                    }
                )

        # Parse text segments
        for cat, block in segments:
            records.extend(_parse_advisory_text(block, cat, crop, region))

    return records


# ---------------------------------------------------------------------------
# Main per-PDF entry point
# ---------------------------------------------------------------------------


def parse_pdf(pdf_path: Path) -> list[dict]:
    """Parse one BAMIS PDF and return all records (climate + advisory)."""
    climate_records: list[dict] = []
    advisory_records: list[dict] = []

    try:
        with pdfplumber.open(pdf_path) as pdf:
            first_page_text = pdf.pages[0].extract_text() if pdf.pages else ""
            crop, region = _infer_crop_region(
                pdf_path, region_hint=_region_from_header(first_page_text)
            )

            # Extract climate table from every page (usually page 1)
            for page in pdf.pages:
                for table in page.extract_tables():
                    # Row-oriented layout (weeks as rows) first, then the
                    # column-oriented layout (weeks as columns).
                    rows = _extract_climate_rows(table, crop, region)
                    transposed = not rows
                    if transposed:
                        rows = _extract_transposed_rows(table, crop, region)
                    if rows:
                        # Deduplicate by week_number (first occurrence wins)
                        seen: set[int] = {r["week_number"] for r in climate_records}
                        for r in rows:
                            if r["week_number"] not in seen:
                                climate_records.append(r)
                                seen.add(r["week_number"])
                    if transposed:
                        advisory_records.extend(
                            _extract_transposed_advisories(table, crop, region)
                        )

            # Advisory extraction (best-effort) — only when the column layout
            # did not already yield structured advisory rows
            if not advisory_records:
                advisory_records = _extract_advisories(pdf, crop, region)

    except Exception as exc:  # noqa: BLE001 - one malformed PDF must not stop the batch
        print(f"  [WARN] Failed to parse {pdf_path.name}: {exc}", file=sys.stderr)
        return []

    # Identical advisory rows repeat on every page of a multi-season calendar
    unique_advisories: list[dict] = []
    seen_advisories: set[tuple[str, str]] = set()
    for rec in advisory_records:
        key = (rec.get("category", ""), rec.get("name", ""))
        if key not in seen_advisories:
            seen_advisories.add(key)
            unique_advisories.append(rec)

    return climate_records + unique_advisories


# ---------------------------------------------------------------------------
# Directory scanner
# ---------------------------------------------------------------------------


def parse_all_pdfs(
    pdf_dir: Path,
    crop_filter: str | None = None,
    region_filter: str | None = None,
    verbose: bool = True,
) -> list[dict]:
    """Parse all PDFs under pdf_dir, return flat list of records."""
    pdfs = sorted(pdf_dir.rglob("*.pdf"))
    if not pdfs:
        print(f"[WARN] No PDFs found under {pdf_dir}", file=sys.stderr)
        return []

    all_records: list[dict] = []
    ok = 0

    for pdf_path in pdfs:
        records = parse_pdf(pdf_path)
        if not records:
            continue

        # crop/region can only be known after parsing — the region may come
        # from the calendar header rather than the file path
        crop = records[0].get("crop", "")
        region = records[0].get("region", "")

        if crop_filter and crop != crop_filter:
            continue
        if region_filter and region != region_filter:
            continue

        climate_n = sum(1 for r in records if "week_number" in r)
        advisory_n = len(records) - climate_n

        if verbose:
            status = "OK" if climate_n else "SKIP (no table found)"
            print(
                f"  [{status}] {crop}/{region}: {climate_n} climate, {advisory_n} advisory"
            )

        all_records.extend(records)
        if climate_n:
            ok += 1

    print(f"[INFO] Parsed {ok}/{len(pdfs)} PDFs → {len(all_records)} total records")
    return all_records


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Parse BAMIS crop-calendar PDFs → JSON records"
    )
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument(
        "--pdf-dir", type=Path, help="Directory containing PDFs (recursive)"
    )
    grp.add_argument("--pdf", type=Path, help="Single PDF file to parse")
    ap.add_argument(
        "--out", type=Path, default=None, help="Output JSON path (default: stdout)"
    )
    ap.add_argument("--crop", default=None, help="Filter to this crop name")
    ap.add_argument("--region", default=None, help="Filter to this region name")
    ap.add_argument("--quiet", action="store_true", help="Suppress per-file messages")
    args = ap.parse_args()

    if args.pdf:
        records = parse_pdf(args.pdf)
    else:
        records = parse_all_pdfs(
            args.pdf_dir,
            crop_filter=args.crop,
            region_filter=args.region,
            verbose=not args.quiet,
        )

    payload = json.dumps(records, ensure_ascii=False, indent=2)
    if args.out:
        args.out.write_text(payload, encoding="utf-8")
        print(f"[DONE] {len(records)} records → {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
