// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Contract test for issue #1227: no long-term root process, no root-written
// files on host binds. Validates the COMMITTED docker-compose.yaml — a red
// here means a service lost its `user:` or a data bind grew a silent
// root-owned creation path.

'use strict';

const fs = require('fs');
const path = require('path');
const { validateComposeNonRoot, SELF_DROPPING } = require('../validators/validate-compose-non-root');

const COMPOSE_PATH = path.join(__dirname, '..', '..', '..', 'docker-compose.yaml');

describe('compose non-root contract (#1227)', () => {
  let composeText;
  let real;

  beforeAll(() => {
    composeText = fs.readFileSync(COMPOSE_PATH, 'utf-8');
    // One parse of the pristine file shared by the pristine-file tests.
    real = validateComposeNonRoot(composeText);
  });

  test('every always-on service pins a non-root user (or is a documented self-dropping image)', () => {
    expect(real.violations).toEqual([]);
  });

  test('the always-on set actually covers the services the contract measured as root', () => {
    // Guards the contract itself against silent scope loss: if one of these
    // services disappears from the always-on set (renamed, profile-gated,
    // removed), the contract must be revisited, not silently narrowed.
    for (const svc of ['nginx', 'frontend', 'kong', 'document-repository', 'arango-vector-db', 'clamav', 'backend']) {
      expect(real.alwaysOn).toContain(svc);
    }
  });

  test('no pinned user is root', () => {
    const { violations } = validateComposeNonRoot('services:\n  backend:\n    user: "0:0"\n');
    expect(violations.some((v) => v.includes('backend') && v.includes('is root'))).toBe(true);
  });

  test('a data bind WITH create_host_path: false is accepted', () => {
    // Negative control for the mutation test below: the accepted form must
    // produce zero violations, so the gate cannot pass for a looser reason.
    const text = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ./data/database_backups',
      '        target: /app/database_backups',
      '        bind:',
      '          create_host_path: false',
      ''
    ].join('\n');
    const { violations } = validateComposeNonRoot(text);
    expect(violations).toEqual([]);
  });

  test('profile-gated services are out of scope', () => {
    const text = ['services:', '  vllm:', '    profiles: ["gpu-models"]', ''].join('\n');
    const { violations, alwaysOn } = validateComposeNonRoot(text);
    expect(violations).toEqual([]);
    expect(alwaysOn).toEqual([]);
  });

  test('mutation: flipping the real file create_host_path to true trips the gate', () => {
    // The gate exists for the REAL file's ${DATA_DIR:-./data} form — proving
    // it on a synthetic literal path proves nothing. Mutate the actual
    // committed content and watch the violation appear.
    const mutated = composeText.replace('create_host_path: false', 'create_host_path: true');
    expect(mutated).not.toBe(composeText);
    const { violations } = validateComposeNonRoot(mutated);
    expect(violations.some((v) => v.includes('backend') && v.includes('create_host_path: false'))).toBe(true);
  });

  test('mutation: a short-syntax data bind trips the gate', () => {
    // The deleted kong logs bind was short syntax — reintroducing that form
    // must be visible to the parser.
    const text = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - "${DATA_DIR:-./data}/logs/kong:/var/log/kong"',
      ''
    ].join('\n');
    const { violations } = validateComposeNonRoot(text);
    expect(violations.some((v) => v.includes('kong') && v.includes('short syntax'))).toBe(true);
  });

  test('one-shot init allowlist members carry cap_add CHOWN and a one-shot policy', () => {
    // Enforces the invariants the ONE_SHOT_ROOT_INIT documentation promises:
    // the chown needs CAP_CHOWN, and a restart-always policy would turn the
    // init into a permanent root container.
    const { violations } = validateComposeNonRoot(composeText);
    expect(violations.filter((v) => v.includes('ONE_SHOT_ROOT_INIT member'))).toEqual([]);
  });

  test('mutation: a one-shot init without CHOWN or with restart-always trips the gate', () => {
    // Enforcement only applies to allowlisted members, so mutate the REAL
    // file: strip CHOWN from the x-chown-init anchor (the three merged
    // inits inherit their caps from it), then flip the one-shot restart
    // policy — each mutation must surface as a violation.
    const noChown = composeText.replaceAll('  cap_add:\n    - CHOWN\n', '');
    expect(noChown).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(noChown);
    expect(v1.some((v) => v.includes('arango-vector-db-init') && v.includes('CHOWN'))).toBe(true);

    // Both one-shot forms must be mutated: restart "no" OR the deploy
    // restart_policy condition each satisfy the invariant on their own.
    const always = composeText
      .replaceAll('condition: "none"', 'condition: always')
      .replaceAll('restart: "no"', 'restart: always');
    expect(always).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(always);
    expect(v2.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);
  });

  test('self-dropping allowlist documents its two members with a reason', () => {
    expect(Object.keys(SELF_DROPPING).sort()).toEqual(['postgres', 'redis-cache']);
    for (const reason of Object.values(SELF_DROPPING)) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
