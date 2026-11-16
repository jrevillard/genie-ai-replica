// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// !1205 — the drift pin between dataprep's Contextual Retrieval budget
// arithmetic and the Node mirror the OKF concept-document ceiling derives
// from (GitLab #1205, closing #1588).
//
// The pin is about CONSTANTS, not about the derived number: both sides are
// runtime answers, and a validator that recomputed the ceiling would be a
// third derivation. The constants are literals in both files, and THAT is
// what can drift silently.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  validateContextualMirror,
  DATAPREP_FILE,
  DATAPREP_MICROSERVICE_FILE,
  MIRROR_FILE
} = require('../validators/validate-contextual-mirror');

const ROOT = path.resolve(__dirname, '../../..');

describe('!1205 — the Node mirror and dataprep agree on the budget constants', () => {
  let result;

  beforeAll(() => {
    result = validateContextualMirror(ROOT);
  });

  test('the mirror and dataprep do not drift', () => {
    expect(result.errors).toEqual([]);
  });

  test('the pin actually checked something (a vacuous pass would be a lie)', () => {
    expect(result.checked.length).toBeGreaterThanOrEqual(7);
    expect(result.checked).toContain('CHARS_PER_TOKEN');
    expect(result.checked).toContain('the per-extension chunk-size map');
    expect(result.checked).toContain('the fail-closed guess is not mirrored');
  });

  describe('the check on a fixture', () => {
    let root;

    const DATAPREP = [
      'CHARS_PER_TOKEN = 4',
      'LABEL_LLM_BATCH_SIZE = max(1, int(os.getenv("DATAPREP_LLM_LABEL_BATCH_SIZE", "4")))',
      'DATAPREP_CONTEXTUAL_MAX_TOKENS = _env_int("DATAPREP_CONTEXTUAL_MAX_TOKENS", 512)',
      'DOC_CONTEXT_HEADER = "Document content (may be truncated):\\n"',
      'DOC_CONTEXT_TRUNCATION_MARKER = "...[truncated]"',
      '_CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT = """',
      'a prompt',
      '"""',
      ''
    ].join('\n');

    const MICROSERVICE = [
      'def get_chunk_size_for_file(filename: str) -> int:',
      '    global_default = int(os.getenv("DATAPREP_CHUNK_SIZE", 500))',
      '    config_map = {',
      '        ".pdf": int(os.getenv("DATAPREP_CHUNK_SIZE_PDF", global_default)),',
      '        ".md": int(os.getenv("DATAPREP_CHUNK_SIZE_MD", global_default)),',
      '    }',
      ''
    ].join('\n');

    const MIRROR = [
      'const CHARS_PER_TOKEN = 4;',
      'const CONTEXTUAL_MAX_TOKENS_DEFAULT = 512;',
      'const LABEL_LLM_BATCH_SIZE_DEFAULT = 4;',
      'const CHUNK_SIZE_DEFAULT = 500;',
      "const CHUNK_SIZE_EXTENSIONS = [['.pdf', 'DATAPREP_CHUNK_SIZE_PDF'], ['.md', 'DATAPREP_CHUNK_SIZE_MD']];",
      "const DOC_CONTEXT_HEADER = 'Document content (may be truncated):\\n';",
      "const DOC_CONTEXT_TRUNCATION_MARKER = '...[truncated]';",
      'const CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS = 10;',
      ''
    ].join('\n');

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'contextual-mirror-'));
      writeFixture(DATAPREP_FILE, DATAPREP);
      writeFixture(DATAPREP_MICROSERVICE_FILE, MICROSERVICE);
      writeFixture(MIRROR_FILE, MIRROR);
    });

    afterEach(() => {
      // The host AV can hold a just-written temp file (EBUSY/EPERM); a
      // failed cleanup must not fail the suite — the directory is in TEMP.
      try {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        /* best effort */
      }
    });

    function writeFixture(relativePath, content) {
      return writeInto(root, relativePath, content);
    }

    function writeInto(base, relativePath, content) {
      const target = path.join(base, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      return target;
    }

    function checkFixture() {
      return validateContextualMirror(root);
    }

    test('the aligned fixture reports nothing', () => {
      expect(checkFixture().errors).toEqual([]);
    });

    test('a drifted CHARS_PER_TOKEN is reported', () => {
      writeFixture(MIRROR_FILE, MIRROR.replace('const CHARS_PER_TOKEN = 4;', 'const CHARS_PER_TOKEN = 3;'));
      const errors = checkFixture().errors;
      expect(errors.join('\n')).toMatch(/CHARS_PER_TOKEN/);
      expect(errors.join('\n')).toMatch(/drift/);
    });

    test('a drifted prompt length is reported', () => {
      writeFixture(
        MIRROR_FILE,
        MIRROR.replace(
          'CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS = 10',
          'CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS = 11'
        )
      );
      expect(checkFixture().errors.join('\n')).toMatch(/prompt default length/);
    });

    test('a drifted header literal is reported', () => {
      writeFixture(MIRROR_FILE, MIRROR.replace("'Document content (may be truncated):\\n'", "'Document content:\\n'"));
      expect(checkFixture().errors.join('\n')).toMatch(/DOC_CONTEXT_HEADER/);
    });

    test('an extension dataprep resolves but the mirror does not know is reported', () => {
      writeFixture(
        MIRROR_FILE,
        MIRROR.replace(
          "const CHUNK_SIZE_EXTENSIONS = [['.pdf', 'DATAPREP_CHUNK_SIZE_PDF'], ['.md', 'DATAPREP_CHUNK_SIZE_MD']];",
          "const CHUNK_SIZE_EXTENSIONS = [['.pdf', 'DATAPREP_CHUNK_SIZE_PDF']];"
        )
      );
      expect(checkFixture().errors.join('\n')).toMatch(/per-extension chunk-size map/);
    });

    test('a wrong env var name for an extension is reported', () => {
      writeFixture(
        MIRROR_FILE,
        MIRROR.replace("['.md', 'DATAPREP_CHUNK_SIZE_MD']", "['.md', 'DATAPREP_CHUNK_SIZE_MARKDOWN']")
      );
      expect(checkFixture().errors.join('\n')).toMatch(/chunk-size env var for \.md/);
    });

    test('a mirrored fail-closed guess is reported (a write ceiling must not guess)', () => {
      writeFixture(MIRROR_FILE, `${MIRROR}const DERIVE_FALLBACK_WINDOW = 2048;\n`);
      expect(checkFixture().errors.join('\n')).toMatch(/DERIVE_FALLBACK_WINDOW/);
    });

    test('a missing dataprep file is reported (the pin cannot pass vacuously)', () => {
      // A SEPARATE tree: deleting a just-written file can be refused by the
      // host AV (EPERM), and a tree that never had the file is the same case
      // without the race.
      const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'contextual-mirror-partial-'));
      try {
        writeInto(partial, DATAPREP_MICROSERVICE_FILE, MICROSERVICE);
        writeInto(partial, MIRROR_FILE, MIRROR);
        expect(validateContextualMirror(partial).errors.join('\n')).toMatch(/missing/);
      } finally {
        try {
          fs.rmSync(partial, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch {
          /* best effort */
        }
      }
    });
  });
});
