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
const path = require('path');
const { withTree } = require('../validators/temp-tree');
const {
  validateContextualMirror,
  DATAPREP_FILE,
  DATAPREP_MICROSERVICE_FILE,
  MIRROR_FILE,
  COMPOSE_FILE,
  VLLM_CACHE_FILE,
  MODEL_CACHE_FILE,
  COMPOSE_MIRROR_KNOBS
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
    // The REAL repo carries compose and the python cache twin, so the
    // compose-agreement and sanity-ceiling legs must have RUN here —
    // a fixture-only pass would leave those two pins unproven.
    expect(result.checked).toContain('compose default DATAPREP_LLM_LABEL_BATCH_SIZE');
    expect(result.checked.some((c) => c.startsWith('MAX_SANE_MODEL_WINDOW_TOKENS'))).toBe(true);
  });

  describe('the check on a fixture', () => {
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
      'const CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS = 8;',
      'const MAX_SANE_MODEL_WINDOW_TOKENS = 10000000;',
      ''
    ].join('\n');

    /** The three code files the base pin reads. */
    const CODE_FILES = {
      [DATAPREP_FILE]: DATAPREP,
      [DATAPREP_MICROSERVICE_FILE]: MICROSERVICE,
      [MIRROR_FILE]: MIRROR
    };

    function check(root) {
      return validateContextualMirror(root);
    }

    test('the aligned fixture reports nothing', () => {
      withTree('contextual-mirror-', CODE_FILES, (root) => {
        expect(check(root).errors).toEqual([]);
      });
    });

    test('a drifted CHARS_PER_TOKEN is reported', () => {
      const mirror = MIRROR.replace('const CHARS_PER_TOKEN = 4;', 'const CHARS_PER_TOKEN = 3;');
      withTree('contextual-mirror-', { ...CODE_FILES, [MIRROR_FILE]: mirror }, (root) => {
        const errors = check(root).errors;
        expect(errors.join('\n')).toMatch(/CHARS_PER_TOKEN/);
        expect(errors.join('\n')).toMatch(/drift/);
      });
    });

    test('a drifted prompt length is reported', () => {
      const mirror = MIRROR.replace(
        'CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS = 8',
        'CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS = 9'
      );
      withTree('contextual-mirror-', { ...CODE_FILES, [MIRROR_FILE]: mirror }, (root) => {
        expect(check(root).errors.join('\n')).toMatch(/prompt default length/);
      });
    });

    test('a drifted header literal is reported', () => {
      const mirror = MIRROR.replace("'Document content (may be truncated):\\n'", "'Document content:\\n'");
      withTree('contextual-mirror-', { ...CODE_FILES, [MIRROR_FILE]: mirror }, (root) => {
        expect(check(root).errors.join('\n')).toMatch(/DOC_CONTEXT_HEADER/);
      });
    });

    test('an extension dataprep resolves but the mirror does not know is reported', () => {
      const mirror = MIRROR.replace(
        "const CHUNK_SIZE_EXTENSIONS = [['.pdf', 'DATAPREP_CHUNK_SIZE_PDF'], ['.md', 'DATAPREP_CHUNK_SIZE_MD']];",
        "const CHUNK_SIZE_EXTENSIONS = [['.pdf', 'DATAPREP_CHUNK_SIZE_PDF']];"
      );
      withTree('contextual-mirror-', { ...CODE_FILES, [MIRROR_FILE]: mirror }, (root) => {
        expect(check(root).errors.join('\n')).toMatch(/per-extension chunk-size map/);
      });
    });

    test('a wrong env var name for an extension is reported', () => {
      const mirror = MIRROR.replace("['.md', 'DATAPREP_CHUNK_SIZE_MD']", "['.md', 'DATAPREP_CHUNK_SIZE_MARKDOWN']");
      withTree('contextual-mirror-', { ...CODE_FILES, [MIRROR_FILE]: mirror }, (root) => {
        expect(check(root).errors.join('\n')).toMatch(/chunk-size env var for \.md/);
      });
    });

    test('a mirrored fail-closed guess is reported (a write ceiling must not guess)', () => {
      const mirror = `${MIRROR}const DERIVE_FALLBACK_WINDOW = 2048;\n`;
      withTree('contextual-mirror-', { ...CODE_FILES, [MIRROR_FILE]: mirror }, (root) => {
        expect(check(root).errors.join('\n')).toMatch(/DERIVE_FALLBACK_WINDOW/);
      });
    });

    test('a missing dataprep file is reported (the pin cannot pass vacuously)', () => {
      // A SEPARATE tree without the file: the same case as a deleted file,
      // without the delete race.
      const { [DATAPREP_FILE]: dropped, ...partialFiles } = CODE_FILES;
      withTree('contextual-mirror-partial-', partialFiles, (root) => {
        expect(check(root).errors.join('\n')).toMatch(/missing/);
      });
    });

    describe('the compose + sanity-ceiling legs (a tree that carries them)', () => {
      // BOTH blocks state ALL the knobs — the real compose does, and the
      // pin reports a knob either block stops carrying.
      const KNOBS = [
        ['DATAPREP_LLM_LABEL_BATCH_SIZE', '4'],
        ['DATAPREP_CONTEXTUAL_MAX_TOKENS', '512'],
        ['DATAPREP_CHUNK_SIZE', '500'],
        ['DATAPREP_CHUNK_SIZE_PDF', '500'],
        ['DATAPREP_CHUNK_SIZE_DOCX', '1000'],
        ['DATAPREP_CHUNK_SIZE_XLSX', '1500'],
        ['DATAPREP_CHUNK_SIZE_PPTX', '500'],
        ['DATAPREP_CHUNK_SIZE_HTML', '500'],
        ['DATAPREP_CHUNK_SIZE_TXT', '500'],
        ['DATAPREP_CHUNK_SIZE_MD', '500'],
        ['CONTEXTUAL_RETRIEVAL_PROMPT', '']
      ];
      const COMPOSE = [
        'services:',
        '  okf-server:',
        '    environment:',
        ...KNOBS.map(([name, def]) => `      - ${name}=\${${name}:-${def}}`),
        '  dataprep-arango-service:',
        '    environment:',
        ...KNOBS.map(([name, def]) => `      ${name}: \${${name}:-${def}}`),
        '  retriever-arango-service:',
        '    environment:',
        '      FOO: bar',
        ''
      ].join('\n');

      const MODEL_CACHE = ['MAX_SANE_MODEL_WINDOW_TOKENS = 10_000_000', ''].join('\n');
      // The Node side of the sanity pin: vllm-model-cache.js owns the window
      // rule, so the fixture tree must carry its constant too.
      const VLLM_CACHE = ['const MAX_SANE_MODEL_WINDOW_TOKENS = 10000000;', ''].join('\n');

      test('aligned compose defaults and sanity ceiling report nothing', () => {
        withTree(
          'contextual-mirror-compose-',
          { ...CODE_FILES, [COMPOSE_FILE]: COMPOSE, [MODEL_CACHE_FILE]: MODEL_CACHE, [VLLM_CACHE_FILE]: VLLM_CACHE },
          (root) => {
            const result = check(root);
            expect(result.errors).toEqual([]);
            expect(result.checked).toContain('compose default DATAPREP_LLM_LABEL_BATCH_SIZE');
            expect(result.checked.some((c) => c.startsWith('MAX_SANE_MODEL_WINDOW_TOKENS'))).toBe(true);
          }
        );
      });

      test('a compose default that disagrees between the two blocks is reported', () => {
        const compose = COMPOSE.replace(
          '      DATAPREP_LLM_LABEL_BATCH_SIZE: ${DATAPREP_LLM_LABEL_BATCH_SIZE:-4}',
          '      DATAPREP_LLM_LABEL_BATCH_SIZE: ${DATAPREP_LLM_LABEL_BATCH_SIZE:-8}'
        );
        withTree(
          'contextual-mirror-compose-',
          { ...CODE_FILES, [COMPOSE_FILE]: compose, [MODEL_CACHE_FILE]: MODEL_CACHE, [VLLM_CACHE_FILE]: VLLM_CACHE },
          (root) => {
            expect(check(root).errors.join('\n')).toMatch(/compose default DATAPREP_LLM_LABEL_BATCH_SIZE/);
          }
        );
      });

      test('a knob one compose block stops stating is reported', () => {
        const compose = COMPOSE.replace(
          '      - DATAPREP_LLM_LABEL_BATCH_SIZE=${DATAPREP_LLM_LABEL_BATCH_SIZE:-4}\n',
          ''
        );
        withTree(
          'contextual-mirror-compose-',
          { ...CODE_FILES, [COMPOSE_FILE]: compose, [MODEL_CACHE_FILE]: MODEL_CACHE, [VLLM_CACHE_FILE]: VLLM_CACHE },
          (root) => {
            expect(check(root).errors.join('\n')).toMatch(/compose default DATAPREP_LLM_LABEL_BATCH_SIZE/);
          }
        );
      });

      test('a drifted sanity ceiling is reported', () => {
        const cache = MODEL_CACHE.replace('10_000_000', '20000000');
        withTree(
          'contextual-mirror-compose-',
          { ...CODE_FILES, [COMPOSE_FILE]: COMPOSE, [MODEL_CACHE_FILE]: cache, [VLLM_CACHE_FILE]: VLLM_CACHE },
          (root) => {
            expect(check(root).errors.join('\n')).toMatch(/MAX_SANE_MODEL_WINDOW_TOKENS/);
          }
        );
      });

      test('every mirror knob is covered by the compose pin (a new knob cannot dodge it)', () => {
        expect(COMPOSE_MIRROR_KNOBS).toContain('DATAPREP_CHUNK_SIZE_MD');
        expect(COMPOSE_MIRROR_KNOBS).toContain('CONTEXTUAL_RETRIEVAL_PROMPT');
        expect(COMPOSE_MIRROR_KNOBS.length).toBe(11);
      });
    });
  });
});
