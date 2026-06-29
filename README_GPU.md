# GPU Deployment Guide

This guide explains how to deploy GENIE.AI on different NVIDIA GPUs.

## Prerequisites

- NVIDIA Driver installed
- NVIDIA Container Toolkit installed
- Docker with NVIDIA support
- Docker Swarm initialized: `docker swarm init`
- GPU node labeled: `docker node update --label-add gpu=true $(hostname)`
- Created `.env` file from `env` template with your secrets

## Environment File Loading

Docker Swarm (`docker stack deploy`) does NOT support `--env-file`. Instead, source the files before deploying:

```bash
# CORRECT - loads both .env and GPU overrides
set -a && source .env && source env.t4 && set +a && docker stack deploy -c docker-compose.yaml genieai

# WRONG - docker stack deploy ignores --env-file
docker stack deploy --env-file .env -c docker-compose.yaml genieai
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
set -a && source .env && source env.t4 && set +a && docker stack deploy -c docker-compose.yaml genieai
```

**Characteristics:**
- gpu_memory_utilization: 0.4 (6.4 GB VRAM)
- max_model_len: 65536 tokens
- max_num_seqs: 64 (main LLM), 16 (translation)
- dtype: half (FP16)
- TEI images: v1.9.3 (unified for all GPUs)

### 2. GPU RTX6000-ADA (24GB VRAM) - Optimized Configuration

**Profile:** Production
**GPU:** NVIDIA RTX 6000 ADA (24GB VRAM)

```bash
# Deploy with RTX6000 GPU settings
set -a && source .env && source env.rtx6000 && set +a && docker stack deploy -c docker-compose.yaml genieai
```

**Characteristics:**
- gpu_memory_utilization: 0.6 (14.4 GB VRAM)
- max_model_len: 65536 tokens (main), 8192 (translation)
- max_num_seqs: 1024 (main), 32 (translation)
- dtype: auto (optimized by framework)
- TEI images: v1.9.3 (unified for all GPUs)

### 3. Default Configuration (No GPU Overrides)

**Profile:** Local development without specific GPU settings

```bash
# First time: create your .env from template
cp env .env
# Edit .env with your secrets

# Deploy with default settings
set -a && source .env && set +a && docker stack deploy -c docker-compose.yaml genieai
```

Uses default values from your `.env` file.

## GPU Variables

### Main vLLM Variables

| Variable | T4 (16GB) | RTX6000 (24GB) | Description |
|----------|------------|-----------------|-------------|
| `VLLM_GPU_UTILIZATION` | 0.4 | 0.6 | % VRAM to use |
| `VLLM_MAX_MODEL_LEN` | 65536 | 65536 | Max context length |
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
   set -a && source .env && source env.my-gpu && set +a && docker stack deploy -c docker-compose.yaml genieai
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
VLLM_MAX_MODEL_LEN=65536
```

### Error: Model Too Long
```bash
# Reduce model length
VLLM_MAX_MODEL_LEN=65536
```

### Check GPU availability
```bash
nvidia-smi
```

## Resources

- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/overview.html)
- [vLLM GPU Memory Utilization](https://docs.vllm.ai/en/latest/serving/usage.html#gpu-memory-utilization)
- [Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference)
