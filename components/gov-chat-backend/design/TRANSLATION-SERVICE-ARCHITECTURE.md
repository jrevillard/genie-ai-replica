# Translation Service Architecture Specification

## 1. Overview

This specification defines a flexible, configurable translation service architecture that supports multiple translation backends (CPU and GPU) with pluggable language mappings. The architecture is designed to be **configuration-driven** via `.env` files, requiring no code changes when switching between translation models or adding new language mappings.

### 1.1 Core Principles

1. **Configuration-First**: All models and backend selection are configured via `.env` files only
2. **No Infrastructure Changes**: Existing vLLM translation guardrail service remains untouched
3. **Proxy Pattern**: `translation-service.js` acts as a smart proxy/proxy service
4. **Modular Backends**: Separate CPU and GPU backend modules with pluggable language maps
5. **Graceful Degradation**: Backend and language fallback chains for reliability
6. **Extensibility**: Adding new LLMs requires only adding a new language map configuration

### 1.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     translation-service.js                       │
│                        (Proxy Service)                           │
│  - Selects backend based on TRANSLATION_BACKEND env variable    │
│  - Handles fallback chain: GPU → CPU → Error                    │
│  - Manages Redis caching (backend-agnostic)                     │
│  - Provides unified API to callers                              │
└────────────────┬────────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│  gpu-translate   │  │  cpu-translate   │
│   -backend.js    │  │   -backend.js    │
│                  │  │                  │
│  Uses vLLM       │  │  Uses            │
│  guardrail       │  │  transformers.js │
│  service         │  │  (browser/node)  │
│  (no changes)    │  │                  │
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         ▼                     ▼
    Reads Model          Configurable
    from .env             CPU Models
│
├─ VLLM_TRANSLATION_MODEL_ID
├─ VLLM_TRANSLATION_ENDPOINT
├─ VLLM_TRANSLATION_SERVICE_PORT
│
└─ CPU-based:
├─ TRANSLATION_THREADS
├─ TRANSLATION_BATCHES
├─ TRANSLATION_CPU_MODEL_ID (NEW)

### 2.2 Backend Selection

```bash
# .env configuration
TRANSLATION_BACKEND=gpu  # Options: gpu | cpu | auto
```

- **`gpu`**: Force GPU backend (vLLM guardrail service)
- **`cpu`**: Force CPU backend (transformers.js)
- **`auto`**: Automatic fallback - try GPU first, fallback to CPU on failure

### 2.3 Language Map Configuration

Language maps are JavaScript objects stored in a configuration directory, allowing easy addition of new language mappings when adding new LLMs.

**Language Map Directory Structure:**
```
gov-chat-backend/
├── services/
│   ├── translation/
│   │   ├── language-maps/
│   │   │   ├── nllb-200-map.js          # NLLB-200 (FLORES-200 codes)
│   │   │   ├── translategemma-map.js    # TranslateGemma (ISO 639-1 codes)
│   │   │   ├── gemma-3-map.js           # Gemma-3 (ISO 639-1 codes)
│   │   │   └── [future-model]-map.js    # Easy to add new maps
```

**Language Map File Structure:**
```javascript
module.exports = {
  // Human-readable model name
  modelName: 'nllb-200-distilled-600M',

  // Model type: 'nllb' | 'gemma' | 'custom'
  modelType: 'nllb',

  // Language code format used by this model
  codeFormat: 'FLORES-200',  // 'FLORES-200' | 'ISO-639-1' | 'custom'

  // Supported languages (34 total)
  languageMap: {
    en: 'eng_Latn',
    ar: 'arb_Arab',
    th: 'tha_Thai',
    zh: 'zho_Hans',
    de: 'deu_Latn',
    fr: 'fra_Latn',
    id: 'ind_Latn',
    es: 'spa_Latn',
    ru: 'rus_Cyrl',
    pt: 'por_Latn',
    sw: 'swh_Latn',
    am: 'amh_Ethi',
    az: 'azj_Latn',
    bn: 'ben_Beng',
    fa: 'pes_Arab',
    ff: 'fuv_Latn',
    ha: 'hau_Latn',
    jv: 'jav_Latn',
    kk: 'kaz_Cyrl',
    ku: 'kmr_Latn',
    ml: 'mal_Mlym',
    ms: 'zsm_Latn',
    om: 'gaz_Latn',
    pa: 'pan_Guru',
    ps: 'pbt_Arab',
    sd: 'snd_Arab',
    skr: 'skr_Arab',
    so: 'som_Latn',
    su: 'sun_Latn',
    tr: 'tur_Latn',
    ug: 'uig_Arab',
    ur: 'urd_Arab',
    uz: 'uzn_Latn',
    yo: 'yor_Latn',
    ckb: 'ckb_Arab',  # Sorani Kurdish (34th language)
  },

  // Optional: Language-specific prompt templates (for LLM-based models)
  promptTemplate: null,  // or function(sourceCode, targetCode, text) => string
};
```

