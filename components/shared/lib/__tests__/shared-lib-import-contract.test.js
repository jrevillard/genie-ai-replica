'use strict';

// The two import paths into `shared/lib` do not expose the same shape:
//
//   require('<component>/shared-lib')            -> { tracingBaggage: {…} }
//   require('<component>/shared-lib/tracing-baggage') -> { createGeniePropagator, withBaggage }
//
// Reaching for a barrel key on the deep path binds `undefined`, and the call
// throws at whatever point it is first reached — which for `tracing.js` meant
// the process exited at startup. A source-text assertion could not catch it:
// the call site held the right text while the value it was called on was
// undefined, and the branch it lives in never runs under `NODE_ENV=test`.
//
// This checks the binding against what the module really exports, for every
// deep import in shipped code, resolved from disk rather than from a hardcoded
// table — so a module nobody listed cannot silently pass as "not checked".

const fs = require('fs');
const path = require('path');

const COMPONENTS = path.resolve(__dirname, '..', '..', '..');
const SHARED_LIB = path.join(COMPONENTS, 'shared', 'lib');
const SCANNED = ['gov-chat-backend', 'document-repository'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'coverage', 'reports', 'dist', '.git']);

// `const { a, b: c } = require('…/shared-lib/<mod>')` — `[^{}]*` keeps the
// match inside one object literal instead of running past a stray brace.
const DESTRUCTURED = /const\s*\{([^{}]*)\}\s*=\s*require\(['"][^'"]*shared-lib\/([\w-]+)['"]\)/g;
// `const mod = require('…/shared-lib/<mod>')` — the destructure form starts
// with `{`, so this cannot match it.
const WHOLE_MODULE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"][^'"]*shared-lib\/([\w-]+)['"]\)/g;

function shippedJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...shippedJsFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.js')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function resolveModule(moduleName) {
  // A shared helper is either a single file or a directory with an index
  // (`melt` is the latter), matching what Node resolves for a bare specifier.
  const candidates = [path.join(SHARED_LIB, `${moduleName}.js`), path.join(SHARED_LIB, moduleName)];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function loadModule(file, moduleName) {
  const resolved = resolveModule(moduleName);
  expect(resolved).toBeDefined();
  return require(resolved);
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

const files = SCANNED.flatMap((c) => shippedJsFiles(path.join(COMPONENTS, c)));

describe('deep shared-lib imports bind to real exports', () => {
  it('finds the shipped components it is meant to scan', () => {
    // A silently empty scan would pass every other test in this file.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(path.join('gov-chat-backend', 'tracing.js')))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join('document-repository', 'src', 'tracing.js')))).toBe(true);
  });

  it.each(files)('%s', (file) => {
    const source = fs.readFileSync(file, 'utf8');

    for (const match of source.matchAll(DESTRUCTURED)) {
      const [, rawNames, moduleName] = match;
      const exported = loadModule(file, moduleName);
      const names = rawNames
        .split(',')
        .map((n) => n.trim().split(':')[0].trim())
        .filter(Boolean);

      for (const name of names) {
        expect({
          file: path.relative(COMPONENTS, file),
          line: lineOf(source, match.index),
          member: `${moduleName}.${name}`,
          exported: Object.hasOwn(exported, name)
        }).toEqual({
          file: path.relative(COMPONENTS, file),
          line: lineOf(source, match.index),
          member: `${moduleName}.${name}`,
          exported: true
        });
      }
    }

    for (const match of source.matchAll(WHOLE_MODULE)) {
      const [, binding, moduleName] = match;
      const exported = loadModule(file, moduleName);

      // Every `binding.member` use in the file is a claim about the module's
      // shape, and a misspelled one is undefined until it is called.
      for (const use of source.matchAll(new RegExp(`\\b${binding}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
        expect({
          file: path.relative(COMPONENTS, file),
          line: lineOf(source, use.index),
          member: `${moduleName}.${use[1]}`,
          exported: Object.hasOwn(exported, use[1])
        }).toEqual({
          file: path.relative(COMPONENTS, file),
          line: lineOf(source, use.index),
          member: `${moduleName}.${use[1]}`,
          exported: true
        });
      }
    }
  });
});
