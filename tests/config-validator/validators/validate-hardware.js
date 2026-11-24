const fs = require('fs');

/**
 * Valid ranges for GPU parameters.
 */
const GPU_RANGES = {
  // Main LLM
  VLLM_GPU_UTILIZATION: { min: 0.1, max: 0.95, type: 'float' },
  VLLM_MAX_MODEL_LEN: { min: 512, max: 131072, type: 'int' },
  VLLM_MAX_NUM_SEQS: { min: 1, max: 2048, type: 'int' },
  VLLM_DTYPE: {
    type: 'enum',
    values: ['half', 'auto', 'float16', 'bfloat16']
  },
  // Translation LLM
  VLLM_TRANSLATION_GPU_UTILIZATION: { min: 0.1, max: 0.95, type: 'float' },
  VLLM_TRANSLATION_MAX_MODEL_LEN: { min: 512, max: 8192, type: 'int' },
  VLLM_TRANSLATION_MAX_NUM_SEQS: { min: 1, max: 2048, type: 'int' },
  VLLM_TRANSLATION_DTYPE: {
    type: 'enum',
    values: ['half', 'auto', 'float16', 'bfloat16']
  },
  VLLM_TRANSLATION_KV_CACHE_DTYPE: {
    type: 'enum',
    values: ['fp8', 'auto', 'fp16', 'bf16'],
    optional: true
  },
  // ROCm (Strix Halo) profile overlay extras
  DOCLING_DEVICE: {
    type: 'enum',
    values: ['cpu', 'cuda'],
    optional: true
  },
  RENDER_GID: { type: 'int', min: 1, max: 65535, optional: true },
  VIDEO_GID: { type: 'int', min: 1, max: 65535, optional: true },
  NGINX_HTTP_PORT: { type: 'int', min: 1, max: 65535, optional: true },
  NGINX_HTTPS_PORT: { type: 'int', min: 1, max: 65535, optional: true },
  ARANGO_PORT: { type: 'int', min: 1, max: 65535, optional: true },
  GPU_HTTPS_PORT: { type: 'int', min: 1, max: 65535, optional: true },
  GPU_HTTP_PORT: { type: 'int', min: 1, max: 65535, optional: true },
  // Sizing model IDs (the split GPU-node stack defaults to different models;
  // the Strix Halo profile pins both to the spike-measured pair)
  VLLM_LLM_MODEL_ID: { type: 'string', optional: true },
  VLLM_TRANSLATION_MODEL_ID: { type: 'string', optional: true },
  // Tool-call parser served by the vLLM container: must match the
  // served model family (granite4 = Granite 4.x default; granite = 3.x) —
  // free-form string, vLLM ships parsers for many model families
  VLLM_TOOL_CALL_PARSER: { type: 'string', optional: true },
  // TEI CPU-image batch caps (the Strix Halo profile runs TEI on the CPU
  // image; GPU-sized batch knobs inflate candle's buffer pools on CPU —
  // the reranker measured 16.3 GiB RSS at 8192/32)
  TEI_RERANKING_MAX_BATCH_TOKENS: { type: 'int', min: 128, max: 131072, optional: true },
  TEI_RERANKING_MAX_CONCURRENT_REQUESTS: { type: 'int', min: 1, max: 512, optional: true },
  TEI_EMBEDDING_MAX_BATCH_TOKENS: { type: 'int', min: 128, max: 131072, optional: true },
  TEI_RERANKING_AUTO_TRUNCATE: { type: 'enum', values: ['true', 'false'], optional: true },
  // Image pins (string-typed: registry refs, range-checked only for presence
  // by the profile guard — no value validation here). The vendor axis lives
  // in the BASE compose files as values: VLLM_IMAGE names the vLLM build for
  // every GPU-tier vLLM service (default: the NVIDIA image), and the TEI
  // rows name the TEI builds (default: the NVIDIA-capable image). The old
  // VLLM_ROCM_IMAGE / TEI_ROCM_* names were overlay-owned and died with the
  // overlays (MR review: one file set, no vendor file axis).
  VLLM_IMAGE: { type: 'string', optional: true },
  TEI_EMBEDDING_IMAGE: { type: 'string', optional: true },
  TEI_RERANKING_IMAGE: { type: 'string', optional: true },
  // Vendor device passthrough values (base compose `devices:` rows are
  // interpolated from these; unset on every NVIDIA host, so the defaults
  // there are /dev/null and /dev/zero — paths that exist everywhere).
  GPU_DEVICE_KFD: { type: 'string', optional: true },
  GPU_DEVICE_DRI: { type: 'string', optional: true },
  // The NVIDIA device claim, as a profile value: the Strix Halo profile
  // pins it to `void` (claim no GPU even on a host that has one).
  NVIDIA_VISIBLE_DEVICES: { type: 'enum', values: ['all', 'void', '0', '1', '2', '3'], optional: true },
  // Task 14 — vLLM reranker backend (ROCm path). tei stays the default
  // backend everywhere; the Strix Halo profile flips to vllm because the
  // TEI ROCm image cannot run on gfx1151 (spike results). The utilization
  // floor keeps parity with the other GPU knobs (a rerank instance at 0.05
  // is deliberate sizing, not an accident).
  RERANKER_BACKEND: { type: 'enum', values: ['tei', 'vllm'], optional: true },
  RERANKER_VLLM_ENDPOINT: { type: 'string', optional: true },
  RERANKER_VLLM_MODEL: { type: 'string', optional: true },
  VLLM_RERANKER_MODEL_ID: { type: 'string', optional: true },
  VLLM_RERANKER_GPU_UTILIZATION: { min: 0.01, max: 0.95, type: 'float', optional: true },
  VLLM_RERANKER_MAX_MODEL_LEN: { min: 512, max: 131072, type: 'int', optional: true },
  // The CLIENT-side pin of the rerank window. It must equal
  // VLLM_RERANKER_MAX_MODEL_LEN (the value the instance is STARTED with):
  // vLLM truncates an over-long (query, doc) pair at its window, while TEI
  // refuses it with HTTP 422. The pin lets the wrapper enforce the same
  // contract and let chatqna abstain with a reason instead of returning a
  // ranking computed on truncated text. Same range as the server knob.
  RERANKER_VLLM_MAX_MODEL_LEN: { min: 512, max: 131072, type: 'int', optional: true },
  // Task-14 mirror — vLLM embedding backend (ROCm path). tei stays the
  // default backend everywhere; the Strix Halo profile flips to vllm for the
  // same reason as the reranker (the TEI ROCm image cannot run on gfx1151).
  // Same validation shape as the reranker entries above, same floor on the
  // utilization knob (a 0.05 embed instance is deliberate sizing).
  EMBEDDING_BACKEND: { type: 'enum', values: ['tei', 'vllm'], optional: true },
  EMBEDDING_VLLM_ENDPOINT: { type: 'string', optional: true },
  VLLM_EMBEDDING_MODEL_ID: { type: 'string', optional: true },
  VLLM_EMBEDDING_GPU_UTILIZATION: { min: 0.01, max: 0.95, type: 'float', optional: true },
  VLLM_EMBEDDING_MAX_MODEL_LEN: { min: 512, max: 131072, type: 'int', optional: true },
  // Split-URL OIDC legs (backend / okf-server / document-repository). The
  // Strix Halo profile pins the in-network pair (venue-independent values);
  // the browser-edge alias needs the venue's domain, so it stays in the
  // venue .env.
  KEYCLOAK_DISCOVERY_URL: { type: 'string', optional: true },
  KEYCLOAK_JWKS_URL: { type: 'string', optional: true },
  // Base-file sizing knobs the collapsed scan now reaches (they were
  // invisible while this gate only scanned the ROCm overlays): the dataprep
  // completion window (0 = unset) and the textgen window override.
  DATAPREP_MAX_MODEL_LEN: { min: 0, max: 131072, type: 'int', optional: true },
  MAX_MODEL_LEN_TEXTGEN: { min: 0, max: 131072, type: 'int', optional: true }
};