## 3. Module Specifications

### 3.1 translation-service.js (Proxy Service)

**Location**: `gov-chat-backend/services/translation-service.js`

**Responsibilities**:
1. Act as a proxy/router to CPU or GPU backends
2. Manage backend selection based on `TRANSLATION_BACKEND` configuration
3. Implement fallback chain (GPU → CPU → Error)
4. Handle Redis caching (backend-agnostic)
5. Load appropriate language map based on active backend
6. Provide unified API to callers

**API**:
```javascript
class TranslationService {
  /**
   * Translate texts or markdown content
   * @param {string|string[]} texts - Text(s) to translate
   * @param {string} sourceLang - Source language code (ISO 639-1)
   * @param {string} targetLang - Target language code (ISO 639-1)
   * @param {Object} options - Translation options
   * @returns {Promise<string|string[]>} Translated text(s)
   */
  async translate(texts, sourceLang, targetLang, options = {})

  /**
   * Get available languages for current backend
   * @returns {Object} Language map
   */
  getSupportedLanguages()

  /**
   * Get current backend information
   * @returns {Object} Backend info { type, model, endpoint }
   */
  getBackendInfo()
}
```

**Backend Selection Logic**:
```javascript
async selectBackend() {
  const backendConfig = process.env.TRANSLATION_BACKEND || 'auto';

  if (backendConfig === 'gpu') {
    return new GpuTranslateBackend();
  }

  if (backendConfig === 'cpu') {
    return new CpuTranslateBackend();
  }

  if (backendConfig === 'auto') {
    // Try GPU first, fallback to CPU
    try {
      const gpuBackend = new GpuTranslateBackend();
      await gpuBackend.initialize();
      return gpuBackend;
    } catch (error) {
      logger.warn('[TRANSLATION] GPU backend unavailable, falling back to CPU');
      return new CpuTranslateBackend();
    }
  }

  throw new Error(`Invalid TRANSLATION_BACKEND: ${backendConfig}`);
}
```

### 3.2 gpu-translate-backend.js

**Location**: `gov-chat-backend/services/translation/gpu-translate-backend.js`

**Responsibilities**:
1. Interface to existing vLLM translation guardrail service
2. Read model configuration from `.env` only
3. Support multiple GPU models (TranslateGemma, Gemma-3, etc.)
4. Load appropriate language map based on model
5. Handle model-specific prompt formatting

**Configuration (from .env)**:
```bash
VLLM_TRANSLATION_MODEL_ID=google/translategemma-4b-it
VLLM_TRANSLATION_ENDPOINT=http://vllm-translation-guardrail:9031
VLLM_TRANSLATION_SERVICE_PORT=9031
```

**API**:
```javascript
class GpuTranslateBackend {
  constructor() {
    this.modelId = process.env.VLLM_TRANSLATION_MODEL_ID;
    this.endpoint = process.env.VLLM_TRANSLATION_ENDPOINT;
    this.languageMap = this.loadLanguageMap(this.modelId);
  }

  /**
   * Initialize backend (health check)
   */
  async initialize()

  /**
   * Translate using vLLM service
   * @param {string[]} texts - Texts to translate
   * @param {string} sourceCode - Source language code (model-specific)
   * @param {string} targetCode - Target language code (model-specific)
   * @returns {Promise<string[]>} Translated texts
   */
  async translate(texts, sourceCode, targetCode)

  /**
   * Load language map based on model ID
   * @param {string} modelId - Model identifier from .env
   * @returns {Object} Language map
   */
  loadLanguageMap(modelId)

  /**
   * Format request for specific model
   * @param {string} modelId - Model identifier
   * @param {string} sourceCode - Source language code
   * @param {string} targetCode - Target language code
   * @param {string} text - Text to translate
   * @returns {Object} Formatted request body
   */
  formatRequest(modelId, sourceCode, targetCode, text)
}
```

