// Every runtime config must satisfy the schema it declares.
//
// The config file is both the instance and its own schema: the loader in
// src/config-loader.js validates the document against the schema the same
// document carries, and refuses to boot the app when they disagree. Nothing
// in the pipeline checked that agreement before the app met it — the
// consistency of a config file was discovered by the browser of whoever
// deployed it, as a white page.
//
// A config whose data no longer matches its schema is exactly how that
// happened in production: the file carried the schema of one shape and the
// data of another, the loader rejected it, and the deploy reported success.
// This test makes that disagreement fail the build instead.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'public', 'config');

const files = fs
  .readdirSync(CONFIG_DIR)
  .filter((name) => /^genie-ai-config.*\.json$/.test(name))
  .sort();

describe('runtime config self-validation', () => {
  it('discovers every runtime config on disk', () => {
    // The test is only worth anything if it walks all of them — a config
    // added later must be validated too.
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files)('%s satisfies the schema it declares', (name) => {
    const doc = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));

    let validate;
    expect(() => {
      validate = new Ajv({ allErrors: true, strict: false }).compile(doc);
    }).not.toThrow();

    const valid = validate(doc);
    const details = (validate.errors || [])
      .map((issue) => `  ${issue.instancePath || '<root>'} ${issue.message}`)
      .join('\n');

    // The error list is the message: an empty one is the pass, and a
    // non-empty one names every path the loader would reject at boot.
    expect(details).toBe('');
    expect(valid).toBe(true);
  });
});
