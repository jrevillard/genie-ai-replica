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
  }
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
