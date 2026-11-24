// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// #2061 phase 1b — the ROUTE KNOB parity pin.
//
// The Lab's ONE loader (components/okf-server/services/route-knobs.js)
// mirrors the retriever's authority (genie-ai-overlay/retriever/config.py),
// and the deployment must DELIVER the knobs to both containers. Each of
// those facts can drift silently, and the drift shows up as a Lab that
// disagrees with production while both report green.
//
// The gate asserts the real repository agrees, and — because a pin that
// never fails is worse than no pin — it proves the check CATCHES each
// drift it claims to catch, using the repository's own files as the
// starting point.

const fs = require('fs');
const path = require('path');
const { withTree } = require('../validators/temp-tree');
const {
  validateRouteKnobParity,
  ROUTE_KNOBS_FILE,
  RETRIEVER_CONFIG_FILE,
  COMPOSE_FILE,
  CHART_OKF_SERVER_FILE,
  CHART_RETRIEVER_FILE,
  CHART_VALUES_FILE
} = require('../validators/validate-route-knob-parity');

const ROOT = path.resolve(__dirname, '../../..');

/** The files the pin reads, copied verbatim from the repository. */
function repoFiles() {
  const files = {};
  for (const rel of [
    ROUTE_KNOBS_FILE,
    RETRIEVER_CONFIG_FILE,
    COMPOSE_FILE,
    CHART_OKF_SERVER_FILE,
    CHART_RETRIEVER_FILE,
    CHART_VALUES_FILE
  ]) {
    files[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  }
  return files;
}

/**
 * Drop a line from the compose okf-server block only.
 *
 * The retriever's block carries the same knob row, so a global removal
 * would prove the wrong leg — the pin would report a missing retriever
 * delivery instead of the missing Lab delivery this case is about.
 *
 * @param {string} compose - The docker-compose.yaml content
 * @param {string} line - The row to drop
 * @returns {string} The compose content without that row in the okf-server block
 */
function dropFromOkfServerBlock(compose, line) {
  const start = compose.indexOf('  okf-server:');
  const end = compose.indexOf('  pii-service:');
  if (start < 0 || end < 0 || end <= start) throw new Error('the okf-server compose block was not found');
  const head = compose.slice(0, start);
  const block = compose.slice(start, end);
  const tail = compose.slice(end);
  const next = block
    .split('\n')
    .filter((l) => !l.includes(line))
    .join('\n');
  if (next === block) throw new Error(`the row "${line}" is not in the okf-server compose block`);
  return head + next + tail;
}

describe("#2061 — the Lab's route knobs and the retriever's authority do not drift", () => {
  let result;

  beforeAll(() => {
    result = validateRouteKnobParity(ROOT);
  });

  test('the three sides agree', () => {
    expect(result.errors).toEqual([]);
  });

  test('the pin actually checked something (a vacuous pass would be a lie)', () => {
    // Every knob the Lab scores under, with the env name and the value the
    // two sides share.
    expect(result.checked).toContain('ROUTE_HEAD_FLOOR: RETRIEVER_ROUTE_HEAD_FLOOR = 0.55');
    expect(result.checked).toContain('ROUTE_FORBIDDEN_TAG_MAX: RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX = 0.55');
    expect(result.checked).toContain('ROUTE_HEAD_MARGIN: RETRIEVER_ROUTE_HEAD_MARGIN = 0.01');
    expect(result.checked).toContain('ROUTE_TOP_K: RETRIEVER_ROUTE_TOP_K = 40');
    expect(result.checked).toContain('ROUTE_MIN_CHUNKS: RETRIEVER_ROUTE_MIN_CHUNKS = 3');
    expect(result.checked).toContain('ROUTE_PROBE_TIMEOUT_MS: RETRIEVER_ROUTE_PROBE_TIMEOUT_MS = 2000');
    expect(result.checked).toContain('ROUTE_RETRY: RETRIEVER_ROUTE_RETRY = 1');
    // The knobs that change the routing OUTCOME — the Lab must model
    // them, or it certifies a gated verdict for a deployment that does
    // not gate.
    expect(result.checked).toContain('ROUTE_ENABLED: RETRIEVER_ROUTE_ENABLED = true');
    expect(result.checked).toContain('ROUTE_HEADS_SUPERSEDE: RETRIEVER_ROUTE_HEADS_SUPERSEDE = true');
    expect(result.checked).toContain('ROUTE_HEAD_WEIGHT: RETRIEVER_ROUTE_HEAD_WEIGHT = 1.0');
    // The DELIVERY legs, not only the value comparison.
    expect(result.checked.some((c) => c.includes('compose delivery'))).toBe(true);
    expect(result.checked.some((c) => c.includes('helm delivery'))).toBe(true);
  });

  describe('the check on a fixture', () => {
    test('a default that drifts from the retriever is caught', () => {
      const files = repoFiles();
      files[ROUTE_KNOBS_FILE] = files[ROUTE_KNOBS_FILE].replace('ROUTE_HEAD_FLOOR: 0.55', 'ROUTE_HEAD_FLOOR: 0.60');
      withTree('route-knob-drift-', files, (root) => {
        const { errors } = validateRouteKnobParity(root);
        expect(errors.some((e) => e.includes('ROUTE_HEAD_FLOOR') && e.includes('0.6'))).toBe(true);
      });
    });

    test('a knob the Lab does not model is caught (a subset test would pass)', () => {
      const files = repoFiles();
      files[ROUTE_KNOBS_FILE] = files[ROUTE_KNOBS_FILE].replace('  ROUTE_HEADS_SUPERSEDE: true\n', '')
        .replace("  ROUTE_HEADS_SUPERSEDE: 'RETRIEVER_ROUTE_HEADS_SUPERSEDE',\n", '')
        .replace("  ROUTE_HEADS_SUPERSEDE: 'boolean',\n", '');
      withTree('route-knob-unmodelled-', files, (root) => {
        const { errors } = validateRouteKnobParity(root);
        expect(errors.some((e) => e.includes('ROUTE_HEADS_SUPERSEDE'))).toBe(true);
      });
    });

    test("a knob that never reaches the Lab's container is caught", () => {
      const files = repoFiles();
      files[COMPOSE_FILE] = dropFromOkfServerBlock(files[COMPOSE_FILE], 'RETRIEVER_ROUTE_HEAD_FLOOR=');
      withTree('route-knob-undelivered-', files, (root) => {
        const { errors } = validateRouteKnobParity(root);
        expect(errors.some((e) => e.includes('RETRIEVER_ROUTE_HEAD_FLOOR') && e.includes('okf-server'))).toBe(true);
      });
    });

    test("the RETRIEVER's own compose default drifting away is caught", () => {
      // The Lab mirrors config.py; if the retriever's compose row drifts,
      // the Lab would mirror a number the retriever does not run.
      const files = repoFiles();
      files[COMPOSE_FILE] = files[COMPOSE_FILE].replace(
        'RETRIEVER_ROUTE_HEAD_FLOOR: ${RETRIEVER_ROUTE_HEAD_FLOOR:-0.55}',
        'RETRIEVER_ROUTE_HEAD_FLOOR: ${RETRIEVER_ROUTE_HEAD_FLOOR:-0.60}'
      );
      withTree('route-knob-retriever-compose-', files, (root) => {
        const { errors } = validateRouteKnobParity(root);
        expect(errors.some((e) => e.includes('RETRIEVER_ROUTE_HEAD_FLOOR') && e.includes('0.6'))).toBe(true);
      });
    });

    test('a knob the Helm deployment never exports is caught', () => {
      const files = repoFiles();
      files[CHART_OKF_SERVER_FILE] = files[CHART_OKF_SERVER_FILE].split('\n')
        .filter((l) => !l.includes('"RETRIEVER_ROUTE_HEAD_FLOOR"'))
        .join('\n');
      withTree('route-knob-nochart-', files, (root) => {
        const { errors } = validateRouteKnobParity(root);
        expect(errors.some((e) => e.includes('RETRIEVER_ROUTE_HEAD_FLOOR') && e.includes('okf-server.yaml'))).toBe(
          true
        );
      });
    });

    test('a values.yaml default that drifts from the retriever is caught', () => {
      // values.yaml is what Helm ACTUALLY deploys; the template's inline
      // default is only the fallback.
      const files = repoFiles();
      files[CHART_VALUES_FILE] = files[CHART_VALUES_FILE].replace(
        'retrieverRouteHeadFloor: "0.55"',
        'retrieverRouteHeadFloor: "0.60"'
      );
      withTree('route-knob-values-', files, (root) => {
        const { errors } = validateRouteKnobParity(root);
        expect(errors.some((e) => e.includes('retrieverRouteHeadFloor') && e.includes('0.6'))).toBe(true);
      });
    });

    test('a knob the retriever does not define is caught', () => {
      const files = repoFiles();
      files[ROUTE_KNOBS_FILE] = files[ROUTE_KNOBS_FILE].replace(
        '  ROUTE_RETRY: 1,',
        '  ROUTE_RETRY: 1,\n  ROUTE_INVENTED: 7,'
      )
        .replace(
          "  ROUTE_RETRY: 'RETRIEVER_ROUTE_RETRY',",
          "  ROUTE_RETRY: 'RETRIEVER_ROUTE_RETRY',\n  ROUTE_INVENTED: 'RETRIEVER_ROUTE_INVENTED',"
        )
        .replace("  ROUTE_RETRY: 'int',", "  ROUTE_RETRY: 'int',\n  ROUTE_INVENTED: 'int',");
      withTree('route-knob-invented-', files, (root) => {
        const { errors } = validateRouteKnobParity(root);
        expect(errors.some((e) => e.includes('ROUTE_INVENTED'))).toBe(true);
      });
    });
  });
});
