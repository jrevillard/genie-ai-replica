#!/usr/bin/env node
/**
 * Validates every runtime config file against the $schema it embeds.
 *
 * Each config file is BOTH the instance and its own schema: it carries
 * `properties` at the top level alongside its own data, and `$schema` is
 * only the draft identifier. Validating therefore means running the file's
 * schema over the file itself.
 *
 * Exit code 0 = every file valid, 1 = at least one file invalid.
 */
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const CONFIG_DIR = path.join(__dirname, '..', 'public', 'config');

const files = fs
  .readdirSync(CONFIG_DIR)
  .filter((name) => /^genie-ai-config.*\.json$/.test(name))
  .sort();

let failed = 0;

for (const name of files) {
  const full = path.join(CONFIG_DIR, name);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    console.error(`${name}: not valid JSON — ${error.message}`);
    failed += 1;
    continue;
  }

  const validate = new Ajv({ allErrors: true, strict: false }).compile(doc);

  if (validate(doc)) {
    console.log(`${name}: OK`);
    continue;
  }

  failed += 1;
  console.error(`${name}: ${validate.errors.length} error(s)`);
  for (const error of validate.errors) {
    console.error(`  ${error.instancePath || '<root>'} ${error.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} config file(s) failed schema validation.`);
  process.exit(1);
}

console.log(`\nAll ${files.length} config files validate.`);
