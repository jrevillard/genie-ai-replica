# Document Translation Service Configuration Guide

## Overview

The Document Translation Service is a flexible, multi-backend translation system designed to translate markdown documents while preserving their structure. The service supports **34 languages** and provides configurable backends (CPU-based, GPU-based, or automatic fallback).

### Key Features

- **34 Language Support** - Including English, Arabic, Chinese, Spanish, and 31 others
- **Multiple Backends** - CPU (NLLB-200), GPU (TranslateGemma, Gemma-3), or Auto mode
- **Smart Caching** - Redis-based permanent caching per document/language pair
- **Graceful Degradation** - Language and backend fallback chains for reliability
- **Zero Configuration Changes Required** - Defaults to existing CPU behavior
- **Configuration-Driven** - All backend selection via `.env` files only

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  translation-service.js                      │
│                       (Proxy Service)                        │
│  - Selects backend based on TRANSLATION_BACKEND env var     │
│  - Handles language fallback chains                         │
│  - Manages Redis caching (backend-agnostic)                 │
│  - Preserves markdown structure during translation          │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────────┐      ┌──────────────────┐
│  CPU Backend     │      │  GPU Backend     │
│  (NLLB-200)      │      │  (vLLM)          │
│                  │      │                  │
│ • 10 tokens/sec  │      │ • 60-100 tokens/s│
│ • 34 languages   │      │ • 34 languages   │
│ • No GPU needed  │      │ • Requires GPU   │
│ • Free           │      │ • GPU cost       │
└──────────────────┘      └──────────────────┘
```

---

## Backend Options

### 1. CPU Backend (Default)

**Model:** Facebook NLLB-200-distilled-600M (via transformers.js)

**Characteristics:**
- ✅ Works on any hardware (no GPU required)
- ✅ Free (no infrastructure costs)
- ✅ Reliable and mature
- ❌ Slower (~10 tokens/second)
- ❌ Longer wait times for large documents

**Best For:**
- Development environments
- Organizations without GPU infrastructure
- Cost-sensitive deployments
- Testing and validation

**Performance:**
- Small document (5 pages): ~2 minutes
- Medium document (20 pages): ~8 minutes
- Large document (100 pages): ~40 minutes

### 2. GPU Backend

**Model:** Google TranslateGemma-4b-it or Gemma-3-4b-it (via vLLM)

**Characteristics:**
- ✅ 3-10x faster than CPU
- ✅ Purpose-built translation models
- ✅ State-of-the-art translation quality
- ❌ Requires GPU hardware
- ❌ GPU infrastructure costs

**Best For:**
- Production environments with GPU
- Time-sensitive document translation
- High-volume translation needs
- Organizations valuing speed

**Performance:**
- Small document (5 pages): ~20-30 seconds
- Medium document (20 pages): ~1.5-2 minutes
- Large document (100 pages): ~5-8 minutes

### 3. Auto Mode (Recommended for Production)

**Behavior:** Tries GPU first, automatically falls back to CPU if GPU fails

**Best For:**
- Production environments wanting maximum reliability
- Environments with intermittent GPU availability
- "Best of both worlds" approach

---

## Configuration

### Environment Variables

All configuration is done via `.env` files. **No code changes required.**

#### Backend Selection

```bash
# env or env-T4 file

# Backend selection: cpu, gpu, or auto
TRANSLATION_BACKEND=cpu    # Default, backward compatible
# TRANSLATION_BACKEND=gpu  # Force GPU
# TRANSLATION_BACKEND=auto # Try GPU, fallback to CPU
```

#### CPU Backend Configuration

```bash
# CPU model (only used when TRANSLATION_BACKEND=cpu or auto)
TRANSLATION_CPU_MODEL_ID=Xenova/nllb-200-distilled-600M

