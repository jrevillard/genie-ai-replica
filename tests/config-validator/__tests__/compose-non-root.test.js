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
  ONE_SHOT_ROOT_INIT,
  INIT_BACKED_BINDS
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
        'secrets-ssl-init',
        'victorialogs',
        'victorialogs-init'
      ].sort()
    );
  });

  test('no pinned user is root', () => {
    const { violations } = validateComposeNonRoot('services:\n  svc:\n    user: "0:0"\n');
    expect(violations.some((v) => v.includes('svc') && v.includes('is root'))).toBe(true);
  });

  test('a data bind WITH create_host_path: false is accepted', () => {
    // Negative control for the mutation test below: the accepted form must
    // produce zero violations, so the gate cannot pass for a looser reason.
    const text = [
      'services:',
      '  svc:',
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

  test('mutation: a non-exempt service with a data bind without the opt-out trips the gate', () => {
    // backend and nginx are INIT_BACKED (their init converges the bind
    // before start) so the real file no longer carries create_host_path:
    // false on them — flipping the remaining opt-outs (tracked config
    // dirs, outside the rule) is a no-op. The rule still fires on ANY
    // OTHER service: appending one to the real text must trip, proving
    // the exemption does not leak to the whole file.
    // inserted right after `services:` — the file ENDS on the top-level
    // networks: section, and an appended key would land there, correctly
    // invisible.
    const rogue = composeText.replace(
      'services:\n',
      [
        'services:',
        '  rogue:',
        '    user: "1000:1000"',
        '    volumes:',
        '      - type: bind',
        '        source: ./data/rogue',
        '        target: /rogue',
        ''
      ].join('\n')
    );
    expect(rogue).not.toBe(composeText);
    const { violations } = validateComposeNonRoot(rogue);
    expect(violations.some((v) => v.includes('rogue') && v.includes('create_host_path: false'))).toBe(true);
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

    const composeFlip = composeText.replaceAll('restart: "on-failure:60"', 'restart: always');
    expect(composeFlip).not.toBe(composeText);
    const { violations: vCompose } = validateComposeNonRoot(composeFlip);
    expect(vCompose.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);
  });

  test('mutation: on-failure without max_attempts trips the gate', () => {
    // The anchor carries restart_policy.condition on-failure WITH a bound
    // (the one-shot rule's blessed self-healing form). Stripping the bound
    // turns every anchor-merged init into an UNBOUNDED restart loop of a
    // failing root container (swarm restarts forever without a bound). Each
    // must trip by name — otel-collector-init asserted as the canary (it
    // is the one init still judged on the ANCHOR's policy since the
    // placement fix gave the other four service-local deploys).
    const unbounded = composeText.replace('\n      max_attempts: 60\n', '\n');
    expect(unbounded).not.toBe(composeText);
    const { violations } = validateComposeNonRoot(unbounded);
    expect(
      violations.some((v) => v.includes('otel-collector-init') && v.includes('on-failure without max_attempts'))
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
    // ${VAR:?err}, ${VAR?err} and ${VAR:+alt} are legal compose —
    // resolved CONSERVATIVELY like every other unknown-location spelling.
    for (const form of ['${DATA_DIR:?missing}', '${DATA_DIR?missing}', '${DATA_DIR:+/srv/alt}']) {
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
      '  svc:',
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
    expect(violations.some((v) => v.includes('svc') && v.includes('create_host_path: false'))).toBe(true);
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
      '  svc:',
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
      'svc: host bind "./data/database_backups" sits under the data directory without ' +
        '`create_host_path: false` — docker creates a missing source as root-owned'
    ]);
  });

  test('mutations: unbounded restart always trips; the bounded ":N" form is one-shot-in-spirit', () => {
    // restart: "on-failure:10" TERMINATES by itself — the one-shot rule
    // accepts it as one-shot-in-spirit (the anchor ships exactly this
    // form). The unbounded spellings are the danger and still trip.
    const bounded = composeText.replaceAll('restart: "on-failure:60"', 'restart: "on-failure:10"');
    const { violations: v1 } = validateComposeNonRoot(bounded);
    expect(v1.filter((v) => v.includes('one-shot'))).toEqual([]);

    const always = composeText.replaceAll('restart: "on-failure:60"', 'restart: always');
    expect(always).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(always);
    expect(v2.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);

    // Braceless $VAR interpolation is legal compose — the bind must still
    // land under the data-dir rule (conservative resolution).
    const braceless = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: $DATA_DIR/database_backups',
      '        target: /app/database_backups',
      ''
    ].join('\n');
    const { violations: v3 } = validateComposeNonRoot(braceless);
    expect(v3.some((v) => v.includes('svc') && v.includes('create_host_path: false'))).toBe(true);
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
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '  otel-collector-init:\n    <<: *chown-init\n    deploy:\n      placement:\n        constraints:\n          - node.labels.genieai == true\n'
    );
    expect(localDeploy).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(localDeploy);
    expect(v2.some((v) => v.includes('otel-collector-init') && v.includes('one-shot'))).toBe(true);
  });

  test('mutations: absolute resolved sources cannot escape the data-dir rule', () => {
    // Re-pointing a variable default at an absolute path must not defeat
    // the gate (long syntax carries the opt-out; short syntax absolute
    // binds like the docker socket are not data paths and stay out).
    const repointed = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ${DATA_DIR:-/srv/genie}/database_backups',
      '        target: /app/database_backups',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(repointed);
    expect(v1.some((v) => v.includes('svc') && v.includes('create_host_path: false'))).toBe(true);

    const handWritten = repointed.replace('${DATA_DIR:-/srv/genie}/database_backups', '/var/genie/data/logs');
    const { violations: v2 } = validateComposeNonRoot(handWritten);
    expect(v2.some((v) => v.includes('svc') && v.includes('create_host_path: false'))).toBe(true);
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
      '  svc:',
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
      '  svc:',
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
      '  svc:',
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

  test('mutations: home-rooted (~) bind sources stay under the rule', () => {
    // compose expands `~` to the invoking user's home; a source missing
    // there is created root-owned by the daemon — the same defect class
    // as an absolute path. A home-ROOTED source therefore counts like an
    // absolute one: templated or data-shaped forms are flagged without
    // the opt-out, while a pre-existing literal absolute (no data
    // segment, no template) stays out.
    const templatedHome = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ${DATA_DIR:-~/genie}/database_backups',
      '        target: /app/database_backups',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(templatedHome);
    expect(v1.some((v) => v.includes('svc') && v.includes('deployment-authored'))).toBe(true);

    const templatedHomeOpted = templatedHome.replace(
      '        target: /app/database_backups',
      '        target: /app/database_backups\n        bind: {create_host_path: false}'
    );
    expect(validateComposeNonRoot(templatedHomeOpted).violations).toEqual([]);

    const literalHomeData = templatedHome.replace(
      'source: ${DATA_DIR:-~/genie}/database_backups',
      'source: ~/data/database_backups'
    );
    const { violations: v2 } = validateComposeNonRoot(literalHomeData);
    expect(v2.some((v) => v.includes('svc') && v.includes('deployment-authored'))).toBe(true);

    const shortHomeData = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes: ["~/data/logs/kong:/var/log/kong"]',
      ''
    ].join('\n');
    const { violations: v3 } = validateComposeNonRoot(shortHomeData);
    expect(v3.some((v) => v.includes('kong') && v.includes('short syntax'))).toBe(true);

    // negative control: a literal absolute WITHOUT a data segment or
    // template is a pre-existing host path — skipped for the right reason
    const literalHomePlain = templatedHome.replace(
      'source: ${DATA_DIR:-~/genie}/database_backups',
      'source: /srv/preexisting/backups'
    );
    expect(validateComposeNonRoot(literalHomePlain).violations).toEqual([]);

    // a LITERAL home-rooted source with NO data segment is still
    // deployment-authored: whose home it lands in depends on who invokes
    // compose — no checkout can claim it pre-exists
    const literalHomeNoData = templatedHome.replace(
      'source: ${DATA_DIR:-~/genie}/database_backups',
      'source: ~/genie/database_backups'
    );
    const { violations: vHome } = validateComposeNonRoot(literalHomeNoData);
    expect(vHome.some((v) => v.includes('svc') && v.includes('deployment-authored'))).toBe(true);
  });

  test('pin: the secrets/ssl binds rely on the init convergence (INIT_BACKED)', () => {
    // The nginx bind no longer carries create_host_path: false: docker
    // creates a missing directory (root-owned, CREATE-time moment) and
    // secrets-ssl-init — which gates nginx's START — normalizes it to
    // root:101 before the edge ever mounts it. Pinned: the nginx bind
    // keeps NO opt-out key, the init's own mount keeps the explicit
    // opt-IN, and the exemption map names both services.
    const nginxAt = composeText.indexOf('target: /etc/nginx/ssl');
    expect(nginxAt).toBeGreaterThan(-1);
    const nginxBind = composeText.slice(nginxAt - 300, nginxAt + 200);
    expect(nginxBind).toContain('source: ./secrets/ssl');
    // the guarded bind opts IN explicitly: long syntax without the key
    // does NOT create a missing source (verified on compose v2.29.7) —
    // the container would fail to create before the init ever ran.
    expect(nginxBind).toContain('create_host_path: true');
    const initMount = composeText.indexOf('source: ./secrets/ssl');
    expect(initMount).toBeGreaterThan(-1);
    const initBlock = composeText.slice(initMount, initMount + 200);
    expect(initBlock).toContain('create_host_path: true');
    // the INIT_BACKED exemption covers both consumers — without it the
    // opt-in true would trip the data-dir rule demanding the false
    // opt-out (the rule predates the init-backed doctrine).
    expect(composeText).not.toContain('./secrets/ssl:/etc/nginx/ssl');
    expect(INIT_BACKED_BINDS.backend.reason).toContain('backend-init');
    expect(INIT_BACKED_BINDS.nginx.reason).toContain('secrets-ssl-init');
    // the exemption is per-bind at BOTH layers: a second host bind on an
    // init-backed service AND on an init itself still demands the opt-out
    // (service-level skips once let any future bind escape the rule — the
    // init-layer gap mutation-tested at 0 violations before this pin).
    const initSecondBind = composeText.replace(
      '        target: /fix-dumps\n',
      '        target: /fix-dumps\n      - type: bind\n        source: ${DATA_DIR:-./data}/rogue\n        target: /rogue\n        bind:\n          create_host_path: true\n'
    );
    expect(initSecondBind).not.toBe(composeText);
    expect(
      validateComposeNonRoot(initSecondBind).violations.some(
        (v) => v.includes('backend-init') && v.includes('create_host_path: false')
      )
    ).toBe(true);
    const secondBind = composeText.replace(
      'services:',
      [
        'services:',
        '  rogue:',
        '    user: "1000:1000"',
        '    volumes:',
        '      - type: bind',
        '        source: ./data/rogue',
        '        target: /rogue',
        ''
      ].join('\n')
    );
    expect(
      validateComposeNonRoot(secondBind).violations.some(
        (v) => v.includes('rogue') && v.includes('create_host_path: false')
      )
    ).toBe(true);
  });

  test('mutations: commented service-local cap items keep the defaults', () => {
    // The service-local cap-item matchers were the one spelling class
    // without trailing-comment tolerance — a DOCUMENTED cap item (the
    // anchor's own items carry those comments) false-red on the
    // CHOWN/cap_drop invariants with zero behavior change.
    const commentedCaps = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n    cap_add:\n      - CHOWN # the chown itself\n      - DAC_OVERRIDE # traversal\n'
    );
    expect(commentedCaps).not.toBe(composeText);
    expect(validateComposeNonRoot(commentedCaps).violations).toEqual([]);
  });

  test('mutations: flow-form cap lists on the base anchor keep the defaults', () => {
    // A formatter reformat of the anchor's cap lists to flow style must
    // not empty anchorDefaults — every merged init would false-red on
    // the CHOWN/cap_drop invariants with zero behavioral change.
    const flowCaps = composeText
      .replace('  cap_drop:\n    - ALL\n  cap_add:\n', '  cap_drop: [ALL]\n  cap_add: [CHOWN, DAC_OVERRIDE]\n')
      .replace(/    # CHOWN \(the chown itself\)[\s\S]*?- DAC_OVERRIDE\n/, '');
    expect(flowCaps).not.toBe(composeText);
    expect(validateComposeNonRoot(flowCaps).violations).toEqual([]);
  });

  test('mutations: base-anchor policy deletion and anchored service keys', () => {
    // DELETING the base anchor's whole restart_policy block left
    // condition/maxAttempts null and the per-service checks treated null
    // as safe — otel-collector-init would restart forever on swarm
    // (default condition "any") behind a green gate. The BASE anchor is
    // policed directly, same as the placement extension.
    const policyDeleted = composeText
      .replace(
        "    restart_policy:\n      # bounded self-heal (the one-shot rule's blessed form): a transient",
        '    # restart_policy deleted'
      )
      .replace(/      condition: on-failure\n      delay: 30s\n      max_attempts: 60\n\nservices:/, '\nservices:');
    expect(policyDeleted).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(policyDeleted);
    expect(v1.some((v) => v.includes('x-chown-init:') && v.includes('max_attempts bound'))).toBe(true);

    // a trailing YAML anchor on a service key (backend: &backend) is the
    // same spelling class as comments/flow bodies — without tolerance the
    // anchored service's body attributed to the PREVIOUS service
    // (innocent neighbor charged, backend skipped).
    const anchored = ['services:', '  frontend:', '    user: "101:101"', '  svc: &svc', '    user: root', ''].join(
      '\n'
    );
    const { violations: v2 } = validateComposeNonRoot(anchored);
    expect(v2.some((v) => v.includes('svc') && v.includes('is root'))).toBe(true);
  });

  test('mutations: a lone-genieai merge earns no base-anchor credit', () => {
    // \*chown-init is a PREFIX of \*chown-init-genieai: a merge spelling
    // that lists ONLY the extension inherits NOTHING from the base anchor
    // (no caps, no busybox image, no bounded restart) — crediting it via
    // the prefix would pass a root, uncapped, unbounded init.
    const lone = composeText.replaceAll('<<: [*chown-init-genieai, *chown-init]', '<<: [*chown-init-genieai]');
    expect(lone).not.toBe(composeText);
    const { violations } = validateComposeNonRoot(lone);
    expect(violations.some((v) => v.includes('cap_drop: [ALL]'))).toBe(true);
    expect(violations.some((v) => v.includes('CHOWN'))).toBe(true);
  });

  test('mutations: the placement anchor carries the same one-shot policy', () => {
    // The sequence merge gives x-chown-init-genieai's deploy: WHOLE to the
    // four constrained inits — a drift in the extension anchor's own
    // policy (condition flip, bound stripped, mode dropped) turns them
    // into unbounded root restart loops while the OUTER anchor's copy
    // still looks pristine. The extension anchor is policed directly.
    const conditionFlip = composeText.replace(
      '        - node.labels.genieai == true\n    restart_policy:\n      condition: on-failure',
      '        - node.labels.genieai == true\n    restart_policy:\n      condition: any'
    );
    expect(conditionFlip).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(conditionFlip);
    expect(v1.some((v) => v.includes('x-chown-init-genieai') && v.includes('condition: on-failure'))).toBe(true);

    const attemptsStripped = composeText.replace(
      '        - node.labels.genieai == true\n    restart_policy:\n      condition: on-failure\n      delay: 30s\n      max_attempts: 60',
      '        - node.labels.genieai == true\n    restart_policy:\n      condition: on-failure\n      delay: 30s'
    );
    expect(attemptsStripped).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(attemptsStripped);
    expect(v2.some((v) => v.includes('x-chown-init-genieai') && v.includes('max_attempts bound'))).toBe(true);

    // PIN the merge ORDER: YAML sequence merges give EARLIER maps
    // precedence — [*chown-init, *chown-init-genieai] would silently
    // discard the placement (the outer anchor's deploy wins whole) while
    // looking symmetrical.
    // 4 service merges (+1 mention in the extension anchor's comment)
    expect((composeText.match(/<<: \[\*chown-init-genieai, \*chown-init\]/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(composeText).not.toContain('<<: [*chown-init,');

    const modeFlip = composeText.replace(
      'x-chown-init-genieai: &chown-init-genieai\n  deploy:\n    mode: global',
      'x-chown-init-genieai: &chown-init-genieai\n  deploy:\n    mode: replicated'
    );
    expect(modeFlip).not.toBe(composeText);
    const { violations: v3 } = validateComposeNonRoot(modeFlip);
    expect(v3.some((v) => v.includes('x-chown-init-genieai') && v.includes('mode: global'))).toBe(true);

    // DELETING the mode line leaves all three policy fields null — the
    // invariants key on the anchor DECL, not on field presence
    const modeDeleted = composeText.replace(
      'x-chown-init-genieai: &chown-init-genieai\n  deploy:\n    mode: global\n    placement:',
      'x-chown-init-genieai: &chown-init-genieai\n  deploy:\n    placement:'
    );
    expect(modeDeleted).not.toBe(composeText);
    const { violations: v4 } = validateComposeNonRoot(modeDeleted);
    expect(v4.some((v) => v.includes('x-chown-init-genieai') && v.includes('mode: global'))).toBe(true);
  });

  test('mutations: compliant flow-form deploy and user pins are not over-enforced', () => {
    // A flow-form deploy: on a chown-init sets localDeploySeen — without
    // parsing its body a fully COMPLIANT spelling (exactly the required
    // doctrine) was judged absent and tripped two violations. Same for a
    // flow-map service body's user: pin ('no user: declared').
    const flowDeploy = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n    deploy: {mode: global, restart_policy: {condition: on-failure, delay: 30s, max_attempts: 60}}\n'
    );
    expect(flowDeploy).not.toBe(composeText);
    expect(validateComposeNonRoot(flowDeploy).violations).toEqual([]);

    const flowUser = ['services:', '  svc: {user: "1000:1000"}', ''].join('\n');
    expect(validateComposeNonRoot(flowUser).violations).toEqual([]);

    // QUOTED root pins in a flow body must still trip: the capture strips
    // a matching quote pair — {user: "root"} once captured `root"` (closing
    // quote kept) and BOTH root tests failed open. Number spellings too.
    const quotedRoot = validateComposeNonRoot(['services:', '  kong: {user: "root"}', ''].join('\n'));
    expect(quotedRoot.violations.some((v) => v.includes('kong') && v.includes('is root'))).toBe(true);
    const quotedZero = validateComposeNonRoot(['services:', '  kong: {user: "0"}', ''].join('\n'));
    expect(quotedZero.violations.some((v) => v.includes('kong') && v.includes('is root'))).toBe(true);

    // an UNRESOLVABLE YAML alias fails loud (conservative resolution): a
    // line parser cannot know *admin resolves to root — reading the alias
    // name as a literal uid is fail-open.
    const aliasUser = validateComposeNonRoot(['services:', '  kong: {user: *admin}', ''].join('\n'));
    expect(aliasUser.violations.some((v) => v.includes('kong') && v.includes('YAML alias or anchor'))).toBe(true);

    // a WHOLE-LIST volumes alias drops every bind from enforcement (neither
    // the block collector nor the flow collectors match) — demand it inline.
    const aliasVolumes = validateComposeNonRoot(
      ['services:', '  svc:', '    user: "1000:1000"', '    volumes: *binds', ''].join('\n')
    );
    expect(aliasVolumes.violations.some((v) => v.includes('svc') && v.includes('volumes: is a YAML alias'))).toBe(true);

    // a trailing COMMENT on a bare pin rode along once (`root # gw` was
    // neither 'root' nor numeric — fail-open). The capture truncates at
    // '#'; a quoted value keeps its own '#'.
    const commentedRoot = validateComposeNonRoot(['services:', '  kong: {user: root # gw}', ''].join('\n'));
    expect(commentedRoot.violations.some((v) => v.includes('kong') && v.includes('is root'))).toBe(true);
    const commentedZero = validateComposeNonRoot(['services:', '  kong: {user: 0 # gw}', ''].join('\n'));
    expect(commentedZero.violations.some((v) => v.includes('kong') && v.includes('is root'))).toBe(true);

    // the BLOCK form fails open the same way for an alias — same rule.
    const blockAlias = validateComposeNonRoot(['services:', '  kong:', '    user: *admin', ''].join('\n'));
    expect(blockAlias.violations.some((v) => v.includes('kong') && v.includes('YAML alias or anchor'))).toBe(true);

    // an INLINE ANCHOR on the pin (user: &a root — legal YAML a real
    // parser resolves) is unresolvable for a line parser: captured `&a`
    // (block) or `&a root` (flow) matched neither root test once. Same
    // conservative rule as the *alias spelling.
    const blockAnchor = validateComposeNonRoot(['services:', '  kong:', '    user: &a root', ''].join('\n'));
    expect(blockAnchor.violations.some((v) => v.includes('kong') && v.includes('YAML alias or anchor'))).toBe(true);
    const flowAnchor = validateComposeNonRoot(['services:', '  kong: {user: &a root}', ''].join('\n'));
    expect(flowAnchor.violations.some((v) => v.includes('kong') && v.includes('YAML alias or anchor'))).toBe(true);

    // an anchored service key WITH a flow body (svc: &b {user: root} —
    // legal YAML, natural dedup spelling) once matched neither
    // serviceMatch alternation: no user: check, no binds, no alwaysOn
    // entry — the whole service was invisible.
    const anchoredFlow = validateComposeNonRoot(['services:', '  svc: &b {user: root}', ''].join('\n'));
    expect(anchoredFlow.violations.some((v) => v.includes('svc') && v.includes('is root'))).toBe(true);

    // the YAML-boolean spelling of the opt-out is legal compose-go and
    // must be recognized (a false-red once prescribed a fix the file
    // already had); an ALIASED bind options map is unresolvable — the
    // dedicated alias diagnostic, not the missing-opt-out one.
    const capitalFalse = validateComposeNonRoot(
      [
        'services:',
        '  svc:',
        '    user: "1000:1000"',
        '    volumes:',
        '      - type: bind',
        '        source: ./data',
        '        target: /data',
        '        bind:',
        '          create_host_path: False',
        ''
      ].join('\n')
    );
    expect(capitalFalse.violations.some((v) => v.includes('without `create_host_path: false`'))).toBe(false);
    // the YAML 1.1 all-caps boolean (FALSE) resolves to false in
    // compose-go — the recognizer is case-complete, not [Ff]-only.
    const capsFalse = validateComposeNonRoot(
      [
        'services:',
        '  svc:',
        '    user: "1000:1000"',
        '    volumes:',
        '      - type: bind',
        '        source: ./data',
        '        target: /data',
        '        bind:',
        '          create_host_path: FALSE',
        ''
      ].join('\n')
    );
    expect(capsFalse.violations.some((v) => v.includes('without `create_host_path: false`'))).toBe(false);

    // a quoted value containing braces must not push the real pin to
    // depth!=0 (the counter once counted braces inside quoted spans):
    // the service failed "no user: declared" — loud, but prescribing an
    // impossible fix for a present pin.
    const quotedBraces = validateComposeNonRoot(
      ['services:', '  backend: {command: "run {a} stage", user: "1000:1000"}', ''].join('\n')
    );
    expect(quotedBraces.violations.some((v) => v.includes('no `user:` declared'))).toBe(false);
    expect(quotedBraces.violations.some((v) => v.includes('is root'))).toBe(false);

    const aliasBind = validateComposeNonRoot(
      [
        'services:',
        '  svc:',
        '    user: "1000:1000"',
        '    volumes:',
        '      - type: bind',
        '        source: ./data',
        '        target: /data',
        '        bind: *opts',
        ''
      ].join('\n')
    );
    expect(
      aliasBind.violations.some((v) => v.includes('svc') && v.includes('bind: options are an unresolvable YAML alias'))
    ).toBe(true);

    // a nested flow-map key named user: (an environment USER var) is NOT
    // the service pin — the depth-aware capture must not raise a false
    // "is root" on a legal spelling.
    const envUserKey = validateComposeNonRoot(['services:', '  kong: {environment: {user: root}}', ''].join('\n'));
    expect(envUserKey.violations.some((v) => v.includes('is root'))).toBe(false);

    // a volumes: key inside a flow body is unreachable by every bind
    // collector (normal OR aliased) — demand the block form.
    const bodyVolumes = validateComposeNonRoot(['services:', '  kong: {user: "1001", volumes: *binds}', ''].join('\n'));
    expect(bodyVolumes.violations.some((v) => v.includes('kong') && v.includes('flow-map body is unenforceable'))).toBe(
      true
    );

    // a whole-entry alias inside a flow volumes LIST drops that bind from
    // every collector — demand it inline.
    const flowListAlias = validateComposeNonRoot(
      ['services:', '  svc:', '    user: "1000:1000"', '    volumes: ["./data:/data", *binds]', ''].join('\n')
    );
    expect(flowListAlias.violations.some((v) => v.includes('svc') && v.includes('YAML alias or anchor'))).toBe(true);

    // the flow deploy is still a SHALLOW replace: dropping mode from it
    // must trip, exactly like the block form
    const flowModeDrop = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n    deploy: {restart_policy: {condition: on-failure, max_attempts: 60}}\n'
    );
    const { violations: v1 } = validateComposeNonRoot(flowModeDrop);
    expect(v1.some((v) => v.includes('otel-collector-init') && v.includes('mode: global'))).toBe(true);
  });

  test('mutations: a reflowed multi-line flow-sequence volumes list stays enforced', () => {
    // A formatter is enough to reflow a flow-sequence volumes list across
    // lines — legal YAML whose single-line regex match would drop every
    // bind in it from enforcement.
    const wrapped = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes: [',
      '      "${DATA_DIR:-./data}/logs/kong:/var/log/kong"',
      '    ]',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(wrapped);
    expect(v1.some((v) => v.includes('kong') && v.includes('templated but in short syntax'))).toBe(true);

    const wrappedOpted = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes: [',
      '      {type: bind, source: ./data/database_backups, target: /app/database_backups, bind: {create_host_path: false}}',
      '    ]',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(wrappedOpted).violations).toEqual([]);

    // a ']' INSIDE a quoted path must not close the reflow accumulation —
    // it once truncated at the quoted bracket and dropped every later
    // bind from enforcement; and the bracket counter ignores quoted
    // spans entirely.
    const quotedBracket = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes: [',
      '      "data[a]/x:/x",',
      '      "${DATA_DIR:-./data}/y:/y"',
      '    ]',
      ''
    ].join('\n');
    const { violations: vq } = validateComposeNonRoot(quotedBracket);
    expect(vq.some((v) => v.includes('kong') && v.includes('templated but in short syntax'))).toBe(true);

    // a backslash-escaped quote inside a span does not close it (the
    // splitFlowItems tracker once desynced and split the entry mid-path).
    const escapedQuote = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes: ["${DATA_DIR:-./data}/logs:/var/log", "/mnt/a\"b/x:/x"]',
      ''
    ].join('\n');
    const { violations: ve } = validateComposeNonRoot(escapedQuote);
    expect(ve.some((v) => v.includes('kong') && v.includes('templated but in short syntax'))).toBe(true);
  });

  test('mutations: templated relative defaults and quoted sources with spaces', () => {
    // A templated source whose default is RELATIVE outside the data dir
    // (${BACKUP_DIR:-./backups}/dumps) is deployment-authored exactly like
    // its absolute sibling — docker still creates the missing source
    // root-owned wherever the variable lands. The default's ./ spelling
    // must not defeat the opt-out demand.
    const templatedRelative = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ${BACKUP_DIR:-./backups}/dumps',
      '        target: /app/dumps',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(templatedRelative);
    expect(v1.some((v) => v.includes('svc') && v.includes('deployment-authored'))).toBe(true);

    const templatedRelativeOpted = templatedRelative.replace(
      '        target: /app/dumps',
      '        target: /app/dumps\n        bind: {create_host_path: false}'
    );
    expect(validateComposeNonRoot(templatedRelativeOpted).violations).toEqual([]);

    // A QUOTED source containing a space is legal YAML/compose — the
    // capture must not stop at the space, or the bind silently skips the
    // rule (a bare \S+ matcher drops the entry entirely).
    const quotedSpace = templatedRelative.replace(
      'source: ${BACKUP_DIR:-./backups}/dumps',
      'source: "./data/my backups/dumps"'
    );
    const { violations: v2 } = validateComposeNonRoot(quotedSpace);
    expect(v2.some((v) => v.includes('svc') && v.includes('sits under the data directory'))).toBe(true);

    const dashQuotedSpace = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - source: "./data/other backups"',
      '        target: /app/x',
      '        type: bind',
      ''
    ].join('\n');
    const { violations: v3 } = validateComposeNonRoot(dashQuotedSpace);
    expect(v3.some((v) => v.includes('svc') && v.includes('sits under the data directory'))).toBe(true);

    const quotedSpaceOpted = quotedSpace.replace(
      '        target: /app/dumps',
      '        target: /app/dumps\n        bind: {create_host_path: false}'
    );
    expect(validateComposeNonRoot(quotedSpaceOpted).violations).toEqual([]);
  });

  test('mutations: cap_drop [ALL] is pinned on one-shot members; stray brace cannot merge flow items', () => {
    // A service-local cap_drop: [] shallow-replaces the anchor's [ALL]
    // (same YAML merge rule the gate models for cap_add) — the init would
    // run with full root caps while the cap_add invariant stayed green.
    const droppedAll = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n    cap_drop: []\n'
    );
    expect(droppedAll).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(droppedAll);
    expect(v1.some((v) => v.includes('otel-collector-init') && v.includes('cap_drop: [ALL]'))).toBe(true);

    // restating the anchor's drop explicitly stays clean
    const restatedAll = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n    cap_drop: [ALL]\n'
    );
    expect(validateComposeNonRoot(restatedAll).violations).toEqual([]);

    // restating BOTH caps in block form (certbot's spelling): the lists
    // must not eat each other's items — entering cap_add clears
    // inCapDrops and vice versa
    const bothBlocks = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n    cap_drop:\n      - ALL\n    cap_add:\n      - CHOWN\n      - DAC_OVERRIDE\n'
    );
    expect(bothBlocks).not.toBe(composeText);
    expect(validateComposeNonRoot(bothBlocks).violations).toEqual([]);

    // a stray unmatched '}' in a flow list must not drive the splitter's
    // depth negative — negative depth stops top-level commas from
    // splitting and silently MERGES distinct entries (under-enforcement)
    const merged = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes: [{type: bind, source: ./data/x, target: /x}}, "${DATA_DIR:-./data}/y:/y"]',
      ''
    ].join('\n');
    const { violations: v2 } = validateComposeNonRoot(merged);
    expect(v2.some((v) => v.includes('kong'))).toBe(true);
  });

  test('mutations: templated short-syntax binds demand the long form', () => {
    // A templated host part in SHORT syntax (${CONFIG_DIR:-./x}:/t:ro)
    // escapes the data-dir rule's dataShaped-only gate — yet a compliant
    // spelling EXISTS (long syntax + create_host_path: false), so unlike
    // a literal absolute path the impossible-fix concern does not apply.
    // The short form would let docker silently root-create a missing
    // operator-override source.
    const shortTemplated = [
      'services:',
      '  frontend:',
      '    user: "101:101"',
      '    volumes:',
      '      - "${CONFIG_DIR_FRONTEND:-./x}:/app/dist/config:ro"',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(shortTemplated);
    expect(v1.some((v) => v.includes('frontend') && v.includes('templated but in short syntax'))).toBe(true);

    // a LITERAL absolute short bind stays out — no compliant short
    // spelling exists there, so flagging would prescribe the impossible
    const literalShort = shortTemplated.replace(
      '"${CONFIG_DIR_FRONTEND:-./x}:/app/dist/config:ro"',
      '"/etc/localtime:/etc/localtime:ro"'
    );
    expect(validateComposeNonRoot(literalShort).violations).toEqual([]);
  });

  test('mutations: block-scalar sources and parent-escape data segments', () => {
    // A folded/literal block-scalar source (`source: >-`, value on the
    // NEXT line) is unreachable for a line parser — the conservative
    // unknown-location doctrine resolves it to the data dir so the bind
    // still demands the opt-out instead of silently skipping the rule.
    const blockScalar = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: >-',
      '          ./data/database_backups',
      '        target: /app/database_backups',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(blockScalar);
    expect(v1.some((v) => v.includes('svc') && v.includes('create_host_path'))).toBe(true);

    const blockScalarOpted = blockScalar.replace(
      '        target: /app/database_backups',
      '        target: /app/database_backups\n        bind: {create_host_path: false}'
    );
    expect(validateComposeNonRoot(blockScalarOpted).violations).toEqual([]);

    // a relative PARENT-ESCAPE with a /data/ segment is data-shaped —
    // compose still root-creates the missing source (relative to the
    // project dir's parent), so the long-syntax form demands the opt-out
    // exactly like its short-syntax sibling
    const parentEscape = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes:',
      '      - type: bind',
      '        source: ../shared/data/backups',
      '        target: /app/backups',
      ''
    ].join('\n');
    const { violations: v2 } = validateComposeNonRoot(parentEscape);
    expect(v2.some((v) => v.includes('svc') && v.includes('sits under the data directory'))).toBe(true);

    // a relative path WITHOUT a data segment and without a template stays
    // out (pre-existing host-relative path, same doctrine as absolute)
    const parentPlain = parentEscape.replace('../shared/data/backups', '../shared/backups');
    expect(validateComposeNonRoot(parentPlain).violations).toEqual([]);
  });

  test('mutations: untyped long-syntax entries are claimed, not dropped', () => {
    // Current compose-go rejects an untyped long-syntax entry outright,
    // but older builds within the documented floor infer the mount type
    // from the source shape — dropping the deferred source would be
    // fail-open. It is claimed as a bind (conservatively) at every place
    // the entry ends: a new entry, the block closing, or end of file.
    const untypedEof = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - source: ${DATA_DIR:-./data}/logs/kong',
      '        target: /var/log/kong',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(untypedEof);
    expect(v1.some((v) => v.includes('kong') && v.includes('create_host_path'))).toBe(true);

    const untypedFollowed = untypedEof
      .replace(
        '        target: /var/log/kong',
        '        target: /var/log/kong\n      - type: bind\n        source: ./data/other\n        target: /other\n        bind: {create_host_path: false}'
      )
      .replace('      - source: ${DATA_DIR:-./data}/logs/kong', '      - source: ./data/logs/kong');
    const { violations: v2 } = validateComposeNonRoot(untypedFollowed);
    expect(v2.some((v) => v.includes('kong') && v.includes('create_host_path'))).toBe(true);

    // a NAMED volume reference (no path shape) and an explicit type:
    // volume stay out
    const namedVolume = untypedEof.replace('source: ${DATA_DIR:-./data}/logs/kong', 'source: kong_logs');
    expect(validateComposeNonRoot(namedVolume).violations).toEqual([]);

    const explicitVolume = untypedEof.replace('      - source:', '      - type: volume\n        source:');
    expect(validateComposeNonRoot(explicitVolume).violations).toEqual([]);
  });

  test('mutations: a 6-space mode: after the deploy block is not deploy state', () => {
    // The deploy block's open state must not outlive its indentation: a
    // later 6-space mode:/restart_policy: under a DIFFERENT parent key
    // (labels: here) would be credited to the service's deploy invariants
    // and overwrite the real mode. Injected into otel-collector-init (an
    // allowlisted one-shot judged on the anchor) with a local deploy of
    // its own, so the invariant check actually judges the hijack.
    const hijacked = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n' +
        '    deploy:\n' +
        '      mode: global\n' +
        '      restart_policy:\n' +
        '        condition: on-failure\n' +
        '        delay: 30s\n' +
        '        max_attempts: 60\n' +
        '    labels:\n' +
        '      mode: replicated\n'
    );
    expect(hijacked).not.toBe(composeText);
    expect(validateComposeNonRoot(hijacked).violations).toEqual([]);
  });

  test('mutations: a service key with a trailing comment is still a service', () => {
    // Every other spelling class tolerates trailing comments; a bare-key
    // -only service detector silently exempted `  kong: # gateway` from
    // EVERY check (fail-open: its user: root and data binds vanished).
    const commented = ['services:', '  kong: # the gateway', '    user: root', ''].join('\n');
    const { violations: v1 } = validateComposeNonRoot(commented);
    expect(v1.some((v) => v.includes('kong') && v.includes('is root'))).toBe(true);

    // a flow-map service body starts a service too — recognized (both
    // service notions see it); parsing its INNER keys is YAML semantics a
    // line parser cannot reach (extracted finding #1274)
    const flowBody = ['services:', '  kong: {user: root}', ''].join('\n');
    expect(collectServiceNames(flowBody).has('kong')).toBe(true);
  });

  test("the runtime gate's exemption shapes match the compose healthchecks", () => {
    // The self-dropping filter's regexes hardcode the pg_isready / redis
    // healthcheck ARGV spellings — if a healthcheck is reformatted (a
    // CMD-SHELL switch, a requote), the regex stops matching the
    // sub-second execs and every converged run reports a phantom
    // 'ROOT PROCESS in ...-postgres'. Pin the coupling: the compose
    // healthcheck tokens must exist in BOTH sides.
    const compose = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docker-compose.yaml'), 'utf-8');
    const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'compose-non-root', 'check-runtime.sh'), 'utf-8');
    expect(compose).toMatch(/test:\s*\["CMD",\s*"pg_isready"/);
    expect(compose).toMatch(/test:\s*\["CMD",\s*"sh",\s*"-c",\s*"test[^\n]*redis-cli ping/);
    for (const token of ['pg_isready', '/bin/sh', 'redis-cli']) {
      expect(shell).toContain(token);
    }
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
      '  svc:',
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
    expect(v2.some((v) => v.includes('svc') && v.includes('create_host_path: false'))).toBe(true);

    // An EXPLICIT cap_add: [] replaces the anchor's list (YAML merge
    // semantics) — the CHOWN invariant must trip, not inherit.
    const emptyCaps = composeText.replace(
      '    <<: [*chown-init-genieai, *chown-init]\n',
      '    <<: [*chown-init-genieai, *chown-init]\n    cap_add: []\n'
    );
    expect(emptyCaps).not.toBe(composeText);
    const { violations: v3 } = validateComposeNonRoot(emptyCaps);
    expect(v3.some((v) => v.includes('backend-init') && v.includes('CHOWN'))).toBe(true);
  });

  test('mutations: commented invariant keys, flow volume entries', () => {
    // A commented restart line must not fall back to the anchor's bounded
    // values — 'restart: always # self-heal' on a chown-init is a
    // permanent root container.
    const commentedRestart = composeText.replaceAll('restart: "on-failure:60"', 'restart: always # self-heal');
    expect(commentedRestart).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(commentedRestart);
    expect(v1.some((v) => v.includes('victorialogs-init') && v.includes('one-shot'))).toBe(true);

    // A commented volumes: key must not disable bind collection — the
    // data-dir bind behind it stays enforced.
    const commentedVolumes = composeText.replace(
      '    volumes:\n      # create_host_path: true EXPLICIT (#1227)',
      '    volumes: # gateway logs\n      # create_host_path: true EXPLICIT (#1227)'
    );
    expect(commentedVolumes).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(commentedVolumes);
    expect(v2.filter((v) => v.includes('create_host_path: false'))).toEqual([]);

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
      '    <<: [*chown-init-genieai, *chown-init]\n',
      '    <<: [*chown-init-genieai, *chown-init]\n    restart: always # self-heal\n'
    );
    expect(localCommented).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(localCommented);
    expect(v1.some((v) => v.includes('backend-init') && v.includes('one-shot'))).toBe(true);

    // A templated user pin could resolve to root — resolved conservatively
    // to root (the identity pin must be literal).
    const templated = ['services:', '  svc:', '    user: "${BACKEND_UID:-0}"', ''].join('\n');
    const { violations: v2 } = validateComposeNonRoot(templated);
    expect(v2.some((v) => v.includes('svc') && v.includes('is root'))).toBe(true);

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
      '  svc:',
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
      '  svc:',
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
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '  otel-collector-init:\n    <<: *chown-init\n    deploy: {mode: replicated}\n'
    );
    expect(flowDeploy).not.toBe(composeText);
    const { violations: v2 } = validateComposeNonRoot(flowDeploy);
    expect(v2.some((v) => v.includes('otel-collector-init') && v.includes('one-shot'))).toBe(true);
    expect(v2.some((v) => v.includes('otel-collector-init') && v.includes('mode: global'))).toBe(true);

    // A local deploy restating the bounded policy but DROPPING
    // mode: global strands the per-node chown guarantee — must trip.
    const modeDrop = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '  otel-collector-init:\n    <<: *chown-init\n    deploy:\n      restart_policy:\n        condition: on-failure\n        max_attempts: 3\n'
    );
    const { violations: v3 } = validateComposeNonRoot(modeDrop);
    expect(v3.some((v) => v.includes('otel-collector-init') && v.includes('mode: global'))).toBe(true);

    // An allowlisted one-shot may pin user: root EXPLICITLY — the doctrine
    // is "root ON PURPOSE"; the blanket root check must not fire on it.
    const explicitRootInit = composeText.replace(
      '    # so the chown has run on every node the collector can land on).\n    <<: *chown-init\n',
      '  otel-collector-init:\n    <<: *chown-init\n    user: root\n'
    );
    const { violations: v4 } = validateComposeNonRoot(explicitRootInit);
    expect(v4.filter((v) => v.includes('otel-collector-init') && v.includes('is root'))).toEqual([]);

    // ...while the same pin on a REGULAR service still trips.
    const explicitRootSvc = ['services:', '  svc:', '    user: root', ''].join('\n');
    const { violations: v5 } = validateComposeNonRoot(explicitRootSvc);
    expect(v5.some((v) => v.includes('svc') && v.includes('is root'))).toBe(true);
  });

  test('mutations: anchor mode flip and re-indented bind cannot slip past the gate', () => {
    // The anchor's OWN mode: global is parsed, not hardcoded — flipping it
    // trips every merged init (the per-node chown guarantee is doctrine).
    const modeFlip = composeText.replaceAll('    mode: global', '    mode: replicated');
    expect(modeFlip).not.toBe(composeText);
    const { violations: v1 } = validateComposeNonRoot(modeFlip);
    // anchor + the four placement-constrained local deploys — every
    // one-shot init must trip
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

  test('mutation: a YAML-aliased source resolves conservatively to the data dir', () => {
    // source: *data_dir (a YAML alias) is unresolvable by a line parser —
    // resolved CONSERVATIVELY like every unknown-location spelling.
    const aliased = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - type: bind',
      '        source: *data_dir',
      '        target: /var/log/kong',
      ''
    ].join('\n');
    const { violations } = validateComposeNonRoot(aliased);
    expect(violations.some((v) => v.includes('kong') && v.includes('create_host_path: false'))).toBe(true);
  });

  test('mutations: flow-list volumes, quoted service keys, deeper short binds', () => {
    // volumes: as a FLOW LIST — each entry carries the same contract.
    const flowList = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes: ["${DATA_DIR:-./data}/logs/kong:/var/log/kong"]',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(flowList);
    expect(v1.some((v) => v.includes('kong') && v.includes('short syntax'))).toBe(true);

    const flowListOpted = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes: [{type: bind, source: ./data/database_backups, target: /app/database_backups, bind: {create_host_path: false}}]',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(flowListOpted).violations).toEqual([]);

    // A QUOTED service key starts its own block — the quoted service's
    // user: root must be checked against ITSELF, not charged to the
    // previous service.
    const quoted = ['services:', '  svc:', '    user: "1000:1000"', '  "kong":', '    user: root', ''].join('\n');
    const { violations: v2 } = validateComposeNonRoot(quoted);
    expect(v2.some((v) => v.includes('kong') && v.includes('is root'))).toBe(true);
    expect(v2.filter((v) => v.includes('svc') && v.includes('is root'))).toEqual([]);

    // A deeper-indented SHORT bind is still collected.
    const deepShort = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '        - "${DATA_DIR:-./data}/x:/y"',
      ''
    ].join('\n');
    const { violations: v3 } = validateComposeNonRoot(deepShort);
    expect(v3.some((v) => v.includes('kong') && v.includes('short syntax'))).toBe(true);
  });

  test('mutations: templated bind source in flow map forms (both spellings)', () => {
    // A templated source (${DATA_DIR:-./data}/...) inside a flow MAP must
    // reach the data-dir rule: the closing brace of ${VAR:-default} is not
    // the end of the entry — a source match that stops at `}` (or a
    // splitter that cuts items at the first `}`) truncates the path and
    // the bind escapes the gate with zero violations while the identical
    // block-style bind is flagged.
    const flowListMap = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes: [{type: bind, source: ${DATA_DIR:-./data}/logs/kong, target: /var/log/kong}]',
      ''
    ].join('\n');
    const { violations: v1 } = validateComposeNonRoot(flowListMap);
    expect(v1.some((v) => v.includes('kong') && v.includes('create_host_path'))).toBe(true);

    // the compliant spelling — opt-out carried inline — stays clean
    const flowListOpted = [
      'services:',
      '  svc:',
      '    user: "1000:1000"',
      '    volumes: [{type: bind, source: ${DATA_DIR:-./data}/database_backups, target: /app/database_backups, bind: {create_host_path: false}}]',
      ''
    ].join('\n');
    expect(validateComposeNonRoot(flowListOpted).violations).toEqual([]);

    // same truncation in the block-form flow entry (- {type: bind, ...})
    const flowEntryMap = [
      'services:',
      '  kong:',
      '    user: "1001:1001"',
      '    volumes:',
      '      - {type: bind, source: ${DATA_DIR:-./data}/logs/other, target: /var/log/other}',
      ''
    ].join('\n');
    const { violations: v2 } = validateComposeNonRoot(flowEntryMap);
    expect(v2.some((v) => v.includes('kong') && v.includes('create_host_path'))).toBe(true);

    const flowEntryOpted = flowEntryMap.replace(
      'target: /var/log/other}',
      'target: /var/log/other, bind: {create_host_path: false}}'
    );
    expect(validateComposeNonRoot(flowEntryOpted).violations).toEqual([]);
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