/**
 * Parse a GPU profile file (env.t4 or env.rtx6000).
 *
 * @param {string} profilePath - Path to the GPU profile file
 * @returns {{ variables: Array<{ name: string, value: string }>, profileName: string }}
 */
function parseGpuProfile(profilePath) {
  let content;
  try {
    content = fs.readFileSync(profilePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read GPU profile file: ${profilePath}`, { cause: err });
  }
  const lines = content.split('\n');
  const variables = [];

  const profileName = profilePath.endsWith('env.t4')
    ? 'T4 (16GB VRAM)'
    : profilePath.endsWith('env.rtx6000')
      ? 'RTX6000 ADA (24GB VRAM)'
      : profilePath.endsWith('env.strixhalo')
        ? 'STRIX HALO (iGPU unified memory)'
        : 'Unknown';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      variables.push({ name: match[1], value: match[2] });
    }
  }

  return { variables, profileName };
}

/**
 * Validate GPU profile values fall within valid ranges.
 *
 * @param {string} profilePath - Path to the GPU profile file
 * @param {string} profileName - Human-readable profile name
 * @returns {{ errors: string[], warnings: string[], variables: Array }}
 */
function validateHardwareProfile(profilePath, profileName) {
  const { variables } = parseGpuProfile(profilePath);
  const errors = [];
  const warnings = [];

  for (const v of variables) {
    const range = GPU_RANGES[v.name];
    if (!range) {
      warnings.push(`${profileName}: Unknown GPU parameter '${v.name}' in profile`);
      continue;
    }

    if (range.type === 'enum') {
      if (!range.values.includes(v.value)) {
        errors.push(`${profileName}: ${v.name}='${v.value}' not in valid values: [${range.values.join(', ')}]`);
      }
    } else if (range.type === 'float' || range.type === 'int') {
      const numVal = parseFloat(v.value);
      if (isNaN(numVal)) {
        errors.push(`${profileName}: ${v.name}='${v.value}' is not a valid number`);
      } else if (numVal < range.min || numVal > range.max) {
        errors.push(`${profileName}: ${v.name}=${numVal} out of range [${range.min}, ${range.max}]`);
      }
    }
  }

  return { errors, warnings, variables };
}

/**
 * Validate T4 uses conservative settings vs RTX6000 aggressive.
 * T4 has 16GB VRAM, RTX6000 has 24GB — so T4 should have lower values.
 *
 * @param {{ variables: Array }} t4 - Parsed T4 profile
 * @param {{ variables: Array }} rtx - Parsed RTX6000 profile
 * @returns {{ warnings: string[] }}
 */
function validateProfileConsistency(t4, rtx) {
  const warnings = [];
  const t4Map = new Map(t4.variables.map((v) => [v.name, parseFloat(v.value)]));
  const rtxMap = new Map(rtx.variables.map((v) => [v.name, parseFloat(v.value)]));

  // GPU utilization: T4 should be <= RTX6000
  if (t4Map.has('VLLM_GPU_UTILIZATION') && rtxMap.has('VLLM_GPU_UTILIZATION')) {
    if (t4Map.get('VLLM_GPU_UTILIZATION') > rtxMap.get('VLLM_GPU_UTILIZATION')) {
      warnings.push('T4 VLLM_GPU_UTILIZATION should be <= RTX6000 (conservative vs aggressive)');
    }
  }

  // Max model len: T4 should be <= RTX6000
  if (t4Map.has('VLLM_MAX_MODEL_LEN') && rtxMap.has('VLLM_MAX_MODEL_LEN')) {
    if (t4Map.get('VLLM_MAX_MODEL_LEN') > rtxMap.get('VLLM_MAX_MODEL_LEN')) {
      warnings.push('T4 VLLM_MAX_MODEL_LEN should be <= RTX6000 (conservative vs aggressive)');
    }
  }

  return { warnings };
}

module.exports = {
  validateHardwareProfile,
  validateProfileConsistency,
  parseGpuProfile,
  GPU_RANGES
};
