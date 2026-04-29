#!/usr/bin/env python3
"""
AMINA — Unsloth LoRA Fine-Tuning on A40
========================================
2x faster, 60% less VRAM than standard HuggingFace LoRA.
Trains Mistral-7B on 145K examples in ~4-6 hours on a single A40 (46GB).

Setup (on A40):
  pip install unsloth
  pip install --no-deps trl peft accelerate bitsandbytes

Usage:
  # Default: Mistral-7B, bf16, 145K golden_standard
  python finetune_unsloth.py

  # Custom data
  python finetune_unsloth.py --data /root/amina-training/data/golden_standard_v2.jsonl

  # Use prepped data from prep_finetune_data.py
  python finetune_unsloth.py --data finetune_output/openai_finetune.jsonl

  # Smaller test run
  python finetune_unsloth.py --data training_data/sft_single_turn.jsonl --epochs 1

  # Export to GGUF for Ollama serving
  python finetune_unsloth.py --export-gguf

  # Resume from checkpoint
  python finetune_unsloth.py --resume models/amina-unsloth/checkpoint-5000
"""

import os
import json
import argparse
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

BASE_MODEL   = "unsloth/mistral-7b-instruct-v0.3-bnb-4bit"  # Unsloth pre-quantized
OUTPUT_DIR   = "models/amina-unsloth"
DATA_PATH    = "/root/amina-training/data/golden_standard_v2.jsonl"

LORA_R       = 32
LORA_ALPHA   = 64
LORA_DROPOUT = 0.05
TARGET_MODS  = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj",
]

MAX_SEQ_LEN  = 4096     # doubled from v2 (2048) — Unsloth handles it efficiently
EPOCHS       = 3
BATCH_SIZE   = 4
GRAD_ACCUM   = 8        # effective batch = 32
LR           = 2e-4
WARMUP_RATIO = 0.03
WEIGHT_DECAY = 0.01
SAVE_STEPS   = 1000
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

def load_training_data(path: str):
    """Load JSONL and normalize all formats to messages array."""
    from datasets import Dataset

    log.info(f"Loading: {path}")
    records = []

    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue

            msgs = None

            # Format 1: messages array (OpenAI/Mistral format)
            if "messages" in d:
                msgs = d["messages"]

            # Format 2: instruction/output
            elif "instruction" in d and "output" in d:
                user = d["instruction"]
                if d.get("input", "").strip():
                    user = f"{user}\n{d['input'].strip()}"
                msgs = [
                    {"role": "system",    "content": AMINA_SYSTEM},
                    {"role": "user",      "content": user},
                    {"role": "assistant", "content": d["output"]},
                ]

            # Format 3: prompt/response or prompt/chosen
            elif "prompt" in d and ("response" in d or "chosen" in d):
                msgs = [
                    {"role": "system",    "content": AMINA_SYSTEM},
                    {"role": "user",      "content": d["prompt"]},
                    {"role": "assistant", "content": d.get("chosen") or d.get("response", "")},
                ]

            # Format 4: question/answer
            elif "question" in d and "answer" in d:
                ans = d["answer"]
                exp = d.get("explanation") or d.get("exp") or ""
                output = f"{ans}. {exp}".strip() if exp else ans
                msgs = [
                    {"role": "system",    "content": AMINA_SYSTEM},
                    {"role": "user",      "content": d["question"]},
                    {"role": "assistant", "content": output},
                ]

            if not msgs:
                continue
            if not any(m.get("role") == "system" for m in msgs):
                msgs = [{"role": "system", "content": AMINA_SYSTEM}] + msgs

            records.append({"messages": msgs})

    log.info(f"Loaded {len(records):,} examples")
    return Dataset.from_list(records)


# ── Main ──────────────────────────────────────────────────────────────────────

