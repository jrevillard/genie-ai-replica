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

  beforeAll(() => {
    composeText = fs.readFileSync(COMPOSE_PATH, 'utf-8');
  });

  test('every always-on service pins a non-root user (or is a documented self-dropping image)', () => {
    const { violations } = validateComposeNonRoot(composeText);
    expect(violations).toEqual([]);
  });

  test('the always-on set actually covers the services the contract measured as root', () => {
    // Guards the contract itself against silent scope loss: if one of these
    // services disappears from the always-on set (renamed, profile-gated,
    // removed), the contract must be revisited, not silently narrowed.
    const { alwaysOn } = validateComposeNonRoot(composeText);
    for (const svc of ['nginx', 'frontend', 'kong', 'document-repository', 'arango-vector-db', 'clamav', 'backend']) {
      expect(alwaysOn).toContain(svc);
    }
  });

  test('no pinned user is root', () => {
    const { violations } = validateComposeNonRoot('services:\n  backend:\n    user: "0:0"\n');
    expect(violations.some((v) => v.includes('backend') && v.includes('is root'))).toBe(true);
  });

  test('a data bind without create_host_path: false is a violation', () => {
    const text = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ./data/database_backups',
      '        target: /app/database_backups',
      ''
    ].join('\n');
    const { violations } = validateComposeNonRoot(text);
    expect(violations.some((v) => v.includes('create_host_path: false'))).toBe(true);
  });

  test('a data bind WITH create_host_path: false is accepted', () => {
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

  test('self-dropping allowlist documents its two members with a reason', () => {
    expect(Object.keys(SELF_DROPPING).sort()).toEqual(['postgres', 'redis-cache']);
    for (const reason of Object.values(SELF_DROPPING)) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
