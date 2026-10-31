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

  test('the always-on set is EXACTLY the contract scope (no silent narrowing)', () => {
    // A subset pin lets a rename (victorialogs → vlogs) shrink the
    // contract with all tests green: the dropped service's user: pin and
    // create_host_path guards stop being enforced silently. Equality
    // against the full list makes any add/remove/rename a loud contract
    // checkpoint instead.
    expect([...real.alwaysOn].sort()).toEqual(
      [
        'arango-vector-db',
        'arango-vector-db-init',
        'backend',
        'backend-init',
        'clamav',
        'db-migrations',
        'document-repository',
        'document-repository-init',
        'frontend',
        'keycloak',
        'keycloak-config',
        'kong',
        'kong-config',
        'kong-migrations',
        'nginx',
        'otel-collector',
        'otel-collector-init',
        'postgres',
        'postgres-init',
        'redis-cache',
        'victorialogs',
        'victorialogs-init'
      ].sort()
    );
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
    // replaceAll: the config binds share the spelling — flipping only the
    // first occurrence would mute the wrong bind after their addition
    const mutated = composeText.replaceAll('create_host_path: false', 'create_host_path: true');
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
    const noChown = composeText.replaceAll('    - CHOWN\n', '');
    expect(noChown).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(noChown);
    expect(v1.some((v) => v.includes('arango-vector-db-init') && v.includes('CHOWN'))).toBe(true);

    // EACH key alone must trip the gate: compose reads `restart:` while
    // swarm reads deploy.restart_policy — flipping one must not hide behind
    // the other.
    const swarmFlip = composeText.replaceAll('condition: on-failure', 'condition: always');
    expect(swarmFlip).not.toBe(composeText);
    const { violations: vSwarm } = validateComposeNonRoot(swarmFlip);
    expect(vSwarm.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);

    const composeFlip = composeText.replaceAll('restart: "on-failure:3"', 'restart: always');
    expect(composeFlip).not.toBe(composeText);
    const { violations: vCompose } = validateComposeNonRoot(composeFlip);
    expect(vCompose.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);
  });

  test('mutation: on-failure without max_attempts trips the gate', () => {
    // The anchor carries restart_policy.condition on-failure WITH a bound
    // (the one-shot rule's blessed self-healing form). Stripping the bound
    // turns every anchor-merged init into an UNBOUNDED restart loop of a
    // failing root container (swarm restarts forever without a bound). Each
    // must trip by name — arango-vector-db-init asserted as the canary.
    const unbounded = composeText.replace('\n      max_attempts: 3\n', '\n');
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

  test('mutation: a doubly-nested variable default cannot defeat the gate', () => {
    // ${DATA_DIR:-${MOUNT_DIR:-./data}} is legal compose — the resolver
    // must strip nesting until stable, not stop at the first inner brace.
    const nested = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - type: bind',
      '        source: ${DATA_DIR:-${MOUNT_DIR:-./data}}/logs/kong',
      '        target: /var/log/kong',
      ''
    ].join('\n');
    const { violations } = validateComposeNonRoot(nested);
    expect(violations.some((v) => v.includes('kong') && v.includes('create_host_path: false'))).toBe(true);
  });

  test('mutations: error/alt variable forms cannot escape the data-dir rule', () => {
    // \${VAR:?err}, \${VAR?err} and \${VAR:+alt} are legal compose —
    // resolved CONSERVATIVELY like every other unknown-location spelling.
    for (const form of ['\${DATA_DIR:?missing}', '\${DATA_DIR?missing}', '\${DATA_DIR:+/srv/alt}']) {
      const text = [
        'services:',
        '  kong:',
        '    user: "1001:1001"',
        '    volumes:',
        '      - type: bind',
        '        source: ' + form + '/logs/kong',
        '        target: /var/log/kong',
        ''
      ].join('\n');
      const { violations } = validateComposeNonRoot(text);
      expect(violations.some((v) => v.includes('kong') && v.includes('create_host_path: false'))).toBe(true);
    }
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

  test('mutations: unbounded restart always trips; the bounded ":N" form is one-shot-in-spirit', () => {
    // restart: "on-failure:10" TERMINATES by itself — the one-shot rule
    // accepts it as one-shot-in-spirit (the anchor ships exactly this
    // form). The unbounded spellings are the danger and still trip.
    const bounded = composeText.replaceAll('restart: "on-failure:3"', 'restart: "on-failure:10"');
    const { violations: v1 } = validateComposeNonRoot(bounded);
    expect(v1.filter((v) => v.includes('one-shot'))).toEqual([]);

    const always = composeText.replaceAll('restart: "on-failure:3"', 'restart: always');
    expect(always).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(always);
    expect(v2.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);

    // Braceless $VAR interpolation is legal compose — the bind must still
    // land under the data-dir rule (conservative resolution).
    const braceless = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: $DATA_DIR/database_backups',
      '        target: /app/database_backups',
      ''
    ].join('\n');
    const { violations: v3 } = validateComposeNonRoot(braceless);
    expect(v3.some((v) => v.includes('backend') && v.includes('create_host_path: false'))).toBe(true);
  });

  test('mutations: numeric-zero uid and local-deploy shallow-replace cannot slip past the gate', () => {
    // user: "00:1000" runs as uid 0 — the exact-spelling check missed it.
    const zero = composeText.replace('user: "999:999"', 'user: "00:999"');
    expect(zero).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(zero);
    expect(v1.some((v) => v.includes('arango-vector-db') && v.includes('is root'))).toBe(true);

    // A service-local deploy: shallow-replaces the anchor's deploy map:
    // mode: global and the anchor restart_policy vanish at runtime while
    // the old gate still credited them — now the local-only view applies
    // and the absent condition reads as swarm's default "any".
    const localDeploy = composeText.replace(
      '  backend-init:\n    <<: *chown-init\n',
      '  backend-init:\n    <<: *chown-init\n    deploy:\n      placement:\n        constraints:\n          - node.labels.genieai == true\n'
    );
    expect(localDeploy).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(localDeploy);
    expect(v2.some((v) => v.includes('backend-init') && v.includes('one-shot'))).toBe(true);
  });

  test('mutations: absolute resolved sources cannot escape the data-dir rule', () => {
    // Re-pointing a variable default at an absolute path must not defeat
    // the gate (long syntax carries the opt-out; short syntax absolute
    // binds like the docker socket are not data paths and stay out).
    const repointed = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ${DATA_DIR:-/srv/genie}/database_backups',
      '        target: /app/database_backups',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(repointed);
    expect(v1.some((v) => v.includes('backend') && v.includes('create_host_path: false'))).toBe(true);

    const handWritten = repointed.replace('${DATA_DIR:-/srv/genie}/database_backups', '/var/genie/data/logs');
    const { violations: v2 } = validateComposeNonRoot(handWritten);
    expect(v2.some((v) => v.includes('backend') && v.includes('create_host_path: false'))).toBe(true);
  });

  test('mutations: short-syntax absolute data bind, dotted service names, named volume "data"', () => {
    // A short-syntax ABSOLUTE bind with a /data/ segment is the same
    // root-created-source defect (short syntax cannot carry the opt-out);
    // the docker socket stays exempt (no data segment).
    const shortAbsolute = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - /srv/genie/data/database_backups:/app/database_backups',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(shortAbsolute);
    expect(v1.some((v) => v.includes('kong') && v.includes('short syntax'))).toBe(true);
    const socket = [
      'services:',
      '  otel-collector:',
      '    user: "10001:10001"',
      '    volumes:',
      '      - /var/run/docker.sock:/var/run/docker.sock:ro',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(socket).violations).toEqual([]);

    // A dotted service key must start its own block — the old regex let
    // its user:/volumes: bleed into the previous service's verdict.
    const dotted = ['services:', '  vlogs.gateway:', '    user: root', ''].join('\n');
    const { violations: v2 } = validateComposeNonRoot(dotted);
    expect(v2.some((v) => v.includes('vlogs.gateway') && v.includes('is root'))).toBe(true);

    // A NAMED volume whose name is "data" is not a host bind — no
    // create_host_path demand on it.
    const namedVolume = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: volume',
      '        source: data',
      '        target: /app/data',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(namedVolume).violations).toEqual([]);
  });

  test('mutations: type-after-source volume, commented opt-out, flow cap_add, literal absolute paths', () => {
    // type: volume AFTER its source: (mapping order free) — the entry is a
    // named volume, not a host bind needing create_host_path.
    const lateVolume = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - source: data',
      '        target: /app/data',
      '        type: volume',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(lateVolume).violations).toEqual([]);

    // A commented opt-out is legal spelling (source: and user: tolerate it).
    const commentedOptOut = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ./data/database_backups',
      '        target: /app/database_backups',
      '        bind:',
      '          create_host_path: false # pre-created by Ansible',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(commentedOptOut).violations).toEqual([]);

    // Flow-style cap_add parses like block style — an allowlisted init
    // with cap_add: [CHOWN] satisfies the CHOWN invariant.
    const flowCaps = ['services:', '  x-init:', '    <<: *chown-init', '    cap_add: [CHOWN, DAC_OVERRIDE]', ''].join(
      '\n'
    );
    const { violations: vFlow } = validateComposeNonRoot(flowCaps);
    expect(vFlow.filter((v) => v.includes('CHOWN'))).toEqual([]);

    // An absolute LITERAL host path (/etc/localtime) pre-exists on every
    // host — no create_host_path demand; the TEMPLATED absolute sibling
    // stays under the rule.
    const literalAbsolute = [
      'services:',
      '  otel-collector:',
      '    user: "10001:10001"',
      '    volumes:',
      '      - type: bind',
      '        source: /etc/localtime',
      '        target: /etc/localtime',
      '        read_only: true',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(literalAbsolute).violations).toEqual([]);
  });

  test("the runtime gate's SELF_DROPPING list matches the validator's allowlist", () => {
    // The shell gate keeps its own copy (no JS runtime there); without
    // this pin a third self-dropping image added to the validator would
    // silently stay unskipped in the runtime half — the prose-drift class
    // that bit the Ansible migration three times.
    const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'compose-non-root', 'check-runtime.sh'), 'utf-8');
    const m = shell.match(/^SELF_DROPPING='([^']*)'$/m);
    expect(m).not.toBeNull();
    const shellList = m[1].trim().split(/\s+/).sort();
    expect(shellList).toEqual(Object.keys(SELF_DROPPING).sort());
  });

  test('mutations: source-first bind, cross-entry opt-out leak, explicit empty cap_add', () => {
    // A source:-first entry whose type: bind arrives LATE is a host bind —
    // the untyped default must not swallow it.
    const sourceFirst = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - source: ${DATA_DIR:-./data}/logs/kong',
      '        target: /var/log/kong',
      '        type: bind',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(sourceFirst);
    expect(
      v1.some(
        (v) => v.includes('kong') && v.includes('short syntax') === false && v.includes('create_host_path: false')
      )
    ).toBe(true);

    // An orphan bind: opts block in an entry with NO source: must die at
    // the entry boundary — it must not opt out the NEXT entry's bind.
    const leak = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        bind:',
      '          create_host_path: false',
      '      - type: bind',
      '        source: ./data/database_backups',
      '        target: /app/database_backups',
      ''
    ].join('\n');
    const { violations: v2 } = validateComposeNonRoot(leak);
    expect(v2.some((v) => v.includes('backend') && v.includes('create_host_path: false'))).toBe(true);

    // An EXPLICIT cap_add: [] replaces the anchor's list (YAML merge
    // semantics) — the CHOWN invariant must trip, not inherit.
    const emptyCaps = composeText.replace(
      '  backend-init:\n    <<: *chown-init\n',
      '  backend-init:\n    <<: *chown-init\n    cap_add: []\n'
    );
    expect(emptyCaps).not.toBe(composeText);
    const { violations: v3 } = validateComposeNonRoot(emptyCaps);
    expect(v3.some((v) => v.includes('backend-init') && v.includes('CHOWN'))).toBe(true);
  });

  test('mutations: commented invariant keys, flow volume entries', () => {
    // A commented restart line must not fall back to the anchor's bounded
    // values — 'restart: always # self-heal' on a chown-init is a
    // permanent root container.
    const commentedRestart = composeText.replaceAll('restart: "on-failure:3"', 'restart: always # self-heal');
    expect(commentedRestart).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(commentedRestart);
    expect(v1.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);

    // A commented volumes: key must not disable bind collection — the
    // data-dir bind behind it stays enforced.
    const commentedVolumes = composeText.replace(
      '    volumes:\n      # Long syntax + create_host_path:false (#1227): docker silently creates',
      '    volumes: # gateway logs\n      # Long syntax + create_host_path:false (#1227): docker silently creates'
    );
    expect(commentedVolumes).not.toBe(composeText);
    // replaceAll: the file carries several opt-outs (frontend/keycloak
    // config binds sit OUTSIDE the data-dir scope — flipping those is a
    // no-op) — the backend's data-dir bind must trip by name
    const flipped = commentedVolumes.replaceAll('create_host_path: false', 'create_host_path: true');
    const { violations: v2 } = validateComposeNonRoot(flipped);
    expect(v2.some((v) => v.includes('backend') && v.includes('create_host_path: false'))).toBe(true);

    // Flow-style entries parse like block entries.
    const flow = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - {type: bind, source: ./data/logs/kong, target: /var/log/kong}',
      ''
    ].join('\n');
    const { violations: v3 } = validateComposeNonRoot(flow);
    expect(v3.some((v) => v.includes('kong') && v.includes('create_host_path: false'))).toBe(true);

    const flowOpted = flow.replace(
      '{type: bind, source: ./data/logs/kong, target: /var/log/kong}',
      '{type: bind, source: ./data/logs/kong, target: /var/log/kong, bind: {create_host_path: false}}'
    );
    expect(validateComposeNonRoot(flowOpted).violations).toEqual([]);
  });

  test('mutations: service-local commented restart, templated user pin, triple nesting, flow bind opts', () => {
    // A SERVICE-LOCAL commented restart hides behind the anchor's bounded
    // values (the r19 mutation covered the anchor line only).
    const localCommented = composeText.replace(
      '  backend-init:\n    <<: *chown-init\n',
      '  backend-init:\n    <<: *chown-init\n    restart: always # self-heal\n'
    );
    expect(localCommented).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(localCommented);
    expect(v1.some((v) => v.includes('backend-init') && v.includes('one-shot'))).toBe(true);

    // A templated user pin could resolve to root — resolved conservatively
    // to root (the identity pin must be literal).
    const templated = ['services:', '  backend:', '    user: "${BACKEND_UID:-0}"', ''].join('\n');
    const { violations: v2 } = validateComposeNonRoot(templated);
    expect(v2.some((v) => v.includes('backend') && v.includes('is root'))).toBe(true);

    // Triple-nested variable defaults strip from the innermost outward.
    const triple = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - type: bind',
      '        source: ${A:-${B:-${C:-./data}}}/logs/kong',
      '        target: /var/log/kong',
      ''
    ].join('\n');
    const { violations: v3 } = validateComposeNonRoot(triple);
    expect(v3.some((v) => v.includes('kong') && v.includes('create_host_path: false'))).toBe(true);

    // Flow-form bind opts and re-indented create_host_path are legal
    // spellings of an opted-out bind — no false violation.
    const flowBind = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ./data/database_backups',
      '        target: /app/database_backups',
      '        bind: {create_host_path: false}',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(flowBind).violations).toEqual([]);

    const reindented = [
      'services:',
      '  backend:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ./data/database_backups',
      '        target: /app/database_backups',
      '        bind:',
      '            create_host_path: false',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(reindented).violations).toEqual([]);
  });

  test('mutations: short-syntax comment, flow deploy, mode drop, explicit root init', () => {
    // A trailing comment must not defeat the short-syntax data bind.
    const shortCommented = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - "${DATA_DIR:-./data}/logs/kong:/var/log/kong" # kong logs',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(shortCommented);
    expect(v1.some((v) => v.includes('kong') && v.includes('short syntax'))).toBe(true);

    // A flow-form deploy: replaces the anchor's map — the mode/one-shot
    // invariants must be judged on the local shape (absent → default).
    const flowDeploy = composeText.replace(
      '  backend-init:\n    <<: *chown-init\n',
      '  backend-init:\n    <<: *chown-init\n    deploy: {mode: replicated}\n'
    );
    expect(flowDeploy).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(flowDeploy);
    expect(v2.some((v) => v.includes('backend-init') && v.includes('one-shot'))).toBe(true);
    expect(v2.some((v) => v.includes('backend-init') && v.includes('mode: global'))).toBe(true);

    // A local deploy restating the bounded policy but DROPPING
    // mode: global strands the per-node chown guarantee — must trip.
    const modeDrop = composeText.replace(
      '  backend-init:\n    <<: *chown-init\n',
      '  backend-init:\n    <<: *chown-init\n    deploy:\n      restart_policy:\n        condition: on-failure\n        max_attempts: 3\n'
    );
    const { violations: v3 } = validateComposeNonRoot(modeDrop);
    expect(v3.some((v) => v.includes('backend-init') && v.includes('mode: global'))).toBe(true);

    // An allowlisted one-shot may pin user: root EXPLICITLY — the doctrine
    // is "root ON PURPOSE"; the blanket root check must not fire on it.
    const explicitRootInit = composeText.replace(
      '  backend-init:\n    <<: *chown-init\n',
      '  backend-init:\n    <<: *chown-init\n    user: root\n'
    );
    const { violations: v4 } = validateComposeNonRoot(explicitRootInit);
    expect(v4.filter((v) => v.includes('backend-init') && v.includes('is root'))).toEqual([]);

    // ...while the same pin on a REGULAR service still trips.
    const explicitRootSvc = ['services:', '  backend:', '    user: root', ''].join('\n');
    const { violations: v5 } = validateComposeNonRoot(explicitRootSvc);
    expect(v5.some((v) => v.includes('backend') && v.includes('is root'))).toBe(true);
  });

  test('mutations: anchor mode flip and re-indented bind cannot slip past the gate', () => {
    // The anchor's OWN mode: global is parsed, not hardcoded — flipping it
    // trips every merged init (the per-node chown guarantee is doctrine).
    const modeFlip = composeText.replace('    mode: global', '    mode: replicated');
    expect(modeFlip).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(modeFlip);
    expect(v1.filter((v) => v.includes('mode: global')).length).toBeGreaterThanOrEqual(5);

    // A deeper-indented long-syntax bind is still collected (same class
    // the create_host_path matcher was made flexible for).
    const reindented = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - type: bind',
      '          source: ${DATA_DIR:-./data}/logs/kong',
      '          target: /var/log/kong',
      ''
    ].join('\n');
    const { violations: v2 } = validateComposeNonRoot(reindented);
    expect(v2.some((v) => v.includes('kong') && v.includes('create_host_path: false'))).toBe(true);
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
