#!/usr/bin/env python3
"""
AMINA v2.0 — #10 Direct Preference Optimization (DPO)

Trains the fine-tuned model to prefer good responses over bad ones,
WITHOUT the complexity of full RLHF (no reward model, no PPO).

DPO directly optimizes the policy from preference pairs:
  - "chosen": culturally appropriate, clinically accurate, concise CHW response
  - "rejected": generic, prescribes medication, too long, no cultural context

Requirements:
  pip install torch transformers peft trl datasets

Usage:
  # After SFT fine-tuning:
  python train_dpo.py --base_model models/amina-v2-lora \
    --data training_data/dpo_preferences.jsonl \
    --output models/amina-v2-dpo \
    --epochs 1 --beta 0.1
"""

import argparse
import json
import os
import sys
from datetime import datetime


def train_dpo(args):
    """Direct Preference Optimization training."""
    print(f"DPO Training")
    print(f"  Base model: {args.base_model}")
    print(f"  Data: {args.data}")
    print(f"  Beta: {args.beta}")

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        from peft import LoraConfig
        from trl import DPOTrainer, DPOConfig
        from datasets import load_dataset
    except ImportError as e:
        print(f"Missing dependency: {e}")
        print("Install: pip install torch transformers peft trl datasets")
        sys.exit(1)

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Quantization
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
    )

    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )

    # LoRA config for DPO
    peft_config = LoraConfig(
        r=8,
        lora_alpha=16,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "v_proj"],
    )

    # Load preference dataset
    dataset = load_dataset("json", data_files=args.data, split="train")
    print(f"Preference pairs: {len(dataset)}")

    # DPO training config
    training_args = DPOConfig(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        learning_rate=5e-5,
        beta=args.beta,
        warmup_ratio=0.1,
        lr_scheduler_type="cosine",
        logging_steps=10,
        save_steps=100,
        fp16=True,
        optim="paged_adamw_8bit",
        report_to="none",
        max_length=1024,
        max_prompt_length=512,
    )

    # Trainer
    trainer = DPOTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        tokenizer=tokenizer,
        peft_config=peft_config,
    )

    print("Starting DPO training...")
    trainer.train()

    trainer.save_model(args.output)
    tokenizer.save_pretrained(args.output)

    # Save metadata
    meta = {
        "base_model": args.base_model,
        "beta": args.beta,
        "epochs": args.epochs,
        "dataset_size": len(dataset),
        "completed_at": datetime.now().isoformat(),
        "training_type": "DPO",
        "amina_version": "2.0",
    }
    with open(os.path.join(args.output, "dpo_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"DPO training complete! Model saved to: {args.output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMINA v2.0 DPO Training")
    parser.add_argument("--base_model", default="models/amina-v2-lora")
    parser.add_argument("--data", default="training_data/dpo_preferences.jsonl")
    parser.add_argument("--output", default="models/amina-v2-dpo")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch_size", type=int, default=2)
    parser.add_argument("--beta", type=float, default=0.1)
    args = parser.parse_args()
    train_dpo(args)
