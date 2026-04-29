#!/usr/bin/env python3
"""
AMINA LoRA 2.0 — Fine-Tuning Pipeline
=======================================
Upgrades from v1:
  - LoRA rank=32, alpha=64  (vs r=16, a=32 in v1)
  - bf16 full precision      (vs 4-bit QLoRA in v1)
  - 83.8M trainable params   (vs 41.9M in v1)
  - Gradient checkpointing   (fits 46GB A40 comfortably)
  - Packing + dynamic padding
  - Cosine LR schedule with warmup
  - Per-step checkpoint saves
  - Supports merged WHO + golden_standard dataset

Hardware:
  - Tested on NVIDIA A40 (46GB)
  - bf16 requires Ampere or newer (A40 = Ampere ✓)
  - Estimated VRAM usage: ~22–26 GB with batch_size=4, grad_accum=8

Usage:
  python finetune_lora_v2.py
  python finetune_lora_v2.py --data /root/amina-training/data/golden_standard_v2.jsonl
  python finetune_lora_v2.py --resume models/amina-lora-2.0/checkpoint-5000
"""

import os
import json
import argparse
import logging
import math
from datetime import datetime
from pathlib import Path

import torch
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    TrainingArguments,
    TrainerCallback,
    BitsAndBytesConfig,
)
from peft import (
    LoraConfig,
    TaskType,
    get_peft_model,
    prepare_model_for_kbit_training,
)
from trl import SFTTrainer, SFTConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(
            f"/root/amina-training/logs/train_lora2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        ),
    ],
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

BASE_MODEL   = "mistralai/Mistral-7B-Instruct-v0.3"
OUTPUT_DIR   = "models/amina-lora-2.0"
DATA_PATH    = "/root/amina-training/data/golden_standard.jsonl"   # default; override with --data

LORA_R       = 32       # rank (doubled from v1)
LORA_ALPHA   = 64       # alpha = 2x rank
LORA_DROPOUT = 0.05
TARGET_MODS  = ["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"]

MAX_SEQ_LEN  = 2048
EPOCHS       = 3
BATCH_SIZE   = 4        # per device
GRAD_ACCUM   = 8        # effective batch = 32
LR           = 1e-4     # lower than v1 (2e-4) — more stable with rank=32
WARMUP_RATIO = 0.03
WEIGHT_DECAY = 0.01
SAVE_STEPS   = 500
EVAL_STEPS   = 500
LOG_STEPS    = 25

AMINA_SYSTEM = (
    "You are Amina, a trusted Community Health Worker in The Gambia. "
    "You speak warmly and directly, like a knowledgeable aunt at the health post. "
    "You follow WHO PEN protocols and evidence-based guidelines. "
    "You NEVER prescribe medication. "
    "You refer emergencies to the nearest health facility or call 199. "
    "You use local context (benachin, domoda, moringa, EFSTH, health post). "
    "You ask ONE question per turn. You give ONE clear piece of advice per turn. "
    "3-6 sentences maximum. End with a question or a specific action step."
)


# ── Dataset loader ────────────────────────────────────────────────────────────

def load_dataset(path: str) -> Dataset:
    log.info(f"Loading dataset: {path}")
    records = []

    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Format 1: already has messages
            if "messages" in d:
                msgs = d["messages"]
                if not any(m.get("role") == "system" for m in msgs):
                    msgs = [{"role": "system", "content": AMINA_SYSTEM}] + msgs
                records.append({"messages": msgs})

            # Format 2: instruction / output (ChatDoctor / WHO style)
            elif "instruction" in d and "output" in d:
                user = d["instruction"]
                if d.get("input", "").strip():
                    user = f"{user}\n{d['input'].strip()}"
                records.append({
                    "messages": [
                        {"role": "system",    "content": AMINA_SYSTEM},
                        {"role": "user",      "content": user},
                        {"role": "assistant", "content": d["output"]},
                    ]
                })

            # Format 3: prompt / response / chosen
            elif "prompt" in d and ("response" in d or "chosen" in d):
                records.append({
                    "messages": [
                        {"role": "system",    "content": AMINA_SYSTEM},
                        {"role": "user",      "content": d["prompt"]},
                        {"role": "assistant", "content": d.get("chosen") or d.get("response","")},
                    ]
                })

            # Format 4: question / answer / explanation (MedMCQA / DDXPlus)
            elif "question" in d and "answer" in d:
                ans = d["answer"]
                exp = d.get("explanation") or d.get("exp") or ""
                output = f"{ans}. {exp}".strip() if exp else ans
                records.append({
                    "messages": [
                        {"role": "system",    "content": AMINA_SYSTEM},
                        {"role": "user",      "content": d["question"]},
                        {"role": "assistant", "content": output},
                    ]
                })

    log.info(f"Loaded {len(records):,} training examples")
    return Dataset.from_list(records)