**Model-Specific Request Formatting**:

TranslateGemma format:
```javascript
formatRequest(modelId, sourceCode, targetCode, text) {
  if (modelId.includes('translategemma')) {
    return {
      model: modelId,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          source_lang_code: sourceCode,  // ISO 639-1
          target_lang_code: targetCode,  // ISO 639-1
          text: text
        }]
      }],
      temperature: 0.0,
      max_tokens: 4096
    };
  }

  if (modelId.includes('gemma-3')) {
    // General LLM prompt format
    return {
      model: modelId,
      messages: [{
        role: 'user',
        content: `Translate the following text from ${this.getLanguageName(sourceCode)} to ${this.getLanguageName(targetCode)}. Only return the translation, no explanation.\n\nText: ${text}`
      }],
      temperature: 0.3,
      max_tokens: 4096
    };
  }

  throw new Error(`Unsupported model: ${modelId}`);
}
```

**Language Map Loading**:
```javascript
loadLanguageMap(modelId) {
  // Map model IDs to language map files
  const modelToMap = {
    'google/translategemma-4b-it': './language-maps/translategemma-map.js',
    'google/gemma-3-4b-it': './language-maps/gemma-3-map.js',
    'google/gemma-3-1b-it': './language-maps/gemma-3-map.js',
  };

  const mapPath = modelToMap[modelId];

  if (!mapPath) {
    throw new Error(`No language map found for model: ${modelId}. Add a language map file to ./language-maps/`);
  }

  return require(mapPath);
}
```

### 3.3 cpu-translate-backend.js

**Location**: `gov-chat-backend/services/translation/cpu-translate-backend.js`

**Responsibilities**:
1. CPU-based translation using transformers.js
2. Support configurable CPU models via `.env`
3. Load appropriate language map based on model
4. Handle batching and threading

**Configuration (from .env)**:
```bash
TRANSLATION_CPU_MODEL_ID=facebook/nllb-200-distilled-600M
TRANSLATION_THREADS=4
TRANSLATION_BATCHES=5
```

**API**:
```javascript
class CpuTranslateBackend {
  constructor() {
    this.modelId = process.env.TRANSLATION_CPU_MODEL_ID || 'facebook/nllb-200-distilled-600M';
    this.threads = parseInt(process.env.TRANSLATION_THREADS) || 4;
    this.batches = parseInt(process.env.TRANSLATION_BATCHES) || 5;
    this.languageMap = this.loadLanguageMap(this.modelId);
    this.model = null;
  }

  /**
   * Initialize backend (load model into memory)
   */
  async initialize()

  /**
   * Translate using CPU model
   * @param {string[]} texts - Texts to translate
   * @param {string} sourceCode - Source language code (model-specific)
   * @param {string} targetCode - Target language code (model-specific)
   * @returns {Promise<string[]>} Translated texts
   */
  async translate(texts, sourceCode, targetCode)

  /**
   * Load language map based on model ID
   */
  loadLanguageMap(modelId)
}
```

## 4. Language Mappings

### 4.1 Supported Languages (34 Total)

