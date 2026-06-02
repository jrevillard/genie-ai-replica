const fs = require('fs');

/**
 * GPU node configuration validator.
 *
 * Validates docker-compose.gpu.yaml against expected architecture:
 * - Correct service set (5 AI services + nginx + certbot)
 * - Single port 443 (path-based routing via nginx)
 * - gpu_network defined
 * - Image tags match the main app compose
 */

/** Expected AI services in GPU compose with their nginx path prefixes. */
const GPU_SERVICE_PORTS = {
  'vllm-llm': 443,
  'vllm-translation': 443,
  'tei-embedding': 443,
  'tei-reranker': 443,
  'docling-serve': 443
};

/** Image tags that must match the main docker-compose.yaml exactly. */
const GPU_REQUIRED_IMAGES = {
  'vllm-llm': 'vllm/vllm-openai:latest',
  'vllm-translation': 'vllm/vllm-openai:v0.10.0',
  'tei-embedding': 'ghcr.io/huggingface/text-embeddings-inference:1.9.3',
  'tei-reranker': 'ghcr.io/huggingface/text-embeddings-inference:1.9.3',
  'docling-serve': 'ghcr.io/ds4sd/docling-serve:latest',
  'nginx-gpu': 'nginx:1.28-alpine'
};

/** GPU compose env vars that are shared with the main compose (not GPU-specific). */
const GPU_SHARED_COMPOSE_VARS = new Set([
  'HUGGING_FACE_HUB_TOKEN',
  'NVIDIA_VISIBLE_DEVICES',
  'VLLM_LLM_MODEL_ID',
  'VLLM_GPU_UTILIZATION',
  'VLLM_MAX_MODEL_LEN',
  'VLLM_MAX_NUM_SEQS',
  'VLLM_DTYPE',
  'VLLM_TRANSLATION_MODEL_ID',
  'VLLM_TRANSLATION_GPU_UTILIZATION',
  'VLLM_TRANSLATION_MAX_MODEL_LEN',
  'VLLM_TRANSLATION_MAX_NUM_SEQS',
  'VLLM_TRANSLATION_DTYPE',
  'EMBEDDING_MODEL_ID',
  'RERANKER_MODEL_ID',
  'TEI_RERANKING_MAX_BATCH_TOKENS',
  'TEI_RERANKING_MAX_CONCURRENT_REQUESTS',
  'DATA_DIR',
  'CERTBOT_EMAIL',
  'GPU_PUBLIC_DOMAIN'
]);

/**
 * Section 14 env vars that are intentionally orphan from GPU compose.
 * These are used by the app node to point to the GPU node, not by the GPU compose itself.
 */
const GPU_NODE_SECTION14_ORPHANS = new Set([
  'GPU_NODE_HOST',
  'VLLM_ENDPOINT',
  'TRANSLATION_VLLM_ENDPOINT',
  'EMBEDDING_SERVICE_URL',
  'RERANKER_SERVICE_URL',
  'DOCLING_ENDPOINT',
  'DOCLING_ENDPOINT_TIMEOUT',
  'VLLM_API_KEY'
]);

/**
 * Extract service names and their exposed ports from docker-compose.gpu.yaml.
 * Uses regex on raw YAML content (same approach as parse-compose.js).
 *
 * @param {string} filePath - Path to docker-compose.gpu.yaml
 * @returns {{ services: Array<{ name: string, ports: number[] }>, networks: string[], images: Map<string, string> }}
 */
