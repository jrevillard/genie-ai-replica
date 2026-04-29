#!/usr/bin/env python3
"""
AMINA — OpenAI Fine-Tune Launcher
==================================

Uploads the prepped JSONL and kicks off a fine-tuning job on GPT-4o-mini
(or GPT-4o). No GPU needed — OpenAI handles everything.

Prerequisites:
  pip install openai
  export OPENAI_API_KEY=sk-...

Usage:
  # Fine-tune GPT-4o-mini (recommended — best cost/quality ratio)
  python launch_openai_finetune.py

  # Fine-tune GPT-4o (higher ceiling, ~4x cost)
  python launch_openai_finetune.py --model gpt-4o-2024-08-06

  # Use custom data file
  python launch_openai_finetune.py --data finetune_output/openai_finetune.jsonl

  # Check status of running job
  python launch_openai_finetune.py --status ftjob-abc123

  # List all fine-tune jobs
  python launch_openai_finetune.py --list
"""

import argparse
import json
import os
import sys
import time

try:
    from openai import OpenAI
except ImportError:
    print("Install openai: pip install openai")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(SCRIPT_DIR, "finetune_output", "openai_finetune.jsonl")

# Supported fine-tune models
MODELS = {
    "gpt-4o-mini": "gpt-4o-mini-2024-07-18",
    "gpt-4o": "gpt-4o-2024-08-06",
}


def validate_data(path: str) -> int:
    """Quick validation of JSONL format before upload."""
    count = 0
    errors = 0
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f):
            try:
                d = json.loads(line.strip())
                msgs = d.get("messages", [])
                if not msgs:
                    errors += 1
                    continue
                roles = [m["role"] for m in msgs]
                if "assistant" not in roles:
                    errors += 1
                    continue
                count += 1
            except (json.JSONDecodeError, KeyError):
                errors += 1

    print(f"Validated: {count:,} valid examples, {errors} errors")
    if errors > count * 0.01:
        print(f"WARNING: {errors} errors (>{count*0.01:.0f}) — check data quality")
    return count


def upload_and_finetune(data_path: str, model_key: str, suffix: str, epochs: int, api_key: str):
    """Upload file and create fine-tuning job."""
    model_id = MODELS.get(model_key, model_key)
    client = OpenAI(api_key=api_key)

    # Validate
    print(f"\n{'='*60}")
    print(f"AMINA Fine-Tune → OpenAI {model_key}")
    print(f"{'='*60}")
    print(f"Data:   {data_path}")
    print(f"Model:  {model_id}")
    print(f"Suffix: {suffix}")
    print(f"Epochs: {epochs}")
    print()

    count = validate_data(data_path)
    if count == 0:
        print("ERROR: No valid examples found")
        sys.exit(1)

    # Upload
    print(f"\nUploading {data_path} ({os.path.getsize(data_path)/1e6:.1f} MB)...")
    with open(data_path, "rb") as f:
        file_obj = client.files.create(file=f, purpose="fine-tune")
    print(f"File ID: {file_obj.id}")
    print(f"Status:  {file_obj.status}")

    # Wait for processing
    print("Waiting for file processing...", end="", flush=True)
    while True:
        file_status = client.files.retrieve(file_obj.id)
        if file_status.status == "processed":
            print(" done!")
            break
        if file_status.status == "error":
            print(f"\nFile processing error: {file_status.status_details}")
            sys.exit(1)
        print(".", end="", flush=True)
        time.sleep(5)

    # Create fine-tuning job
    print(f"\nCreating fine-tuning job...")
    job = client.fine_tuning.jobs.create(
        training_file=file_obj.id,
        model=model_id,
        suffix=suffix,
        hyperparameters={
            "n_epochs": epochs,
        },
    )

    print(f"\n{'='*60}")
    print(f"FINE-TUNING JOB CREATED")
    print(f"{'='*60}")
    print(f"Job ID:       {job.id}")
    print(f"Status:       {job.status}")
    print(f"Model:        {job.model}")
    print(f"Created:      {job.created_at}")
    print(f"\nEstimated time: 2-6 hours for 145K examples")
    print(f"\nCheck status:")
    print(f"  python launch_openai_finetune.py --status {job.id}")
    print(f"\nOr via API:")
    print(f"  openai api fine_tuning.jobs.retrieve -i {job.id}")
    print(f"\nOnce complete, use the model in AMINA by setting:")
    print(f"  OPENAI_MODEL=ft:{model_id}:{suffix}:...")
    print(f"{'='*60}")

    return job


def check_status(job_id: str, api_key: str):
    """Check fine-tuning job status."""
    client = OpenAI(api_key=api_key)
    job = client.fine_tuning.jobs.retrieve(job_id)

    print(f"\n{'='*60}")
    print(f"FINE-TUNE JOB STATUS")
    print(f"{'='*60}")
    print(f"Job ID:         {job.id}")
    print(f"Status:         {job.status}")
    print(f"Model:          {job.model}")
    print(f"Created:        {job.created_at}")

    if job.finished_at:
        print(f"Finished:       {job.finished_at}")
    if job.fine_tuned_model:
        print(f"Fine-tuned model: {job.fine_tuned_model}")
        print(f"\n→ Use this model ID in your AMINA config:")
        print(f"  OPENAI_MODEL={job.fine_tuned_model}")
    if job.error:
        print(f"Error:          {job.error}")
    if hasattr(job, "trained_tokens") and job.trained_tokens:
        print(f"Trained tokens: {job.trained_tokens:,}")

    # Recent events
    events = client.fine_tuning.jobs.list_events(fine_tuning_job_id=job_id, limit=10)
    if events.data:
        print(f"\nRecent events:")
        for evt in reversed(events.data):
            print(f"  [{evt.created_at}] {evt.message}")

    print(f"{'='*60}")


def list_jobs(api_key: str):
    """List all fine-tuning jobs."""
    client = OpenAI(api_key=api_key)
    jobs = client.fine_tuning.jobs.list(limit=20)

    print(f"\n{'='*60}")
    print(f"FINE-TUNING JOBS")
    print(f"{'='*60}")
    for job in jobs.data:
        model_out = job.fine_tuned_model or "(training...)"
        print(f"  {job.id}  {job.status:<12}  {job.model}  →  {model_out}")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="AMINA OpenAI Fine-Tune Launcher")
    parser.add_argument("--data", default=DEFAULT_DATA, help="Path to OpenAI JSONL")
    parser.add_argument("--model", default="gpt-4o-mini", choices=list(MODELS.keys()) + list(MODELS.values()), help="Model to fine-tune")
    parser.add_argument("--suffix", default="amina-care", help="Model suffix (appears in model ID)")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--status", default=None, help="Check status of job ID")
    parser.add_argument("--list", action="store_true", help="List all fine-tuning jobs")
    parser.add_argument("--api-key", default=None, help="OpenAI API key (or set OPENAI_API_KEY env)")
    args = parser.parse_args()

    api_key = args.api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: Set OPENAI_API_KEY env var or pass --api-key")
        sys.exit(1)

    if args.list:
        list_jobs(api_key)
    elif args.status:
        check_status(args.status, api_key)
    else:
        if not os.path.exists(args.data):
            print(f"ERROR: Data file not found: {args.data}")
            print(f"Run prep_finetune_data.py first to generate it")
            sys.exit(1)
        upload_and_finetune(args.data, args.model, args.suffix, args.epochs, api_key)


if __name__ == "__main__":
    main()
