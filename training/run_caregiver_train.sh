#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# AMINA Caregiver Model — Training Launch Script
# Queues after the current patient model job (PID 61173) finishes.
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd /root/amina-training

LOG=/root/amina-training/caregiver_train.log
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo " AMINA Caregiver Model Training"
echo " Started: $(date)"
echo "=========================================="

# ── Wait for current training job to finish ───────────────────────────────────
CURRENT_PID=61173
if kill -0 $CURRENT_PID 2>/dev/null; then
    echo "[$(date +%H:%M:%S)] Waiting for patient model training (PID $CURRENT_PID) to finish..."
    while kill -0 $CURRENT_PID 2>/dev/null; do
        sleep 60
        echo "[$(date +%H:%M:%S)] Still waiting for PID $CURRENT_PID..."
    done
    echo "[$(date +%H:%M:%S)] Patient model training finished. Starting caregiver training."
else
    echo "[$(date +%H:%M:%S)] No active job detected. Starting immediately."
fi

# ── Step 1: Generate training data ───────────────────────────────────────────
echo ""
echo "[$(date +%H:%M:%S)] Step 1: Generating caregiver training data..."
python3 generate_caregiver_data.py \
    --output data/caregiver/ \
    --count 4000

echo "[$(date +%H:%M:%S)] Training data generated."
ls -lh data/caregiver/

# ── Step 2: SFT fine-tune on interview + followup data ───────────────────────
echo ""
echo "[$(date +%H:%M:%S)] Step 2: SFT fine-tune (interviews + followups)..."

# Merge both SFT files
cat data/caregiver/caregiver_sft_interviews.jsonl \
    data/caregiver/caregiver_sft_followups.jsonl \
    > data/caregiver/caregiver_sft_combined.jsonl

wc -l data/caregiver/caregiver_sft_combined.jsonl

python3 finetune_lora.py \
    --base_model  mistralai/Mistral-7B-Instruct-v0.3 \
    --data        data/caregiver/caregiver_sft_combined.jsonl \
    --output      models/amina-caregiver-lora \
    --epochs      3 \
    --batch_size  4 \
    --grad_accum  8 \
    --lora_rank   16 \
    --lora_alpha  32 \
    --max_seq_length 2048

echo "[$(date +%H:%M:%S)] SFT fine-tune complete."

# ── Step 3: DPO preference alignment ─────────────────────────────────────────
echo ""
echo "[$(date +%H:%M:%S)] Step 3: DPO preference alignment..."
python3 train_dpo.py \
    --base_model  models/amina-caregiver-lora \
    --data        data/caregiver/caregiver_dpo_preferences.jsonl \
    --output      models/amina-caregiver-dpo

echo "[$(date +%H:%M:%S)] DPO training complete."

# ── Step 4: Merge for deployment ─────────────────────────────────────────────
echo ""
echo "[$(date +%H:%M:%S)] Step 4: Merging LoRA adapters into full model..."
python3 finetune_lora.py --merge \
    --base_model  mistralai/Mistral-7B-Instruct-v0.3 \
    --lora_path   models/amina-caregiver-dpo \
    --output      models/amina-caregiver-final

echo ""
echo "=========================================="
echo " AMINA Caregiver Model — Training DONE"
echo " Finished: $(date)"
echo " Output  : /root/amina-training/models/amina-caregiver-final"
echo "=========================================="
du -sh models/amina-caregiver-final