function parseGpuCompose(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read GPU compose file: ${filePath}: ${err.message}`, { cause: err });
  }

  const lines = content.split('\n');
  const services = [];
  const networks = [];
  const images = new Map();

  let inServices = false;
  let currentService = null;
  let currentPorts = [];
  let networksLineIdx = lines.findIndex((l) => l.trim() === 'networks:');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comment lines and blank lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Detect top-level blocks (0 indentation)
    if (line.match(/^services:\s*$/)) {
      inServices = true;
      continue;
    }
    if (line.match(/^(networks|volumes):\s*$/)) {
      inServices = false;
      continue;
    }

    if (inServices) {
      // Service definition: exactly 2-space indent + name: (not 4-space property)
      const serviceMatch = line.match(/^ {2}([a-z][\w-]+):\s*$/);
      if (serviceMatch) {
        // Save previous service
        if (currentService) {
          services.push({ name: currentService, ports: [...currentPorts] });
        }
        currentService = serviceMatch[1];
        currentPorts = [];
        continue;
      }

      // Extract port mappings inside current service block (any indent)
      const portMatch = trimmed.match(/"(\d+):\d+"/);
      if (portMatch && currentService) {
        currentPorts.push(parseInt(portMatch[1], 10));
      }

      // Extract image (4-space indent, inside a service block)
      const imageMatch = line.match(/^ {4}image:\s*([^\s]+)/);
      if (imageMatch && currentService) {
        images.set(currentService, imageMatch[1]);
      }
    }

    // Detect network definitions (2-space indent, after networks: line)
    if (networksLineIdx >= 0 && i > networksLineIdx) {
      const networkMatch = line.match(/^ {2}([\w-]+):\s*$/);
      if (networkMatch) {
        networks.push(networkMatch[1]);
      }
    }
  }

  // Save last service
  if (currentService) {
    services.push({ name: currentService, ports: [...currentPorts] });
  }

  return { services, networks, images };
}

/**
 * Validate GPU compose architecture.
 *
 * @param {string} gpuComposePath - Path to docker-compose.gpu.yaml
 * @param {string} mainComposePath - Path to docker-compose.yaml (for image tag comparison)
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateGpuNode(gpuComposePath, _mainComposePath) {
  const gpu = parseGpuCompose(gpuComposePath);
  const errors = [];
  const warnings = [];

  // 1. All 5 AI services must exist
  const gpuServiceNames = new Set(gpu.services.map((s) => s.name));
  for (const serviceName of Object.keys(GPU_SERVICE_PORTS)) {
    if (!gpuServiceNames.has(serviceName)) {
      errors.push(`GPU compose missing required service: ${serviceName}`);
    }
  }

  // 2. nginx-gpu must exist and expose port 443 (path-based routing)
  const nginxService = gpu.services.find((s) => s.name === 'nginx-gpu');
  if (!nginxService) {
    errors.push('GPU compose missing nginx-gpu service');
  } else if (!nginxService.ports.includes(443)) {
    errors.push('nginx-gpu: missing port 443 for path-based routing');
  }

  // 3. gpu_network must be defined
  if (!gpu.networks.includes('gpu_network')) {
    errors.push('GPU compose missing gpu_network definition');
  }

  // 4. Image tags must match required images
  for (const [serviceName, expectedImage] of Object.entries(GPU_REQUIRED_IMAGES)) {
    const actualImage = gpu.images.get(serviceName);
    if (actualImage && actualImage !== expectedImage) {
      errors.push(
        `${serviceName}: image tag mismatch — expected "${expectedImage}", got "${actualImage}"`
      );
    }
  }

  // 5. nginx-gpu must not expose legacy ports (9400-9404)
  const legacyPorts = [9400, 9401, 9402, 9403, 9404];
  for (const svc of gpu.services) {
    for (const port of svc.ports) {
      if (legacyPorts.includes(port)) {
        errors.push(`${svc.name}: legacy port ${port} found (path-based routing uses 443 only)`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Cross-reference GPU compose vars against env template.
 *
 * GPU compose uses vars shared with the main compose (HUGGING_FACE_HUB_TOKEN, etc.)
 * plus its own GPU_PUBLIC_DOMAIN. Section 14 env vars are intentionally orphan
 * from the GPU compose (they configure the app node to point to the GPU node).
 *
 * @param {Array<{ name: string, default: string|null, hasDefault: boolean }>} gpuComposeVars
 * @param {{ variables: Array<{ name: string }> }} envParsed
 * @param {Set<string>} sharedComposeVars - Vars shared with main compose (not GPU-specific)
 * @returns {{ orphaned: string[], undocumented: string[], conflicting: Array }}
 */
function crossReferenceGpu(gpuComposeVars, envParsed, sharedComposeVars) {
  const envNames = new Set(envParsed.variables.map((v) => v.name));
  const gpuNames = new Set(gpuComposeVars.map((v) => v.name));

  // Undocumented: in GPU compose but not in env template
  // Filter out vars shared with the main compose (documented there, not here)
  const undocumented = [...gpuNames]
    .filter((name) => !envNames.has(name) && !sharedComposeVars.has(name));

  // Orphaned: in env but not in GPU compose
  // Filter out known Section 14 orphans + vars shared with main compose
  const orphaned = [...envNames]
    .filter((name) => !gpuNames.has(name) && !GPU_NODE_SECTION14_ORPHANS.has(name))
    .filter((name) => !sharedComposeVars.has(name));

  // Conflicting: same var with different defaults
  const conflicting = [];
  const envDefaults = new Map();
  for (const v of envParsed.variables) {
    envDefaults.set(v.name, v.value);
  }
  for (const cv of gpuComposeVars) {
    if (cv.hasDefault && envNames.has(cv.name)) {
      const envVal = envDefaults.get(cv.name);
      if (envVal !== '' && cv.default !== '' && cv.default !== null && envVal !== cv.default) {
        conflicting.push({
          name: cv.name,
          composeDefault: cv.default,
          envDefault: envVal
        });
      }
    }
  }

  return { orphaned, undocumented, conflicting };
}

module.exports = {
  parseGpuCompose,
  validateGpuNode,
  crossReferenceGpu,
  GPU_SERVICE_PORTS,
  GPU_REQUIRED_IMAGES,
  GPU_SHARED_COMPOSE_VARS,
  GPU_NODE_SECTION14_ORPHANS
};
