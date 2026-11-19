'use strict';

// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// STATIC repository check — the OPEA-free gate (Story 1.4, FR-20, AD-1).
//
// AD-1 makes the agentic path OPEA-free structurally, not by discipline: a
// contributor who imports the OPEA overlay package into an agent-path package,
// or vendors an OPEA tree at build time, breaks the constraint with a green
// pipeline. This gate is what makes the constraint structural.
//
// Over the packages the manifest lists as agent-path, it checks:
//   - an import of the OPEA overlay package (`comps`), in every form Python
//     offers: static, aliased, and dynamic;
//   - an OPEA build-time download: a clone of the OPEA tree, an `opea/*` base
//     image, a vendored OPEA stage, a `comps` path on PYTHONPATH, the OPEA
//     package installed by pip, or a requirement naming it.
//
// The candidate set is data (scripts/ci/agent-path-packages.json), not code:
// putting a package on the agentic path is a manifest edit. Every package
// under components/ is classified, so the set cannot shrink by omission.
//
// SCOPE — WHAT THIS GATE CANNOT SEE
// ---------------------------------
// - The BFF's runtime call graph. Grep cannot tell which URL the agentic
//   branch targets at runtime; a BFF that routes to the OPEA chatqna service
//   passes this gate untouched. That leg is covered by the Epic 3 story 3.1
//   routing-helper test, which asserts the agentic branch never targets the
//   chatqna/OPEA URL.
// - Reachability through an alias or a re-export: the gate matches the
//   package name as it is written, not the symbol it resolves to.
// - The overlay itself: genie-ai-overlay/ is where the `comps` package
//   legitimately lives, so it is out of scope by design.
// - The dependency graph of a third-party package: only the files of the
//   agent-path packages are read.
// - Uncommitted files: the enumeration is the tracked tree (`git ls-files`),
//   exactly what the pipeline checks out — a local run over an unstaged file
//   is not a pipeline result.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseGitlabCiJobChanges } = require('../validators/parse-compose');
const { gitlabGlobMatches } = require('../validators/gitlab-glob');
const { withTree } = require('../validators/temp-tree');

const ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_REPO_PATH = 'scripts/ci/agent-path-packages.json';
const MANIFEST_PATH = path.join(ROOT, MANIFEST_REPO_PATH);
const COMPONENTS_DIR = path.join(ROOT, 'components');
const CI_JOB = 'config:validate';

/**
 * The ways a Python file can pull the OPEA overlay package in. The static
 * forms are the ones the overlay's own services use; the dynamic ones are
 * the holes a static-only check leaves open.
 */
