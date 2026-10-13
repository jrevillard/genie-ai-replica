const fs = require('fs');

/**
 * Extract environment variable references from docker-compose.yaml using regex.
 *
 * IMPORTANT: docker-compose.yaml contains ${VAR:-default} shell substitution
 * which is NOT valid YAML. Use regex pattern matching on raw file content,
 * NOT js-yaml for variable extraction.
 *
 * Regex: /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g
 *   Group 1: variable name
 *   Group 2: default value (optional, may be empty string for ${VAR:-})
 *
 * @param {string} filePath - Path to docker-compose.yaml
 * @returns {Array<{ name: string, default: string|null, hasDefault: boolean, raw: string }>}
 */
function parseComposeEnvVars(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read docker-compose file: ${filePath}`, { cause: err });
  }
  // Filter out comment lines to avoid false positives from documentation text
  const codeLines = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  // Regex: /\$\{([A-Z_][A-Z0-9_]*)(?::-((?:[^{}]|\$\{[^}]*\})*))?\}/g
  // Default group uses (?:[^{}]|\$\{[^}]*\})* to handle ONE level of nested
  // ${...} in defaults (e.g. ${VAR:-${OTHER:-fallback}}).
  const regex = /\$\{([A-Z_][A-Z0-9_]*)(?::-((?:[^{}]|\$\{[^}]*\})*))?\}/g;
  const seen = new Map();

  let match;
  while ((match = regex.exec(codeLines)) !== null) {
    const name = match[1];
    const rawDefault = match[2];
    // ${VAR:-} means default is empty string; ${VAR} means no default at all
    const hasDefault = match[0].includes(':');
    const defaultVal = hasDefault ? rawDefault : null;

    if (!seen.has(name)) {
      seen.set(name, {
        name,
        default: defaultVal,
        hasDefault,
        raw: match[0]
      });
    } else {
      // If we see the same var with and without a default, prefer the one with default
      const existing = seen.get(name);
      if (!existing.hasDefault && hasDefault) {
        seen.set(name, {
          name,
          default: defaultVal,
          hasDefault,
          raw: match[0]
        });
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Cross-reference docker-compose vars against env template vars.
 *
 * Flags:
 *   - Orphaned: vars in env template but never referenced in docker-compose.yaml
 *   - Undocumented: vars in docker-compose.yaml but not in env template
 *   - Conflicting: same variable with different defaults in compose vs env
 *
 * @param {Array<{ name: string, default: string|null, hasDefault: boolean }>} composeVars
 * @param {{ variables: Array<{ name: string, value: string }> }} envParsed
 * @returns {{ orphaned: string[], undocumented: string[], conflicting: Array<{ name: string, composeDefault: string, envDefault: string }> }}
 */
function crossReference(composeVars, envParsed) {
  const envNames = new Set(envParsed.variables.map((v) => v.name));
  const envDefaults = new Map();
  for (const v of envParsed.variables) {
    envDefaults.set(v.name, v.value);
  }

  const composeNames = new Set(composeVars.map((v) => v.name));

  const orphaned = [...envNames].filter((name) => !composeNames.has(name));

  const undocumented = [...composeNames].filter((name) => !envNames.has(name));

  // GENIE_AI_REGISTRY is an indirection knob: compose defaults use
  // ${GENIE_AI_REGISTRY:-<fallback>}/<image> while the env template expands each
  // per-service GENIE_AI_*_IMAGE to the literal form. Resolve that one variable
  // (using its env value, or the fallback if unset) before comparing so
  // equivalent values are not flagged as conflicting.
  const registryVal = envDefaults.get('GENIE_AI_REGISTRY') || '';
  const resolveRegistry = (val) =>
    val
      .replace(/\$\{GENIE_AI_REGISTRY:-([^}]*)\}/g, (_m, fallback) => registryVal || fallback)
      .replace(/\$\{GENIE_AI_REGISTRY\}/g, registryVal);

  const conflicting = [];
  for (const cv of composeVars) {
    if (cv.hasDefault && envNames.has(cv.name)) {
      const envVal = envDefaults.get(cv.name);
      const resolvedDefault = resolveRegistry(cv.default);
      // Only flag as conflicting if both have non-empty values and they differ
      if (envVal !== '' && resolvedDefault !== '' && resolvedDefault !== null && envVal !== resolvedDefault) {
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

/**
 * Extract all image references from a docker-compose file.
 *
 * Returns every `image:` line parsed as { service, image, isVariableRef }.
 * - `service` is the enclosing service name (best-effort via 2/4-space YAML indent).
 * - `image` is the raw image string (may contain ${} substitutions).
 * - `isVariableRef` is true when the image starts with `${` (i.e. the whole value
 *   is a variable reference; the fallback `:latest` in those expressions is the
 *   documented local-dev escape hatch and is NOT flagged by the `:latest` test).
 *
 * Follows the same regex-on-raw-YAML approach as parseGpuCompose() in
 * validate-gpu-node.js — compose files contain ${VAR:-default} shell substitutions
 * that are not valid YAML, so we cannot use js-yaml here.
 *
 * @param {string} filePath - Path to a docker-compose file
 * @returns {Array<{ service: string|null, image: string, isVariableRef: boolean }>}
 */
function parseComposeImages(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read compose file: ${filePath}`, { cause: err });
  }

  const lines = content.split('\n');
  const results = [];
  let currentService = null;
  let inServices = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comment lines and blank lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Detect top-level `services:` block
    if (line.match(/^services:\s*$/)) {
      inServices = true;
      continue;
    }
    // Detect any other top-level block (networks, volumes, configs, secrets, etc.)
    if (line.match(/^[a-z][\w-]*:\s*$/) && !line.startsWith(' ')) {
      inServices = trimmed === 'services:';
      continue;
    }

    if (!inServices) continue;

    // Service definition: 2-space indent + name
    const serviceMatch = line.match(/^ {2}([\w-]+):\s*$/);
    if (serviceMatch) {
      currentService = serviceMatch[1];
      continue;
    }

    // Image reference: 4-space (or deeper) indent inside a service block
    const imageMatch = line.match(/^ {4,}image:\s*(.+)$/);
    if (imageMatch && currentService) {
      const image = imageMatch[1].trim().replace(/\s+#.*$/, "").trim();
      results.push({
        service: currentService,
        image,
        isVariableRef: image.startsWith('${')
      });
    }
  }

  return results;
}

