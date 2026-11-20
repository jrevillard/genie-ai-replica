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
//   - an OPEA build-time source: the OPEA source tree (by name or by its
//     organisation), the clone knobs, an `opea/*` image, a build stage named
//     after the overlay, a vendored stage or payload, the overlay package on
//     the import path, the overlay package installed by pip, or a dependency
//     declaration naming it.
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
// - Prose. The import check reads code — a commented-out import and a
//   docstring that quotes one are not couplings. The build check reads build
//   files with their comments stripped — a Dockerfile comment that mentions
//   the overlay is documentation, not a dependency. A mention in a file the
//   gate does not read (a README, a YAML value that is not an image
//   reference) is not a coupling either.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseGitlabCiJobChanges } = require('../validators/parse-compose');
const { gitlabGlobMatches } = require('../validators/gitlab-glob');
const { withTree } = require('../validators/temp-tree');

const ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_REPO_PATH = 'scripts/ci/agent-path-packages.json';
const MANIFEST_PATH = path.join(ROOT, MANIFEST_REPO_PATH);
const COMPONENTS_DIR = 'components';
const CI_JOB = 'config:validate';

/**
 * The ways a Python file can pull the OPEA overlay package in. The static
 * forms cover the module lists Python offers (`import comps.x`, `import os,
 * comps.x`), the dynamic ones are the holes a static-only check leaves open.
 *
 * `at` says which part of the match must sit in code: the package name for
 * the static forms (a name in a comment is not a coupling), the call for the
 * dynamic ones (their package name is inside a string, which is not code).
 */
