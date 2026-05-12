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
    (re.compile(r"insect\s+pest", re.I),       "Pest/Disease"),
    (re.compile(r"\bdisease\b", re.I),          "Pest/Disease"),
    (re.compile(r"pest\s*[&/]\s*disease", re.I),"Pest/Disease"),
    (re.compile(r"weather\s+warning", re.I),    "Weather Warning"),
    (re.compile(r"favorable\s+weather", re.I),  "Weather Warning"),
    (re.compile(r"favourable\s+weather", re.I), "Weather Warning"),
]

# Months used to extract applicable periods from advisory text
_MONTH_NAMES = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)
_MONTH_PATTERN = re.compile(
    r"(" + "|".join(_MONTH_NAMES) + r")"
    r"(?:\s*[-–]\s*(" + "|".join(_MONTH_NAMES) + r"))?",
    re.I,
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
    week_m = re.search(r"week[s]?\s*(\d+)\s*[-–to]+\s*(\d+)", text, re.I)
    if week_m:
        return f"Weeks {week_m.group(1)}–{week_m.group(2)}"
    # Month range
    month_m = _MONTH_PATTERN.search(text)
    if month_m:
        start = month_m.group(1).title()
        end   = month_m.group(2).title() if month_m.group(2) else start
        return f"{start} – {end}" if start != end else start
    return "General / Spans multiple weeks"


# ---------------------------------------------------------------------------
# Filename → crop, region
# ---------------------------------------------------------------------------

def _infer_crop_region(pdf_path: Path) -> tuple[str, str]:
    """
    crawl_bamis.py writes: raw/<crop>/<region>/<crop>_<region>.pdf
    Fall back to splitting the stem on first underscore if path depth differs.
    """
    parts = pdf_path.parts
    # At least 3 levels: .../<crop>/<region>/<file>.pdf
    if len(parts) >= 3:
        region_candidate = parts[-2]
        crop_candidate   = parts[-3]
        stem = pdf_path.stem  # e.g. "potato_dhaka"
        if stem == f"{crop_candidate}_{region_candidate}":
            return crop_candidate, region_candidate

    # Fallback: split stem on first underscore
    stem = pdf_path.stem
    if "_" in stem:
        idx = stem.index("_")
        return stem[:idx], stem[idx + 1:]

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
    last_month: str  = ""

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
            name = " ".join(words[:min(4, len(words))]).title()
            description = item

        period = _extract_period(item)

        records.append({
            "crop":              crop,
            "region":            region,
            "category":          category,
            "name":              name,
            "description":       description[:300],
            "applicable_period": period,
            "raw_text":          item[:500],
        })

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
            cat_col  = next(
                (i for i, h in enumerate(headers) if "category" in h or "type" in h), None
            )
            desc_col = next(
                (i for i, h in enumerate(headers)
                 if "description" in h or "condition" in h or "remark" in h), None
            )
            period_col = next(
                (i for i, h in enumerate(headers)
                 if "period" in h or "month" in h or "week" in h), None
            )

            for row in table[1:]:
                def _cell(idx: int | None) -> str:
                    if idx is None or idx >= len(row):
                        return ""
                    return str(row[idx] or "").strip()

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
                records.append({
                    "crop":              crop,
                    "region":            region,
                    "category":          category,
                    "name":              name.title(),
                    "description":       _cell(desc_col)[:300],
                    "applicable_period": _extract_period(_cell(period_col) or raw),
                    "raw_text":          raw[:500],
                })

        # Parse text segments
        for cat, block in segments:
            records.extend(_parse_advisory_text(block, cat, crop, region))

    return records


# ---------------------------------------------------------------------------
# Main per-PDF entry point
# ---------------------------------------------------------------------------

def parse_pdf(pdf_path: Path) -> list[dict]:
    """Parse one BAMIS PDF and return all records (climate + advisory)."""
    crop, region = _infer_crop_region(pdf_path)
    climate_records: list[dict] = []

    try:
        with pdfplumber.open(pdf_path) as pdf:
            # Extract climate table from every page (usually page 1)
            for page in pdf.pages:
                for table in page.extract_tables():
                    rows = _extract_climate_rows(table, crop, region)
                    if rows:
                        # Deduplicate by week_number (first occurrence wins)
                        seen: set[int] = {r["week_number"] for r in climate_records}
                        for r in rows:
                            if r["week_number"] not in seen:
                                climate_records.append(r)
                                seen.add(r["week_number"])

            # Advisory extraction (best-effort)
            advisory_records = _extract_advisories(pdf, crop, region)

    except Exception as exc:
        print(f"  [WARN] Failed to parse {pdf_path.name}: {exc}", file=sys.stderr)
        return []

    return climate_records + advisory_records


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
        crop, region = _infer_crop_region(pdf_path)

        if crop_filter and crop != crop_filter:
            continue
        if region_filter and region != region_filter:
            continue

        records = parse_pdf(pdf_path)
        climate_n  = sum(1 for r in records if "week_number" in r)
        advisory_n = len(records) - climate_n

        if verbose:
            status = "OK" if climate_n else "SKIP (no table found)"
            print(f"  [{status}] {crop}/{region}: {climate_n} climate, {advisory_n} advisory")

        all_records.extend(records)
        if climate_n:
            ok += 1

    print(f"[INFO] Parsed {ok}/{len(pdfs)} PDFs → {len(all_records)} total records")
    return all_records


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Parse BAMIS crop-calendar PDFs → JSON records")
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument("--pdf-dir", type=Path, help="Directory containing PDFs (recursive)")
    grp.add_argument("--pdf",     type=Path, help="Single PDF file to parse")
    ap.add_argument("--out",    type=Path, default=None,
                    help="Output JSON path (default: stdout)")
    ap.add_argument("--crop",   default=None, help="Filter to this crop name")
    ap.add_argument("--region", default=None, help="Filter to this region name")
    ap.add_argument("--quiet",  action="store_true", help="Suppress per-file messages")
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