| ISO 639-1 | Language Name | NLLB-200 Code | TranslateGemma Code |
|-----------|---------------|---------------|---------------------|
| en | English | eng_Latn | en |
| ar | Arabic | arb_Arab | ar |
| th | Thai | tha_Thai | th |
| zh | Chinese | zho_Hans | zh |
| de | German | deu_Latn | de |
| fr | French | fra_Latn | fr |
| id | Indonesian | ind_Latn | id |
| es | Spanish | spa_Latn | es |
| ru | Russian | rus_Cyrl | ru |
| pt | Portuguese | por_Latn | pt |
| sw | Kiswahili | swh_Latn | sw |
| am | Amharic | amh_Ethi | am |
| az | Azerbaijani | azj_Latn | az |
| bn | Bengali | ben_Beng | bn |
| fa | Persian (Farsi) | pes_Arab | fa |
| ff | Fulah | fuv_Latn | ff |
| ha | Hausa | hau_Latn | ha |
| jv | Javanese | jav_Latn | jv |
| kk | Kazakh | kaz_Cyrl | kk |
| ku | Kurdish (Kurmanji) | kmr_Latn | ku |
| ml | Malayalam | mal_Mlym | ml |
| ms | Malay | zsm_Latn | ms |
| om | Oromo (West Central) | gaz_Latn | om |
| pa | Punjabi | pan_Guru | pa |
| ps | Pashto | pbt_Arab | ps |
| sd | Sindhi | snd_Arab | sd |
| skr | Saraiki | skr_Arab | skr |
| so | Somali | som_Latn | so |
| su | Sundanese | sun_Latn | su |
| tr | Turkish | tur_Latn | tr |
| ug | Uyghur | uig_Arab | ug |
| ur | Urdu | urd_Arab | ur |
| uz | Uzbek | uzn_Latn | uz |
| yo | Yoruba | yor_Latn | yo |
| ckb | Sorani Kurdish | ckb_Arab | ckb |

### 4.2 Language Fallback Chains

Language fallback is applied **before** backend fallback. Each language can specify a fallback language if translation is not supported.

**Fallback Map**:
```javascript
const fallbackLangMap = {
  // West African → Kiswahili (regional lingua franca)
  ff: 'sw', ha: 'sw', yo: 'sw',

  // South Asian → Urdu or English
  skr: 'ur', sd: 'ur', pa: 'ur',

  // Central Asian → Turkish
  kk: 'tr', uz: 'tr', ug: 'tr',

  // Southeast Asian → Indonesian
  ms: 'id', su: 'id', jv: 'id',

  // Middle Eastern → Persian or Arabic
  ps: 'fa', ku: 'fa', ckb: 'ar',

  // Horn of Africa → Kiswahili or English
  om: 'sw', so: 'en',

  // South Asian → English
  am: 'en', bn: 'en', ml: 'en',

  // Central Asian → Turkish
  az: 'tr',
};
```

**Fallback Priority**:
1. Direct language support (check language map)
2. Language fallback (check fallback map)
3. Backend fallback (GPU → CPU)
4. Error thrown

## 5. Adding New LLMs

### 5.1 Step-by-Step Process

When adding a new translation LLM, follow these steps:

**Step 1: Create Language Map File**
```bash
# Create new language map in language-maps/ directory
touch gov-chat-backend/services/translation/language-maps/[new-model]-map.js
```

**Step 2: Define Language Map**
```javascript
// gov-chat-backend/services/translation/language-maps/new-model-map.js
module.exports = {
  modelName: 'New Model Name',
  modelType: 'custom',  // 'nllb' | 'gemma' | 'custom'
  codeFormat: 'custom',  // 'FLORES-200' | 'ISO-639-1' | 'custom'

  languageMap: {
    en: 'model_specific_code_for_en',
    ar: 'model_specific_code_for_ar',
    // ... all 34 languages
  },

  // Optional: Custom prompt template
  promptTemplate: (sourceCode, targetCode, text) => {
    return `Custom prompt for ${sourceCode}→${targetCode}: ${text}`;
  },
};
```

**Step 3: Register Language Map in Backend**

**For GPU Backend**:
```javascript
// gpu-translate-backend.js
loadLanguageMap(modelId) {
  const modelToMap = {
    // Existing models...
    'new/model-id': './language-maps/new-model-map.js',  // Add this line
  };
  // ...
}
```

**For CPU Backend**:
```javascript
// cpu-translate-backend.js
loadLanguageMap(modelId) {
  const modelToMap = {
    // Existing models...
    'new/model-id': './language-maps/new-model-map.js',  // Add this line
  };
  // ...
}
```

