// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// #2061 phase 1b — the ROUTE KNOB parity pin.
//
// The Testing Lab replays the production routing gate locally, so it scores
// under thresholds that MUST be the ones the retriever is actually running.
// Four places hold that contract, and each can drift from the others
// silently:
//
//   components/okf-server/services/route-knobs.js        the Lab's ONE loader
//   genie-ai-overlay/retriever/config.py                 the PRODUCTION authority
//   docker-compose.yaml                                  the DELIVERY (both containers)
//   charts/genieai-umbrella/.../{okf-server,retriever}.yaml + values.yaml
//
// The failure this pin exists for is not a wrong number in one file — it is
// a number that is right in one place and never reaches the other: the Lab
// scoring under code defaults while the retriever runs a retuned value,
// both green, neither honest.
//
// THE PYTHON SIDE IS THE AUTHORITY, and the Lab's knob set must EQUAL the
// retriever's route-knob set — not merely be a subset of it. A subset test
// passes precisely when the Lab models FEWER controls than production, and
// three of the retriever's route knobs change the routing OUTCOME rather
// than a threshold (ROUTE_ENABLED, ROUTE_HEADS_SUPERSEDE,
// ROUTE_HEAD_WEIGHT): a Lab that ignored them would certify a gated
// verdict for a deployment that does not gate.

const fs = require('fs');
const path = require('path');
const { parseComposeServiceContracts } = require('./parse-compose');

const ROUTE_KNOBS_FILE = 'components/okf-server/services/route-knobs.js';
const RETRIEVER_CONFIG_FILE = 'genie-ai-overlay/retriever/config.py';
const COMPOSE_FILE = 'docker-compose.yaml';
const CHART_OKF_SERVER_FILE = 'charts/genieai-umbrella/templates/opea/okf-server.yaml';
const CHART_RETRIEVER_FILE = 'charts/genieai-umbrella/templates/opea/retriever.yaml';
const CHART_VALUES_FILE = 'charts/genieai-umbrella/values.yaml';

const OKF_SERVER_COMPOSE_SERVICE = 'okf-server';
const RETRIEVER_COMPOSE_SERVICE = 'retriever-arango-service';

/** The Lab's knob table in route-knobs.js: KNOB: numeric literal. */
const JS_DEFAULTS_BLOCK = /ROUTE_KNOB_DEFAULTS\s*=\s*\{([\s\S]*?)\}/;

/** The Lab's env-name table in route-knobs.js: KNOB: 'ENV_NAME'. */
const JS_ENV_BLOCK = /ROUTE_KNOB_ENV\s*=\s*\{([\s\S]*?)\}/;

/** The Lab's declared knob types: KNOB: 'int' | 'float' | 'boolean'. */
const JS_TYPES_BLOCK = /ROUTE_KNOB_TYPES\s*=\s*\{([\s\S]*?)\}/;

