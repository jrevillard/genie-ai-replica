'use strict';

// #1074 — one variable, one interpolation form.
//
// The gate lives in validate-interpolation-form.js; this suite pins the
// classifier and asserts the LIVE docker-compose.yaml carries no variable
// that mixes interpolation forms — the asymmetry that made an unset (or
// empty-set) variable reach two services with different values.

const fs = require('fs');
const path = require('path');
const {
  classifyForm,
  collectInterpolations,
  findMixedInterpolationForms
} = require('../validators/validate-interpolation-form');

const ROOT = path.join(__dirname, '..', '..', '..');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.yaml');

describe('classifyForm', () => {
  it.each([
    ['${EMAIL_HOST}', 'bare'],
    ['${EMAIL_PORT:-587}', 'default'],
    ['${EMAIL_SECURE:-}', 'default'],
    ['${VAR-default}', 'default-unset'],
    ['${VAR?required}', 'error'],
    ['${VAR:?required}', 'error'],
    ['${KC_SMTP_AUTH:+true}', 'presence']
  ])('%s → %s', (raw, expected) => {
    expect(classifyForm(raw)).toBe(expected);
  });
});

describe('collectInterpolations', () => {
  it('skips comment-only lines', () => {
    const content = ['# same source spelling as (${DATA_DIR} —', '  FOO: ${FOO:-x}'].join('\n');
    expect(collectInterpolations(content)).toEqual([{ name: 'FOO', form: 'default', line: 2, raw: '${FOO:-x}' }]);
  });

  it('strips trailing inline comments before classifying', () => {
    const content = ['  FOO: ${FOO:-x} # was bare ${FOO} before #1074'].join('\n');
    expect(collectInterpolations(content)).toEqual([{ name: 'FOO', form: 'default', line: 1, raw: '${FOO:-x}' }]);
  });

  it('reports every occurrence with its line number', () => {
    const content = ['a: ${X}', 'b: ${X:-y}'].join('\n');
    const occ = collectInterpolations(content);
    expect(occ.map((o) => [o.name, o.form, o.line])).toEqual([
      ['X', 'bare', 1],
      ['X', 'default', 2]
    ]);
  });
});

describe('findMixedInterpolationForms — the live compose file', () => {
  it('docker-compose.yaml has no variable mixing interpolation forms', () => {
    const content = fs.readFileSync(COMPOSE_FILE, 'utf8');
    const mixed = findMixedInterpolationForms(content);
    expect(mixed).toEqual([]);
  });
});

describe('findMixedInterpolationForms — detection', () => {
  it('flags a variable that is bare in one service and defaulted in another', () => {
    const content = [
      'backend:',
      '  environment:',
      '    - EMAIL_HOST=${EMAIL_HOST}',
      'keycloak:',
      '  environment:',
      '    - KC_SMTP_HOST=${EMAIL_HOST:-}'
    ].join('\n');
    const mixed = findMixedInterpolationForms(content);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].name).toBe('EMAIL_HOST');
    expect(mixed[0].message).toContain('EMAIL_HOST');
    expect(mixed[0].message).toContain('line 3');
    expect(mixed[0].message).toContain('line 6');
  });

  it('flags a `-` vs `:-` mix — the two defaults disagree on empty-set', () => {
    const content = ['a: ${OKF_SCOPE_MODE-open}', 'b: ${OKF_SCOPE_MODE:-open}'].join('\n');
    const mixed = findMixedInterpolationForms(content);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].name).toBe('OKF_SCOPE_MODE');
  });

  it('does not flag a uniform variable', () => {
    const content = ['a: ${X:-1}', 'b: ${X:-1}', 'c: ${X:+set} # presence form is exempt'].join('\n');
    expect(findMixedInterpolationForms(content)).toEqual([]);
  });
});
