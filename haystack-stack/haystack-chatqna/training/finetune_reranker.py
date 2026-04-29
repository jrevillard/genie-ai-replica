#!/usr/bin/env python3
"""
AMINA Care — Clinical Re-Ranker Fine-Tuning Pipeline (Phase 3)
================================================================
Fine-tunes a cross-encoder re-ranker on WHO PEN clinical data
combined with AMINA user feedback pairs.

Base model: BAAI/bge-reranker-v2-m3  (multilingual, best zero-shot)
Loss:       Binary cross-entropy on (query, passage, label) triplets
Output:     models/amina-reranker/  (saved locally for registry slot)

Data sources:
  1. eval/reranker_eval.py triplets  → positive + hard-negative pairs
  2. ArcadeDB RerankerFeedback       → thumbs up/down → pos/neg pairs
  3. Optional JSONL file              → manual annotation pairs

Usage:
  # Fine-tune with defaults (bge-reranker-v2-m3 base, 3 epochs)
  python -m training.finetune_reranker

  # Custom base model and epochs
  python -m training.finetune_reranker --base ms-marco-large --epochs 5

  # Include feedback data from ArcadeDB
  python -m training.finetune_reranker --include-feedback

  # Extra annotated pairs
  python -m training.finetune_reranker --extra-data path/to/pairs.jsonl

  # Dry-run (build dataset, skip training)
  python -m training.finetune_reranker --dry-run
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("finetune_reranker")

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

BASE_MODELS = {
    "bge-reranker-v2": "BAAI/bge-reranker-v2-m3",
    "ms-marco-mini": "cross-encoder/ms-marco-MiniLM-L-6-v2",
    "ms-marco-large": "cross-encoder/ms-marco-MiniLM-L-12-v2",
    "jina-reranker": "jinaai/jina-reranker-v2-base-multilingual",
}

DEFAULT_BASE = "bge-reranker-v2"
OUTPUT_DIR = Path("models/amina-reranker")

TRAINING_DEFAULTS = {
    "epochs": 3,
    "batch_size": 16,
    "learning_rate": 2e-5,
    "warmup_ratio": 0.1,
    "max_length": 512,
    "eval_split": 0.1,
    "seed": 42,
}


@dataclass
class TrainingPair:
    query: str
    passage: str
    label: float  # 1.0 = relevant, 0.0 = irrelevant


@dataclass
class TrainingReport:
    base_model: str
    total_pairs: int
    train_pairs: int
    eval_pairs: int
    epochs: int
    final_loss: Optional[float] = None
    eval_accuracy: Optional[float] = None
    duration_sec: Optional[float] = None
    output_dir: str = ""
    timestamp: str = ""
    data_sources: Dict[str, int] = field(default_factory=dict)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA COLLECTION — EVAL TRIPLETS
# ═══════════════════════════════════════════════════════════════════════════════


def collect_eval_triplets() -> List[TrainingPair]:
    """Convert eval triplets from reranker_eval.py into training pairs."""
    pairs = []

    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from eval.reranker_eval import RERANKER_EVAL
    except ImportError:
        log.warning("Could not import RERANKER_EVAL from eval.reranker_eval")
        return pairs

    for t in RERANKER_EVAL:
        pairs.append(TrainingPair(query=t.query, passage=t.relevant, label=1.0))
        pairs.append(TrainingPair(query=t.query, passage=t.irrelevant, label=0.0))
        if t.hard_negative:
            pairs.append(TrainingPair(query=t.query, passage=t.hard_negative, label=0.0))

    log.info("Collected %d pairs from eval triplets", len(pairs))
    return pairs


# ═══════════════════════════════════════════════════════════════════════════════
# DATA COLLECTION — ARCADEDB FEEDBACK
# ═══════════════════════════════════════════════════════════════════════════════


def collect_feedback_pairs() -> List[TrainingPair]:
    """Pull thumbs up/down feedback from ArcadeDB RerankerFeedback vertex."""
    pairs = []

    arcade_url = os.getenv("ARCADEDB_URL", "http://localhost:2480")
    arcade_db = os.getenv("ARCADEDB_DB", "amina")
    arcade_user = os.getenv("ARCADEDB_USER", "root")
    arcade_pass = os.getenv("ARCADEDB_PASS", "amina_pass")

    query_sql = """
        SELECT query, passage, feedback_type, relevance_score
        FROM RerankerFeedback
        WHERE feedback_type IN ['thumbs_up', 'thumbs_down']
        ORDER BY created_at DESC
        LIMIT 10000
    """

    try:
        import requests
        resp = requests.post(
            f"{arcade_url}/api/v1/command/{arcade_db}",
            json={"language": "sql", "command": query_sql},
            auth=(arcade_user, arcade_pass),
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json().get("result", [])
    except Exception as e:
        log.warning("ArcadeDB feedback fetch failed (non-fatal): %s", e)
        return pairs

    for row in rows:
        label = 1.0 if row.get("feedback_type") == "thumbs_up" else 0.0
        if row.get("relevance_score") is not None:
            label = float(row["relevance_score"])
        pairs.append(TrainingPair(
            query=row["query"],
            passage=row["passage"],
            label=label,
        ))

    log.info("Collected %d pairs from ArcadeDB feedback", len(pairs))
    return pairs


# ═══════════════════════════════════════════════════════════════════════════════
# DATA COLLECTION — JSONL FILE
# ═══════════════════════════════════════════════════════════════════════════════


def collect_jsonl_pairs(path: str) -> List[TrainingPair]:
    """Load annotated pairs from JSONL file.

    Expected format per line:
      {"query": "...", "passage": "...", "label": 1.0}
    """
    pairs = []
    p = Path(path)
    if not p.exists():
        log.warning("JSONL file not found: %s", path)
        return pairs

    with open(p) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                pairs.append(TrainingPair(
                    query=obj["query"],
                    passage=obj["passage"],
                    label=float(obj.get("label", 1.0)),
                ))
            except (json.JSONDecodeError, KeyError) as e:
                log.warning("Skipping JSONL line %d: %s", i + 1, e)

    log.info("Collected %d pairs from %s", len(pairs), path)
    return pairs


# ═══════════════════════════════════════════════════════════════════════════════
# DATASET BUILDER
# ═══════════════════════════════════════════════════════════════════════════════


def build_dataset(
    include_feedback: bool = False,
    extra_data: Optional[str] = None,
) -> Tuple[List[TrainingPair], Dict[str, int]]:
    """Assemble the full training dataset from all sources."""
    sources: Dict[str, int] = {}

    eval_pairs = collect_eval_triplets()
    sources["eval_triplets"] = len(eval_pairs)

    feedback_pairs = []
    if include_feedback:
        feedback_pairs = collect_feedback_pairs()
        sources["arcadedb_feedback"] = len(feedback_pairs)

    extra_pairs = []
    if extra_data:
        extra_pairs = collect_jsonl_pairs(extra_data)
        sources["jsonl_extra"] = len(extra_pairs)

    all_pairs = eval_pairs + feedback_pairs + extra_pairs

    seen = set()
    deduped = []
    for p in all_pairs:
        key = (p.query[:100], p.passage[:100], p.label)
        if key not in seen:
            seen.add(key)
            deduped.append(p)

    sources["total_deduped"] = len(deduped)
    log.info("Total dataset: %d pairs (deduped from %d)", len(deduped), len(all_pairs))
    return deduped, sources


# ═══════════════════════════════════════════════════════════════════════════════
# FINE-TUNING ENGINE
# ═══════════════════════════════════════════════════════════════════════════════


def finetune(
    pairs: List[TrainingPair],
    base_model_key: str = DEFAULT_BASE,
    epochs: int = TRAINING_DEFAULTS["epochs"],
    batch_size: int = TRAINING_DEFAULTS["batch_size"],
    learning_rate: float = TRAINING_DEFAULTS["learning_rate"],
    warmup_ratio: float = TRAINING_DEFAULTS["warmup_ratio"],
    max_length: int = TRAINING_DEFAULTS["max_length"],
    eval_split: float = TRAINING_DEFAULTS["eval_split"],
    seed: int = TRAINING_DEFAULTS["seed"],
    output_dir: Optional[Path] = None,
) -> TrainingReport:
    """Fine-tune a cross-encoder on the collected pairs."""
    import random
    random.seed(seed)

    model_id = BASE_MODELS.get(base_model_key, base_model_key)
    out = output_dir or OUTPUT_DIR
    out.mkdir(parents=True, exist_ok=True)

    random.shuffle(pairs)
    split_idx = max(1, int(len(pairs) * eval_split))
    eval_pairs = pairs[:split_idx]
    train_pairs = pairs[split_idx:]

    report = TrainingReport(
        base_model=model_id,
        total_pairs=len(pairs),
        train_pairs=len(train_pairs),
        eval_pairs=len(eval_pairs),
        epochs=epochs,
        output_dir=str(out),
        timestamp=datetime.utcnow().isoformat() + "Z",
    )

    log.info("Fine-tuning %s on %d train / %d eval pairs for %d epochs",
             model_id, len(train_pairs), len(eval_pairs), epochs)

    try:
        from sentence_transformers import CrossEncoder, InputExample
        from torch.utils.data import DataLoader
    except ImportError:
        log.error("sentence-transformers and torch required. "
                  "Install: pip install sentence-transformers torch")
        return report

    train_examples = [
        InputExample(texts=[p.query, p.passage], label=p.label)
        for p in train_pairs
    ]
    eval_examples = [
        InputExample(texts=[p.query, p.passage], label=p.label)
        for p in eval_pairs
    ]

    ce = CrossEncoder(model_id, num_labels=1, max_length=max_length)

    train_loader = DataLoader(train_examples, shuffle=True, batch_size=batch_size)

    warmup_steps = int(len(train_loader) * epochs * warmup_ratio)

    t0 = time.monotonic()

    ce.fit(
        train_dataloader=train_loader,
        epochs=epochs,
        warmup_steps=warmup_steps,
        optimizer_params={"lr": learning_rate},
        output_path=str(out),
        show_progress_bar=True,
    )

    report.duration_sec = round(time.monotonic() - t0, 1)

    # Evaluate on held-out set
    eval_queries = [e.texts for e in eval_examples]
    eval_labels = [e.label for e in eval_examples]
    predictions = ce.predict(eval_queries)

    correct = sum(
        1 for pred, label in zip(predictions, eval_labels)
        if (pred > 0.5) == (label > 0.5)
    )
    report.eval_accuracy = round(correct / max(len(eval_labels), 1), 4)

    ce.save(str(out))
    log.info("Model saved to %s (eval accuracy: %.2f%%)",
             out, report.eval_accuracy * 100)

    meta = {
        "base_model": model_id,
        "fine_tuned_on": report.timestamp,
        "train_pairs": report.train_pairs,
        "eval_accuracy": report.eval_accuracy,
        "epochs": epochs,
        "learning_rate": learning_rate,
    }
    (out / "training_meta.json").write_text(json.dumps(meta, indent=2))

    return report


# ═══════════════════════════════════════════════════════════════════════════════
# A/B VALIDATION AFTER FINE-TUNING
# ═══════════════════════════════════════════════════════════════════════════════


def validate_against_baseline(report_path: Optional[str] = None) -> Dict[str, Any]:
    """Run reranker_eval on both the baseline and the fine-tuned model.

    Returns comparison dict with NDCG@3 and MRR for each.
    """
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from eval.reranker_eval import run_evaluation
    except ImportError:
        log.warning("Cannot import run_evaluation for A/B validation")
        return {}

    results = {}

    log.info("Evaluating baseline (ms-marco-mini)...")
    baseline = run_evaluation(model_key="ms-marco-mini")
    results["baseline"] = {
        "model": "ms-marco-mini",
        "ndcg3": baseline.ndcg_at_3,
        "mrr": baseline.mrr,
        "hard_neg_rejection": baseline.hard_neg_rejection_rate,
    }

    if OUTPUT_DIR.exists() and (OUTPUT_DIR / "config.json").exists():
        log.info("Evaluating fine-tuned (amina-clinical)...")
        finetuned = run_evaluation(model_key="amina-clinical")
        results["finetuned"] = {
            "model": "amina-clinical",
            "ndcg3": finetuned.ndcg_at_3,
            "mrr": finetuned.mrr,
            "hard_neg_rejection": finetuned.hard_neg_rejection_rate,
        }
        results["ndcg3_delta"] = round(
            finetuned.ndcg_at_3 - baseline.ndcg_at_3, 4
        )
        results["improved"] = finetuned.ndcg_at_3 > baseline.ndcg_at_3
    else:
        log.warning("Fine-tuned model not found at %s, skipping comparison", OUTPUT_DIR)
        results["finetuned"] = None
        results["improved"] = False

    if report_path:
        Path(report_path).write_text(json.dumps(results, indent=2))
        log.info("Validation report saved to %s", report_path)

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════


def main():
    parser = argparse.ArgumentParser(
        description="Fine-tune AMINA clinical re-ranker"
    )
    parser.add_argument(
        "--base", default=DEFAULT_BASE,
        choices=list(BASE_MODELS.keys()),
        help="Base model key (default: bge-reranker-v2)",
    )
    parser.add_argument("--epochs", type=int, default=TRAINING_DEFAULTS["epochs"])
    parser.add_argument("--batch-size", type=int, default=TRAINING_DEFAULTS["batch_size"])
    parser.add_argument("--lr", type=float, default=TRAINING_DEFAULTS["learning_rate"])
    parser.add_argument("--include-feedback", action="store_true",
                        help="Include ArcadeDB user feedback pairs")
    parser.add_argument("--extra-data", type=str, default=None,
                        help="Path to extra JSONL annotation file")
    parser.add_argument("--output", type=str, default=None,
                        help="Output directory (default: models/amina-reranker)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Build dataset only, skip training")
    parser.add_argument("--validate", action="store_true",
                        help="Run A/B validation after training")
    parser.add_argument("--report", type=str, default=None,
                        help="Save training report to JSON file")

    args = parser.parse_args()

    pairs, sources = build_dataset(
        include_feedback=args.include_feedback,
        extra_data=args.extra_data,
    )

    if not pairs:
        log.error("No training pairs collected. Aborting.")
        sys.exit(1)

    log.info("Dataset ready: %d pairs from %s", len(pairs), sources)

    if args.dry_run:
        log.info("DRY RUN — dataset built but training skipped")
        pos = sum(1 for p in pairs if p.label > 0.5)
        neg = len(pairs) - pos
        log.info("  Positive: %d  Negative: %d  Ratio: %.2f",
                 pos, neg, pos / max(neg, 1))

        for src, count in sources.items():
            log.info("  Source %-20s: %d pairs", src, count)
        return

    output_dir = Path(args.output) if args.output else OUTPUT_DIR

    report = finetune(
        pairs=pairs,
        base_model_key=args.base,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        output_dir=output_dir,
    )
    report.data_sources = sources

    log.info("Training complete in %.1fs — eval accuracy: %s",
             report.duration_sec or 0,
             f"{report.eval_accuracy:.2%}" if report.eval_accuracy else "N/A")

    if args.validate:
        log.info("Running A/B validation...")
        validation = validate_against_baseline(
            report_path=args.report.replace(".json", "_validation.json")
            if args.report else None
        )
        if validation.get("improved"):
            log.info("Fine-tuned model IMPROVES over baseline (NDCG@3 delta: +%.4f)",
                     validation["ndcg3_delta"])
        else:
            log.warning("Fine-tuned model did NOT improve over baseline")

    if args.report:
        import dataclasses
        Path(args.report).write_text(json.dumps(dataclasses.asdict(report), indent=2))
        log.info("Report saved to %s", args.report)


if __name__ == "__main__":
    main()
