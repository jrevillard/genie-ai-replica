import json
import uuid
from pathlib import Path
from typing import Any

# ==========================
# TEXT BUILDERS
# ==========================
_ADVISORY_LABEL = {
    "insect_pest": "Insect Pest",
    "disease": "Disease",
    "weather_warning": "Weather Warning",
    "favorable_weather": "Favorable Weather",
}


def _climate_text(r: dict[str, Any]) -> str:
    return (
        f"Crop: {r['crop']} | Region: {r['region']} | "
        f"Week {r['week_number']} ({r.get('month', '')}) | "
        f"Stage: {r.get('crop_stage', '')}. "
        f"Climate: Rainfall {r.get('rainfall_mm') or 'N/A'}mm, "
        f"Temp {r.get('min_temp_c') or '?'}-{r.get('max_temp_c') or '?'}°C, "
        f"RH {r.get('rh_min_percent') or '?'}-{r.get('rh_max_percent') or '?'}%."
    )


def _advisory_text(r: dict[str, Any]) -> str:
    kind = _ADVISORY_LABEL.get(r["record_kind"], r["record_kind"])
    name = r.get("name", "")
    # week_numbers and months are comma-joined strings (from _encode_flat_value)
    weeks_str = r.get("week_numbers", "")
    months_str = r.get("months", "")
    period = f"{months_str} (weeks {weeks_str})" if weeks_str else months_str or "General"
    cond_parts: list[str] = []
    cond_raw = r.get("conditions_json", "")
    if cond_raw:
        try:
            cond = json.loads(cond_raw)
            cond_parts = [
                f"{k.replace('_', ' ')}: {v}" for k, v in cond.items() if v is not None
            ]
        except Exception:
            pass
    text = f"{kind} for {r['crop']} in {r['region']}: {name}. Applies: {period}."
    if cond_parts:
        text += f" Conditions: {', '.join(cond_parts)}."
    return text


def record_to_chunk(r: dict[str, Any]) -> dict[str, Any]:
    kind = r.get("record_kind", "")
    if kind == "calendar_week":
        chunk_id = f"climate_{r['crop']}_{r['region']}_w{r['week_number']}"
        text = _climate_text(r)
    else:
        chunk_id = f"{kind}_{uuid.uuid4().hex[:8]}"
        text = _advisory_text(r)
    # Exclude heavy/index-irrelevant fields from stored metadata
    meta = {k: v for k, v in r.items() if k not in ("source_url", "fetched_at", "type")}
    return {"id": chunk_id, "text": text, "metadata": meta}


# ==========================
# MAIN EXECUTION
# ==========================
def main():
    input_dir = Path("../mcp_weather/data/agri_data/raw")
    output_jsonl = Path("../mcp_weather/data/agri_data/vector_ready_chunks.jsonl")
    output_jsonl.parent.mkdir(parents=True, exist_ok=True)

    print("Starting BAMIS JSON → Vector Chunk pipeline...")

    json_files = sorted(input_dir.rglob("*.json"))
    if not json_files:
        print(f"No JSON files found under {input_dir}. Run crawl_bamis.py first.")
        return

    all_chunks: list[dict[str, Any]] = []

    for json_path in json_files:
        try:
            records = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  Skip {json_path.name}: {e}")
            continue

        if not isinstance(records, list):
            records = [records]

        file_chunks: list[dict[str, Any]] = []
        for r in records:
            try:
                file_chunks.append(record_to_chunk(r))
            except Exception as e:
                print(f"  Skip record in {json_path.name}: {e}")

        all_chunks.extend(file_chunks)
        rel = json_path.relative_to(input_dir)
        print(f"  {rel}: {len(records)} records → {len(file_chunks)} chunks")

    with open(output_jsonl, "w", encoding="utf-8") as f:
        for chunk in all_chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + "\n")

    print(f"\nGenerated {len(all_chunks)} vector-ready chunks → {output_jsonl}")


if __name__ == "__main__":
    main()