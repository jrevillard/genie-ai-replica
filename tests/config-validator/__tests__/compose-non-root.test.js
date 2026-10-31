// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Contract test for issue #1227: no long-term root process, no root-written
// files on host binds. Validates the COMMITTED docker-compose.yaml — a red
// here means a service lost its `user:` or a data bind grew a silent
// root-owned creation path.

'use strict';

const fs = require('fs');
const path = require('path');
const {
  validateComposeNonRoot,
  collectServiceNames,
  SELF_DROPPING,
  ONE_SHOT_ROOT_INIT
} = require('../validators/validate-compose-non-root');

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
    // file: strip CHOWN from the x-chown-init anchor (the five merged
    // inits inherit their caps from it), then flip the one-shot restart
    // policy — each mutation must surface as a violation.
    const noChown = composeText.replaceAll('  cap_add:\n    - CHOWN\n', '');
    expect(noChown).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(noChown);
    expect(v1.some((v) => v.includes('arango-vector-db-init') && v.includes('CHOWN'))).toBe(true);

    // EACH key alone must trip the gate: compose reads `restart:` while
    // swarm reads deploy.restart_policy — flipping one must not hide behind
    // the other.
    const swarmFlip = composeText.replaceAll('condition: "none"', 'condition: always');
    expect(swarmFlip).not.toBe(composeText);
    const { violations: vSwarm } = validateComposeNonRoot(swarmFlip);
    expect(vSwarm.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);

    const composeFlip = composeText.replaceAll('restart: "no"', 'restart: always');
    expect(composeFlip).not.toBe(composeText);
    const { violations: vCompose } = validateComposeNonRoot(composeFlip);
    expect(vCompose.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);
  });

  test('mutation: on-failure without max_attempts trips the gate', () => {
    // The anchor carries restart_policy.condition "none" and NO max_attempts:
    // flipping the condition to on-failure makes every anchor-merged init an
    // UNBOUNDED restart loop of a failing root container (swarm restarts
    // forever without a bound). Each must trip by name — arango-vector-db-init
    // asserted as the canary.
    const unbounded = composeText.replaceAll('condition: "none"', 'condition: on-failure');
    expect(unbounded).not.toBe(composeText);
    const { violations } = validateComposeNonRoot(unbounded);
    expect(
      violations.some((v) => v.includes('arango-vector-db-init') && v.includes('on-failure without max_attempts'))
    ).toBe(true);

    // Negative control: an EXPLICIT bound satisfies the rule — the gate
    // reads the max_attempts key, not just the condition.
    const bounded = [
      'services:',
      '  arango-vector-db-init:',
      '    <<: *chown-init',
      '    deploy:',
      '      restart_policy:',
      '        condition: on-failure',
      '        max_attempts: 5',
      ''
    ].join('\n');
    const { violations: vBounded } = validateComposeNonRoot(bounded);
    expect(
      vBounded.filter((v) => v.includes('arango-vector-db-init') && v.includes('on-failure without max_attempts'))
    ).toEqual([]);
  });

  test('data-dir detection survives variable spellings (renaming cannot defeat the gate)', () => {
    // The resolver must see through every spelling a source can carry:
    // the shipped default form, a renamed variable with default, a bare
    // variable (unknown location — resolved CONSERVATIVELY to the data
    // dir), and quoted sources. Each must land under the data-dir rule.
    const cases = [
      '${DATA_DIR:-./data}/logs/kong',
      '${MOUNT_DIR:-./data}/logs/kong',
      '${DATA_DIR}/logs/kong',
      '"${DATA_DIR:-./data}/logs/kong"'
    ];
    for (const src of cases) {
      const text = [
        'services:',
        '  kong:',
        '    user: "1001:1001"',
        '    volumes:',
        `      - ${src}:/var/log/kong`,
        ''
      ].join('\n');
      const { violations } = validateComposeNonRoot(text);
      expect(violations.some((v) => v.includes('kong') && v.includes('short syntax'))).toBe(true);
    }
  });

  test('mutation: a create_host_path:false without its bind: key opts nothing out', () => {
    // The opt-out attaches to the bind entry its `bind:` key opens — a
    // stray create_host_path line with no bind: block must NOT silence the
    // last-pushed source.
    const withBind = [
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
    expect(validateComposeNonRoot(withBind).violations).toEqual([]);

    const stray = withBind.replace('        bind:\n', '');
    expect(stray).not.toBe(withBind);
    const { violations } = validateComposeNonRoot(stray);
    expect(violations.some((v) => v.includes('backend') && v.includes('create_host_path: false'))).toBe(true);
  });

  test('a commented long-syntax source is still enforced', () => {
    // A trailing YAML comment is a legal spelling (the user: regex already
    // tolerates it) — the source: match must not silently drop the bind
    // out of enforcement.
    const text = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - type: bind',
      '        source: ${DATA_DIR:-./data}/logs/kong # kong logs',
      '        target: /var/log/kong',
      ''
    ].join('\n');
    const { violations } = validateComposeNonRoot(text);
    expect(violations.some((v) => v.includes('kong') && v.includes('create_host_path: false'))).toBe(true);
  });

  test('bind: opts written BEFORE their source: still attach to the right entry', () => {
    // YAML mapping order is free: the reversed spelling (bind: block first,
    // source: after) must attach the opt-out to ITS OWN entry, not the
    // previous one — and the previous entry must stay unopted-out.
    const text = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ./data/database_backups',
      '        target: /app/database_backups',
      '      - type: bind',
      '        bind:',
      '          create_host_path: false',
      '        source: ./data/other',
      '        target: /app/other',
      ''
    ].join('\n');
    const { violations } = validateComposeNonRoot(text);
    expect(violations).toEqual([
      'backend: host bind "./data/database_backups" sits under the data directory without ' +
        '`create_host_path: false` — docker creates a missing source as root-owned'
    ]);
  });

  test('allowlist entries reference services that exist in the compose file', () => {
    // A renamed or removed service would leave a stale allowlist entry that
    // enforces nothing — dead enforcement data. Uses the validator's OWN
    // collector: a private re-scan would drift silently when the validator
    // extends its notion of a service name.
    const serviceNames = collectServiceNames(composeText);
    for (const name of [...Object.keys(SELF_DROPPING), ...Object.keys(ONE_SHOT_ROOT_INIT)]) {
      expect(serviceNames.has(name)).toBe(true);
    }
  });

  test('self-dropping allowlist documents its two members with a reason', () => {
    expect(Object.keys(SELF_DROPPING).sort()).toEqual(['postgres', 'redis-cache']);
    for (const reason of Object.values(SELF_DROPPING)) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
