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
//   - an OPEA build-time download: a clone of the OPEA source tree, an
//     `opea/*` base image under any registry, a vendored OPEA stage or
//     payload, a `comps` path on PYTHONPATH, the OPEA package installed by
//     pip, or a dependency declaration naming it.
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
// - Uncommitted files: both the file enumeration and the package enumeration
//   are the tracked tree (`git ls-files`), exactly what the pipeline checks
//   out — a local run over an unstaged file, or over a scratch directory
//   under components/, is not a pipeline result.
// - Prose. The import check reads code: a commented-out import and a
//   docstring that quotes one are not couplings, so neither is reported.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseGitlabCiJobChanges } = require('../validators/parse-compose');
const { stripCommentLines } = require('../validators/parse-env-template');
const { gitlabGlobMatches } = require('../validators/gitlab-glob');
const { withTree } = require('../validators/temp-tree');

const ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_REPO_PATH = 'scripts/ci/agent-path-packages.json';
const MANIFEST_PATH = path.join(ROOT, MANIFEST_REPO_PATH);
const COMPONENTS_DIR = 'components';
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
 * The files whose content is a build input: a Dockerfile, a requirements or
 * constraints file, a lock file, a packaging file, a build script or a
 * pipeline file. The OPEA markers are searched there and nowhere else — a
 * README that mentions an OPEA image is documentation, not a dependency.
 */
const BUILD_FILE_PATTERN =
  /(^|\/)(Dockerfile[^/]*|requirements[^/]*\.(txt|in)|requirements[^/]*\/[^/]*\.(txt|in)|constraints[^/]*\.txt|pyproject\.toml|setup\.(py|cfg)|Makefile|uv\.lock|Pipfile[^/]*|[^/]+\.sh|[^/]+\.(yml|yaml))$/;

/**
 * The ways an agent-path package can fetch OPEA at build time. The forms are
 * the ones the overlay's own Dockerfiles use.
 */
