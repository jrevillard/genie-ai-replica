'use strict';

// Regression guard for swagger-jsdoc parse warnings in routes/*.js.
//
// The backend exposes /api-docs.json built by swagger-jsdoc over the
// JSDoc blocks of ./routes/*.js. The production call site in
// index.js wraps the build in a try/catch — but swagger-jsdoc 3.x
// does NOT throw on YAMLSemanticError; it logs the error and returns
// a still-populated spec. Without this test the warnings would only
// surface in container logs (silently degraded UI, no admin signal).
//
// We intercept console.error to capture the warnings, mirroring what
// the backend logger.error would have received.

const path = require('path');

const swaggerJsdoc = require('swagger-jsdoc');

const REPO_ROUTES_DIR = path.resolve(__dirname, '../routes');

function captureSwaggerWarnings(build) {
  const warnings = [];
  const originalError = console.error;
  console.error = (...args) => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
  let spec;
  try {
    spec = build();
  } finally {
    console.error = originalError;
  }
  return { spec, warnings };
}

describe('Route swagger YAML regression', () => {
  it('swagger-jsdoc parses every routes/*.js annotation without warnings', () => {
    const { spec, warnings } = captureSwaggerWarnings(() =>
      swaggerJsdoc({
        definition: {
          openapi: '3.0.0',
          info: { title: 'regression', version: '0.0.0' }
        },
        apis: [path.join(REPO_ROUTES_DIR, '*.js')]
      })
    );

    const yamlWarnings = warnings.filter((w) => /YAMLSem|Implicit map|Nested mapping/i.test(w));
    if (yamlWarnings.length) {
      throw new Error(
        `swagger-jsdoc reported ${yamlWarnings.length} YAML warning(s):\n${yamlWarnings.join('\n---\n')}`
      );
    }

    const paths = spec && spec.paths ? Object.keys(spec.paths) : [];
    expect(paths.length).toBeGreaterThan(20);
  });
});
