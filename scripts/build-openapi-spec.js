'use strict';

/**
 * Extracts the OpenAPI spec from the backend sources into a JSON file.
 *
 * Consumed by scripts/generate-api-client.sh: the generation envelope pins
 * API_URL/KEYCLOAK_URL/KEYCLOAK_REALM under env -i (the determinism
 * mechanism that keeps the committed Dart artifacts byte-identical across
 * regenerations) and invokes this module with the spec output path as argv.
 * The pinned placeholder values land in the committed artifacts' cosmetics
 * (ApiClient's basePath default, README server/OAuth URLs); the endpoint
 * paths are env-independent, and the app overrides basePath at runtime.
 *
 * The swagger tooling resolves through the backend package (swagger-jsdoc is
 * a backend production dependency; the CI drift gate installs it at the
 * repository root, which the same resolution reaches by walking up), so the
 * module works from any working directory and with either install shape.
 * POSIX only (Linux/macOS), like the generation shell script — the env -i
 * envelope cannot run on Windows, and the module is untested there.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const BACKEND_DIR = path.resolve(__dirname, '..', 'components', 'gov-chat-backend');

function buildSpec() {
  const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const swaggerJsdoc = backendRequire('swagger-jsdoc');
  const spec = swaggerJsdoc({
    definition: backendRequire('./swagger-definition'),
    apis: [path.join(BACKEND_DIR, 'routes', '*.js')]
  });
  // Sanity checks: a broken apis glob yields a spec with zero paths, and a
  // pin assignment dropped from the env -i line shows up as an 'undefined'
  // interpolation. The envelope's URL construction is asserted by the
  // backend suite, not re-encoded here.
  assert.ok(
    Object.keys(spec.paths ?? {}).length > 0,
    'the generated spec has no paths — the apis glob matched nothing.'
  );
  assert.ok(
    (spec.servers ?? []).some((s) => s?.url === process.env.API_URL),
    'no server entry carries the API_URL pin value — either a pin assignment' +
      ' is missing from the env -i line in scripts/generate-api-client.sh, or' +
      ' swagger-definition.js no longer serves the pin verbatim (it normalizes' +
      ' or rejects non-absolute http(s) values, or changed how it builds the' +
      ' servers list).'
  );
  const flow = spec.components?.securitySchemes?.KeycloakOAuth2?.flows?.authorizationCode;
  for (const [label, url] of [
    ['authorizationUrl', flow?.authorizationUrl],
    ['tokenUrl', flow?.tokenUrl]
  ]) {
    assert.ok(
      typeof url === 'string' && !url.includes('undefined'),
      label +
        ' is not a concrete URL — the KEYCLOAK_URL/KEYCLOAK_REALM pins' +
        ' are missing from the env -i line in scripts/generate-api-client.sh.'
    );
  }
  return spec;
}

module.exports = { buildSpec };

if (require.main === module) {
  const output = process.argv[2];
  if (!output) {
    console.error(
      'usage: API_URL=<url> KEYCLOAK_URL=<url> KEYCLOAK_REALM=<realm> \\\n' +
        '  node scripts/build-openapi-spec.js <spec-output-path>\n' +
        '(the three pins are required; see the env -i envelope in' +
        ' scripts/generate-api-client.sh; POSIX only, like the generation' +
        ' script)'
    );
    process.exit(1);
  }
  const spec = buildSpec();
  fs.writeFileSync(output, JSON.stringify(spec, null, 2));
  console.log('Generated ' + Object.keys(spec.paths).length + ' endpoints');
}
