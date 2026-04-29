#!/usr/bin/env python3
"""
AMINA — 1 Million Example Dataset Builder
==========================================
Combines scraped WHO data with existing golden_standard.jsonl,
deduplicates, normalizes to a single format, and writes the final
training file.

Usage:
  python build_million_dataset.py \
    --who      /root/amina-training/data/who/who_training_pairs.jsonl \
    --existing /root/amina-training/data/golden_standard.jsonl \
    --output   /root/amina-training/data/golden_standard_v2.jsonl
"""

import json
import os
import argparse
import hashlib
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

AMINA_SYSTEM = (
    "You are Amina, a trusted Community Health Worker in The Gambia. "
    "You speak warmly and directly. You follow WHO PEN protocols. "
    "You NEVER prescribe medication. You refer emergencies to the nearest health post or call 199. "
    "You give clear, practical health information. 3-6 sentences max per response."
)


def normalize(record: dict) -> dict | None:
    """Normalize any input format to {messages: [...]} SFT format."""
    # Already in messages format
    if "messages" in record:
        msgs = record["messages"]
        if not any(m.get("role") == "system" for m in msgs):
            msgs = [{"role": "system", "content": AMINA_SYSTEM}] + msgs
        return {"messages": msgs, "source": record.get("source", "unknown")}

    # instruction/output format (ChatDoctor / WHO scraped)
    instruction = record.get("instruction") or record.get("prompt") or ""
    output      = record.get("output") or record.get("response") or record.get("answer") or ""
    inp         = record.get("input", "")

    if not instruction or not output:
        return None
    if len(output.strip()) < 30:
        return None

    user_content = f"{instruction}\n{inp}".strip() if inp else instruction

    return {
        "messages": [
            {"role": "system",    "content": AMINA_SYSTEM},
            {"role": "user",      "content": user_content},
            {"role": "assistant", "content": output},
        ],
        "source":   record.get("source", "unknown"),
        "category": record.get("category", "general"),
        "license":  record.get("license", "unknown"),
    }


def fingerprint(record: dict) -> str:
    """Generate a dedup key from user+assistant text."""
    msgs = record.get("messages", [])
    user = next((m["content"] for m in msgs if m["role"] == "user"), "")
    asst = next((m["content"] for m in msgs if m["role"] == "assistant"), "")
    return hashlib.md5(f"{user[:120]}{asst[:120]}".encode()).hexdigest()


def load_jsonl(path: str):
    if not os.path.exists(path):
        log.warning(f"File not found: {path}")
        return
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                log.debug(f"Bad JSON at line {i} in {path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--who",      default="/root/amina-training/data/who/who_training_pairs.jsonl")
    parser.add_argument("--existing", default="/root/amina-training/data/golden_standard.jsonl")
    parser.add_argument("--output",   default="/root/amina-training/data/golden_standard_v2.jsonl")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    seen       = set()
    total_in   = 0
    total_out  = 0
    by_source  = {}

    who_pdfs = os.path.join(os.path.dirname(args.who), "..", "who_pdfs", "who_pdf_pairs.jsonl")
    who_pdfs = os.path.normpath(who_pdfs)

    sources = [
        ("existing",  args.existing),
        ("who_html",  args.who),
        ("who_pdfs",  who_pdfs),
    ]

    with open(args.output, "w", encoding="utf-8") as out:
        for source_label, path in sources:
            count = 0
            for raw in load_jsonl(path):
                total_in += 1
                norm = normalize(raw)
                if not norm:
                    continue
                fp = fingerprint(norm)
                if fp in seen:
                    continue
                seen.add(fp)
                out.write(json.dumps(norm, ensure_ascii=False) + "\n")
                count += 1
                total_out += 1

            by_source[source_label] = count
            log.info(f"{source_label}: {count:,} examples added")

    log.info("=== Build Complete ===")
    log.info(f"Input records:  {total_in:,}")
    log.info(f"Deduped output: {total_out:,}")
    for k, v in by_source.items():
        log.info(f"  {k}: {v:,}")
    log.info(f"Output: {args.output}")
    print(f"\n✓ {total_out:,} examples → {args.output}")


if __name__ == "__main__":
    main()
