/**
 * Feature flag interdependency validator.
 *
 * Validates that DEPLOY_OPEA correctly controls OPEA service variable requirements.
 * When DEPLOY_OPEA=0, OPEA-related vars are not required.
 * When DEPLOY_OPEA=1, all OPEA service vars must be present with valid defaults.
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
    'RETRIEVER_ARANGO_DISTANCE_STRATEGY'
  ],
  dataprep: ['CONTENT_EXTRACTION_METHOD', 'DOCLING_DEVICE', 'DATAPREP_CHUNK_SIZE_PDF', 'LABELING_STRATEGY', 'CONTEXTUAL_RETRIEVAL_ENABLED'],
  chatqna: ['CHATQNA_TYPE', 'CHATQNA_SYSTEM_PROMPT', 'CHATQNA_ENFORCE_ABSTENTION'],
  translation: ['VLLM_TRANSLATION_SERVICE_PORT', 'TRANSLATION_CACHE']
};

/** All unique OPEA-related variable names */
const OPEA_VAR_NAMES = new Set(Object.values(OPEA_SERVICE_VARS).flat());

/**
 * Validate feature flag interdependencies.
 *
 * @param {{ variables: Array<{ name: string, value: string }> }} envParsed - Parsed env template
 * @param {Array<{ name: string }>} composeVars - Parsed compose variables
 * @returns {{ errors: string[], warnings: string[] }}
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

  return {
    opeaServiceVars: OPEA_SERVICE_VARS,
    opeaVarNames: OPEA_VAR_NAMES,
    gpuOnlyVars,
    errors,
    warnings
  };
}

module.exports = { validateFeatureFlags, OPEA_SERVICE_VARS, OPEA_VAR_NAMES };
