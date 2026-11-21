/**
 * The ROCm branches of deploy/ansible/templates/env.j2 — rendered, not
 * read.
 *
 * env.j2 is the deployment's .env producer, and its ROCm rows live inside
 * Jinja conditionals. A static read of the template cannot say whether a
 * row renders on a given deployment, and a mistake here is invisible
 * until a deployment starts: the app stack then posts to a route that
 * answers nothing, per call, long after the deploy reported success.
 *
 * The gate renders the template for the three shapes the repository cares
 * about (NVIDIA, co-located ROCm node, remote ROCm node) with the real
 * group_vars and asserts:
 *   - the embedding trio (backend switch, base URL, RAGAS embedder base)
 *     renders ONLY on the ROCm shapes;
 *   - the NVIDIA render carries none of it — the NVIDIA deployment keeps
 *     the TEI path and its .env is unchanged;
 *   - the base URL the ROCm shapes carry points at the shape's own GPU
 *     endpoint (the co-located node's address, the remote node's host),
 *     never at the local vLLM service that does not run there.
 *
 * The gate skips when the renderer cannot run (a machine without python3,
 * jinja2 or yaml is not a broken repository). CI installs all three.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RENDERER = path.join(REPO_ROOT, 'tests/config-validator/tools/render_env_template.py');
const RENDER_TIMEOUT_MS = 60000;

/**
 * Can the renderer run? (python3 + jinja2 + yaml + the template's variables)
 *
 * @returns {{available: boolean, reason: string}}
 */
function probeRenderer() {
  const probe = spawnSync('python3', [RENDERER, 'nvidia'], {
    encoding: 'utf8',
    timeout: RENDER_TIMEOUT_MS
  });
  if (probe.error) {
    return { available: false, reason: `no python3: ${probe.error.message}` };
  }
  if (probe.status !== 0) {
    return { available: false, reason: `renderer failed: ${(probe.stderr || '').trim().split('\n').slice(-1)[0]}` };
  }
  return { available: true, reason: '' };
}

/**
 * Render one case.
 *
 * @param {string} name - the case name
 * @returns {string} the rendered .env
 */
function renderCase(name) {
  const result = spawnSync('python3', [RENDERER, name], {
    encoding: 'utf8',
    timeout: RENDER_TIMEOUT_MS
  });
  if (result.status !== 0) {
    throw new Error(`rendering ${name} failed: ${(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

/**
 * The EFFECTIVE value of one variable in a rendered .env.
 *
 * dotenv is last-wins: a variable rendered twice keeps the LAST
 * assignment. The gate therefore reads the last occurrence — and the
 * ordering test below proves which one that is.
 *
 * @param {string} text - the rendered file
 * @param {string} name - the variable name
 * @returns {string|null} the effective value, or null when the variable is absent
 */
function variable(text, name) {
  const matches = [...text.matchAll(new RegExp(`^${name}=(.*)$`, 'gm'))];
  if (matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1][1].trim();
}

const probe = probeRenderer();
const describeRender = probe.available ? describe : describe.skip;

if (!probe.available) {
  // A skip is right on a developer machine that does not have python's
  // jinja2/yaml. In CI it is a lie: the gate would report itself as
  // "skipped" and the pipeline would read green while asserting NOTHING.
  // The renderer gained a yaml import after the CI job installed only
  // jinja2 — and the gate quietly ran zero assertions because of
  // it. So in CI, a renderer that cannot run FAILS the job instead.
  if (process.env.CI) {
    throw new Error(
      `[rocm-env-render] the renderer could not run in CI (${probe.reason}). ` +
        'The gate would assert nothing while the pipeline reads green - install ' +
        "the renderer's dependencies (python3, jinja2, yaml) in the CI image."
    );
  }
  console.warn(`[rocm-env-render] skipped: ${probe.reason}`);
}

describeRender('ROCm env.j2 render gate', () => {
  let nvidia;
  let local;
  let remote;

  beforeAll(() => {
    nvidia = renderCase('nvidia');
    local = renderCase('rocm-local');
    remote = renderCase('rocm-remote');
  });

  test('the NVIDIA deployment renders no ROCm embedding rows', () => {
    // The NVIDIA deployment keeps TEI for every embedding consumer: the
    // corpus, the retriever's fallback branch AND the query encoder. Any
    // of these rows appearing here would silently move an NVIDIA
    // deployment's vectors onto another model.
    expect(variable(nvidia, 'EMBEDDING_BACKEND')).toBeNull();
    expect(variable(nvidia, 'EMBEDDING_VLLM_ENDPOINT')).toBeNull();
    expect(variable(nvidia, 'RERANKER_VLLM_ENDPOINT')).toBeNull();
  });

  test('the NVIDIA deployment still points its RAGAS embedder at TEI', () => {
    expect(variable(nvidia, 'RAGAS_EMBED_BASE_URL')).toBe('http://tei:80');
  });

  test('the co-located ROCm node renders the embedding trio', () => {
    expect(variable(local, 'EMBEDDING_BACKEND')).toBe('vllm');
    // The co-located node's own address (the GPU node's TLS proxy), not
    // the app stack's local vllm service — that service does not run on a
    // ROCm host (GPU_MODEL_REPLICAS=0).
    expect(variable(local, 'EMBEDDING_VLLM_ENDPOINT')).toMatch(/^https:\/\/10\.0\.0\.5:\d+$/);
    expect(variable(local, 'RAGAS_EMBED_BASE_URL')).toMatch(/^https:\/\/10\.0\.0\.5:\d+\/v1$/);
  });

  test('the remote ROCm node renders the embedding trio against the node host', () => {
    expect(variable(remote, 'EMBEDDING_BACKEND')).toBe('vllm');
    expect(variable(remote, 'EMBEDDING_VLLM_ENDPOINT')).toMatch(/^https:\/\/gpu\.example\.org:\d+$/);
    expect(variable(remote, 'RAGAS_EMBED_BASE_URL')).toMatch(/^https:\/\/gpu\.example\.org:\d+\/v1$/);
  });

  test('the RAGAS embedder base URL is the last one written (dotenv is last-wins)', () => {
    // The shared block renders RAGAS_EMBED_BASE_URL=http://tei:80 first; the
    // ROCm block renders the GPU base URL after it. dotenv keeps the LAST
    // assignment, so the ROCm value is the effective one — but only if it
    // really comes later.
    for (const [name, text] of [
      ['co-located', local],
      ['remote', remote]
    ]) {
      const occurrences = [...text.matchAll(/^RAGAS_EMBED_BASE_URL=(.*)$/gm)].map((match) => match[1].trim());
      expect({ name, occurrences }).toEqual({
        name,
        occurrences: ['http://tei:80', expect.stringMatching(/^https:\/\//)]
      });
    }
  });

  test('the ROCm shapes force the TLS skip the self-signed node needs', () => {
    // Without it every model call to the node fails a certificate check.
    expect(variable(local, 'OPEA_SSL_SKIP_VERIFY')).toBe('1');
    expect(variable(remote, 'OPEA_SSL_SKIP_VERIFY')).toBe('1');
  });
});
