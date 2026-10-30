// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// validate-compose-non-root — enforce the no-root contract (#1227) on
// docker-compose.yaml:
//   1. every always-on service declares a non-root `user:` (uid != 0), so no
//      long-term process runs as root and no entrypoint phase writes
//      root-owned files into host binds;
//   2. every host bind under the data directory either already exists in the
//      repository or opts into `create_host_path: false` — docker silently
//      creates a missing bind source as root-owned, which is exactly the
//      defect this contract forbids.
//
// `SELF_DROPPING` lists the upstream images whose entrypoint execs into an
// unprivileged user by itself (postgres and redis `gosu`/`su-exec` to their
// package users). Their runtime UID is image-defined, so no static `user:`
// is pinned for them; everything else in the always-on set must carry an
// explicit one. Profile-gated services (opea, gpu-models, observability,
// okf, letsencrypt) are out of scope — they never run in the default
// deployment this contract governs.

'use strict';

/**
 * Services whose upstream image entrypoint drops privileges itself.
 * Keyed by service name, valued with the reason (kept in the message).
 */
const SELF_DROPPING = {
  postgres: 'postgres:16 entrypoint gosu-execs as the postgres package user (uid 999)',
  'redis-cache': 'redis:7-alpine entrypoint su-exec-execs as the redis user (uid 999)'
};

/**
 * One-shot init containers that legitimately run as root: their whole job is
 * to chown a NAMED volume for the unprivileged user of the service that
 * follows (the otel-collector-init convention). They write nothing
 * host-visible — named volumes are daemon-managed, not host paths — and they
 * are short-lived, so neither contract rule is broken. Anything in this list
 * must keep `cap_add: [CHOWN]` and a restart policy of `none`/`on-failure`.
 */
const ONE_SHOT_ROOT_INIT = {
  'otel-collector-init': 'chowns the otel-queue volume for the collector (uid 10001) before it starts',
  'arango-vector-db-init': 'chowns the arango_data volume for arangodb (uid 999) before it starts',
  'victorialogs-init': 'chowns the vlogs-data volume for victoria-logs (uid 65534) before it starts'
};


/**
 * @param {string} composeText raw docker-compose.yaml content (the file
 *   contains ${VAR} substitutions, so callers must not round-trip it through
 *   a YAML parser — same caveat as parse-compose.js)
 * @returns {{violations: string[], alwaysOn: string[]}}
 *   violations: human-readable lines, one per offending service or bind
 *   alwaysOn: service names the contract applies to (for reporting)
 */
function validateComposeNonRoot(composeText) {
  const violations = [];
  const alwaysOn = [];
  const lines = composeText.split('\n');

  let inServices = false;
  let currentService = null;
  let currentUser = null;
  let currentProfiles = [];
  let inProfiles = false;
  let inVolumes = false;
  const serviceBinds = {}; // service -> [{path, createHostPath}]

  const flush = () => {
    if (currentService) {
      const gated = currentProfiles.length > 0;
      if (!gated) {
        alwaysOn.push(currentService);
        if (currentUser === null && !SELF_DROPPING[currentService] && !ONE_SHOT_ROOT_INIT[currentService]) {
          violations.push(
            `${currentService}: no \`user:\` declared — every always-on service must pin a non-root user ` +
              '(or join SELF_DROPPING / ONE_SHOT_ROOT_INIT with a justification)'
          );
        } else if (currentUser !== null) {
          const uid = String(currentUser).split(':')[0];
          if (uid === '0' || uid === 'root') {
            violations.push(`${currentService}: \`user: ${currentUser}\` is root — the contract forbids it`);
          }
        }
      }
      serviceBinds[currentService] = serviceBinds[currentService] || [];
      const binds = serviceBinds[currentService];
      for (const b of binds) {
        // A host path under the data dir that docker would silently create
        // (root-owned) is a violation unless the config opts out.
        if (/^(\.\/)?data(\/|$)/.test(b.path) && !b.createHostPathFalse) {
          violations.push(
            `${currentService}: host bind "${b.path}" sits under the data directory without ` +
              '`create_host_path: false` — docker creates a missing source as root-owned'
          );
        }
      }
    }
    currentService = null;
    currentUser = null;
    currentProfiles = [];
    inProfiles = false;
    inVolumes = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    if (line.match(/^services:\s*$/)) {
      flush();
      inServices = true;
      currentService = null;
      continue;
    }
    if (line.match(/^[a-z][\w-]*:\s*$/) && !line.startsWith(' ')) {
      flush();
      inServices = trimmed === 'services:';
      continue;
    }
    if (!inServices) continue;

    const serviceMatch = line.match(/^ {2}([\w-]+):\s*$/);
    if (serviceMatch) {
      flush();
      currentService = serviceMatch[1];
      continue;
    }
    if (!currentService) continue;

    // `user:` — mapping form only (the form every service in this file uses)
    const userMatch = line.match(/^ {4}user:\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (userMatch) {
      currentUser = userMatch[1];
      continue;
    }

    // `profiles:` — inline list or block list
    const profilesInline = line.match(/^ {4}profiles:\s*\[(.*)\]\s*$/);
    if (profilesInline) {
      currentProfiles = profilesInline[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean);
      continue;
    }
    if (/^ {4}profiles:\s*$/.test(line)) {
      inProfiles = true;
      continue;
    }
    if (inProfiles) {
      if (!/^ {6}/.test(line)) {
        inProfiles = false;
      } else {
        const item = line.match(/^ {6}-\s*['"]?([\w-]+)['"]?\s*$/);
        if (item) currentProfiles.push(item[1]);
        continue;
      }
    }

    // `volumes:` — collect host binds with their create_host_path opt-out
    if (/^ {4}volumes:\s*$/.test(line)) {
      inVolumes = true;
      continue;
    }
    if (inVolumes) {
      if (!/^ {6}/.test(line)) {
        inVolumes = false;
        continue;
      }
      // long syntax:
      //   - type: bind
      //     source: ./data/database_backups
      //     target: /app/database_backups
      //     bind:
      //       create_host_path: false
      const srcMatch = line.match(/^ {8}source:\s*(\S+)\s*$/);
      if (srcMatch) {
        const binds = (serviceBinds[currentService] = serviceBinds[currentService] || []);
        binds.push({ path: srcMatch[1], createHostPathFalse: false, sourceLine: i + 1 });
        continue;
      }
      const createFalse = line.match(/^ {10}create_host_path:\s*false\s*$/);
      if (createFalse && serviceBinds[currentService] && serviceBinds[currentService].length) {
        serviceBinds[currentService][serviceBinds[currentService].length - 1].createHostPathFalse = true;
        continue;
      }
    }
  }
  flush();

  return { violations, alwaysOn };
}

module.exports = { validateComposeNonRoot, SELF_DROPPING, ONE_SHOT_ROOT_INIT };