**Step 4: Configure Model in .env**
```bash
# For GPU
VLLM_TRANSLATION_MODEL_ID=new/model-id

# For CPU
TRANSLATION_CPU_MODEL_ID=new/model-id
```

**Step 5: Test**
```bash
# Restart service
docker-compose restart backend

# Test translation
curl -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello", "sourceLang": "en", "targetLang": "es"}'
```

### 5.2 Model-Specific Request Formatting

If the new model requires custom request formatting, extend the backend:

**GPU Backend Example**:
```javascript
// gpu-translate-backend.js
formatRequest(modelId, sourceCode, targetCode, text) {
  // Existing models...
  if (modelId === 'new/model-id') {
    return {
      model: modelId,
      input: [{
        source_language: sourceCode,
        target_language: targetCode,
        text: text
      }],
      // Model-specific parameters
    };
  }
  // ...
}
```

## 6. Fallback Chain Design

### 6.1 Fallback Sequence

```
User Request
     │
     ▼
┌─────────────────────────────────────────┐
│  1. Language Support Check              │
│     - Check if language in languageMap  │
│     - If not found → Language Fallback  │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  2. Language Fallback                   │
│     - Check fallbackLangMap             │
│     - If fallback exists → retry        │
│     - If no fallback → Continue         │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  3. Backend Selection                   │
│     - Check TRANSLATION_BACKEND         │
│     - If 'auto' → try GPU first         │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  4. GPU Backend Execution               │
│     - Call vLLM service                 │
│     - If success → Return result        │
│     - If failure → Backend Fallback     │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  5. Backend Fallback (if enabled)       │
│     - Switch to CPU backend             │
│     - Execute translation               │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  6. Return Result or Error              │
└─────────────────────────────────────────┘
```

### 6.2 Error Handling

**Retryable Errors** (trigger backend fallback):
- GPU service unavailable (ECONNREFUSED)
- GPU service timeout
- GPU out of memory
- Model loading errors

**Non-Retryable Errors** (immediate failure):
- Invalid language codes
- Empty input text
- Language map not found
- Configuration errors

## 7. Configuration Examples

### 7.1 Production with GPU (Recommended)

```bash
# .env
TRANSLATION_BACKEND=gpu
VLLM_TRANSLATION_MODEL_ID=google/translategemma-4b-it
VLLM_TRANSLATION_ENDPOINT=http://vllm-translation-guardrail:9031
VLLM_TRANSLATION_SERVICE_PORT=9031
```

### 7.2 Production with CPU Fallback

```bash
# .env
TRANSLATION_BACKEND=auto
VLLM_TRANSLATION_MODEL_ID=google/translategemma-4b-it
VLLM_TRANSLATION_ENDPOINT=http://vllm-translation-guardrail:9031
TRANSLATION_CPU_MODEL_ID=facebook/nllb-200-distilled-600M
TRANSLATION_THREADS=4
TRANSLATION_BATCHES=5
```

### 7.3 CPU-Only (Development/Testing)

```bash
# .env
TRANSLATION_BACKEND=cpu
TRANSLATION_CPU_MODEL_ID=facebook/nllb-200-distilled-600M
TRANSLATION_THREADS=4
TRANSLATION_BATCHES=5
```

### 7.4 RTX 6000 ADA (High-End GPU)

```bash
# .env (using env configuration)
TRANSLATION_BACKEND=gpu
VLLM_TRANSLATION_MODEL_ID=google/translategemma-4b-it
VLLM_TRANSLATION_GPU_UTIL=0.35
VLLM_TRANSLATION_MAX_MODEL_LEN=8192
```

### 7.5 T4 GPU (Mid-Range GPU)

```bash
# .env (using env-T4 configuration)
TRANSLATION_BACKEND=gpu
VLLM_TRANSLATION_MODEL_ID=google/gemma-3-1b-it
VLLM_TRANSLATION_GPU_UTIL=0.4
VLLM_TRANSLATION_MAX_MODEL_LEN=8192
```

## 8. Migration Path

### 8.1 Current State

- `translation-service.js` contains hardcoded NLLB-200 integration
- Single backend support (CPU only)
- Language map embedded in service
- No model configurability

### 8.2 Migration Steps

