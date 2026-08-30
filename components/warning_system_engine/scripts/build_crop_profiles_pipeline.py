"""
build_crop_profiles_pipeline.py
================================
Master pipeline: BAMIS PDFs → bamis_metadata.json → example_crop_profile.json
                 → app/crops/<crop>/{profile,risk_engine}.py

Steps
─────
  1. parse    – parse every PDF in --pdf-dir using parse_bamis_pdfs.py
                → writes data/bamis_metadata.json
  2. enrich   – run enrich_crop_profiles.py against bamis_metadata.json
                → writes data/example_crop_profile.json
  3. generate – generate app/crops/<crop>/profile.py + risk_engine.py
                for every crop in example_crop_profile.json

Usage
─────
  # Full run from raw PDFs
  python scripts/build_crop_profiles_pipeline.py \\
      --pdf-dir /data/raw_pdfs

  # Skip parsing if bamis_metadata.json is already up to date
  python scripts/build_crop_profiles_pipeline.py \\
      --pdf-dir /data/raw_pdfs --skip-parse

  # Single crop × region (e.g. after re-crawling only potato)
  python scripts/build_crop_profiles_pipeline.py \\
      --pdf-dir /data/raw_pdfs --crop potato --region dhaka

  # Regenerate Python modules only (JSON already current)
  python scripts/build_crop_profiles_pipeline.py \\
      --skip-parse --skip-enrich

Environment variables (override defaults)
────────────────────────────────────────
  BAMIS_PDF_DIR    path to raw PDFs directory
  BAMIS_DATA_DIR   path to output data directory (default: scripts/../data)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Allow running from any working directory inside the container
_SCRIPTS_DIR = Path(__file__).resolve().parent
_ENGINE_ROOT  = _SCRIPTS_DIR.parent
sys.path.insert(0, str(_SCRIPTS_DIR))

import enrich_crop_profiles
import generate_crop_modules
# parse_bamis_pdfs is imported lazily in step_parse() — it requires pdfplumber
# which may not be installed in all environments.


# ---------------------------------------------------------------------------
# Defaults (can be overridden via env vars or CLI flags)
# ---------------------------------------------------------------------------
_DEFAULT_PDF_DIR  = Path(os.getenv("BAMIS_PDF_DIR",  ""))
_DEFAULT_DATA_DIR = Path(os.getenv("BAMIS_DATA_DIR", str(_ENGINE_ROOT / "data")))


# ---------------------------------------------------------------------------
# Step 1 – Parse PDFs → bamis_metadata.json
# ---------------------------------------------------------------------------

def step_parse(
    pdf_dir: Path,
    data_dir: Path,
    crop_filter: str | None,
    region_filter: str | None,
    verbose: bool,
) -> int:
    """Parse PDFs and write bamis_metadata.json. Returns number of records."""
    print("\n── Step 1: Parse PDFs ─────────────────────────────────────────")
    print(f"   PDF dir  : {pdf_dir}")

    if not pdf_dir.exists():
        sys.exit(
            f"[ERROR] PDF directory not found: {pdf_dir}\n"
            "        Run crawl_bamis.py first, or set --pdf-dir / BAMIS_PDF_DIR."
        )

    import parse_bamis_pdfs  # lazy — requires pdfplumber

    t0 = time.time()
    records = parse_bamis_pdfs.parse_all_pdfs(
        pdf_dir,
        crop_filter=crop_filter,
        region_filter=region_filter,
        verbose=verbose,
    )

    if not records:
        sys.exit("[ERROR] No records extracted from PDFs. Aborting.")

    meta_path = data_dir / "bamis_metadata.json"
    data_dir.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    climate_n  = sum(1 for r in records if "week_number" in r)
    advisory_n = len(records) - climate_n
    elapsed = time.time() - t0
    print(
        f"\n   Saved {len(records)} records ({climate_n} climate, {advisory_n} advisory)"
        f" → {meta_path}  [{elapsed:.1f}s]"
    )
    return len(records)


# ---------------------------------------------------------------------------
# Step 2 – Enrich crop profiles
# ---------------------------------------------------------------------------

def step_enrich(
    data_dir: Path,
    crop_filter: str | None,
    region_filter: str | None,
    output_path: Path | None,
) -> int:
    """Run enrich_crop_profiles and write example_crop_profile.json. Returns profile count."""
    print("\n── Step 2: Enrich crop profiles ───────────────────────────────")

    meta_path = data_dir / "bamis_metadata.json"
    if not meta_path.exists():
        sys.exit(
            f"[ERROR] bamis_metadata.json not found at {meta_path}.\n"
            "        Run without --skip-parse first."
        )

    out = output_path or (data_dir / "example_crop_profile.json")
    t0 = time.time()

    # Monkey-patch the module-level path constants so enrich uses our paths
    enrich_crop_profiles._BAMIS_META  = meta_path
    enrich_crop_profiles._OUTPUT_FILE = out

    # Build argv for enrich's argparse
    argv_backup = sys.argv
    sys.argv = ["enrich_crop_profiles"]
    if crop_filter:
        sys.argv += ["--crop", crop_filter]
    if region_filter:
        sys.argv += ["--region", region_filter]
    sys.argv += ["--output", str(out)]

    try:
        enrich_crop_profiles.main()
    finally:
        sys.argv = argv_backup

    elapsed = time.time() - t0
    profiles = json.loads(out.read_text())
    print(f"\n   Written {len(profiles)} profiles → {out}  [{elapsed:.1f}s]")
    return len(profiles)


# ---------------------------------------------------------------------------
# Step 3 – Generate Python crop modules
# ---------------------------------------------------------------------------

def step_generate(
    data_dir: Path,
    crops_dir: Path,
    crop_filter: str | None,
    no_overwrite: bool,
    verbose: bool,
) -> int:
    """Generate app/crops/<crop>/ Python modules. Returns number of files written."""
    print("\n── Step 3: Generate crop Python modules ───────────────────────")
    print(f"   Crops dir: {crops_dir}")

    profile_path = data_dir / "example_crop_profile.json"
    if not profile_path.exists():
        sys.exit(
            f"[ERROR] example_crop_profile.json not found at {profile_path}.\n"
            "        Run without --skip-enrich first."
        )

    t0 = time.time()
    written = generate_crop_modules.generate_all_modules(
        profile_json=profile_path,
        crops_dir=crops_dir,
        crop_filter=crop_filter,
        overwrite=not no_overwrite,
        verbose=verbose,
    )
    elapsed = time.time() - t0
    print(f"\n   Generated {len(written)} files  [{elapsed:.1f}s]")
    return len(written)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description="BAMIS PDF → crop profile pipeline for warning_system_engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument(
        "--pdf-dir", type=Path,
        default=_DEFAULT_PDF_DIR if _DEFAULT_PDF_DIR.parts else None,
        help="Root directory of BAMIS PDFs (raw/<crop>/<region>/<crop>_<region>.pdf)",
    )
    ap.add_argument(
        "--data-dir", type=Path,
        default=_DEFAULT_DATA_DIR,
        help=f"Output directory for JSON artefacts (default: {_DEFAULT_DATA_DIR})",
    )
    ap.add_argument(
        "--crops-dir", type=Path,
        default=_ENGINE_ROOT / "app" / "crops",
        help="Parent directory for generated crop modules (default: app/crops/)",
    )
    ap.add_argument("--crop",   default=None, help="Process only this crop")
    ap.add_argument("--region", default=None, help="Process only this region")
    ap.add_argument(
        "--skip-parse", action="store_true",
        help="Skip PDF parsing; use existing bamis_metadata.json",
    )
    ap.add_argument(
        "--skip-enrich", action="store_true",
        help="Skip profile enrichment; use existing example_crop_profile.json",
    )
    ap.add_argument(
        "--skip-generate", action="store_true",
        help="Skip Python module generation (steps 1–2 only)",
    )
    ap.add_argument(
        "--no-overwrite", action="store_true",
        help="Do not overwrite existing crop module files",
    )
    ap.add_argument(
        "--output", type=Path, default=None,
        help="Override output path for example_crop_profile.json",
    )
    ap.add_argument("--quiet", action="store_true", help="Suppress per-file messages")
    args = ap.parse_args()

    t_start = time.time()
    print("═" * 60)
    print("  BAMIS Crop Profile Pipeline")
    print("═" * 60)
    print(f"  Data dir  : {args.data_dir}")
    print(f"  Crops dir : {args.crops_dir}")

    # ── Step 1: Parse PDFs ───────────────────────────────────────
    if args.skip_parse:
        print("\n── Step 1: Parse PDFs ── SKIPPED (--skip-parse)")
    else:
        if not args.pdf_dir:
            ap.error(
                "--pdf-dir is required unless --skip-parse is set.\n"
                "You can also export BAMIS_PDF_DIR=/path/to/raw_pdfs"
            )
        step_parse(
            pdf_dir=args.pdf_dir,
            data_dir=args.data_dir,
            crop_filter=args.crop,
            region_filter=args.region,
            verbose=not args.quiet,
        )

    # ── Step 2: Enrich profiles ──────────────────────────────────
    if args.skip_enrich:
        print("\n── Step 2: Enrich profiles ── SKIPPED (--skip-enrich)")
    else:
        step_enrich(
            data_dir=args.data_dir,
            crop_filter=args.crop,
            region_filter=args.region,
            output_path=args.output,
        )

    # ── Step 3: Generate Python modules ─────────────────────────
    if args.skip_generate:
        print("\n── Step 3: Generate modules ── SKIPPED (--skip-generate)")
    else:
        step_generate(
            data_dir=args.data_dir,
            crops_dir=args.crops_dir,
            crop_filter=args.crop,
            no_overwrite=args.no_overwrite,
            verbose=not args.quiet,
        )

    total = time.time() - t_start
    print(f"\n{'═'*60}")
    print(f"  Pipeline complete in {total:.1f}s")
    print(f"{'═'*60}")


if __name__ == "__main__":
    main()