/**
 * Parse image references from Ansible group_vars (YAML).
 *
 * Looks for lines matching `<name>_image: <value>` and returns them as
 * { name, image }. The Ansible group_vars file is plain YAML with no ${}
 * substitutions, so simple line parsing is sufficient.
 *
 * @param {string} filePath - Path to an Ansible group_vars YAML file
 * @returns {Array<{ name: string, image: string }>}
 */
function parseAnsibleImages(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read Ansible file: ${filePath}`, { cause: err });
  }

  const results = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    const match = trimmed.match(/^([\w]+_image):\s*(.+)$/);
    if (match) {
      results.push({ name: match[1], image: match[2].trim().replace(/\s+#.*$/, "").trim() });
    }
  }
  return results;
}

/**
 * Parse image references from GitLab CI configuration (.gitlab-ci.yml).
 *
 * Looks for lines matching `image: <value>` (with any indentation) and returns
 * them as { job, image }. GitLab CI files are plain YAML with no ${} substitutions,
 * so simple line parsing is sufficient.
 *
 * @param {string} filePath - Path to a .gitlab-ci.yml file
 * @returns {Array<{ job: string|null, image: string }>}
 */
function parseGitlabCiImages(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read GitLab CI file: ${filePath}`, { cause: err });
  }

  const lines = content.split('\n');
  const results = [];
  let currentJob = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Detect job definition (top-level key with 0 indent)
    const jobMatch = line.match(/^([\w-]+):\s*$/);
    if (jobMatch) {
      currentJob = jobMatch[1];
      continue;
    }

    // Detect image reference (any indent)
    const imageMatch = trimmed.match(/^image:\s*(.+)$/);
    if (imageMatch) {
      results.push({ job: currentJob, image: imageMatch[1].trim().replace(/\s+#.*$/, "").trim() });
    }
  }
  return results;
}

module.exports = { parseComposeEnvVars, crossReference, parseComposeImages, parseAnsibleImages, parseGitlabCiImages, parseComposeServiceContracts };

/**
 * Extract per-service structural contracts (profiles + deploy.replicas) from
 * docker-compose.yaml.
 *
 * Used by config-validator tests to assert always-on invariants — e.g. that
 * the admin-logs substrate (VL + OTel Collector + otel-collector-init) has
 * no `profiles: [observability]` and that `victorialogs.deploy.replicas` is
 * the literal `1` rather than `${ENABLE_OBSERVABILITY:-0}`.
 *
 * Pure line-scan over the raw file (compose has ${} substitutions, so js-yaml
 * is unsafe here — same caveat as parseComposeEnvVars).
 *
 * Returns:
 *   [{ service, profiles: string[], replicas: string|null, replicasLine: number|null }]
 *
 * - `profiles`: list of profile names declared on the service. Empty if no
 *   `profiles:` key (means default profile = always-on in compose mode).
 * - `replicas`: raw replicas value (may contain `${VAR:-default}`).
 * - `replicasLine`: 1-indexed line number of the `replicas:` line, for error
 *   messages.
 *
 * @param {string} filePath - Path to a docker-compose.yaml file
 * @returns {Array<{ service: string, profiles: string[], replicas: string|null, replicasLine: number|null }>}
 */
function parseComposeServiceContracts(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read docker-compose file: ${filePath}`, { cause: err });
  }

  const lines = content.split('\n');
  const contracts = [];
  let currentService = null;
  let inServices = false;
  let currentProfiles = null;
  let currentReplicas = null;
  let currentReplicasLine = null;

  const flush = () => {
    if (currentService) {
      contracts.push({
        service: currentService,
        profiles: currentProfiles || [],
        replicas: currentReplicas,
        replicasLine: currentReplicasLine
      });
    }
    currentProfiles = null;
    currentReplicas = null;
    currentReplicasLine = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Detect top-level `services:` block
    if (line.match(/^services:\s*$/)) {
      flush();
      inServices = true;
      currentService = null;
      continue;
    }
    // Detect any other top-level block (networks, volumes, configs, secrets, etc.)
    if (line.match(/^[a-z][\w-]*:\s*$/) && !line.startsWith(' ')) {
      flush();
      inServices = trimmed === 'services:';
      continue;
    }

    if (!inServices) continue;

    // Service definition: 2-space indent + name
    const serviceMatch = line.match(/^ {2}([\w-]+):\s*$/);
    if (serviceMatch) {
      flush();
      currentService = serviceMatch[1];
      continue;
    }

    // profiles: [name1, name2] or profiles: name1
    const profilesMatch = trimmed.match(/^profiles:\s*\[([^\]]*)\]\s*$/) ||
      trimmed.match(/^profiles:\s*\[?\s*([^\]]+?)\s*\]?\s*$/);
    if (profilesMatch && currentService) {
      const raw = profilesMatch[1];
      currentProfiles = raw
        .split(',')
        .map((p) => p.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      continue;
    }

    // deploy.replicas: — 6-space indent (4 for `deploy:`, 6 for `replicas:`)
    const replicasMatch = trimmed.match(/^replicas:\s*(.+)$/);
    if (replicasMatch && currentService) {
      // Only treat as deploy.replicas if we're inside a `deploy:` block (indented ≥ 6 spaces)
      const indentMatch = line.match(/^( +)replicas:/);
      if (indentMatch && indentMatch[1].length >= 6) {
        currentReplicas = replicasMatch[1].trim().replace(/\s+#.*$/, '').trim();
        currentReplicasLine = i + 1;
      }
    }
  }

  flush();
  return contracts;
}