# CPU performance tuning
TRANSLATION_THREADS=4      # Worker threads for CPU translation
TRANSLATION_BATCHES=5      # Number of parallel batches
```

#### GPU Backend Configuration

```bash
# GPU model (read from existing env, not new)
VLLM_TRANSLATION_MODEL_ID=google/translategemma-4b-it
# Or: VLLM_TRANSLATION_MODEL_ID=google/gemma-3-4b-it

# vLLM service endpoint (existing configuration)
VLLM_TRANSLATION_ENDPOINT=http://vllm-translation-guardrail:9031
VLLM_TRANSLATION_SERVICE_PORT=9031
```

#### Cache Configuration

```bash
# Enable/disable Redis caching
TRANSLATION_CACHE=on

# Redis connection settings
TRANSLATION_CACHE_HOST=redis-cache
TRANSLATION_CACHE_PORT=6379
TRANSLATION_CACHE_PASSWORD=!@#$5678
```

---

## Supported Languages (34 Total)

### Original 11 Languages
| Code | Language |
|------|----------|
| en | English |
| ar | Arabic |
| th | Thai |
| zh | Chinese (Simplified) |
| de | German |
| fr | French |
| id | Indonesian |
| es | Spanish |
| ru | Russian |
| pt | Portuguese |
| sw | Kiswahili |

### Extended Languages (23 Additional)
| Code | Language | Fallback |
|------|----------|----------|
| am | Amharic | English |
| az | Azerbaijani | Turkish |
| bn | Bengali | English |
| ckb | Sorani Kurdish | Arabic |
| fa | Persian (Farsi) | - |
| ff | Fulah | Kiswahili |
| ha | Hausa | Kiswahili |
| jv | Javanese | Indonesian |
| kk | Kazakh | Turkish |
| ku | Kurdish (Kurmanji) | Persian |
| ml | Malayalam | English |
| ms | Malay | Indonesian |
| om | Oromo | Kiswahili |
| pa | Punjabi | Urdu |
| ps | Pashto | Persian |
| sd | Sindhi | Urdu |
| skr | Saraiki | Urdu |
| so | Somali | Kiswahili |
| su | Sundanese | Indonesian |
| tr | Turkish | - |
| ug | Uyghur | Turkish |
| ur | Urdu | - |
| uz | Uzbek | Turkish |
| yo | Yoruba | Kiswahili |

---

## How Translation Works

### 1. Document Processing

When a markdown document is submitted for translation:

```
Markdown Document
       │
       ▼
┌─────────────────────────────────┐
│  Parse into Text Nodes           │
│  (Preserve structure)            │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Split into Batches              │
│  (Default: 5 parallel batches)   │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Translate Each Text Node        │
│  (Backend: CPU or GPU)           │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Reassemble Markdown             │
│  (Replace translated text)       │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Cache in Redis (Permanent)      │
│  Key: translation:{docHash}:{lang}│
└─────────────────────────────────┘
```

### 2. Language Fallback

If a target language is not directly supported, the service uses fallback chains:

```
User requests: English → Saraiki (skr)
                │
                ▼
Check: Is skr supported?
         │
         │ No
         ▼
Check: Is there a fallback for skr?
         │
         │ Yes → Urdu (ur)
         ▼
Translate: English → Urdu (instead of Saraiki)
```

### 3. Backend Fallback (Auto Mode Only)

When `TRANSLATION_BACKEND=auto`:

```
Translation Request
        │
        ▼
Try GPU Backend
        │
        ├─ Success → Return result
        │
        └─ Failure → Fall back to CPU
                        │
                        └─ Retry translation with CPU