/** The retriever's NUMERIC route knobs: int|float(os.getenv("ENV", "default")). */
const PY_NUM_ROUTE_KNOB =
  /^(ROUTE_[A-Z_]+)\s*=\s*(int|float)\(\s*os\.getenv\(\s*["']([A-Z0-9_]+)["']\s*,\s*["']([^"']*)["']\s*\)\s*\)/gm;

/** The retriever's BOOLEAN route knobs: os.getenv("ENV", "true").lower() == "true". */
const PY_BOOL_ROUTE_KNOB =
  /^(ROUTE_[A-Z_]+)\s*=\s*os\.getenv\(\s*["']([A-Z0-9_]+)["']\s*,\s*["']([^"']*)["']\s*\)\.lower\(\)\s*==\s*["']true["']/gm;

/**
 * A compose row that pipes a knob in with its deployment default.
 *
 * Both shapes are in the file: the okf-server block uses the LIST form
 * (`- NAME=${VAR:-default}`) and the retriever block the MAPPING form
 * (`NAME: ${VAR:-default}`), so the list marker is optional.
 */
const COMPOSE_KNOB_ROW = /^[ \t]*(?:-[ \t]*)?(RETRIEVER_ROUTE_[A-Z_]+)\s*[:=]\s*\$\{\1:-([^}\n]*)\}[ \t]*$/gm;

/**
 * A chart env row: (dict "name" "RETRIEVER_ROUTE_X" "value" ($opeaRetriever.<key> | default "v" ...)).
 *
 * The source segment must NOT cross a newline: a row whose value comes from
 * an `include` (no `| default`) would otherwise swallow the NEXT row and
 * take its default with it — the row after a boolEnvValue include is
 * exactly one a reader would not notice missing.
 */
const CHART_KNOB_ROW =
  /\(dict "name" "(RETRIEVER_ROUTE_[A-Z_]+)" "value" \(\$opeaRetriever\.([A-Za-z0-9]+)[^|\n]*\| default "([^"]*)"/g;

/** A chart env row in the BOOLEAN form the retriever template uses. */
const CHART_KNOB_INCLUDE_ROW =
  /\(dict "name" "(RETRIEVER_ROUTE_[A-Z_]+)" "value" \(include "genieai-umbrella\.boolEnvValue" \(dict "value" \$opeaRetriever\.([A-Za-z0-9]+) "default" (true|false)\)\)/g;

/** The chart's values.yaml block for the retriever: retrieverRouteX: "v" (a trailing comment is allowed). */
const VALUES_ROUTE_KNOB = /^\s*(retrieverRoute[A-Za-z0-9]*)\s*:\s*["']?([^"'\n#]*?)\s*["']?\s*(?:#.*)?$/gm;

/**
 * Read a repository file.
 *
 * @param {string} root - The repository root
 * @param {string} relative - The path relative to the root
 * @returns {string} The file content
 */
function read(root, relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) throw new Error(`missing file: ${relative}`);
  return fs.readFileSync(full, 'utf8');
}

/**
 * Parse a JS object literal body into plain key/value pairs.
 *
 * @param {string} body - The text between the braces
 * @param {RegExp} valuePattern - A pattern with the value in group 1
 * @returns {Map<string, string>} The parsed pairs
 */
function parseJsObject(body, valuePattern) {
  const out = new Map();
  for (const line of body.split('\n')) {
    const match = line.match(valuePattern);
    if (match) out.set(match[1], match[2].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

/**
 * Parse the retriever's route knobs out of config.py.
 *
 * @param {string} content - The config.py content
 * @returns {Map<string, {env: string, default: string, type: string}>} Each knob
 */
function parsePythonRouteKnobs(content) {
  const out = new Map();
  for (const match of content.matchAll(PY_NUM_ROUTE_KNOB)) {
    out.set(match[1], { env: match[3], default: match[4], type: match[2] });
  }
  for (const match of content.matchAll(PY_BOOL_ROUTE_KNOB)) {
    out.set(match[1], { env: match[2], default: match[3], type: 'boolean' });
  }
  return out;
}

/**
 * Parse the compose rows that pipe a route knob in.
 *
 * @param {string} content - The docker-compose.yaml content
 * @returns {Map<string, string>} Each knob env name, with its deployment default
 */
function parseComposeKnobs(content) {
  const out = new Map();
  for (const match of content.matchAll(COMPOSE_KNOB_ROW)) {
    out.set(match[1], match[2]);
  }
  return out;
}

/**
 * Parse the chart env rows that export a route knob.
 *
 * @param {string} content - The template content
 * @returns {Map<string, {src: string, default: string}>} Each knob env name, with its values key and its chart default
 */
function parseChartKnobs(content) {
  const out = new Map();
  for (const match of content.matchAll(CHART_KNOB_ROW)) {
    out.set(match[1], { src: match[2], default: match[3] });
  }
  for (const match of content.matchAll(CHART_KNOB_INCLUDE_ROW)) {
    out.set(match[1], { src: match[2], default: match[3] });
  }
  return out;
}

/**
 * Slice one compose service block out of the file.
 *
 * @param {string} content - The docker-compose.yaml content
 * @param {string} service - The service name
 * @returns {string} The block, or '' when the service is absent
 */
function composeServiceBlock(content, service) {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start < 0) return '';
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9][A-Za-z0-9_.-]*:\s*$/.test(lines[i])) return lines.slice(start, i).join('\n');
  }
  return lines.slice(start).join('\n');
}

/**
 * Two defaults are the same when they are the same value.
 *
 * Numbers are compared as NUMBERS ("0.55" and 0.55 are one value spelled
 * two ways, and the Lab's table holds a number while the deployment files
 * hold a string). Booleans are compared as booleans — the retriever reads
 * them as `os.getenv(X, "true").lower() == "true"`, so only "true" is true.
 *
 * @param {string} a - One spelling
 * @param {string} b - The other spelling
 * @param {string} type - 'number' | 'boolean'
 * @returns {boolean} True when both denote the same value
 */
function sameValue(a, b, type) {
  if (type === 'boolean') {
    const norm = (v) => {
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      if (s === 'true') return true;
      if (s === 'false') return false;
      return null;
    };
    const na = norm(a);
    const nb = norm(b);
    return na !== null && nb !== null && na === nb;
  }
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/**
 * Check that the Lab's route knobs, the retriever's authority and the
 * deployment that delivers them agree.
 *
 * @param {string} root - The repository root
 * @returns {{errors: string[], checked: string[]}} The findings and what was checked
 */
function validateRouteKnobParity(root) {
  const errors = [];
  const checked = [];

  const jsSource = read(root, ROUTE_KNOBS_FILE);
  const jsDefaultsBlock = jsSource.match(JS_DEFAULTS_BLOCK);
  const jsEnvBlock = jsSource.match(JS_ENV_BLOCK);
  if (!jsDefaultsBlock || !jsEnvBlock) {
    return {
      errors: [`${ROUTE_KNOBS_FILE} does not carry the ROUTE_KNOB_DEFAULTS/ROUTE_KNOB_ENV tables`],
      checked
    };
  }
  const jsDefaults = parseJsObject(jsDefaultsBlock[1], /^\s*(ROUTE_[A-Z_]+)\s*:\s*(true|false|[0-9.]+)\s*,?\s*$/);
  const jsEnv = parseJsObject(jsEnvBlock[1], /^\s*(ROUTE_[A-Z_]+)\s*:\s*['"]([A-Z0-9_]+)['"]\s*,?\s*$/);
  const jsTypesBlock = jsSource.match(JS_TYPES_BLOCK);
  const jsTypes = jsTypesBlock
    ? parseJsObject(jsTypesBlock[1], /^\s*(ROUTE_[A-Z_]+)\s*:\s*['"](int|float|boolean)['"]\s*,?\s*$/)
    : new Map();

  const pythonKnobs = parsePythonRouteKnobs(read(root, RETRIEVER_CONFIG_FILE));

  // 1. The Lab's knob set must EQUAL the retriever's route-knob set. A
  //    subset test would pass precisely when the Lab models fewer controls
  //    than production — the failure that matters.
  for (const knob of pythonKnobs.keys()) {
    if (!jsDefaults.has(knob)) {
      errors.push(
        `${knob} is a retriever route knob but the Lab does not model it — the Lab would certify a gated verdict for a deployment that does not gate`
      );
    }
  }
  for (const knob of jsDefaults.keys()) {
    if (!pythonKnobs.has(knob)) {
      errors.push(`${knob} is a Lab knob but the retriever authority (config.py) does not define it`);
    }
  }

  // 2. Same knob, same env name, same default — on both sides.
  for (const [knob, jsDefault] of jsDefaults) {
    const authority = pythonKnobs.get(knob);
    if (!authority) continue;
    const jsEnvName = jsEnv.get(knob);
    if (!jsEnvName) {
      errors.push(`${knob} has no env name in ROUTE_KNOB_ENV`);
      continue;
    }
    if (jsEnvName !== authority.env) {
      errors.push(
        `${knob} reads ${jsEnvName} in the Lab but ${authority.env} in the retriever (the two would never see the same value)`
      );
    }
    if (!sameValue(jsDefault, authority.default, authority.type)) {
      errors.push(
        `${knob} defaults to ${jsDefault} in the Lab but ${authority.default} in the retriever (the Lab would score under a different threshold than production)`
      );
    }
    // The PARSING must agree too: a float read with parseInt turns "2.5"
    // into 2, and the retriever's config.py says which is which.
    const jsType = jsTypes.get(knob);
    if (!jsType) {
      errors.push(`${knob} has no declared type in ROUTE_KNOB_TYPES — the loader would have to guess how to parse it`);
    } else if (jsType !== authority.type) {
      errors.push(`${knob} is parsed as ${jsType} in the Lab but ${authority.type} in the retriever`);
    }
    checked.push(`${knob}: ${jsEnvName} = ${jsDefault}`);
  }

  // 3. DELIVERY (Compose): the knobs must reach BOTH containers — the
  //    retriever (which reads them) and the okf-server (which replays the
  //    gate). A knob that reaches only one of them is the drift this whole
  //    change set is about. And BOTH containers' compose defaults must
  //    match the authority: a retriever row that drifts leaves the two
  //    services on different thresholds while the Lab mirrors config.py.
  const composeContent = read(root, COMPOSE_FILE);
  const contracts = parseComposeServiceContracts(path.join(root, COMPOSE_FILE));
  const okfEnv = contracts.find((c) => c.service === OKF_SERVER_COMPOSE_SERVICE)?.envVars || [];
  const retrieverEnv = contracts.find((c) => c.service === RETRIEVER_COMPOSE_SERVICE)?.envVars || [];
  const okfComposeKnobs = parseComposeKnobs(composeServiceBlock(composeContent, OKF_SERVER_COMPOSE_SERVICE));
  const retrieverComposeKnobs = parseComposeKnobs(composeServiceBlock(composeContent, RETRIEVER_COMPOSE_SERVICE));
  for (const [knob, jsEnvName] of jsEnv) {
    const authority = pythonKnobs.get(knob);
    if (!okfEnv.includes(jsEnvName)) {
      errors.push(
        `${jsEnvName} does not reach the ${OKF_SERVER_COMPOSE_SERVICE} container — the Lab would score under the code defaults while the retriever uses the deployment's`
      );
    }
    if (!retrieverEnv.includes(jsEnvName)) {
      errors.push(`${jsEnvName} does not reach the ${RETRIEVER_COMPOSE_SERVICE} container`);
    }
    const okfDefault = okfComposeKnobs.get(jsEnvName);
    if (okfDefault === undefined) {
      errors.push(
        `${jsEnvName} is not piped in with a deployment default in the ${OKF_SERVER_COMPOSE_SERVICE} compose block`
      );
    } else if (authority && !sameValue(okfDefault, authority.default, authority.type)) {
      errors.push(
        `${jsEnvName} defaults to ${okfDefault} in the ${OKF_SERVER_COMPOSE_SERVICE} compose block but ${authority.default} in the retriever`
      );
    }
    const retrieverDefault = retrieverComposeKnobs.get(jsEnvName);
    if (retrieverDefault === undefined) {
      errors.push(
        `${jsEnvName} is not piped in with a deployment default in the ${RETRIEVER_COMPOSE_SERVICE} compose block`
      );
    } else if (authority && !sameValue(retrieverDefault, authority.default, authority.type)) {
      errors.push(
        `${jsEnvName} defaults to ${retrieverDefault} in the ${RETRIEVER_COMPOSE_SERVICE} compose block but ${authority.default} in the retriever — the Lab would mirror config.py while the retriever ran the other value`
      );
    }
  }
  checked.push(`compose delivery to ${OKF_SERVER_COMPOSE_SERVICE} and ${RETRIEVER_COMPOSE_SERVICE}`);

  // 4. DELIVERY (Helm): both templates must export the knobs, and the
  //    chart's values.yaml must carry the same numbers the templates
  //    fall back to — a values.yaml that drifts from the template's inline
  //    default is a Helm deployment that runs a threshold the Lab does not.
  const chartOkfSource = read(root, CHART_OKF_SERVER_FILE);
  const chartRetrieverSource = read(root, CHART_RETRIEVER_FILE);
  const chartOkf = parseChartKnobs(chartOkfSource);
  const chartRetriever = parseChartKnobs(chartRetrieverSource);
  const valuesSource = read(root, CHART_VALUES_FILE);
  const valuesKnobs = new Map();
  for (const match of valuesSource.matchAll(VALUES_ROUTE_KNOB)) {
    valuesKnobs.set(match[1], match[2].trim());
  }
  const okfSources = new Map();
  for (const [name, entry] of chartOkf) okfSources.set(name, entry.src);
  const retrieverSources = new Map();
  for (const [name, entry] of chartRetriever) retrieverSources.set(name, entry.src);
  for (const [knob, jsEnvName] of jsEnv) {
    const authority = pythonKnobs.get(knob);
    const okfEntry = chartOkf.get(jsEnvName);
    if (okfEntry === undefined) {
      errors.push(
        `${jsEnvName} is not exported by ${CHART_OKF_SERVER_FILE} — a Helm deployment would score the Lab under the code defaults`
      );
    } else if (authority && !sameValue(okfEntry.default, authority.default, authority.type)) {
      errors.push(
        `${jsEnvName} defaults to ${okfEntry.default} in ${CHART_OKF_SERVER_FILE} but ${authority.default} in the retriever`
      );
    }
    const retrieverEntry = chartRetriever.get(jsEnvName);
    if (retrieverEntry === undefined) {
      errors.push(`${jsEnvName} is not exported by ${CHART_RETRIEVER_FILE}`);
    } else if (authority && !sameValue(retrieverEntry.default, authority.default, authority.type)) {
      errors.push(
        `${jsEnvName} defaults to ${retrieverEntry.default} in ${CHART_RETRIEVER_FILE} but ${authority.default} in the retriever`
      );
    }
    // The two charts must read the SAME values key, so one override moves
    // the retriever and the Lab together.
    const okfKey = okfSources.get(jsEnvName);
    const retrieverKey = retrieverSources.get(jsEnvName);
    if (okfKey && retrieverKey && okfKey !== retrieverKey) {
      errors.push(
        `${jsEnvName} reads ${okfKey} in the okf-server chart but ${retrieverKey} in the retriever chart — one override would move only one of them`
      );
    }
    // values.yaml is what Helm actually deploys; the template's inline
    // default is the fallback. They must agree, and both must agree with
    // the authority.
    if (okfKey) {
      const value = valuesKnobs.get(okfKey);
      if (value === undefined) {
        errors.push(
          `${CHART_VALUES_FILE} does not carry ${okfKey} — the Helm deployment of ${jsEnvName} would fall back to the template default`
        );
      } else if (authority && !sameValue(value, authority.default, authority.type)) {
        errors.push(`${okfKey} is ${value} in ${CHART_VALUES_FILE} but ${authority.default} in the retriever`);
      }
    }
  }
  checked.push('helm delivery to the okf-server and retriever deployments');

  // 5. The chart's okf-server rows must read the RETRIEVER values block —
  //    a second copy of the numbers is how the two drift apart.
  const okfRouteBlock = chartOkfSource.match(/routeGateEnv\s*:=\s*list([\s\S]*?)\n-\}\}/);
  if (okfRouteBlock) {
    const fromRetriever = (okfRouteBlock[1].match(/\$opeaRetriever\./g) || []).length;
    const rows = (okfRouteBlock[1].match(/\(dict "name"/g) || []).length;
    if (fromRetriever !== rows) {
      errors.push(
        `the okf-server chart reads ${fromRetriever} of its ${rows} route knobs from the retriever values block — the rest are a second copy of the numbers`
      );
    }
  } else {
    errors.push(`${CHART_OKF_SERVER_FILE} does not carry a routeGateEnv list`);
  }

  return { errors, checked };
}

module.exports = {
  validateRouteKnobParity,
  ROUTE_KNOBS_FILE,
  RETRIEVER_CONFIG_FILE,
  COMPOSE_FILE,
  CHART_OKF_SERVER_FILE,
  CHART_RETRIEVER_FILE,
  CHART_VALUES_FILE
};