const OPEA_BUILD_MARKERS = [
  { id: 'opea-source-tree', pattern: /GenAI(?:Comps|Examples)\b/i },
  { id: 'opea-project-org', pattern: /opea-project[\\/]/i },
  { id: 'opea-build-arg', pattern: /\bOPEA_[A-Z0-9_]*URL\b|\bOPEA_[A-Z0-9_]*VERSION\b/ },
  { id: 'opea-base-image', pattern: /(?:^|[^\w.-])opea\/[a-z0-9][a-z0-9._-]*/ },
  { id: 'opea-vendored-stage', pattern: /--from=[^\s]*(?:comps|opea)[^\s]*/ },
  { id: 'opea-vendored-payload', pattern: /--from=[^\s]+[^\n]*\/comps\// },
  { id: 'opea-pythonpath', pattern: /PYTHONPATH[^\n]*\/comps\b/ },
  { id: 'opea-pip-install', pattern: /\bpip3?[ \t]+install\b[^\n]*\bcomps\b/ },
  { id: 'opea-requirement', pattern: /^[ \t]*-?[ \t]*["']?(?:genai-)?comps\b/im },
  { id: 'opea-dependency-entry', pattern: /["'](?:genai-)?comps\b/ }
];

/**
 * A triple-quoted block: a docstring or a long string. What it holds is
 * text, not an import.
 */
const DOCSTRING_PATTERN = /"""[\s\S]*?"""|'''[\s\S]*?'''/g;

/**
 * Read the code of a Python file: no docstring, no comment line.
 *
 * The gate reads imports, not prose: a commented-out import and a docstring
 * that quotes one are not couplings.
 *
 * @param {string} content - The file content
 * @returns {string} The code it holds
 */
function readCode(content) {
  return stripCommentLines(content.replace(DOCSTRING_PATTERN, ''));
}

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
 * The tracked files under a directory.
 *
 * @param {string} directory - The repository-relative directory
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
 * Every package directory under components/, as repository paths.
 *
 * The enumeration is the tracked tree, so a scratch directory a developer
 * left under components/ is not a package — and the pipeline sees exactly
 * what the gate sees.
 *
 * @returns {string[]} The repository-relative package paths, sorted
 */
function componentDirectories() {
  const directories = new Set();
  for (const file of trackedFilesUnder(COMPONENTS_DIR)) {
    const rest = file.slice(`${COMPONENTS_DIR}/`.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      continue;
    }
    directories.add(`${COMPONENTS_DIR}/${rest.slice(0, slash)}`);
  }
  return [...directories].sort();
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
      const code = readCode(content);
      for (const form of COMPS_IMPORT_FORMS) {
        if (form.pattern.test(code)) {
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

// One sample per detection form. Each sample names the rules it must trip,
// so a detector that stops matching its form turns the matrix red instead
// of silently losing a form.
const IMPORT_SAMPLES = {
  'from-import': 'from comps.chunking import Chunker\n',
  'import-statement': 'import comps.core\n',
  'importlib-import-module': "mod = importlib.import_module('comps.core')\n",
  'builtins-import': "mod = __import__('comps.core')\n"
};

const BUILD_SAMPLES = {
  'opea-source-tree': 'RUN git clone https://github.com/mirror/GenAIComps.git /src\n',
  'opea-project-org': 'RUN git clone https://github.com/opea-project/other-tools.git /src\n',
  'opea-build-arg': 'ARG OPEA_VERSION=1.5\n',
  'opea-base-image': 'FROM registry.example.com/opea/embedding:1.5\n',
  'opea-vendored-stage': 'COPY --from=opea_base /src /app\n',
  'opea-vendored-payload': 'COPY --from=builder /src/comps/ /app/comps/\n',
  'opea-pythonpath': 'ENV PYTHONPATH=/app/comps\n',
  'opea-pip-install': 'RUN pip install --no-cache-dir comps\n',
  'opea-requirement': 'comps==1.5\n',
  'opea-dependency-entry': 'dependencies = ["comps==1.5"]\n'
};

// The overlay's own Dockerfile: a clone and a vendored stage — the two forms
// a contributor copies.
const OVERLAY_DOCKERFILE =
  'RUN git clone https://github.com/opea-project/GenAIComps.git /src\nCOPY --from=opea_base /src/comps/ /app/comps/\n';

// A package that carries neither coupling: the control of every matrix.
const CLEAN_FILES = {
  'pkg/app.py': 'from fastapi import FastAPI\n\napp = FastAPI()\n',
  'pkg/Dockerfile': 'FROM python:3.11-slim\nRUN pip install --no-cache-dir -r requirements.txt\n',
  'pkg/requirements.txt': 'fastapi==0.141.1\nuvicorn==0.52.1\n'
};

// Prose that names the overlay package: neither is a coupling.
const PROSE_SAMPLES = {
  'pkg/app.py': '# from comps.chunking import Chunker\n',
  'pkg/doc.py': '"""Example:\nfrom comps.chunking import Chunker\n"""\n'
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

  it('detects the overlay Dockerfile a contributor copies', () => {
    const violations = withTree('opea-free-overlay-', { 'pkg/Dockerfile': OVERLAY_DOCKERFILE }, (root) =>
      scanFiles(['pkg/Dockerfile'], (file) => fs.readFileSync(path.join(root, file), 'utf8'))
    );
    expect(violations.map((violation) => violation.rule).sort()).toEqual([
      'opea-build:opea-project-org',
      'opea-build:opea-source-tree',
      'opea-build:opea-vendored-payload',
      'opea-build:opea-vendored-stage'
    ]);
  });

  it('leaves a clean package alone', () => {
    const violations = withTree('opea-free-clean-', CLEAN_FILES, (root) =>
      scanFiles(Object.keys(CLEAN_FILES), (file) => fs.readFileSync(path.join(root, file), 'utf8'))
    );
    expect(violations).toEqual([]);
  });

  it('reads imports, not prose', () => {
    // A commented-out import and a docstring that quotes one are not
    // couplings: the gate reads code.
    const violations = withTree('opea-free-prose-', PROSE_SAMPLES, (root) =>
      scanFiles(Object.keys(PROSE_SAMPLES), (file) => fs.readFileSync(path.join(root, file), 'utf8'))
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
    // root-level AND a nested path, under the fnmatch dialect rules:changes
    // uses.
    const changes = parseGitlabCiJobChanges(path.join(ROOT, '.gitlab-ci.yml'), [CI_JOB]);
    const entries = changes.get(CI_JOB) || [];
    for (const entry of agentPathPackages(readManifest())) {
      const rootFile = `${entry.path}/module.py`;
      const nestedFile = `${entry.path}/tests/module.py`;
      expect(entries.some((glob) => gitlabGlobMatches(glob, rootFile))).toBe(true);
      expect(entries.some((glob) => gitlabGlobMatches(glob, nestedFile))).toBe(true);
    }
    // The manifest is an input to the gate too: an MR that moves a package
    // onto the agentic path must run the job in its own pipeline.
    expect(entries).toContain(MANIFEST_REPO_PATH);
  });
});