**Phase 1: Extract CPU Backend**
1. Create `cpu-translate-backend.js`
2. Move existing NLLB-200 code into CPU backend
3. Create `nllb-200-map.js` language map
4. Update `translation-service.js` to use CPU backend

**Phase 2: Add GPU Backend**
1. Create `gpu-translate-backend.js`
2. Implement vLLM guardrail service integration
3. Create `translategemma-map.js` language map
4. Add model-specific request formatting
5. Test GPU backend independently

**Phase 3: Implement Proxy Logic**
1. Refactor `translation-service.js` to proxy pattern
2. Implement backend selection logic
3. Add backend fallback chain
4. Update Redis caching to be backend-agnostic

**Phase 4: Configuration**
1. Add `.env` variables
2. Update existing `.env` and `env-T4` files
3. Document configuration options

**Phase 5: Testing**
1. Unit tests for each backend
2. Integration tests for fallback chain
3. Load testing for concurrent translations
4. Language coverage tests (34 languages)

## 9. Testing Strategy

### 9.1 Unit Tests

**CPU Backend Tests**:
- Model initialization
- Language mapping
- Batch translation
- Error handling

**GPU Backend Tests**:
- vLLM service communication
- Request formatting per model
- Response parsing
- Error handling

**Proxy Service Tests**:
- Backend selection
- Fallback chain
- Redis caching
- Language fallback

### 9.2 Integration Tests

```javascript
// Test suite example
describe('Translation Service Integration', () => {
  test('GPU backend translates successfully', async () => {
    process.env.TRANSLATION_BACKEND = 'gpu';
    const service = new TranslationService();
    const result = await service.translate('Hello', 'en', 'es');
    expect(result).toBe('Hola');
  });

  test('Fallback chain works correctly', async () => {
    process.env.TRANSLATION_BACKEND = 'auto';
    // Mock GPU failure
    const service = new TranslationService();
    const result = await service.translate('Hello', 'en', 'es');
    // Should fall back to CPU
    expect(result).toBe('Hola');
  });

  test('Language fallback works correctly', async () => {
    const service = new TranslationService();
    // Test Saraiki → Urdu fallback
    const result = await service.translate('Hello', 'en', 'skr');
    // Should use Urdu as target
  });

  test('All 34 languages are supported', async () => {
    const service = new TranslationService();
    const languages = service.getSupportedLanguages();
    expect(Object.keys(languages).length).toBe(34);
  });
});
```

### 9.3 Load Testing

```bash
# Test concurrent translation performance
k6 run --vus 10 --duration 30s translation-load-test.js
```

## 10. Performance Considerations

### 10.1 GPU Backend Performance

- **TranslateGemma-4b-it**: ~50-100 tokens/sec on T4 GPU
- **Gemma-3-4b-it**: ~30-60 tokens/sec on T4 GPU
- **Gemma-3-1b-it**: ~60-120 tokens/sec on T4 GPU
- **Batching**: Supported via vLLM automatic batching

### 10.2 CPU Backend Performance

- **NLLB-200-distilled-600M**: ~5-15 tokens/sec (CPU-dependent)
- **Threading**: Configurable via `TRANSLATION_THREADS`
- **Batching**: Configurable via `TRANSLATION_BATCHES`
- **Memory**: ~2GB RAM for model loading

### 10.3 Caching Strategy

- **Redis**: Cache translations by hash of (sourceText + sourceLang + targetLang)
- **TTL**: 24 hours (configurable)
- **Cache Invalidation**: Manual or TTL-based
- **Backend-Agnostic**: Cache key does not depend on backend used

## 11. Security Considerations

### 11.1 API Security

- Validate all language codes against supported languages
- Sanitize input text to prevent injection attacks
- Rate limit translation requests per user
- Log all translation activity for audit

### 11.2 Model Security

- Do not expose model endpoints directly to clients
- Use existing authentication mechanisms (backend service)
- Validate `.env` configuration on startup
- Monitor for unusual translation patterns

## 12. Monitoring and Observability

### 12.1 Metrics to Track

- Translation request rate (per backend, per language)
- Average translation latency
- Backend fallback rate
- Cache hit/miss ratio
- Error rate (per backend, per error type)