const COMPS_IMPORT_FORMS = [
  { id: 'from-import', pattern: /^[ \t]*from[ \t]+comps\b/m },
  { id: 'import-statement', pattern: /^[ \t]*import[ \t]+comps\b/m },
  { id: 'importlib-import-module', pattern: /importlib\.import_module\([ \t]*['"]comps\b/ },
  { id: 'builtins-import', pattern: /(^|[^\w.])__import__\([ \t]*['"]comps\b/ }
];

/**
 * The files whose content is a build input: a Dockerfile, a requirements
 * file, a packaging file, a build script or a pipeline file. The OPEA
 * markers are searched there and nowhere else — a README that mentions an
 * OPEA image is documentation, not a dependency.
 */
const BUILD_FILE_PATTERN =
  /(^|\/)(Dockerfile[^/]*|requirements[^/]*\.(txt|in)|pyproject\.toml|setup\.(py|cfg)|Makefile|[^/]+\.sh|[^/]+\.(yml|yaml))$/;

/**
 * The ways an agent-path package can fetch OPEA at build time. The forms are
 * the ones the overlay's own Dockerfiles use.
 */
const OPEA_BUILD_MARKERS = [
  { id: 'opea-clone-url', pattern: /opea-project[\\/]/ },
  { id: 'opea-build-arg', pattern: /\bOPEA_(?:COMPS_)?REPO_URL\b|\bOPEA_VERSION\b/ },
  { id: 'opea-base-image', pattern: /(?:^|[\s"'=(])(?:docker\.io\/|ghcr\.io\/)?opea\/[a-z0-9][a-z0-9._-]*/ },
  { id: 'opea-vendored-stage', pattern: /--from=(?:opea_base|opea_example_base|comps_base_builder)\b/ },
  { id: 'opea-pythonpath', pattern: /PYTHONPATH[^\n]*\/comps\// },
  { id: 'opea-pip-install', pattern: /\bpip3?[ \t]+install\b[^\n]*\bcomps\b/ },
  { id: 'opea-requirement', pattern: /^(?:genai-)?comps\b/im }
];

/**
 * Read the manifest that classifies the packages under components/.
 *
 * @returns {object} The parsed manifest
 */
function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

/**
 * The packages on the agentic path, as the manifest declares them.
 *
 * @param {object} manifest - The parsed manifest
 * @returns {object[]} The agent-path entries
 */
function agentPathPackages(manifest) {
  return manifest.agentPathPackages || [];
}

/**
 * The packages NOT on the agentic path, as the manifest declares them.
 *
 * @param {object} manifest - The parsed manifest
 * @returns {object[]} The other entries
 */
function otherPackages(manifest) {
  return manifest.otherPackages || [];
}

/**
 * Every package directory under components/, as repository paths.
 *
 * @returns {string[]} The repository-relative package paths, sorted
 */
function componentDirectories() {
  return fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `components/${entry.name}`)
    .sort();
}

/**
 * The packages the manifest does not classify.
 *
 * A package that is in neither list is a hole: the gate would pass over it
 * without ever looking, and nobody would know which path it was.
 *
 * @param {object} manifest - The parsed manifest
 * @param {string[]} directories - The package directories that exist
 * @returns {string[]} The unclassified package paths
 */
function unclassifiedPackages(manifest, directories) {
  const classified = new Set([...agentPathPackages(manifest), ...otherPackages(manifest)].map((entry) => entry.path));
  return directories.filter((directory) => !classified.has(directory));
}

/**
 * The tracked files under a package directory.
 *
 * @param {string} directory - The repository-relative package path
 * @returns {string[]} The repository-relative tracked file paths
 */
function trackedFilesUnder(directory) {
  const out = execFileSync('git', ['ls-files', '-z', '--', directory], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return out.split('\0').filter(Boolean);
}

/**
 * Scan files for the two OPEA couplings the gate forbids.
 *
 * @param {string[]} files - The file paths to read
 * @param {(file: string) => string} read - The reader for a file
 * @returns {object[]} The violations, one per file and rule
 */
function scanFiles(files, read) {
  const violations = [];
  for (const file of files) {
    const content = read(file);
    if (file.endsWith('.py')) {
      for (const form of COMPS_IMPORT_FORMS) {
        if (form.pattern.test(content)) {
          violations.push({ file, rule: `comps-import:${form.id}` });
        }
      }
    }
    if (BUILD_FILE_PATTERN.test(file)) {
      for (const marker of OPEA_BUILD_MARKERS) {
        if (marker.pattern.test(content)) {
          violations.push({ file, rule: `opea-build:${marker.id}` });
        }
      }
    }
  }
  return violations;
}

// One sample per detection form. Each sample triggers exactly one rule, so a
// detector that stops matching its form turns the matrix red instead of
// silently losing a form.
const IMPORT_SAMPLES = {
  'from-import': 'from comps.chunking import Chunker\n',
  'import-statement': 'import comps.core\n',
  'importlib-import-module': "mod = importlib.import_module('comps.core')\n",
  'builtins-import': "mod = __import__('comps.core')\n"
};

const BUILD_SAMPLES = {
  'opea-clone-url': 'RUN git clone https://github.com/opea-project/GenAIComps.git /src\n',
  'opea-build-arg': 'ARG OPEA_VERSION=1.5\n',
  'opea-base-image': 'FROM opea/embedding:1.5\n',
  'opea-vendored-stage': 'COPY --from=opea_base /src/comps/ /app/comps/\n',
  'opea-pythonpath': 'ENV PYTHONPATH=/app/comps/rerankings/src\n',
  'opea-pip-install': 'RUN pip install --no-cache-dir comps\n',
  'opea-requirement': 'comps==1.5\n'
};

// A package that carries neither coupling: the control of every matrix.
const CLEAN_FILES = {
  'pkg/app.py': 'from fastapi import FastAPI\n\napp = FastAPI()\n',
  'pkg/Dockerfile': 'FROM python:3.11-slim\nRUN pip install --no-cache-dir -r requirements.txt\n',
  'pkg/requirements.txt': 'fastapi==0.141.1\nuvicorn==0.52.1\n'
};

describe('OPEA-free gate (Story 1.4, FR-20, AD-1)', () => {
  it('classifies every package under components/', () => {
    const manifest = readManifest();
    const directories = componentDirectories();
    expect(directories.length).toBeGreaterThanOrEqual(1);
    expect(unclassifiedPackages(manifest, directories)).toEqual([]);

    const entries = [...agentPathPackages(manifest), ...otherPackages(manifest)];
    // Every entry carries its reason: the classification is a decision
    // someone wrote down, not a silent omission.
    for (const entry of entries) {
      expect(typeof entry.why).toBe('string');
      expect(entry.why.trim().length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(ROOT, entry.path))).toBe(true);
    }
    // A package listed twice would be classified by whichever list is read
    // last — the reason would then belong to the wrong decision.
    const paths = entries.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(agentPathPackages(manifest).length).toBeGreaterThanOrEqual(1);
  });

  it('finds no OPEA coupling in the agentic path', () => {
    const manifest = readManifest();
    const files = agentPathPackages(manifest).flatMap((entry) => trackedFilesUnder(entry.path));
    const violations = scanFiles(files, (file) => fs.readFileSync(path.join(ROOT, file), 'utf8'));
    expect(violations).toEqual([]);
  });

  it('scans the agentic path', () => {
    // Anti-vacuity floor: an enumeration that returned nothing would make the
    // gate above pass without ever reading a file.
    const manifest = readManifest();
    const packages = agentPathPackages(manifest);
    const files = packages.flatMap((entry) => trackedFilesUnder(entry.path));
    expect(files.length).toBeGreaterThanOrEqual(5);
    // Every tracked file of every agent-path package is scanned — a gate that
    // skips a file type would still be green.
    const trackedTotal = packages.reduce((total, entry) => total + trackedFilesUnder(entry.path).length, 0);
    expect(files.length).toBe(trackedTotal);
    for (const file of files) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    }
  });

  it('detects every form of comps import', () => {
    for (const [id, content] of Object.entries(IMPORT_SAMPLES)) {
      const violations = withTree('opea-free-import-', { 'pkg/mod.py': content }, (root) =>
        scanFiles(['pkg/mod.py'], (file) => fs.readFileSync(path.join(root, file), 'utf8'))
      );
      expect(violations.map((violation) => violation.rule)).toEqual([`comps-import:${id}`]);
    }
  });

  it('detects every OPEA build-time marker', () => {
    for (const [id, content] of Object.entries(BUILD_SAMPLES)) {
      const violations = withTree('opea-free-build-', { 'pkg/Dockerfile': content }, (root) =>
        scanFiles(['pkg/Dockerfile'], (file) => fs.readFileSync(path.join(root, file), 'utf8'))
      );
      expect(violations.map((violation) => violation.rule)).toEqual([`opea-build:${id}`]);
    }
  });

  it('leaves a clean package alone', () => {
    const violations = withTree('opea-free-clean-', CLEAN_FILES, (root) =>
      scanFiles(Object.keys(CLEAN_FILES), (file) => fs.readFileSync(path.join(root, file), 'utf8'))
    );
    expect(violations).toEqual([]);
  });

  it('fails when a package is not classified', () => {
    const manifest = readManifest();
    const directories = componentDirectories();
    const dropped = otherPackages(manifest)[0] || agentPathPackages(manifest)[0];
    const synthetic = {
      agentPathPackages: agentPathPackages(manifest).filter((entry) => entry.path !== dropped.path),
      otherPackages: otherPackages(manifest).filter((entry) => entry.path !== dropped.path)
    };
    expect(unclassifiedPackages(synthetic, directories)).toEqual([dropped.path]);
  });

  it('runs the gate in the pipeline that can introduce a violation', () => {
    // The gate reads the tracked tree, so the pipeline that adds a violation
    // must run the job that holds it — otherwise the failure only shows up
    // after the merge. A glob that looks right but does not cover a nested
    // file (components/agent-service/* instead of **/*) would leave a
    // violation in tests/ un-policed, so the glob is checked against a
    // nested path under the fnmatch dialect rules:changes uses.
    const changes = parseGitlabCiJobChanges(path.join(ROOT, '.gitlab-ci.yml'), [CI_JOB]);
    const entries = changes.get(CI_JOB) || [];
    for (const entry of agentPathPackages(readManifest())) {
      const nested = `${entry.path}/tests/probe.py`;
      expect(entries.some((glob) => gitlabGlobMatches(glob, nested))).toBe(true);
    }
    // The manifest is an input to the gate too: an MR that moves a package
    // onto the agentic path must run the job in its own pipeline.
    expect(entries).toContain(MANIFEST_REPO_PATH);
  });
});