```

---

## Caching Behavior

### Cache Key Format

```
translation:{documentHash}:{targetLanguage}
```

**Example:** `translation:a1b2c3d4e5f6:es`

### Important Characteristics

1. **Backend-Agnostic** - Cache key does NOT include backend identifier
   - If CPU translates a document first, GPU requests will return the cached CPU version
   - Once cached, switching backends does NOT trigger re-translation

2. **Permanent Storage** - Cached translations do not expire (no TTL)
   - Subsequent requests are instant
   - Manual cache clearing required to update translations

3. **One-Time Cost** - First translation is expensive (CPU: minutes, GPU: seconds)
   - All subsequent requests are instant (cache hit)
   - Cost is paid once per document/language pair

### Cache Implications

**Scenario 1: CPU then GPU**
```
1. User uploads English manual, requests Spanish translation
2. CPU translates it (~8 minutes) → Cached as translation:abc123:es
3. Admin switches to GPU mode
4. User requests same English→Spanish translation
5. ✅ Cache hit - Returns CPU translation (GPU never runs)
```

**Scenario 2: Switching Models**
```
1. Current translations cached with CPU (NLLB-200)
2. Admin switches to GPU (TranslateGemma)
3. New requests hit cache immediately (CPU versions)
4. To get GPU translations, clear Redis cache or use new document
```

---

## Performance Comparison

### Translation Speed (Tokens/Second)

| Backend | Model | Speed | Relative to CPU |
|---------|-------|-------|-----------------|
| CPU | NLLB-200 | ~10 tokens/sec | 1x (baseline) |
| GPU (T4) | Gemma-3-1b-it | ~60 tokens/sec | 6x faster |
| GPU (T4) | TranslateGemma-4b | ~75 tokens/sec | 7.5x faster |
| GPU (RTX 6000) | TranslateGemma-4b | ~100 tokens/sec | 10x faster |

### Real-World Document Translation Times

| Document Size | Words | Pages | CPU Time | GPU Time | Time Saved |
|--------------|-------|-------|----------|----------|------------|
| Small | 1,500 | 5 | ~2 min | ~20 sec | **1m 40s** |
| Medium | 5,000 | 20 | ~8 min | ~1.5 min | **6m 30s** |
| Large | 25,000 | 100 | ~40 min | ~5 min | **35 min** |

### Cost Considerations

**CPU Backend:**
- Infrastructure: $0 (runs on existing server)
- Translation time: High (opportunity cost)
- Best for: Low volume, non-time-sensitive translations

**GPU Backend:**
- Infrastructure: GPU hourly rate
- Translation time: Low (faster turnaround)
- Best for: High volume, time-sensitive translations

**ROI Calculation:**
```
If GPU costs $1/hour and saves 35 minutes per large document:
- You can translate ~1.7 large documents per hour on GPU
- If you translate >2 documents per hour, GPU is cheaper
```

---

## Switching Between Backends

### From CPU to GPU

1. **Update .env file:**
   ```bash
   # Change from:
   TRANSLATION_BACKEND=cpu

   # To:
   TRANSLATION_BACKEND=gpu
   ```

2. **Restart backend service:**
   ```bash
   docker-compose restart backend
   ```

3. **Verify in logs:**
   ```
   [TRANSLATION-SERVICE] Selecting backend: gpu
   [GPU-BACKEND] Initializing with model: google/translategemma-4b-it
   [GPU-BACKEND] Initialized successfully. vLLM service is ready.
   ```

### From GPU to CPU

1. **Update .env file:**
   ```bash
   # Change from:
   TRANSLATION_BACKEND=gpu

   # To:
   TRANSLATION_BACKEND=cpu
   ```

2. **Restart backend service:**
   ```bash
   docker-compose restart backend
   ```

3. **Verify in logs:**
   ```
   [TRANSLATION-SERVICE] Selecting backend: cpu
   [CPU-BACKEND] Initializing with model: Xenova/nllb-200-distilled-600M
   [CPU-BACKEND] Initialized successfully. Model is ready.
   ```

### Enable Auto Mode

1. **Update .env file:**
   ```bash
   TRANSLATION_BACKEND=auto
   ```

2. **Restart backend service:**
   ```bash
   docker-compose restart backend
   ```

3. **Verify in logs:**
   ```
   [TRANSLATION-SERVICE] Auto mode: Trying GPU backend first
   [GPU-BACKEND] Initialized successfully. vLLM service is ready.
   [TRANSLATION-SERVICE] Auto mode: GPU backend successful
   ```

---

## Translation Quality Comparison

### Model Differences

**NLLB-200 (CPU):**
- Research-grade model from Meta
- Trained on 200 languages
- Good general-purpose translation
- Sometimes literal translations

**TranslateGemma-4b (GPU):**
- Purpose-built translation model from Google
- Specialized for translation tasks
- More natural, fluent translations
- Better idiomatic expressions

**Gemma-3-4b (GPU):**
- General-purpose LLM used for translation
- Prompt-based translation approach
- Good but not as specialized as TranslateGemma
- Can handle complex context better

### Example Comparison

**Original Text (English):**
> "The quick brown fox jumps over the lazy dog."

**NLLB-200 (CPU) → Spanish:**
> "El rápido zorro marrón salta sobre el perro perezoso."

**TranslateGemma-4b (GPU) → Spanish:**
> "El rápido zorro marrón salta sobre el perro perezoso."

**In this case:** Identical translations (simple sentence)

**Original Text (English):**
> "It's raining cats and dogs."

**NLLB-200 (CPU) → French:**
> "Il pleut des chats et des chiens." (Literal)

**TranslateGemma-4b (GPU) → French:**
> "Il pleut des cordes." (Idiomatic: "It's raining ropes")

**In this case:** GPU produces more natural, idiomatic translation

---

## Troubleshooting

### Issue: "Backend not initialized"

**Symptoms:**
```
[TRANSLATION-SERVICE] Service is not ready.
```

**Solutions:**
1. Check backend initialization in logs
2. Verify `TRANSLATION_BACKEND` env var is set correctly
3. Restart backend service: `docker-compose restart backend`

### Issue: "vLLM service unreachable"

**Symptoms:**
```
[GPU-BACKEND] vLLM service unreachable: connect ECONNREFUSED
```

**Solutions:**
1. Verify vLLM service is running: `docker ps | grep vllm`
2. Check `VLLM_TRANSLATION_ENDPOINT` is correct
3. Switch to `TRANSLATION_BACKEND=auto` for automatic fallback

### Issue: "Unsupported language"

**Symptoms:**
```
[TRANSLATION-SERVICE] Unsupported target language: xx
```

**Solutions:**
1. Check if language is in the 34 supported languages
2. Verify language code is ISO 639-1 format (e.g., 'es', not 'spa')
3. Check fallback chain for that language

### Issue: Translation slower than expected

**Symptoms:**
- GPU translation taking as long as CPU

**Solutions:**
1. Check logs to confirm GPU backend is actually being used
2. Verify GPU model is loaded correctly
3. Check vLLM service performance metrics
4. Consider batch size optimization

### Issue: Cache not working

**Symptoms:**
- Re-translating same documents repeatedly

**Solutions:**
1. Verify Redis is running: `docker ps | grep redis`
2. Check `TRANSLATION_CACHE=on` is set
3. Verify Redis connection settings in .env
4. Check Redis logs for connection issues

---

## Best Practices

### 1. Use Auto Mode for Production

```bash
TRANSLATION_BACKEND=auto
```

**Why:** Maximizes reliability with GPU speed when available, automatic fallback to CPU.

### 2. Monitor Translation Performance

```javascript
// Check backend info
const backendInfo = translationService.getBackendInfo();
console.log(backendInfo);
// Output: { type: 'gpu', model: 'translategemma-4b-it', initialized: true }
```

### 3. Clear Cache When Switching Models

```bash
# Connect to Redis
docker exec -it redis-cache redis-cli

