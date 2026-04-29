# AMINA v2.0 — Model Training Pipeline

## Quick Start

```bash
# Step 1: Generate training data
python generate_synthetic_data.py --output training_data/ --count 10000

# Step 2: Build Mandinka corpus
python mandinka_nlp.py --build-corpus --output mandinka_corpus/
python mandinka_nlp.py --generate-training --output training_data/mandinka_health.jsonl --count 2000

# Step 3: LoRA Fine-Tune (requires GPU)
python finetune_lora.py \
  --base_model meta-llama/Meta-Llama-3-8B-Instruct \
  --data training_data/sft_single_turn.jsonl \
  --output models/amina-v2-lora \
  --epochs 3

# Step 4: DPO Preference Learning
python train_dpo.py \
  --base_model models/amina-v2-lora \
  --data training_data/dpo_preferences.jsonl \
  --output models/amina-v2-dpo

# Step 5: Merge for deployment
python finetune_lora.py --merge \
  --base_model meta-llama/Meta-Llama-3-8B-Instruct \
  --lora_path models/amina-v2-dpo \
  --output models/amina-v2-final
```

## Requirements

```
pip install torch transformers peft trl datasets accelerate bitsandbytes
```

GPU: NVIDIA GPU with 16GB+ VRAM (RTX 4090, A100, etc.)
For 4-bit quantized training: 8GB+ VRAM sufficient.

## Training Data

| File | Count | Description |
|------|-------|-------------|
| `sft_single_turn.jsonl` | ~6000 | Single-turn clinical QA |
| `sft_multi_turn.jsonl` | ~1500 | Multi-turn patient conversations |
| `dpo_preferences.jsonl` | ~1500 | Chosen vs rejected response pairs |
| `mandinka_pairs.jsonl` | ~1000 | English-Mandinka health phrases |
| `mandinka_health.jsonl` | ~2000 | Mandinka conversation training |

## Pipeline

```
WHO PEN Protocols + Gambian Context
         │
    generate_synthetic_data.py
         │
         ├── SFT Data (6K single + 1.5K multi-turn)
         ├── DPO Preferences (1.5K pairs)
         └── Mandinka Pairs (1K)
                │
         mandinka_nlp.py
                │
                ├── Health Vocabulary (200+ terms)
                ├── Tokenizer Adaptation
                └── Bilingual Training (2K examples)
                       │
                finetune_lora.py (SFT)
                       │
                  train_dpo.py (DPO)
                       │
                 amina-v2-final model
```
