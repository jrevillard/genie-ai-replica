# GPU Deployment Guide

This guide explains how to deploy GENIE.AI on different NVIDIA GPUs.

## Prerequisites

- NVIDIA Driver installed
- NVIDIA Container Toolkit installed
- Docker with NVIDIA support
- Created `.env` file from `env` template with your secrets

## Important Note on Environment Files

When using `--env-file`, Docker Compose **does not** automatically load the default `.env` file. Therefore, you must specify **both** files:

- `.env` - Contains required secrets (ARANGO_PASSWORD, JWT_SECRET, etc.)
- `env.t4` / `env.rtx6000` - Contains GPU-specific overrides

```bash
# CORRECT - loads both files
docker compose --env-file .env --env-file env.t4 up

# WRONG - only loads GPU settings, missing secrets!
docker compose --env-file env.t4 up
```

## Available GPU Deployments

### 1. GPU T4 (16GB VRAM) - Conservative Configuration

**Profile:** Development and testing
**GPU:** NVIDIA T4 (16GB VRAM)

```bash
# First time: create your .env from template
cp env .env
# Edit .env with your secrets

# Deploy with T4 GPU settings
docker compose --env-file .env --env-file env.t4 up
```

**Characteristics:**
- gpu_memory_utilization: 0.4 (6.4 GB VRAM)
- max_model_len: 2048 tokens
- max_num_seqs: 64 (main LLM), 16 (translation)
- dtype: half (FP16)
- TEI images: v1.9.3 (unified for all GPUs)

### 2. GPU RTX6000-ADA (24GB VRAM) - Optimized Configuration

**Profile:** Production
**GPU:** NVIDIA RTX 6000 ADA (24GB VRAM)

```bash
# Deploy with RTX6000 GPU settings
docker compose --env-file .env --env-file env.rtx6000 up
```

**Characteristics:**
- gpu_memory_utilization: 0.6 (14.4 GB VRAM)
- max_model_len: 4096 tokens (main), 8192 (translation)
- max_num_seqs: 1024 (main), 32 (translation)
- dtype: auto (optimized by framework)
- TEI images: v1.9.3 (unified for all GPUs)

### 3. Default Configuration (T4 Compatible)

**Profile:** Local development without specific GPU

```bash
# First time: create your .env from template
cp env .env
# Edit .env with your secrets

# Deploy with default settings
docker compose up
```

Uses default values from your `.env` file.

## GPU Variables

### Main vLLM Variables

| Variable | T4 (16GB) | RTX6000 (24GB) | Description |
|----------|------------|-----------------|-------------|
| `VLLM_GPU_UTILIZATION` | 0.4 | 0.6 | % VRAM to use |
| `VLLM_MAX_MODEL_LEN` | 2048 | 4096 | Max context length |
| `VLLM_MAX_NUM_SEQS` | 64 | 1024 | Concurrent sequences |
| `VLLM_DTYPE` | half | auto | Data type |

### Translation vLLM Variables

| Variable | T4 (16GB) | RTX6000 (24GB) | Description |
|----------|------------|-----------------|-------------|
| `VLLM_TRANSLATION_GPU_UTILIZATION` | 0.3 | 0.4 | % VRAM for translation |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | 2048 | 8192 | Max translation length |
| `VLLM_TRANSLATION_MAX_NUM_SEQS` | 16 | 32 | Translation sequences |
| `VLLM_TRANSLATION_KV_CACHE_DTYPE` | fp8 | auto | KV cache |
| `VLLM_TRANSLATION_DTYPE` | half | auto | Data type |

### TEI Variables (Text Embeddings)

| Variable | T4 | RTX6000 | Description |
|----------|-----|----------|-------------|
| `TEI_EMBEDDING_IMAGE` | ghcr.io/huggingface/text-embeddings-inference:1.9.3 | ghcr.io/huggingface/text-embeddings-inference:1.9.3 | Embeddings image (unified) |
| `TEI_RERANKING_IMAGE` | ghcr.io/huggingface/text-embeddings-inference:1.9.3 | ghcr.io/huggingface/text-embeddings-inference:1.9.3 | Reranker image (unified) |
| `TEI_RERANKING_MAX_BATCH_TOKENS` | 1024 | 32768 | Batch tokens |
| `TEI_RERANKING_MAX_CONCURRENT_REQUESTS` | 8 | 256 | Concurrent requests |

## Customization

To adapt to your GPU:

1. **Create a custom environment file:**
   ```bash
   # 1. Copy and configure the main env file
   cp env .env
   nano .env  # Configure your secrets, API keys, etc.

   # 2. Create a custom GPU file (optional)
   cp env.t4 env.my-gpu
   # or
   cp env.rtx6000 env.my-gpu

   # 3. Adjust GPU values in env.my-gpu
   nano env.my-gpu

   # 4. Deploy with your custom configuration
   docker compose --env-file .env --env-file env.my-gpu up
   ```

2. **Calculate available VRAM:**
   ```
   Available VRAM = Total VRAM × gpu_memory_utilization
   Example T4: 16GB × 0.4 = 6.4 GB
   ```

3. **Estimate VRAM per model:**
   - Granite 3.3 2B: ~4 GB
   - Gemma 3 4B: ~8 GB
   - BGE Base: ~0.5 GB
   - MiniLM-L-6: ~0.1 GB

4. **Adjust parameters:**
   - Increase `VLLM_MAX_MODEL_LEN` if you have more VRAM
   - Increase `VLLM_MAX_NUM_SEQS` for better throughput
   - Use `dtype=auto` to let framework optimize

## GPU Comparison

| GPU | VRAM | Utilization | Throughput | Latency | Recommended For |
|-----|------|-------------|------------|---------|-----------------|
| **T4 16GB** | 16GB | 40-60% | Low | Medium | Dev, Test |
| **RTX6000 24GB** | 24GB | 60-80% | High | Low | Production |

## Troubleshooting

### Error: Out of Memory
```bash
# Reduce GPU utilization
VLLM_GPU_UTILIZATION=0.3
VLLM_MAX_MODEL_LEN=1024
```

### Error: Model Too Long
```bash
# Reduce model length
VLLM_MAX_MODEL_LEN=2048
```

### Check GPU availability
```bash
nvidia-smi
```

## Resources

- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/overview.html)
- [vLLM GPU Memory Utilization](https://docs.vllm.ai/en/latest/serving/usage.html#gpu-memory-utilization)
- [Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference)
