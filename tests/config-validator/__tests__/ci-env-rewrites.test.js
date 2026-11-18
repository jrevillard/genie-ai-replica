const path = require('path');
const fs = require('fs');

const { findCiEnvRewrites, findDeadEnvRewrites } = require('../validators/check-ci-env-rewrites');

const ROOT = path.resolve(__dirname, '../../..');
const CI_FILE = path.join(ROOT, '.gitlab-ci.yml');
const ENV_TEMPLATE = path.join(ROOT, 'env');

// The gate: a CI rewrite of a .env variable must target a variable the env
// template ASSIGNS. A sed on a name the template does not carry matches
// NOTHING — the rewrite is dead, the .env keeps the template's default,
// and the job runs against the wrong artifact, silently.
//
// The defect it was written for: the image-tag rename moved the stack's
// version from GENIE_AI_GLOBAL_TAG to GENIE_AI_IMAGE_TAG and the E2E job's
// sed kept the old name. The E2E job runs only on a merge train with
// E2E_ENABLED=1, so no merge request pipeline would have caught it.

describe('ci env rewrite gate: the repository', () => {
  test('every literal .env rewrite in the CI targets a variable the env template assigns', () => {
    const dead = findDeadEnvRewrites(CI_FILE, ENV_TEMPLATE);
    const report = dead
      .map((rewrite) => `  .gitlab-ci.yml:${rewrite.line} rewrites ${rewrite.name}, which the env template does not assign`)
      .join('\n');
    expect(dead.map((rewrite) => rewrite.name)).toEqual([]);
    expect(report).toBe('');
  });

  test('the CI does rewrite the stack version — the gate is not vacuous', () => {
    // A gate that finds nothing because it looks at nothing is worse than
    // no gate: it reads as a pass. The E2E job's candidate-tag rewrite is
    // the one the rename broke, so its presence is what makes the empty
    // result above meaningful.
    const rewrites = findCiEnvRewrites(fs.readFileSync(CI_FILE, 'utf-8'));
    expect(rewrites.map((rewrite) => rewrite.name)).toContain('GENIE_AI_IMAGE_TAG');
  });
});

describe('ci env rewrite gate: the extraction', () => {
  const FIXTURE = `
job:
  script:
    - sed -i "s|^GENIE_AI_IMAGE_TAG=.*|GENIE_AI_IMAGE_TAG=mr-1-abc|" .env
    - sed -i "s|^\${var}=.*|\${var}=value|" .env
    - sed -i '/^GENIE_AI_[A-Z0-9_]*_IMAGE=/ s|^|# |' .env
    - sed -i "s|^EMAIL_HOST=.*|EMAIL_HOST=localhost|" .env
    - sed -i "s|^SOMETHING_ELSE=.*|SOMETHING_ELSE=x|" other.txt
`;

  test('reads the literal names only', () => {
    const rewrites = findCiEnvRewrites(FIXTURE);
    expect(rewrites.map((rewrite) => rewrite.name)).toEqual(['GENIE_AI_IMAGE_TAG', 'EMAIL_HOST']);
  });

  test('ignores a rewrite that does not target the .env', () => {
    const rewrites = findCiEnvRewrites(FIXTURE);
    expect(rewrites.map((rewrite) => rewrite.name)).not.toContain('SOMETHING_ELSE');
  });

  test('reports a name the template does not assign', () => {
    const ciPath = path.join(ROOT, 'tests/config-validator/__tests__/fixtures/ci-dead-rewrite.yml');
    const dead = findDeadEnvRewrites(ciPath, ENV_TEMPLATE);
    expect(dead.map((rewrite) => rewrite.name)).toEqual(['GENIE_AI_GLOBAL_TAG']);
  });
});
