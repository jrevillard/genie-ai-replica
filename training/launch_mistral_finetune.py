#!/usr/bin/env python3
"""
AMINA — Mistral La Plateforme Fine-Tune Launcher
=================================================

Uploads the prepped JSONL and kicks off a fine-tuning job on Mistral Small
(or other Mistral models). No GPU needed — Mistral handles everything.

Prerequisites:
  pip install mistralai
  export MISTRAL_API_KEY=...

Usage:
  # Fine-tune Mistral Small (recommended)
  python launch_mistral_finetune.py

  # Use custom data file
  python launch_mistral_finetune.py --data finetune_output/mistral_finetune.jsonl

  # Check status
  python launch_mistral_finetune.py --status <job-id>

  # List jobs
  python launch_mistral_finetune.py --list
"""

import argparse
import json
import os
import sys
import time

try:
    from mistralai import Mistral
except ImportError:
    print("Install mistralai: pip install mistralai")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(SCRIPT_DIR, "finetune_output", "mistral_finetune.jsonl")

MODELS = {
    "mistral-small": "mistral-small-latest",
    "mistral-medium": "mistral-medium-latest",
    "mistral-large": "mistral-large-latest",
}


def validate_data(path: str) -> int:
    """Quick JSONL validation."""
    count = 0
    errors = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                d = json.loads(line.strip())
                msgs = d.get("messages", [])
                if msgs and any(m["role"] == "assistant" for m in msgs):
                    count += 1
                else:
                    errors += 1
            except (json.JSONDecodeError, KeyError):
                errors += 1

    print(f"Validated: {count:,} valid, {errors} errors")
    return count


def upload_and_finetune(data_path: str, model_key: str, suffix: str, epochs: int, lr: float, api_key: str):
    """Upload and create fine-tune job on Mistral."""
    model_id = MODELS.get(model_key, model_key)
    client = Mistral(api_key=api_key)

    print(f"\n{'='*60}")
    print(f"AMINA Fine-Tune → Mistral La Plateforme ({model_key})")
    print(f"{'='*60}")
    print(f"Data:   {data_path}")
    print(f"Model:  {model_id}")
    print(f"Suffix: {suffix}")
    print(f"Epochs: {epochs}")
    print(f"LR:     {lr}")
    print()

    count = validate_data(data_path)
    if count == 0:
        print("ERROR: No valid examples")
        sys.exit(1)

    # Upload file
    file_size_mb = os.path.getsize(data_path) / 1e6
    print(f"\nUploading {data_path} ({file_size_mb:.1f} MB)...")

    with open(data_path, "rb") as f:
        file_obj = client.files.upload(
            file={
                "file_name": os.path.basename(data_path),
                "content": f.read(),
            },
            purpose="fine-tune",
        )

    print(f"File ID: {file_obj.id}")

    # Create fine-tuning job
    print(f"\nCreating fine-tuning job...")
    job = client.fine_tuning.jobs.create(
        model=model_id,
        training_files=[{"file_id": file_obj.id, "weight": 1}],
        hyperparameters={
            "training_steps": None,
            "learning_rate": lr,
            "epochs": epochs,
        },
        suffix=suffix,
    )

    print(f"\n{'='*60}")
    print(f"FINE-TUNING JOB CREATED")
    print(f"{'='*60}")
    print(f"Job ID:       {job.id}")
    print(f"Status:       {job.status}")
    print(f"Model:        {job.model}")
    print(f"Created:      {job.created_at}")
    print(f"\nEstimated time: 2-8 hours for 145K examples")
    print(f"\nCheck status:")
    print(f"  python launch_mistral_finetune.py --status {job.id}")
    print(f"\nOnce complete, use the model in AMINA by setting:")
    print(f"  MISTRAL_MODEL=ft:{model_id}:{suffix}:...")
    print(f"{'='*60}")

    return job


def check_status(job_id: str, api_key: str):
    """Check job status."""
    client = Mistral(api_key=api_key)
    job = client.fine_tuning.jobs.get(job_id=job_id)

    print(f"\n{'='*60}")
    print(f"FINE-TUNE JOB STATUS")
    print(f"{'='*60}")
    print(f"Job ID:         {job.id}")
    print(f"Status:         {job.status}")
    print(f"Model:          {job.model}")
    print(f"Created:        {job.created_at}")

    if hasattr(job, "fine_tuned_model") and job.fine_tuned_model:
        print(f"Fine-tuned model: {job.fine_tuned_model}")
        print(f"\n→ Use this model ID in AMINA:")
        print(f"  MISTRAL_MODEL={job.fine_tuned_model}")
    if hasattr(job, "trained_tokens") and job.trained_tokens:
        print(f"Trained tokens: {job.trained_tokens:,}")

    print(f"{'='*60}")


def list_jobs(api_key: str):
    """List all fine-tuning jobs."""
    client = Mistral(api_key=api_key)
    jobs = client.fine_tuning.jobs.list()

    print(f"\n{'='*60}")
    print(f"MISTRAL FINE-TUNING JOBS")
    print(f"{'='*60}")
    for job in jobs.data:
        model_out = getattr(job, "fine_tuned_model", None) or "(training...)"
        print(f"  {job.id}  {job.status:<12}  {job.model}  →  {model_out}")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="AMINA Mistral Fine-Tune Launcher")
    parser.add_argument("--data", default=DEFAULT_DATA, help="Path to Mistral JSONL")
    parser.add_argument("--model", default="mistral-small", choices=list(MODELS.keys()), help="Model to fine-tune")
    parser.add_argument("--suffix", default="amina-care", help="Model suffix")
    parser.add_argument("--epochs", type=int, default=3, help="Training epochs")
    parser.add_argument("--lr", type=float, default=1e-4, help="Learning rate")
    parser.add_argument("--status", default=None, help="Check job status")
    parser.add_argument("--list", action="store_true", help="List all jobs")
    parser.add_argument("--api-key", default=None, help="Mistral API key (or set MISTRAL_API_KEY)")
    args = parser.parse_args()

    api_key = args.api_key or os.getenv("MISTRAL_API_KEY")
    if not api_key:
        print("ERROR: Set MISTRAL_API_KEY env var or pass --api-key")
        sys.exit(1)

    if args.list:
        list_jobs(api_key)
    elif args.status:
        check_status(args.status, api_key)
    else:
        if not os.path.exists(args.data):
            print(f"ERROR: Data file not found: {args.data}")
            print(f"Run prep_finetune_data.py first")
            sys.exit(1)
        upload_and_finetune(args.data, args.model, args.suffix, args.epochs, args.lr, api_key)


if __name__ == "__main__":
    main()
