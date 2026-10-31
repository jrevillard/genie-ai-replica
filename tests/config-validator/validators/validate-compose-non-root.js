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
 * Keyed by service name; the values are enforced documentation — pinned by
 * compose-non-root.test.js so an entry can neither vanish silently nor
 * lose its justification.
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
  'arango-vector-db-init': 'chowns the arango_data AND arango_apps volumes for arangodb (uid 999) before it starts',
  'victorialogs-init': 'chowns the vlogs-data volume for victoria-logs (uid 65534) before it starts',
  'document-repository-init': 'chowns the doc_repo_uploads volume for document-repository (uid 1000) before it starts',
  'backend-init':
    'chowns the backend root-era volumes (backend_data, backend_uploads) for the uid-1000 backend before it starts'
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
  let currentRestart = null;
  let currentRestartPolicyCondition = null;
  let currentCapAdds = [];
  let inCapAdds = false;
  let inDeploy = false;
  let inRestartPolicy = false;
  let currentMaxAttempts = null;
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
      // Profile-gated services are out of the contract's scope entirely —
      // same boundary as the user: check above (they never run in the
      // default deployment the contract governs).
      if (!gated) {
        const binds = serviceBinds[currentService] || [];
        for (const b of binds) {
          // A host path under the data dir that docker would silently create
          // (root-owned) is a violation unless the config opts out. Sources
          // carry variable forms — resolve them: `${VAR:-default}` to its
          // default; a bare `${VAR}` (unknown location) to the data dir
          // CONSERVATIVELY, so renaming the variable cannot defeat the gate.
          const resolved = b.path
            .replace(/^['"]|['"]$/g, '')
            .replace(/^\$\{[\w-]+:-([^}]*)\}/, '$1')
            .replace(/^\$\{[\w-]+\}/, './data')
            // braceless $VAR is legal compose interpolation too — same
            // conservative treatment (unknown location = under the data dir)
            .replace(/^\$(?!\{)[\w-]+/, './data');
          if (!/^(\.\/)?data(\/|$)/.test(resolved)) continue;
          if (b.shortSyntax) {
            violations.push(
              `${currentService}: host bind "${b.path}" sits under the data directory in short syntax, ` +
                'which cannot carry `create_host_path: false` — use long syntax or a named volume'
            );
          } else if (!b.createHostPathFalse) {
            violations.push(
              `${currentService}: host bind "${b.path}" sits under the data directory without ` +
                '`create_host_path: false` — docker creates a missing source as root-owned'
            );
          }
        }
        if (ONE_SHOT_ROOT_INIT[currentService]) {
          // Documented invariants, enforced: a root init exists to chown a
          // named volume (needs CAP_CHOWN) and must stay a one-shot (a
          // restart-always policy would make it a permanent root container).
          // A service merged with the x-chown-init anchor inherits the
          // invariants from the anchor unless it overrides them locally.
          const capAdds = currentCapAdds.length ? currentCapAdds : anchorMerged ? anchorDefaults.capAdds : [];
          const restart = currentRestart !== null ? currentRestart : anchorMerged ? anchorDefaults.restart : null;
          const condition =
            currentRestartPolicyCondition !== null
              ? currentRestartPolicyCondition
              : anchorMerged
                ? anchorDefaults.condition
                : null;
          const maxAttempts =
            currentMaxAttempts !== null ? currentMaxAttempts : anchorMerged ? anchorDefaults.maxAttempts : null;
          if (!capAdds.includes('CHOWN')) {
            violations.push(`${currentService}: ONE_SHOT_ROOT_INIT member must keep cap_add: [CHOWN]`);
          }
          // BOTH keys must be one-shot: compose reads `restart:` while
          // `docker stack deploy` reads deploy.restart_policy — an OR would
          // let a single-key flip create a permanent root container on one
          // front-end while the other still looks safe. An ABSENT key is the
          // front-end's no-restart default (compose "no", swarm "none"), so
          // only an explicit non-one-shot value violates.
          const oneShot =
            (restart === null || restart === 'no') &&
            (condition === null || condition === 'none' || condition === 'on-failure');
          // on-failure restarts a FAILING container — on swarm, without a
          // max_attempts bound that is an infinite loop, i.e. a permanent
          // root container for exactly as long as the chown keeps failing.
          if (condition === 'on-failure' && maxAttempts === null) {
            violations.push(
              `${currentService}: restart_policy on-failure without max_attempts restarts a failing ` +
                'root init forever on swarm — bound it'
            );
          }
          if (!oneShot) {
            violations.push(
              `${currentService}: ONE_SHOT_ROOT_INIT member must be a one-shot on BOTH front-ends ` +
                '(restart "no" AND restart_policy none/on-failure)'
            );
          }
        }
      }
    }
    currentService = null;
    currentUser = null;
    currentProfiles = [];
    inProfiles = false;
    inVolumes = false;
    currentRestart = null;
    currentRestartPolicyCondition = null;
    currentMaxAttempts = null;
    currentCapAdds = [];
    inCapAdds = false;
    inDeploy = false;
    inRestartPolicy = false;
  };

  // Pre-scan the x-chown-init extension anchor: services merge it via
  // `<<: *chown-init`, and a line-level parser must resolve that merge to
  // see the invariants it carries (cap_add, restart, restart_policy).
  const anchorDefaults = { capAdds: [], restart: null, condition: null, maxAttempts: null };
  {
    let inAnchor = false;
    let inAnchorPolicy = false;
    let anchorKey = null; // which 2-space key the current 4-space list belongs to
    for (const line of lines) {
      if (/^x-chown-init:/.test(line)) {
        inAnchor = true;
        continue;
      }
      if (!inAnchor) continue;
      if (/^[a-z][\w-]*:\s*$/.test(line) && !line.startsWith(' ')) {
        inAnchor = false;
        continue;
      }
      // Only items under `cap_add:` are capabilities the anchor GRANTS —
      // the anchor also carries `cap_drop: [ALL]`, whose ALL would poison
      // the CHOWN invariant check if it leaked into the same list.
      if (/^ {2}[\w-]+:\s*(\[.*\]\s*)?$/.test(line)) {
        anchorKey = line.match(/^ {2}([\w-]+):/)[1];
        continue;
      }
      const cap = anchorKey === 'cap_add' ? line.match(/^ {4}-\s*([A-Z_]+)\s*$/) : null;
      if (cap) {
        anchorDefaults.capAdds.push(cap[1]);
        continue;
      }
      const restart = line.match(/^ {2}restart:\s*['"]?([\w:-]+)['"]?\s*$/);
      if (restart) anchorDefaults.restart = restart[1];
      const anchorAttempts = line.match(/^ {4}max_attempts:\s*(\d+)\s*$/);
      if (anchorAttempts) anchorDefaults.maxAttempts = anchorAttempts[1];
      if (/^ {4}restart_policy:\s*$/.test(line)) {
        inAnchorPolicy = true;
        continue;
      }
      if (inAnchorPolicy) {
        if (!/^ {6}/.test(line)) {
          inAnchorPolicy = false;
        } else {
          const cond = line.match(/^ {6}condition:\s*['"]?([\w-]+)['"]?\s*$/);
          if (cond) anchorDefaults.condition = cond[1];
          continue;
        }
      }
    }
  }
  let anchorMerged = false;
  // Long-syntax state: the index of the bind entry the current `bind:` opts
  // block nests under, or null when there is none — a `create_host_path:`
  // line must attach to the entry its own `bind:` key opened, not to the
  // last-pushed source (a misplaced opt-out would otherwise silence the
  // wrong bind).
  let inBindOpts = false;
  let pendingCreateFalse = false;
  let sourceSeenThisEntry = false;
  let bindOptsTarget = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

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
      serviceBinds[currentService] = [];
      anchorMerged = false;
      inBindOpts = false;
      pendingCreateFalse = false;
      sourceSeenThisEntry = false;
      bindOptsTarget = null;
      continue;
    }
    if (!currentService) continue;

    // `<<: *chown-init` — the service inherits the anchor's invariants as
    // its baseline (service-local keys still override).
    if (/^ {4}<<:\s*\*chown-init\s*$/.test(line)) {
      anchorMerged = true;
      continue;
    }

    // `user:` — mapping form only (the form every service in this file uses)
    // A trailing # comment is legal documentation on the pin — the value
    // ends at whitespace or the comment marker.
    const userMatch = line.match(/^ {4}user:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/);
    if (userMatch) {
      currentUser = userMatch[1];
      continue;
    }

    // restart / cap_add / deploy.restart_policy.condition — the one-shot
    // init invariants
    const restartMatch = line.match(/^ {4}restart:\s*['"]?([\w:-]+)['"]?\s*$/);
    if (restartMatch) {
      currentRestart = restartMatch[1];
      continue;
    }
    if (/^ {4}cap_add:\s*$/.test(line)) {
      inCapAdds = true;
      continue;
    }
    if (inCapAdds) {
      if (!/^ {6}/.test(line)) {
        inCapAdds = false;
      } else {
        const cap = line.match(/^ {6}-\s*([A-Z_]+)\s*$/);
        if (cap) currentCapAdds.push(cap[1]);
        continue;
      }
    }
    if (/^ {4}deploy:\s*$/.test(line)) {
      inDeploy = true;
      continue;
    }
    if (inDeploy) {
      if (/^ {6}restart_policy:\s*$/.test(line)) {
        inRestartPolicy = true;
        continue;
      }
      if (inRestartPolicy) {
        if (!/^ {8}/.test(line)) {
          inRestartPolicy = false;
        } else {
          const cond = line.match(/^ {8}condition:\s*['"]?([\w-]+)['"]?\s*$/);
          if (cond) currentRestartPolicyCondition = cond[1];
          const attempts = line.match(/^ {8}max_attempts:\s*(\d+)\s*$/);
          if (attempts) currentMaxAttempts = attempts[1];
          continue;
        }
      }
    }

    // `profiles:` — inline list or block list
    const profilesInline = line.match(/^ {4}profiles:\s*\[([^\]]*)\]\s*(?:#.*)?$/);
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
        inBindOpts = false;
        pendingCreateFalse = false;
        sourceSeenThisEntry = false;
        bindOptsTarget = null;
        continue;
      }
      if (/^ {6}-\s/.test(line)) {
        // a new long-syntax entry begins — its opts may only attach to a
        // source: seen from here on
        sourceSeenThisEntry = false;
      }
      // long syntax:
      //   - type: bind
      //     source: ./data/database_backups
      //     target: /app/database_backups
      //     bind:
      //       create_host_path: false
      const srcMatch = line.match(/^ {8}source:\s*(\S+)\s*(?:#.*)?$/);
      if (srcMatch) {
        const binds = (serviceBinds[currentService] = serviceBinds[currentService] || []);
        // YAML mapping order is free: a `bind:` opts block may follow its
        // own source: (the common spelling) or precede it. Retro-attach to
        // the source: this entry opened when we saw one; otherwise arm the
        // pending flag the next source: consumes.
        const idx = binds.length;
        binds.push({ path: srcMatch[1], createHostPathFalse: false, shortSyntax: false });
        if (pendingCreateFalse) {
          binds[idx].createHostPathFalse = true;
          pendingCreateFalse = false;
        }
        sourceSeenThisEntry = true;
        inBindOpts = false;
        continue;
      }
      if (/^ {8}bind:\s*$/.test(line)) {
        inBindOpts = true;
        bindOptsTarget = sourceSeenThisEntry ? (serviceBinds[currentService] || []).length - 1 : null;
        continue;
      }
      const createFalse = line.match(/^ {10}create_host_path:\s*false\s*$/);
      if (createFalse && inBindOpts) {
        if (bindOptsTarget !== null) {
          serviceBinds[currentService][bindOptsTarget].createHostPathFalse = true;
          bindOptsTarget = null;
        } else {
          pendingCreateFalse = true;
        }
        continue;
      }
      // Short syntax: - <host>:<container>[:mode] — the form the deleted
      // kong logs bind used. The container side always starts with `/` and
      // the greedy host group absorbs `${VAR:-default}` spans (which contain
      // colons); a named volume is a bare name with no `/`-rooted target.
      const shortBind = line.match(/^ {6}-\s*(.+):(\/[^:\s]+)(?::\S+)?\s*$/);
      if (shortBind) {
        const hostPart = shortBind[1].replace(/^['"]|['"]$/g, '');
        if (/[/${]|^\.?\.?\//.test(hostPart)) {
          const binds = (serviceBinds[currentService] = serviceBinds[currentService] || []);
          binds.push({ path: hostPart, createHostPathFalse: false, shortSyntax: true });
        }
        continue;
      }
    }
  }
  flush();

  return { violations, alwaysOn };
}

/**
 * Collect the service names declared under the top-level `services:`
 * section — 2-space keys only, tracked by section so the top-level
 * `volumes:` keys never leak in. compose-non-root.test.js MUST use this
 * helper (not its own scan) or the two notions of "a service exists"
 * drift apart silently.
 */
function collectServiceNames(composeText) {
  const names = new Set();
  let inServices = false;
  for (const line of composeText.split('\n')) {
    if (/^[a-z][\w-]*:\s*$/.test(line)) {
      inServices = line.trim() === 'services:';
    } else if (inServices) {
      const m = line.match(/^ {2}([\w-]+):\s*$/);
      if (m) names.add(m[1]);
    }
  }
  return names;
}

module.exports = { validateComposeNonRoot, collectServiceNames, SELF_DROPPING, ONE_SHOT_ROOT_INIT };
