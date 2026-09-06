/**
 * Feature flag interdependency validator.
 *
 * Validates that DEPLOY_OPEA correctly controls OPEA service variable requirements.
 * When DEPLOY_OPEA=0, OPEA-related vars are not required.
 * When DEPLOY_OPEA=1, all OPEA service vars must be present with valid defaults.
 *
 * Also enforces the closed-enum feature-var whitelist (see
 * `FEATURE_VAR_WHITELIST`): each entry must resolve to an allowed runtime value
 * — anything else is rejected by the validator. Unset vars fall back to
 * `FEATURE_VAR_DEFAULTS` so a missing seam var never produces an error.
 */

/**
 * OPEA service variable groups controlled by DEPLOY_OPEA.
 * Each entry maps a service to its key environment variables.
 */
const OPEA_SERVICE_VARS = {
  vllm: ['VLLM_LLM_MODEL_ID', 'VLLM_GPU_UTILIZATION', 'VLLM_MAX_MODEL_LEN', 'VLLM_DTYPE'],
  'vllm-translation-guardrail': [
    'VLLM_TRANSLATION_MODEL_ID',
    'VLLM_TRANSLATION_GPU_UTILIZATION',
    'VLLM_TRANSLATION_MAX_MODEL_LEN',
    'VLLM_TRANSLATION_DTYPE',
    'VLLM_TRANSLATION_SERVICE_PORT',
    'VLLM_TRANSLATION_MAX_NUM_SEQS'
  ],
  'tei-embedding': ['TEI_EMBEDDING_IMAGE', 'EMBEDDING_MODEL_ID'],
  embedding: ['EMBEDDING_MODEL_ID', 'EMBEDDING_SERVER_ENDPOINT'],
  'tei-reranking': ['TEI_RERANKING_IMAGE', 'RERANKER_MODEL_ID', 'TEI_RERANKING_MAX_BATCH_TOKENS'],
  reranking: ['RERANKING_STRATEGY', 'RERANKING_THRESHOLD'],
  retriever: [
    'RETRIEVER_ARANGO_K',
    'RETRIEVER_ARANGO_FETCH_K',
    'RETRIEVER_ARANGO_SCORE_THRESHOLD',
    'RETRIEVER_ARANGO_DISTANCE_THRESHOLD',
    'RETRIEVER_ARANGO_LAMBDA_MULT',
    'RETRIEVER_ARANGO_SEARCH_MODE',
    'RETRIEVER_HYBRID_RETRIEVAL_ENABLED',
    'RETRIEVER_ARANGO_DISTANCE_STRATEGY'
  ],
  dataprep: ['CONTENT_EXTRACTION_METHOD', 'DOCLING_DEVICE', 'DATAPREP_CHUNK_SIZE_PDF', 'LABELING_STRATEGY', 'CONTEXTUAL_RETRIEVAL_ENABLED', 'CONTEXTUAL_STRATEGY', 'CONTEXTUAL_LABEL_RAW'],
  chatqna: ['CHATQNA_TYPE', 'CHATQNA_SYSTEM_PROMPT', 'CHATQNA_ENFORCE_ABSTENTION'],
  translation: ['VLLM_TRANSLATION_SERVICE_PORT', 'TRANSLATION_CACHE']
};

/** All unique OPEA-related variable names */
const OPEA_VAR_NAMES = new Set(Object.values(OPEA_SERVICE_VARS).flat());

/**
 * Feature vars with a closed set of allowed values (closed-enum whitelist).
 * Mirrors the architecture spine AD-15 future-provider seam contract: each
 * entry documents which runtime values are permitted. Boot rejects anything
 * outside the list.
 */
const FEATURE_VAR_WHITELIST = {
  MELT_PROVIDER: ['victorialogs']
};

/**
 * Default value applied when a whitelisted feature var is unset / empty in
 * BOTH env template AND docker-compose. Mirrors the defaults documented in
 * `env-vars.md` ("New vars" table) and `deploy/ansible/templates/env.j2`.
 */
const FEATURE_VAR_DEFAULTS = {
  MELT_PROVIDER: 'victorialogs'
};

/**
 * Validate feature flag interdependencies.
 *
 * @param {{ variables: Array<{ name: string, value: string }> }} envParsed - Parsed env template
 * @param {Array<{ name: string, default: string|null, hasDefault: boolean }>} composeVars - Parsed compose variables
 * @returns {{ errors: string[], warnings: string[], resolvedFeatureVars: Record<string, string> }}
 */
function validateFeatureFlags(envParsed, composeVars) {
  const errors = [];
  const warnings = [];
  const envNames = new Set(envParsed.variables.map((v) => v.name));

  // Check: OPEA vars should be present in both env and compose
  for (const varName of OPEA_VAR_NAMES) {
    const inEnv = envNames.has(varName);
    const inCompose = composeVars.some((v) => v.name === varName);

    if (!inEnv && !inCompose) {
      errors.push(`OPEA variable ${varName} is not documented in env template or docker-compose.yaml`);
    } else if (!inEnv) {
      warnings.push(`OPEA variable ${varName} is used in docker-compose.yaml but not documented in env template`);
    }
  }

  // Check: GPU profile files should only override GPU-specific vars, not service topology
  const gpuOnlyVars = new Set([
    'VLLM_GPU_UTILIZATION',
    'VLLM_MAX_MODEL_LEN',
    'VLLM_MAX_NUM_SEQS',
    'VLLM_DTYPE',
    'VLLM_TRANSLATION_GPU_UTILIZATION',
    'VLLM_TRANSLATION_MAX_MODEL_LEN',
    'VLLM_TRANSLATION_MAX_NUM_SEQS',
    'VLLM_TRANSLATION_DTYPE',
    'VLLM_TRANSLATION_KV_CACHE_DTYPE',
    'TEI_EMBEDDING_IMAGE'
  ]);

  // Check: closed-enum feature vars must resolve to a whitelisted value.
  // Resolution order: env template value → compose default → built-in default.
  // Unset / empty values fall back to the built-in default (boot MUST NOT
  // crash on a missing seam var — the future-provider seam is opt-in).
  const resolvedFeatureVars = {};
  for (const [varName, allowed] of Object.entries(FEATURE_VAR_WHITELIST)) {
    const envVar = envParsed.variables.find((v) => v.name === varName);
    const envValue = envVar && envVar.value ? envVar.value : '';

    const composeVar = composeVars.find((v) => v.name === varName);
    const composeValue = composeVar && composeVar.hasDefault && composeVar.default ? composeVar.default : '';

    const resolved = envValue || composeValue || FEATURE_VAR_DEFAULTS[varName] || '';
    resolvedFeatureVars[varName] = resolved;

    if (resolved !== '' && !allowed.includes(resolved)) {
      errors.push(`Feature variable ${varName}='${resolved}' is not in the whitelist (allowed: ${allowed.join(', ')})`);
    }
  }

  return {
    opeaServiceVars: OPEA_SERVICE_VARS,
    opeaVarNames: OPEA_VAR_NAMES,
    gpuOnlyVars,
    resolvedFeatureVars,
    errors,
    warnings
  };
}

module.exports = {
  validateFeatureFlags,
  OPEA_SERVICE_VARS,
  OPEA_VAR_NAMES,
  FEATURE_VAR_WHITELIST,
  FEATURE_VAR_DEFAULTS
};
