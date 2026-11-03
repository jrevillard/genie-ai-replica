// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// EGRESS + INGRESS contract (regression #1358, 2026-11-03).
//
// #1358: the wave-2 SAST egress allowlist on authedAxios admitted ONLY the
// document-repository origin, but the ingest drain's three dataprep calls
// route through the same wrapper — every OKF import fail-closed at step 0
// on any image built after 2026-10-29, while the whole suite stayed green,
// because the worker suite mocks authedAxios at the boundary and the
// guard's own tests only pinned doc-repo shapes.
//
// This file is the mutation-test for that failure class, on BOTH axes:
//
//   EGRESS — every authedAxios call site in okf-server source must target
//   one of the two configured internal services (document-repository or
//   dataprep), asserted two ways:
//     1. a source sweep pins each call site's URL base to one of the two
//        config origins (a future consumer adding a third base goes red
//        HERE, not in a dead drain two weeks later);
//     2. the REAL guard accepts every harvested base + probe path on
//        compose defaults, and still fails a foreign origin (runtime proof
//        that sweep-accepted bases are guard-accepted bases — the sweep and
//        the allowlist cannot drift apart silently).
//
//   INGRESS — the dataprep → okf-server internal callback is guarded by a
//   shared secret whose header name and env-var name must AGREE across the
//   Python sender and the JS receiver. The pair already 403'd every
//   callback once (2026-08-21, PATCH fall-through) — a renamed constant on
//   either side would do it again. The contract scans both source trees:
//   same header literal, same env-var literal. The runtime behaviour
//   (right secret passes, wrong secret 401s) is pinned by
//   internal-controller.test.js.
//
// Deliberately NOT here: the model-service clients (adaptive-llm-call,
// rerank-client, vllm-model-cache, frontmatter TEI embed, pii-client) have
// NO origin allowlist BY DESIGN — they target operator-supplied endpoints
// including remote providers (model-configs: "LiteLLM gateway or direct
// provider APIs" is a product feature); an allowlist there would break the
// product, and their SSRF exposure is bounded by tools-admin authorization
// on the config surface. The retrieval-config-client / ragas-suite-service
// relative-path guards are safe by construction (hard-coded constant paths
// at every call site).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATAPREP_SRC = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'genie-ai-overlay',
  'dataprep',
  'genieai_dataprep_arangodb.py'
);

/** Harvest every authedAxios.<verb>( call site's first-argument window from
 * the production source tree. Returns {file, line, url} — url is the source
 * fragment (template literal / string concat as written), not a resolved
 * URL: the sweep pins the BASE EXPRESSION so a config-external literal is
 * caught even before it runs. */
function harvestAuthedAxiosCallSites(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      harvestAuthedAxiosCallSites(full, acc);
    } else if (/\.js$/.test(entry.name)) {
      const src = fs.readFileSync(full, 'utf8');
      const re = /authedAxios\s*\.\s*(?:get|post|patch|delete)\s*\(/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const line = src.slice(0, m.index).split('\n').length;
        const window = src.slice(m.index, m.index + 300);
        acc.push({ file: path.relative(ROOT, full), line, url: window });
      }
    }
  }
  return acc;
}

const callSites = harvestAuthedAxiosCallSites(ROOT);
const BASE_MARKERS = ['${config.documentRepository.url}', '${config.dataprep.url}'];

describe('egress contract: every authedAxios call targets a configured internal service (#1358)', () => {
  test('the sweep is not vacuous — the drain call sites are all seen', () => {
    expect(callSites.length).toBeGreaterThanOrEqual(20);
    const drain = callSites.filter((c) => /dataprep\.url/.test(c.url));
    expect(drain.length).toBeGreaterThanOrEqual(3); // probe, retract, ingest POST
  });

  test.each(callSites.map((c) => [`${c.file}:${c.line}`, c]))(
    '%s names config.documentRepository.url or config.dataprep.url as its base',
    (_label, site) => {
      const ok = BASE_MARKERS.some((marker) => site.url.includes(marker));
      // A one-line reason IN the failure: the guard admits exactly these two
      // origins, so a new base must either extend the guard DELIBERATELY
      // (service-token.js assertAllowedUrl + this BASE_MARKERS list + a
      // regression test there) or route through plain axios with its own
      // justification — never silently.
      expect(ok).toBe(true);
    }
  );

  test('the REAL guard accepts both configured bases at runtime, and still fails a foreign origin', () => {
    // Runtime proof that the sweep's two allowed markers are exactly the
    // origins the guard admits — given the sweep above passes, every
    // harvested call-site base IS one of these two (review round 3: the
    // name now says what the body probes).
    delete process.env.DATAPREP_URL;
    delete process.env.DOCUMENT_REPOSITORY_URL;
    jest.resetModules();
    const { _assertAllowedUrl } = require('../services/service-token');
    const config = require('../config');
    const bases = new Set([config.documentRepository.url, config.dataprep.url]);
    for (const base of bases) {
      expect(() => _assertAllowedUrl(`${base}/contract-probe`)).not.toThrow();
    }
    expect(() => _assertAllowedUrl('http://169.254.169.254/latest/meta-data')).toThrow(/dataprep service/);
    // The guard's allowed set must be exactly these two — a third admitted
    // origin without a sweep marker change is the next #1358 waiting.
    expect(bases.size).toBe(2);
  });
});

describe('ingress contract: the dataprep → okf-server internal secret pair agrees across languages', () => {
  const jsSrc = fs.readFileSync(path.join(ROOT, 'controllers', 'internal-controller.js'), 'utf8');
  const pySrc = fs.readFileSync(DATAPREP_SRC, 'utf8');

  test('both sides exist to be contracted at all (extraction is not vacuous)', () => {
    expect(fs.existsSync(DATAPREP_SRC)).toBe(true);
    expect(jsSrc).toMatch(/x-okf-internal-secret/);
    expect(pySrc).toMatch(/X-OKF-Internal-Secret/);
  });

  test('the header name is the same on both sides (case-insensitive HTTP, exact source literals)', () => {
    // req.get() lowercases; Express header lookup is case-insensitive — pin
    // the literals anyway so a rename on EITHER side (e.g. X-Internal-Secret)
    // fails here instead of 401-ing every concept callback in production.
    const jsHeader = jsSrc.match(/req\.get\(\s*['"]([^'"]+)['"]\s*\)/);
    const pyHeader = pySrc.match(/headers\[\s*["']([^"']+)["']\s*\]\s*=\s*os\.getenv\(\s*["']OKF_INTERNAL_SECRET["']/);
    expect(jsHeader).not.toBeNull();
    expect(pyHeader).not.toBeNull();
    expect(jsHeader[1].toLowerCase()).toBe('x-okf-internal-secret');
    expect(pyHeader[1].toLowerCase()).toBe(jsHeader[1].toLowerCase());
  });

  test('both sides read the SAME env var (OKF_INTERNAL_SECRET) for the shared secret', () => {
    expect(pySrc).toMatch(/os\.getenv\(\s*["']OKF_INTERNAL_SECRET["']/);
    expect(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8')).toMatch(/process\.env\.OKF_INTERNAL_SECRET/);
  });
});
