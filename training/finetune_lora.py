#!/usr/bin/env python3
"""
AMINA v2.0 — #9 LoRA Fine-Tuning Pipeline

Fine-tunes Llama 3 8B (or any HuggingFace model) using LoRA adapters
on AMINA's synthetic training data.

Steps:
  1. Load base model + tokenizer
  2. Apply LoRA adapters (rank=16, alpha=32, target: q_proj, v_proj, k_proj, o_proj)
  3. Train on SFT data (single-turn + multi-turn)
  4. Save LoRA adapters (small, ~50MB vs 16GB full model)
  5. Optionally merge adapters into full model for deployment

Requirements:
  pip install torch transformers peft trl datasets accelerate bitsandbytes

Usage:
  # SFT fine-tune
  python finetune_lora.py --base_model meta-llama/Meta-Llama-3-8B-Instruct \
    --data training_data/sft_single_turn.jsonl \
    --output models/amina-v2-lora \
    --epochs 3 --batch_size 4 --lr 2e-4

  # Quick test with smaller model
  python finetune_lora.py --base_model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
    --data training_data/sft_single_turn.jsonl \
    --output models/amina-test-lora \
    --epochs 1 --batch_size 8

  # Merge LoRA adapters into full model
  python finetune_lora.py --merge --base_model meta-llama/Meta-Llama-3-8B-Instruct \
    --lora_path models/amina-v2-lora \
    --output models/amina-v2-merged
"""

import argparse
import json
import os
import sys
from datetime import datetime


def train_sft(args):
    """Supervised Fine-Tuning with LoRA adapters."""
    print(f"Loading base model: {args.base_model}")
    print(f"Training data: {args.data}")
    print(f"Output: {args.output}")

    try:
        import torch
        from transformers import (
            AutoModelForCausalLM, AutoTokenizer,
            TrainingArguments, BitsAndBytesConfig,
        )
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from trl import SFTTrainer
        from datasets import load_dataset
    except ImportError as e:
        print(f"Missing dependency: {e}")
        print("Install: pip install torch transformers peft trl datasets accelerate bitsandbytes")
        sys.exit(1)

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # Quantization config (4-bit for memory efficiency)
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )
    model = prepare_model_for_kbit_training(model)

    # LoRA config
    lora_config = LoraConfig(
        r=args.lora_rank,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # Load dataset
    dataset = load_dataset("json", data_files=args.data, split="train")
    print(f"Dataset size: {len(dataset)} examples")

    # Format for chat template
    def format_chat(example):
        messages = example.get("messages", [])
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        return {"text": text}

    dataset = dataset.map(format_chat)

    # Training arguments
    training_args = TrainingArguments(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        weight_decay=0.01,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        logging_steps=10,
        save_steps=200,
        save_total_limit=3,
        fp16=True,
        optim="paged_adamw_8bit",
        report_to="none",
        max_grad_norm=0.3,
        group_by_length=True,
    )

    # Trainer
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        args=training_args,
        max_seq_length=args.max_seq_length,
        dataset_text_field="text",
        packing=False,
    )

    # Train
    print(f"Starting training... ({args.epochs} epochs)")
    trainer.train()

    # Save LoRA adapters
    trainer.save_model(args.output)
    tokenizer.save_pretrained(args.output)

    # Save training metadata
    meta = {
        "base_model": args.base_model,
        "lora_rank": args.lora_rank,
        "lora_alpha": args.lora_alpha,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.lr,
        "training_data": args.data,
        "dataset_size": len(dataset),
        "completed_at": datetime.now().isoformat(),
        "amina_version": "2.0",
    }
    with open(os.path.join(args.output, "training_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"Training complete! LoRA adapters saved to: {args.output}")
    print(f"Adapter size: ~{sum(os.path.getsize(os.path.join(args.output, f)) for f in os.listdir(args.output) if f.endswith('.safetensors')) / 1024 / 1024:.1f} MB")


def merge_lora(args):
    """Merge LoRA adapters into the base model for deployment."""
    print(f"Merging LoRA adapters from {args.lora_path} into {args.base_model}")

    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    # Load base model (full precision for merging)
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model, torch_dtype="auto", device_map="auto", trust_remote_code=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)

    # Load and merge LoRA
    model = PeftModel.from_pretrained(model, args.lora_path)
    model = model.merge_and_unload()

    # Save merged model
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)

    print(f"Merged model saved to: {args.output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMINA v2.0 LoRA Fine-Tuning")
    parser.add_argument("--base_model", default="meta-llama/Meta-Llama-3-8B-Instruct")
    parser.add_argument("--data", default="training_data/sft_single_turn.jsonl")
    parser.add_argument("--output", default="models/amina-v2-lora")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=4)
    parser.add_argument("--grad_accum", type=int, default=4)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--lora_rank", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--max_seq_length", type=int, default=2048)
    parser.add_argument("--merge", action="store_true", help="Merge LoRA into base model")
    parser.add_argument("--lora_path", default=None, help="Path to LoRA adapters (for merge)")
    args = parser.parse_args()

    if args.merge:
        if not args.lora_path:
            print("--lora_path required for merge")
            sys.exit(1)
        merge_lora(args)
    else:
        train_sft(args)