def format_messages(example, tokenizer):
    """Apply chat template to messages."""
    return tokenizer.apply_chat_template(
        example["messages"],
        tokenize=False,
        add_generation_prompt=False,
    )


# ── Feasibility check ─────────────────────────────────────────────────────────

def check_feasibility():
    """Print VRAM requirements before loading anything heavy."""
    log.info("=== AMINA LoRA 2.0 — Feasibility Check ===")
    log.info(f"Base model:        {BASE_MODEL}")
    log.info(f"LoRA rank:         {LORA_R}  (alpha={LORA_ALPHA})")
    log.info(f"Target modules:    {TARGET_MODS}")
    log.info(f"Precision:         bf16 (no quantization)")
    log.info(f"Max seq length:    {MAX_SEQ_LEN}")
    log.info(f"Batch size:        {BATCH_SIZE} × {GRAD_ACCUM} grad_accum = {BATCH_SIZE*GRAD_ACCUM} effective")
    log.info(f"Learning rate:     {LR}")
    log.info(f"Epochs:            {EPOCHS}")

    # Param count estimate
    # Mistral 7B dims: hidden=4096, intermediate=14336, kv_heads=8 (dim=1024), layers=32
    dims = {
        "q_proj":    (4096, 4096),
        "k_proj":    (4096, 1024),
        "v_proj":    (4096, 1024),
        "o_proj":    (4096, 4096),
        "gate_proj": (4096, 14336),
        "up_proj":   (4096, 14336),
        "down_proj": (14336, 4096),
    }
    trainable = sum(
        (LORA_R * i + o * LORA_R)
        for m, (i, o) in dims.items()
        if m in TARGET_MODS
    ) * 32  # 32 layers
    total_7b = 7_241_748_480

    log.info(f"\n--- Parameter Counts ---")
    log.info(f"Total model params:    {total_7b:,}  (7.24B)")
    log.info(f"Trainable LoRA params: {trainable:,}  ({trainable/total_7b*100:.2f}%)")

    # VRAM estimate
    model_bf16_gb  = total_7b * 2 / 1e9          # 2 bytes per bf16 param
    lora_gb        = trainable * 4 / 1e9          # fp32 for LoRA params
    optimizer_gb   = trainable * 8 / 1e9          # AdamW: 2 states × fp32
    activation_gb  = BATCH_SIZE * MAX_SEQ_LEN * 4096 * 2 / 1e9 * 0.15  # grad checkpoint ~15%
    total_est_gb   = model_bf16_gb + lora_gb + optimizer_gb + activation_gb

    log.info(f"\n--- VRAM Estimate ---")
    log.info(f"Model weights (bf16):  {model_bf16_gb:.1f} GB")
    log.info(f"LoRA params (fp32):    {lora_gb:.2f} GB")
    log.info(f"Optimizer states:      {optimizer_gb:.2f} GB")
    log.info(f"Activations (w/ GC):   {activation_gb:.2f} GB")
    log.info(f"Total estimate:        {total_est_gb:.1f} GB")

    if torch.cuda.is_available():
        free_gb = torch.cuda.mem_get_info()[0] / 1e9
        total_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
        log.info(f"\n--- GPU ---")
        log.info(f"GPU:        {torch.cuda.get_device_name(0)}")
        log.info(f"VRAM total: {total_gb:.1f} GB")
        log.info(f"VRAM free:  {free_gb:.1f} GB")
        headroom = free_gb - total_est_gb
        if headroom > 4:
            log.info(f"STATUS: ✓ FEASIBLE — {headroom:.1f} GB headroom")
        elif headroom > 0:
            log.info(f"STATUS: ⚠ TIGHT — only {headroom:.1f} GB headroom, reduce batch_size if OOM")
        else:
            log.info(f"STATUS: ✗ NOT FEASIBLE — need {abs(headroom):.1f} GB more VRAM")
            log.info("SUGGESTION: Use --use_4bit flag to enable QLoRA")

    log.info(f"\n--- Training Estimate ---")
    # Will be computed after dataset load
    log.info(f"Output dir: {OUTPUT_DIR}")
    log.info("=" * 50)


# ── Main training ─────────────────────────────────────────────────────────────