const COMPS_IMPORT_FORMS = [
  {
    id: 'from-import',
    pattern: /(?:^|[;\n:])[ \t]*from[ \t]+(?<![a-z0-9_.])(?<pkg>comps)(?![a-z0-9_])/dgm,
    at: 'name'
  },
  {
    id: 'import-statement',
    pattern:
      /(?:^|[;\n:])[ \t]*import[ \t]+(?<![a-z0-9_.])(?:[A-Za-z_][\w.]*[ \t]*,[ \t]*)*(?<pkg>comps)(?![a-z0-9_])/dgm,
    at: 'name'
  },
  { id: 'importlib-import-module', pattern: /importlib\.import_module\([ \t]*['"]comps\b/g, at: 'call' },
  { id: 'builtins-import', pattern: /(^|[^\w.])__import__\([ \t]*['"]comps\b/g, at: 'call' }
];

/**
 * The files whose content is a build input: a Dockerfile, a requirements or
 * constraints file, a lock file, a packaging file, a build script or a
 * pipeline file. The OPEA markers are searched there and nowhere else — a
 * README that mentions an OPEA image is documentation, not a dependency.
 */
const BUILD_FILE_PATTERN =
  /(^|\/)(Dockerfile[^/]*|requirements[^/]*\.(txt|in)|requirements[^/]*\/[^/]*\.(txt|in)|constraints[^/]*\.txt|uv\.lock|Pipfile[^/]*|pyproject\.toml|setup\.(py|cfg)|Makefile|[^/]+\.sh|[^/]+\.(yml|yaml))$/;

/**
 * The files that DECLARE dependencies. Only in those does the name of the
 * overlay package on its own mean a dependency — elsewhere it is prose, a
 * YAML key or a Makefile target.
 */
const DEPENDENCY_FILE_PATTERN =
  /(^|\/)(requirements[^/]*\.(txt|in)|requirements[^/]*\/[^/]*\.(txt|in)|constraints[^/]*\.txt|uv\.lock|Pipfile[^/]*|pyproject\.toml|setup\.(py|cfg))$/;

/**
 * The ways an agent-path package can fetch OPEA at build time. The forms are
 * the ones the overlay's own Dockerfiles use: an OPEA image as an upstream
 * base, the clone knobs, a clone of the OPEA tree, a stage that builds the
 * overlay package, a payload copied out of it, the package on the import
 * path, and the package installed by pip.
 */
const OPEA_BUILD_MARKERS = [
  { id: 'opea-source-tree', pattern: /GenAI(?:Comps|Examples)\b/i },
  { id: 'opea-project-org', pattern: /opea-project[\\/]/i },
  { id: 'opea-build-arg', pattern: /\bOPEA_[A-Z0-9_]*(?:URL|VERSION)\b/ },
  { id: 'opea-base-image', pattern: /(?:^|[^\w.-])opea\/[a-z0-9][a-z0-9._-]*/ },
  { id: 'opea-vendored-stage', pattern: /--from=[^\s]*(?<![a-z0-9])(?:comps|opea)(?![a-z0-9])[^\s]*/ },
  { id: 'opea-overlay-stage', pattern: /\bAS[ \t]+\S*(?<![a-z0-9])(?:comps|opea)(?![a-z0-9])\S*[ \t]*$/im },
  { id: 'opea-vendored-payload', pattern: /--from=[^\s]+[^\n]*\/comps\// },
  { id: 'opea-copied-payload', pattern: /\b(?:cp|rsync|mv)\b[^\n]*\/comps(?![a-z0-9._-])/ },
  { id: 'opea-pythonpath', pattern: /PYTHONPATH[^\n]*\/comps(?![a-z0-9._-])/ },
  { id: 'opea-pip-install', pattern: /\bpip3?[ \t]+install\b[^\n]*(?<![a-z0-9._-])comps(?![a-z0-9._-])/ }
];

/**
 * The ways a dependency declaration names the overlay package. The version
 * operator (or the end of the entry) is what makes it a declaration and not
 * a mention.
 */
const OPEA_DEPENDENCY_MARKERS = [
  {
    id: 'opea-requirement',
    pattern:
      /^[ \t]*-?[ \t]*(?:genai-)?comps(?![a-z0-9._-])(?:\[[^\]]*\])?[ \t]*(?:==|>=|<=|~=|!=|<|>|[ \t]*@|[ \t]*=|[ \t]*$)/im
  },
  {
    id: 'opea-dependency-entry',
    pattern:
      /["'](?:genai-)?comps(?![a-z0-9._-])(?:\[[^\]]*\])?[ \t]*(?:==|>=|<=|~=|!=|<|>|[ \t]*@|["'][ \t]*(?:,|\]|\))|["'][ \t]*$)|^[ \t]*(?:install_requires|requires)[ \t]*=[ \t]*[^#\n]*?(?<![a-z0-9._-])comps(?![a-z0-9._-])/im
  }
];

/**
 * Read a file as CODE and as a comment-free text.
 *
 * A regular expression cannot tell code from prose: a `"""` that opens no
 * docstring pairs with the NEXT `"""`, and everything between them — a real
 * import included — looks like a string. This scanner follows the quote
 * state instead, so a stray quote cannot swallow the file.
 *
 * @param {string} content - The file content
 * @returns {{ mask: Uint8Array, commentFree: string }} The code mask (one
 *   flag per character: 1 when the character is code) and the text with the
 *   comments blanked out
 */
function analyse(content) {
  const mask = new Uint8Array(content.length);
  let commentFree = '';
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    if (char === '#') {
      // A comment runs to the end of the line: it is neither code nor text.
      while (index < content.length && content[index] !== '\n') {
        commentFree += ' ';
        index += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      // A string literal: single-quoted, double-quoted or triple-quoted. Its
      // text is kept (a dependency URL is a string), but it is not code.
      const triple = content.startsWith(char.repeat(3), index);
      const quote = triple ? char.repeat(3) : char;
      let literal = quote;
      index += quote.length;
      while (index < content.length) {
        if (content[index] === '\\') {
          literal += content.slice(index, index + 2);
          index += 2;
          continue;
        }
        if (content.startsWith(quote, index)) {
          literal += quote;
          index += quote.length;
          break;
        }
        literal += content[index];
        index += 1;
      }
      commentFree += literal;
      continue;
    }
    mask[index] = 1;
    commentFree += char;
    index += 1;
  }
  return { mask, commentFree };
}

/**
 * Is an occurrence of an import form in CODE?
 *
 * The forms are matched against the raw file — a dynamic import names the
 * package inside a string, which the code mask blanks — so the occurrence
 * is only a coupling when the part the form points at sits in code.
 *
 * @param {string} content - The file content
 * @param {Uint8Array} mask - The code mask of that content
 * @param {object} form - The import form: its pattern and the part that must
 *   be in code (`name` or `call`)
 * @returns {boolean} True when the form occurs in code
 */
function importsInCode(content, mask, form) {
  for (const match of content.matchAll(form.pattern)) {
    const offset = form.at === 'name' ? match.indices.groups.pkg[0] : match.index;
    if (mask[offset]) {
      return true;
    }
  }
  return false;
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
    const { mask, commentFree } = analyse(content);
    if (file.endsWith('.py')) {
      for (const form of COMPS_IMPORT_FORMS) {
        if (importsInCode(content, mask, form)) {
          violations.push({ file, rule: `comps-import:${form.id}` });
        }
      }
    }
    if (BUILD_FILE_PATTERN.test(file)) {
      for (const marker of OPEA_BUILD_MARKERS) {
        if (marker.pattern.test(commentFree)) {
          violations.push({ file, rule: `opea-build:${marker.id}` });
        }
      }
      if (DEPENDENCY_FILE_PATTERN.test(file)) {
        for (const marker of OPEA_DEPENDENCY_MARKERS) {
          if (marker.pattern.test(commentFree)) {
            violations.push({ file, rule: `opea-build:${marker.id}` });
          }
        }
      }
    }
  }
  return violations;
}

// One sample per detection form, each naming the rules it must trip, so a
// detector that stops matching its form turns the matrix red instead of
// silently losing a form.
const IMPORT_SAMPLES = {
  'from-import': 'from comps.chunking import Chunker\n',
  'import-statement': 'import comps.core\n',
  'importlib-import-module': "mod = importlib.import_module('comps.core')\n",
  'builtins-import': "mod = __import__('comps.core')\n"
};

const BUILD_SAMPLES = [
  {
    file: 'pkg/Dockerfile',
    content: 'RUN git clone https://github.com/mirror/GenAIComps.git /src\n',
    rules: ['opea-source-tree']
  },
  {
    file: 'pkg/Dockerfile',
    content: 'RUN git clone https://github.com/mirror/GenAIExamples.git /src\n',
    rules: ['opea-source-tree']
  },
  {
    file: 'pkg/Dockerfile',
    content: 'RUN git clone https://github.com/opea-project/other-tools.git /src\n',
    rules: ['opea-project-org']
  },
  { file: 'pkg/Dockerfile', content: 'ARG OPEA_VERSION=1.5\n', rules: ['opea-build-arg'] },
  { file: 'pkg/Dockerfile', content: 'ARG OPEA_COMPS_VERSION=1.5\n', rules: ['opea-build-arg'] },
  { file: 'pkg/Dockerfile', content: 'FROM registry.example.com/opea/embedding:1.5\n', rules: ['opea-base-image'] },
  { file: 'pkg/Dockerfile', content: 'ARG UPSTREAM_IMAGE=opea/embedding:1.5\n', rules: ['opea-base-image'] },
  { file: 'pkg/Dockerfile', content: 'COPY --from=comps_builder /src /app\n', rules: ['opea-vendored-stage'] },
  { file: 'pkg/Dockerfile', content: 'FROM python:3.11-slim AS comps_base_builder\n', rules: ['opea-overlay-stage'] },
  {
    file: 'pkg/Dockerfile',
    content: 'COPY --from=builder /src/comps/ /app/comps/\n',
    rules: ['opea-vendored-payload']
  },
  { file: 'pkg/Dockerfile', content: 'RUN cp -R /src/comps/. /app/comps/\n', rules: ['opea-copied-payload'] },
  { file: 'pkg/Dockerfile', content: 'ENV PYTHONPATH=/app/comps\n', rules: ['opea-pythonpath'] },
  { file: 'pkg/Dockerfile', content: 'RUN pip install --no-cache-dir comps\n', rules: ['opea-pip-install'] }
];

const DEPENDENCY_SAMPLES = [
  { file: 'pkg/requirements.txt', content: 'comps==1.5\n', rules: ['opea-requirement'] },
  { file: 'pkg/requirements.txt', content: '  comps==1.5\n', rules: ['opea-requirement'] },
  { file: 'pkg/Pipfile', content: 'comps = "*"\n', rules: ['opea-requirement'] },
  { file: 'pkg/pyproject.toml', content: 'dependencies = ["comps==1.5"]\n', rules: ['opea-dependency-entry'] },
  { file: 'pkg/setup.cfg', content: 'install_requires = comps\n', rules: ['opea-dependency-entry'] },
  { file: 'pkg/uv.lock', content: 'name = "comps"\n', rules: ['opea-dependency-entry'] },
  { file: 'pkg/requirements/base.txt', content: 'comps==1.5\n', rules: ['opea-requirement'] },
  { file: 'pkg/constraints.txt', content: 'comps==1.5\n', rules: ['opea-requirement'] }
];

// Prose that names the overlay package: none of it is a coupling. Each
// sample is able to fail ALONE, so reverting one mechanism — the comment
// strip, the dependency-file restriction, the version operator, the stage
// name boundary — turns the suite red.
const NEGATIVE_SAMPLES = [
  // Only the comment strip can kill this one: the OPEA image is a build
  // marker, and it sits in a comment.
  { file: 'pkg/Dockerfile', content: '# FROM opea/embedding:1.5\n' },
  // Only the dependency-file restriction can kill this one: the requirement
  // marker matches the line, and the file is not a dependency file.
  { file: 'pkg/Dockerfile', content: 'comps==1.5\n' },
  // Only the version operator can kill this one: the name is at the start of
  // the line of a dependency file, and it declares nothing.
  { file: 'pkg/requirements.txt', content: 'comps: see the overlay\n' },
  // Only the stage-name boundary can kill this one: "european" contains
  // "opea".
  { file: 'pkg/Dockerfile', content: 'FROM x AS european_base\n' },
  { file: 'pkg/Dockerfile', content: 'COPY --from=european_builder /src /app\n' },
  { file: 'pkg/Dockerfile', content: "FROM python:3.11-slim\n# Copy the *contents* of the cloned 'comps' directory\n" },
  { file: 'pkg/config.yaml', content: 'comps:\n  path: /opt/tools\n' },
  { file: 'pkg/Makefile', content: 'comps:\n\t@echo build\n' },
  { file: 'pkg/install.sh', content: 'export PYTHONPATH=/opt/comps-tools\n' },
  // A package whose name merely starts with the overlay's name.
  { file: 'pkg/Dockerfile', content: 'RUN pip install --no-cache-dir comps-tools\n' },
  { file: 'pkg/setup.cfg', content: 'install_requires = comps-tools\n' },
  { file: 'pkg/requirements.txt', content: "# the 'comps' package is banned here\nfastapi==0.141.1\n" },
  { file: 'pkg/app.py', content: '# from comps.chunking import Chunker\n' },
  { file: 'pkg/doc.py', content: '"""Example:\nfrom comps.chunking import Chunker\n"""\n' },
  { file: 'pkg/legacy.py', content: "LEGACY = None  # was importlib.import_module('comps.core')\n" },
  // A relative import of a local module named `comps` is not the overlay.
  { file: 'pkg/relative.py', content: 'from .comps import chunker\n' },
  // A local module whose name merely starts with the package name.
  { file: 'pkg/helpers.py', content: 'import os, comps_helpers\n' }
];

// The module lists Python offers: the package name among others, and an
// import that follows another statement on the same line.
const IMPORT_VARIANTS = [
  { content: 'import os, comps.core\n', rule: 'comps-import:import-statement' },
  { content: 'import os.path, comps.core as c\n', rule: 'comps-import:import-statement' },
  { content: 'x = 1; import comps.core\n', rule: 'comps-import:import-statement' },
  { content: 'if TYPE_CHECKING: import comps.core\n', rule: 'comps-import:import-statement' }
];

// A stray quote that opens no docstring, followed by a REAL import: the
// import is a coupling, and the quote must not swallow it.
const STRAY_QUOTE_SAMPLES = {
  'pkg/prompt.py': 'PROMPT = \'Say """ loudly\'\nimport comps.core\n"""\ndoc\n"""\n'
};

// A package that carries neither coupling: the control of every matrix.
const CLEAN_FILES = {
  'pkg/app.py': 'from fastapi import FastAPI\n\napp = FastAPI()\n',
  'pkg/Dockerfile': 'FROM python:3.11-slim\nRUN pip install --no-cache-dir -r requirements.txt\n',
  'pkg/requirements.txt': 'fastapi==0.141.1\nuvicorn==0.52.1\n'
};

/**
 * The files a set of `rules:changes` globs leaves uncovered.
 *
 * @param {string[]} globs - The globs of the job
 * @param {string[]} files - The repository-relative file paths
 * @returns {string[]} The files no glob matches
 */
function uncoveredFiles(globs, files) {
  return files.filter((file) => !globs.some((glob) => gitlabGlobMatches(glob, file)));
}

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

  it('reads the tracked tree, not the working directory', () => {
    // A scratch directory under components/ is not a package: git does not
    // track an empty directory, so the pipeline never sees it and the gate
    // must not either.
    const scratch = path.join(ROOT, COMPONENTS_DIR, '.gate-scratch-probe');
    fs.mkdirSync(scratch, { recursive: true });
    try {
      expect(componentDirectories()).not.toContain(`${COMPONENTS_DIR}/.gate-scratch-probe`);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
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

  it('detects the module lists Python offers', () => {
    for (const variant of IMPORT_VARIANTS) {
      const violations = withTree('opea-free-variant-', { 'pkg/mod.py': variant.content }, (root) =>
        scanFiles(['pkg/mod.py'], (file) => fs.readFileSync(path.join(root, file), 'utf8'))
      );
      expect(violations.map((violation) => violation.rule)).toEqual([variant.rule]);
    }
  });

  it('detects every OPEA build-time marker', () => {
    for (const sample of BUILD_SAMPLES) {
      const violations = withTree('opea-free-build-', { [sample.file]: sample.content }, (root) =>
        scanFiles([sample.file], (file) => fs.readFileSync(path.join(root, file), 'utf8'))
      );
      expect(violations.map((violation) => violation.rule)).toEqual(sample.rules.map((rule) => `opea-build:${rule}`));
    }
  });

  it('detects every way a dependency declaration names the overlay package', () => {
    for (const sample of DEPENDENCY_SAMPLES) {
      const violations = withTree('opea-free-dependency-', { [sample.file]: sample.content }, (root) =>
        scanFiles([sample.file], (file) => fs.readFileSync(path.join(root, file), 'utf8'))
      );
      expect(violations.map((violation) => violation.rule)).toEqual(sample.rules.map((rule) => `opea-build:${rule}`));
    }
  });

  it('detects the overlay Dockerfile a contributor copies', () => {
    const content = [
      'ARG OPEA_REPO_URL="https://github.com/opea-project/GenAIComps.git"',
      'ARG OPEA_VERSION="v1.5"',
      'RUN git clone --depth 1 --branch ${OPEA_VERSION} ${OPEA_REPO_URL} .',
      'FROM python:3.11-slim AS comps_base_builder',
      'COPY --from=opea_base /src/comps/ /app/comps/',
      'ENV PYTHONPATH="/app:/app/comps/rerankings/src"',
      ''
    ].join('\n');
    const violations = withTree('opea-free-overlay-', { 'pkg/Dockerfile': content }, (root) =>
      scanFiles(['pkg/Dockerfile'], (file) => fs.readFileSync(path.join(root, file), 'utf8'))
    );
    expect(violations.map((violation) => violation.rule).sort()).toEqual([
      'opea-build:opea-build-arg',
      'opea-build:opea-overlay-stage',
      'opea-build:opea-project-org',
      'opea-build:opea-pythonpath',
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

  it('reads dependencies, not prose', () => {
    // A comment that mentions the overlay, a YAML key, a Makefile target, a
    // tools directory and a commented-out import: none of them is a coupling.
    for (const sample of NEGATIVE_SAMPLES) {
      const violations = withTree('opea-free-negative-', { [sample.file]: sample.content }, (root) =>
        scanFiles([sample.file], (file) => fs.readFileSync(path.join(root, file), 'utf8'))
      );
      expect(violations).toEqual([]);
    }
  });

  it('finds the import a stray quote could hide', () => {
    // A `"""` that opens no docstring must not pair with the next one and
    // swallow the file: the import below it is a coupling.
    const violations = withTree('opea-free-stray-', STRAY_QUOTE_SAMPLES, (root) =>
      scanFiles(Object.keys(STRAY_QUOTE_SAMPLES), (file) => fs.readFileSync(path.join(root, file), 'utf8'))
    );
    expect(violations.map((violation) => violation.rule)).toEqual(['comps-import:import-statement']);
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
    // after the merge. EVERY tracked file of an agent-path package must be
    // matched by a glob of the job: a glob that covers only the root leaves
    // a violation in tests/ un-policed, and a set of globs that covers the
    // root in one and the nested files in another leaves the rest of the
    // package un-policed. The check runs under the fnmatch dialect
    // rules:changes uses.
    const changes = parseGitlabCiJobChanges(path.join(ROOT, '.gitlab-ci.yml'), [CI_JOB]);
    const entries = changes.get(CI_JOB) || [];
    for (const entry of agentPathPackages(readManifest())) {
      const files = trackedFilesUnder(entry.path);
      expect(uncoveredFiles(entries, files)).toEqual([]);
      // AND one glob of the job must cover the WHOLE package. A set that
      // covers the root files in one glob and the nested files in another
      // leaves the rest of the package un-policed the day a new file lands
      // outside the two directories it happens to cover.
      expect(entries.some((glob) => files.every((file) => gitlabGlobMatches(glob, file)))).toBe(true);
      // A glob set that covers the root files in one and the nested files in
      // another leaves the rest of the package un-policed.
      expect(uncoveredFiles([`${entry.path}/*.py`, `${entry.path}/tests/**/*`], files).length).toBeGreaterThan(0);
      // A glob that covers only the root leaves the nested files un-policed.
      expect(uncoveredFiles([`${entry.path}/*`], files).length).toBeGreaterThan(0);
    }
    // The manifest is an input to the gate too: an MR that moves a package
    // onto the agentic path must run the job in its own pipeline.
    expect(entries).toContain(MANIFEST_REPO_PATH);
    // The globs are the JOB'S OWN, parsed from the pipeline file: the job
    // must run the gate that lives in its own tree.
    expect(uncoveredFiles(entries, ['tests/config-validator/__tests__/opea-free-gate.test.js'])).toEqual([]);
  });
});