# Authenticate
AUTH "!@#$5678"

# Clear all translation cache
KEYS translation:*
# Then delete each key, or use:
FLUSHDB  # WARNING: Deletes ALL cache, not just translations
```

### 4. Test with Small Documents First

When switching backends:
1. Upload a small test document (1-2 pages)
2. Verify translation quality
3. Check performance in logs
4. Then process larger documents

### 5. Use GPU for Batch Translations

If translating multiple documents:
1. Switch to GPU mode
2. Process all documents
3. Switch back to CPU if needed
4. GPU cost is offset by time savings

### 6. Monitor GPU Utilization

```bash
# Check GPU usage
nvidia-smi

# Look for high GPU memory utilization
# If too low, consider increasing batch size
```

---

## API Reference

### Get Supported Languages

```javascript
const languages = translationService.getSupportedLanguages();
console.log(languages);
// { en: 'eng_Latn', es: 'spa_Latn', ... }
```

### Get Backend Information

```javascript
const info = translationService.getBackendInfo();
console.log(info);
// {
//   type: 'cpu',          // or 'gpu'
//   model: 'nllb-200-distilled-600M',
//   codeFormat: 'FLORES-200',
//   initialized: true
// }
```

### Translate Text

```javascript
const texts = ['Hello', 'How are you?'];
const translated = await translationService.translate(texts, 'en', 'es');
console.log(translated);
// ['Hola', '¿Cómo estás?']
```

### Translate Markdown Document

```javascript
const markdown = '# Title\n\nSome content...';
const translated = await translationService.translateMarkdown(markdown, 'en', 'es');
console.log(translated);
// '# Título\n\nAlgún contenido...'
```

---

## FAQ

**Q: Can I run GPU and CPU backends simultaneously?**
A: No. The service uses one backend at a time. Use `auto` mode for automatic fallback.

**Q: Will switching backends break existing translations?**
A: No. Cached translations remain available. New requests use the current backend.

**Q: How do I force re-translation of a document?**
A: Clear the specific cache key in Redis or upload a new document (different hash).

**Q: Which GPU model should I use?**
A: Use `google/translategemma-4b-it` for best translation quality. Use `google/gemma-3-1b-it` for lower memory GPUs.

**Q: Can I add support for more languages?**
A: Yes. Add new language mappings to the language map files. See architecture specification.

**Q: Why does translation take longer than expected?**
A: Check logs for actual backend in use. Large documents are processed node-by-node (not as single request).

**Q: Is there a maximum document size?**
A: No hard limit, but larger documents take proportionally longer. Test with your document sizes.

**Q: Can I translate PDF files?**
A: The service translates markdown. Convert PDF to markdown first using document repository service.

**Q: How do I know which backend was used?**
A: Check logs for `[TRANSLATION-SERVICE] Backend: cpu/gpu` or use `getBackendInfo()`.

**Q: What happens if GPU fails during translation?**
A: In `auto` mode, it falls back to CPU and retries. In `gpu` mode, the translation fails.

---

## Summary

| Aspect | CPU Backend | GPU Backend | Auto Mode |
|--------|-------------|-------------|-----------|
| **Speed** | Slow (10 tok/s) | Fast (60-100 tok/s) | Fast (with fallback) |
| **Cost** | Free | GPU cost | GPU cost (or free) |
| **Reliability** | High | Medium | Very High |
| **Setup** | None required | GPU required | GPU required |
| **Best For** | Dev, testing | Production, speed | Production, reliability |

**Recommendation:** Start with CPU backend for testing. Switch to GPU or Auto mode for production deployments.

---

## Additional Resources

- **Architecture Specification:** `TRANSLATION-SERVICE-ARCHITECTURE.md`
- **Language Maps:** `services/translation/language-maps/`
- **Backend Implementations:** `services/translation/cpu-translate-backend.js`, `services/translation/gpu-translate-backend.js`
- **Main Service:** `services/translation-service.js`

---

**Last Updated:** 2025-02-26
**Version:** 1.0