### 12.2 Logging

```javascript
// Structured logging example
logger.info('[TRANSLATION] Request received', {
  backend: 'gpu',
  model: 'translategemma-4b-it',
  sourceLang: 'en',
  targetLang: 'es',
  textLength: 100,
  requestId: 'uuid'
});

logger.info('[TRANSLATION] Request completed', {
  backend: 'gpu',
  latency: 1500,
  cached: false,
  requestId: 'uuid'
});
```

## 13. Rollback Strategy

### 13.1 Rollback Plan

If issues arise with new architecture:

1. **Immediate Rollback**: Set `TRANSLATION_BACKEND=cpu` in `.env`
2. **Service Restart**: `docker-compose restart backend`
3. **Verification**: Test translations work with CPU backend
4. **Analysis**: Check logs for GPU backend issues

### 13.2 Feature Flags

```bash
# .env
TRANSLATION_ENABLED=true
TRANSLATION_BACKEND=cpu
TRANSLATION_GPU_ENABLED=false  # Emergency disable
```

## 14. Documentation Requirements

### 14.1 Developer Documentation

- How to add a new language
- How to add a new LLM
- How to configure backends
- How to test translation service

### 14.2 Operations Documentation

- How to monitor translation service
- How to troubleshoot common issues
- How to scale GPU/CPU resources
- How to update models

## 15. Future Enhancements

### 15.1 Potential Features

1. **Multi-Model Translation**: Use different models for different language pairs
2. **Quality Scoring**: Return confidence scores for translations
3. **Translation Memory**: Store user-approved translations for reuse
4. **Custom Terminology**: Support domain-specific term glossaries
5. **Batch API**: Endpoint for translating multiple documents
6. **Streaming**: Real-time translation progress for long texts
7. **Language Detection**: Auto-detect source language
8. **Model Fine-tuning**: Support custom fine-tuned models

### 15.2 Extensibility Points

- Custom language maps per domain (legal, medical, etc.)
- Custom prompt templates per LLM
- Custom fallback strategies per language pair
- Custom cache keys per use case

---

## Appendix A: Environment Variables Reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| TRANSLATION_BACKEND | string | auto | Backend selection: gpu | cpu | auto |
| TRANSLATION_ENABLED | boolean | true | Enable/disable translation service |
| TRANSLATION_CPU_MODEL_ID | string | facebook/nllb-200-distilled-600M | CPU model identifier |
| TRANSLATION_THREADS | integer | 4 | CPU worker threads |
| TRANSLATION_BATCHES | integer | 5 | CPU batch size |
| VLLM_TRANSLATION_MODEL_ID | string | google/gemma-3-4b-it | GPU model identifier |
| VLLM_TRANSLATION_ENDPOINT | string | http://vllm-translation-guardrail:9031 | vLLM service endpoint |
| VLLM_TRANSLATION_SERVICE_PORT | integer | 9031 | vLLM service port |
| VLLM_TRANSLATION_GPU_UTIL | float | 0.35 | GPU memory utilization |
| VLLM_TRANSLATION_MAX_MODEL_LEN | integer | 8192 | Maximum context length |
| TRANSLATION_CACHE | string | on | Enable Redis caching: on | off |
| TRANSLATION_CACHE_HOST | string | redis-cache | Redis host |
| TRANSLATION_CACHE_PORT | integer | 6379 | Redis port |
| TRANSLATION_CACHE_PASSWORD | string | !@#$5678 | Redis password |

## Appendix B: Language Code Reference

### FLORES-200 Codes (NLLB-200)

Format: `{language}_{script}`

Examples:
- `eng_Latn` - English (Latin script)
- `arb_Arab` - Arabic (Arabic script)
- `zho_Hans` - Chinese (Simplified)
- `rus_Cyrl` - Russian (Cyrillic script)

### ISO 639-1 Codes (TranslateGemma)

Format: `{language}` (2-letter code)

Examples:
- `en` - English
- `ar` - Arabic
- `zh` - Chinese
- `ru` - Russian

---

**Specification Version**: 1.0
**Last Updated**: 2025-02-26
**Status**: Draft - Pending Review