def train(args):
    os.makedirs("/root/amina-training/logs", exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    check_feasibility()

    # ── Load tokenizer ────────────────────────────────────────────────────────
    log.info("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    tokenizer.pad_token     = tokenizer.eos_token
    tokenizer.padding_side  = "right"

    # ── Load dataset ──────────────────────────────────────────────────────────
    dataset = load_dataset(args.data)
    n       = len(dataset)
    steps_per_epoch  = math.ceil(n / (BATCH_SIZE * GRAD_ACCUM))
    total_steps      = steps_per_epoch * EPOCHS
    log.info(f"Steps per epoch: {steps_per_epoch:,} | Total steps: {total_steps:,}")

    # ── Load model (bf16, no quantization) ───────────────────────────────────
    log.info("Loading model in bf16...")
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
        use_cache=False,         # required for gradient checkpointing
    )
    model.config.use_cache = False
    model.enable_input_require_grads()

    # ── Apply LoRA ────────────────────────────────────────────────────────────
    log.info(f"Applying LoRA (rank={LORA_R}, alpha={LORA_ALPHA})...")
    lora_cfg = LoraConfig(
        task_type       = TaskType.CAUSAL_LM,
        r               = LORA_R,
        lora_alpha      = LORA_ALPHA,
        lora_dropout    = LORA_DROPOUT,
        target_modules  = TARGET_MODS,
        bias            = "none",
        inference_mode  = False,
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # ── Training arguments ────────────────────────────────────────────────────
    training_args = SFTConfig(
        output_dir                  = OUTPUT_DIR,
        num_train_epochs            = EPOCHS,
        per_device_train_batch_size = BATCH_SIZE,
        gradient_accumulation_steps = GRAD_ACCUM,
        gradient_checkpointing      = True,
        gradient_checkpointing_kwargs = {"use_reentrant": False},
        optim                       = "adamw_torch_fused",
        learning_rate               = LR,
        weight_decay                = WEIGHT_DECAY,
        lr_scheduler_type           = "cosine",
        warmup_ratio                = WARMUP_RATIO,
        bf16                        = True,
        fp16                        = False,
        logging_steps               = LOG_STEPS,
        save_steps                  = SAVE_STEPS,
        save_total_limit            = 3,
        eval_strategy               = "no",
        dataloader_num_workers      = 4,
        remove_unused_columns       = False,
        report_to                   = "none",
        run_name                    = "amina-lora-2.0",
        max_seq_length              = MAX_SEQ_LEN,
        packing                     = True,
        resume_from_checkpoint      = args.resume,
    )

    # ── Trainer ───────────────────────────────────────────────────────────────
    def formatting_fn(example):
        return tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )

    trainer = SFTTrainer(
        model           = model,
        args            = training_args,
        train_dataset   = dataset,
        processing_class= tokenizer,
        formatting_func = formatting_fn,
    )

    # ── Train ─────────────────────────────────────────────────────────────────
    log.info("Starting training...")
    log.info(f"Dataset:    {len(dataset):,} examples")
    log.info(f"Epochs:     {EPOCHS}")
    log.info(f"Total steps:{total_steps:,}")

    trainer.train(resume_from_checkpoint=args.resume)

    # ── Save ──────────────────────────────────────────────────────────────────
    log.info("Saving LoRA adapters...")
    trainer.save_model(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)

    # Save training metadata
    meta = {
        "model":        "amina-lora-2.0",
        "base_model":   BASE_MODEL,
        "lora_rank":    LORA_R,
        "lora_alpha":   LORA_ALPHA,
        "trainable_params": 83_886_080,
        "precision":    "bf16",
        "dataset":      args.data,
        "examples":     len(dataset),
        "epochs":       EPOCHS,
        "total_steps":  total_steps,
        "trained_at":   datetime.utcnow().isoformat(),
    }
    with open(os.path.join(OUTPUT_DIR, "training_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    log.info(f"✓ Training complete. Model saved to {OUTPUT_DIR}")
    adapter_size = sum(
        os.path.getsize(os.path.join(OUTPUT_DIR, f))
        for f in os.listdir(OUTPUT_DIR)
        if f.endswith(".safetensors") or f.endswith(".bin")
    ) / 1e6
    log.info(f"  Adapter size: {adapter_size:.1f} MB")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data",    default=DATA_PATH,  help="Path to training JSONL")
    parser.add_argument("--resume",  default=None,       help="Resume from checkpoint path")
    parser.add_argument("--check",   action="store_true",help="Feasibility check only, no training")
    args = parser.parse_args()

    if args.check:
        check_feasibility()
    else:
        train(args)