def train(args):
    import torch
    from unsloth import FastLanguageModel
    from trl import SFTTrainer, SFTConfig

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── GPU info ──────────────────────────────────────────────────────────────
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        gpu_mem = torch.cuda.get_device_properties(0).total_memory / 1e9
        log.info(f"GPU: {gpu_name} ({gpu_mem:.1f} GB)")
    else:
        log.error("No GPU found!")
        return

    # ── Load model with Unsloth ───────────────────────────────────────────────
    log.info(f"Loading {BASE_MODEL} with Unsloth...")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL,
        max_seq_length=MAX_SEQ_LEN,
        dtype=None,              # auto-detect (bf16 on A40)
        load_in_4bit=True,       # 4-bit quantization — fits easily on A40
    )

    # ── Apply LoRA ────────────────────────────────────────────────────────────
    log.info(f"Applying LoRA (rank={LORA_R}, alpha={LORA_ALPHA})...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODS,
        bias="none",
        use_gradient_checkpointing="unsloth",  # Unsloth optimized — 30% less VRAM
        random_state=42,
    )
    model.print_trainable_parameters()

    # ── Load dataset ──────────────────────────────────────────────────────────
    dataset = load_training_data(args.data)
    n = len(dataset)

    import math
    steps_per_epoch = math.ceil(n / (BATCH_SIZE * GRAD_ACCUM))
    total_steps = steps_per_epoch * EPOCHS

    log.info(f"Dataset:     {n:,} examples")
    log.info(f"Steps/epoch: {steps_per_epoch:,}")
    log.info(f"Total steps: {total_steps:,}")

    # ── Chat template formatting ──────────────────────────────────────────────
    def formatting_fn(example):
        return tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )

    # ── Training config ───────────────────────────────────────────────────────
    training_args = SFTConfig(
        output_dir=OUTPUT_DIR,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        optim="adamw_8bit",                    # 8-bit Adam — less VRAM
        learning_rate=LR,
        weight_decay=WEIGHT_DECAY,
        lr_scheduler_type="cosine",
        warmup_ratio=WARMUP_RATIO,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),   # True on A40
        logging_steps=LOG_STEPS,
        save_steps=SAVE_STEPS,
        save_total_limit=3,
        eval_strategy="no",
        dataloader_num_workers=4,
        remove_unused_columns=False,
        report_to="none",
        run_name="amina-unsloth",
        max_seq_length=MAX_SEQ_LEN,
        packing=True,                          # Unsloth packing — more efficient
        resume_from_checkpoint=args.resume,
    )

    # ── Trainer ───────────────────────────────────────────────────────────────
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        processing_class=tokenizer,
        formatting_func=formatting_fn,
    )

    # ── VRAM estimate ─────────────────────────────────────────────────────────
    if torch.cuda.is_available():
        allocated = torch.cuda.memory_allocated() / 1e9
        reserved = torch.cuda.memory_reserved() / 1e9
        log.info(f"VRAM before training: {allocated:.1f} GB allocated, {reserved:.1f} GB reserved")

    # ── Train ─────────────────────────────────────────────────────────────────
    log.info("=" * 60)
    log.info("STARTING TRAINING")
    log.info(f"  Model:      {BASE_MODEL}")
    log.info(f"  LoRA:       rank={LORA_R}, alpha={LORA_ALPHA}")
    log.info(f"  Data:       {n:,} examples")
    log.info(f"  Epochs:     {EPOCHS}")
    log.info(f"  Batch:      {BATCH_SIZE} x {GRAD_ACCUM} = {BATCH_SIZE*GRAD_ACCUM} effective")
    log.info(f"  Seq length: {MAX_SEQ_LEN}")
    log.info(f"  Steps:      {total_steps:,}")
    log.info("=" * 60)

    start = datetime.now()
    trainer.train(resume_from_checkpoint=args.resume)
    elapsed = datetime.now() - start

    # ── Save ──────────────────────────────────────────────────────────────────
    log.info("Saving LoRA adapters...")
    trainer.save_model(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)

    # Training metadata
    meta = {
        "model": "amina-unsloth",
        "base_model": BASE_MODEL,
        "lora_rank": LORA_R,
        "lora_alpha": LORA_ALPHA,
        "target_modules": TARGET_MODS,
        "precision": "4bit + bf16 LoRA",
        "framework": "unsloth",
        "dataset": args.data,
        "examples": n,
        "epochs": EPOCHS,
        "total_steps": total_steps,
        "max_seq_length": MAX_SEQ_LEN,
        "effective_batch_size": BATCH_SIZE * GRAD_ACCUM,
        "learning_rate": LR,
        "training_time_seconds": elapsed.total_seconds(),
        "training_time_human": str(elapsed),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "unknown",
        "trained_at": datetime.utcnow().isoformat(),
    }
    with open(os.path.join(OUTPUT_DIR, "training_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    adapter_size = sum(
        os.path.getsize(os.path.join(OUTPUT_DIR, f))
        for f in os.listdir(OUTPUT_DIR)
        if f.endswith(".safetensors") or f.endswith(".bin")
    ) / 1e6

    log.info("=" * 60)
    log.info(f"TRAINING COMPLETE")
    log.info(f"  Time:         {elapsed}")
    log.info(f"  Adapter size: {adapter_size:.1f} MB")
    log.info(f"  Output:       {OUTPUT_DIR}")
    log.info("=" * 60)

    # ── Export to GGUF if requested ───────────────────────────────────────────
    if args.export_gguf:
        export_gguf(model, tokenizer)


def export_gguf(model=None, tokenizer=None):
    """Export to GGUF format for Ollama / llama.cpp serving."""
    from unsloth import FastLanguageModel

    if model is None:
        log.info("Loading model for GGUF export...")
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=OUTPUT_DIR,
            max_seq_length=MAX_SEQ_LEN,
            dtype=None,
            load_in_4bit=True,
        )

    gguf_dir = os.path.join(OUTPUT_DIR, "gguf")
    os.makedirs(gguf_dir, exist_ok=True)

    log.info("Exporting to GGUF (Q4_K_M quantization)...")
    model.save_pretrained_gguf(
        gguf_dir,
        tokenizer,
        quantization_method="q4_k_m",
    )

    log.info(f"GGUF export saved to {gguf_dir}")
    log.info(f"To serve with Ollama:")
    log.info(f"  ollama create amina-care -f {gguf_dir}/Modelfile")
    log.info(f"  ollama run amina-care")


