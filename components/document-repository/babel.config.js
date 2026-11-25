// Jest-only Babel config.
//
// parse5 8.x — the fix for CVE-2026-133245, an uncaught exception on two
// consecutive low surrogates — is ESM-only: it ships `"type": "module"` and a
// single `./dist/index.js` export with no CommonJS build. The RUNTIME needs
// nothing (Node >= 22.12 loads an ESM module from `require()` natively), but
// Jest's CommonJS loader refuses to `require()` an ESM file below Node 24.9,
// so `require('cheerio')` — which requires parse5 — dies with ERR_REQUIRE_ESM.
//
// The two plugins are the minimum that compiles parse5 and its ESM-only
// `entities` dependency to CommonJS: the first rewrites import/export, the
// second handles parse5's `export * as <namespace>` re-exports, which the
// first plugin alone rejects.
//
// Scoped to those two packages by an `overrides` entry, so no file of this
// component is transformed by it. jest.config.js's transformIgnorePatterns is
// what lets the transform reach them at all.
module.exports = {
  overrides: [
    {
      test: /node_modules[\\/](parse5|entities)[\\/]/,
      sourceType: 'unambiguous',
      plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-export-namespace-from'],
    },
  ],
};