def test_inference(args):
    """Quick test: load adapter and run a sample query."""
    from unsloth import FastLanguageModel

    log.info(f"Loading model from {OUTPUT_DIR}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=OUTPUT_DIR,
        max_seq_length=MAX_SEQ_LEN,
        dtype=None,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)

    test_queries = [
        "My sugar was 250 this morning",
        "Can I eat benachin with diabetes?",
        "My chest hurts and I'm sweating",
        "I stopped taking my BP medicine because I feel fine",
        "I'm scared, I just found out I have diabetes",
    ]

    log.info("\n" + "=" * 60)
    log.info("INFERENCE TEST")
    log.info("=" * 60)

    for query in test_queries:
        messages = [
            {"role": "system", "content": AMINA_SYSTEM},
            {"role": "user", "content": query},
        ]
        inputs = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        ).to(model.device)

        outputs = model.generate(
            input_ids=inputs,
            max_new_tokens=256,
            temperature=0.7,
            top_p=0.9,
            do_sample=True,
        )

        response = tokenizer.decode(outputs[0][inputs.shape[1]:], skip_special_tokens=True)
        print(f"\nUser: {query}")
        print(f"Amina: {response.strip()}")
        print("-" * 40)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMINA Unsloth Fine-Tuning on A40")
    parser.add_argument("--data", default=DATA_PATH, help="Training JSONL path")
    parser.add_argument("--resume", default=None, help="Resume from checkpoint")
    parser.add_argument("--export-gguf", action="store_true", help="Export to GGUF after training")
    parser.add_argument("--test", action="store_true", help="Run inference test on trained model")
    parser.add_argument("--epochs", type=int, default=EPOCHS, help="Training epochs")
    args = parser.parse_args()

    if args.epochs != EPOCHS:
        EPOCHS = args.epochs

    if args.test:
        test_inference(args)
    else:
        train(args)
