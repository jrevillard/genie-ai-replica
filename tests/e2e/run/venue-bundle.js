// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * What the VENUE'S FRONTEND BUILD actually carries.
 *
 * The stale-venue diagnosis (#1895, #1896): a spec asserts a handle the
 * app declares, the venue's build predates the declaration, and the
 * element is never found. The failure reads exactly like a product defect
 * — and the run files it as one, because nothing in the failure says
 * which BUILD answered. Two product bugs were filed that way; both were
 * the venue serving an older bundle than the checkout.
 *
 * This module is that missing read. It walks the venue's served bundle
 * the way `docs/e2e-tests/local-run.md` documents it by hand (the SPA's
 * index names the app bundle; the app bundle names its lazy chunks), and
 * it compares the handles the CHECKOUT DECLARES with the ones the venue
 * SERVES. The two answers mean different things:
 *
 *  - declared by the checkout, ABSENT from the venue -> the venue's
 *    build is older than the checkout's: a STALE VENUE, not a defect of
 *    the spec or of the app;
 *  - absent from both -> the app never declared it: a SPEC DEFECT, and
 *    it is filed as one, exactly as before.
 *
 * The walk reads the venue over the suite's own transport
 * (`helpers/auth.js`'s `request`), which ignores the venue's self-signed
 * certificate and re-issues the edge's reset reply — the same transport
 * every spec uses, so the walk sees the venue the specs saw.
 */
const fs = require('fs');
const path = require('path');
const { request, mapWithConcurrency } = require('../helpers/auth');

// How many chunks the walk reads at once. The walk asks the edge for
// every chunk the app bundle names; a bounded wave keeps that polite
// (and quick) without a per-chunk handshake serialized behind the last.
const CHUNK_FETCH_CONCURRENCY = 6;

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// Where the app declares its handles. The declaration lives in the
// frontend's own source — that is the only place a handle can come from.
const FRONTEND_SRC = path.join(REPO_ROOT, 'components', 'gov-chat-frontend', 'src');

/**
 * A declared handle, in a SOURCE text (a Vue template or a spec).
 *
 * The value must be a literal: a dynamic binding (`:data-testid="expr"`)
 * names no handle — its value is not known at build time, so it cannot be
 * looked up in a bundle and is not a declaration. The look-behind keeps
 * the dynamic spelling out.
 */
const HANDLE_RE = /(?<!:)data-test(?:id|-id)\s*=\s*["']([^"']+)["']/g;

// The chunk filename template webpack emits: "js/"+<name>+"."+<hash>+".js".
// The anchor is the template itself, not a shape of it: the map of chunk
// NAMES may or may not be there (a chunk whose name is its id has none),
// and the map of HASHES is what the served files are named by.
const CHUNK_TEMPLATE_MARKER = '"js/"+';
// A chunk hash: eight lowercase hex digits.
const HASH_RE = /^[0-9a-f]{8}$/;
// The source extensions the frontend's declarations live in.
const SOURCE_EXTENSIONS = new Set(['.vue', '.js']);
// The frontend's own test tree declares handles its mocks render — and
// those are NOT app handles: the app never ships them, so a walk that
// counted them would call the venue stale for handles no spec can
// assert. The app's declarations live outside the test tree.
const TEST_DIRECTORIES = new Set(['__tests__', '__mocks__']);

/**
 * The handles a source text declares.
 *
 * @param {string} text - the source text
 * @returns {string[]} the declared handle values, in the order they appear
 */
function handlesIn(text) {
  const found = [];
  const pattern = new RegExp(HANDLE_RE.source, 'g');
  let match = pattern.exec(String(text || ''));
  while (match !== null) {
    found.push(match[1]);
    match = pattern.exec(String(text || ''));
  }
  return found;
}

/**
 * Does the served bundle carry this handle?
 *
 * The quotes are the point: the compiled bundle carries a handle as a
 * quoted string literal, and searching for the BARE value would let
 * `upload-files-dialog` match a bundle that carries only
 * `upload-files-dialog-confirm`. That false "the venue has it" is the
 * direction that hides a stale venue, so the search keeps the quotes.
 *
 * @param {string} bundleText - the served bundle
 * @param {string} handle - the handle value
 * @returns {boolean} whether the bundle carries it
 */
function bundleServesHandle(bundleText, handle) {
  return String(bundleText || '').includes(`"${handle}"`);
}

/**
 * The braced group that starts at or after `from`, with its body and the
 * index just past its closing brace.
 *
 * Braces inside a quoted value do not count: a chunk name could carry
 * one, and an unbalanced read would swallow the rest of the bundle.
 *
 * @param {string} text - the text to read
 * @param {number} from - the index to start at
 * @returns {{body: string, end: number}|null} the group, or null
 */
function readBracedGroup(text, from) {
  const start = text.indexOf('{', from);
  if (start === -1) return null;
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * The `id -> value` pairs of a JavaScript object literal.
 *
 * @param {string} body - the literal's body
 * @returns {Map<string, string>} the pairs
 */
function parseObjectLiteral(body) {
  const map = new Map();
  const pattern = /(\d+)\s*:\s*"([^"]*)"/g;
  let match = pattern.exec(body);
  while (match !== null) {
    map.set(match[1], match[2]);
    match = pattern.exec(body);
  }
  return map;
}

/**
 * The chunk naming the app bundle carries: the map of chunk HASHES (the
 * served files are named by them) and, when the template has one, the map
 * of chunk NAMES.
 *
 * The HASH map is the group whose values are all eight-hex digests; the
 * NAME map's values are names. A build that names a chunk differently
 * from its id (`244` served as `fm`) is the reason the name map is read
 * at all — a walk that asked for `244.<hash>.js` would fetch the SPA's
 * fallback page and call the chunk missing.
 *
 * @param {string} appBundleText - the served app bundle
 * @returns {{hashes: Map<string,string>, names: Map<string,string>}|null} the naming, or null when the bundle carries none
 */
function parseChunkNaming(appBundleText) {
  const text = String(appBundleText || '');
  const anchor = text.indexOf(CHUNK_TEMPLATE_MARKER);
  if (anchor === -1) return null;
  const rest = text.slice(anchor + CHUNK_TEMPLATE_MARKER.length);
  const groups = [];
  let cursor = 0;
  for (let i = 0; i < 2; i++) {
    const group = readBracedGroup(rest, cursor);
    if (!group) break;
    groups.push(parseObjectLiteral(group.body));
    cursor = group.end;
  }
  let hashes = null;
  let names = null;
  for (const group of groups) {
    if (group.size === 0) continue;
    const allHashes = [...group.values()].every((value) => HASH_RE.test(value));
    if (allHashes) {
      // The FIRST digest map after the template anchor is the chunk
      // naming; a second one further down belongs to another loader.
      if (!hashes) hashes = group;
    } else if (!names) {
      names = group;
    }
  }
  if (!hashes) return null;
  return { hashes, names };
}

/**
 * The chunk files the app bundle names.
 *
 * @param {string} appBundleText - the served app bundle
 * @returns {string[]|null} the chunk paths, or null when the bundle names none
 */
function chunkPaths(appBundleText) {
  const naming = parseChunkNaming(appBundleText);
  if (!naming) return null;
  const paths = [];
  for (const [id, hash] of naming.hashes) {
    const name = (naming.names && naming.names.get(id)) || id;
    paths.push(`/js/${name}.${hash}.js`);
  }
  return paths;
}

/**
 * The handles the CHECKOUT's frontend declares, and the file that declares
 * each one.
 *
 * @param {string} [srcDir] - the frontend source directory
 * @returns {Map<string, string>} handle -> the repo-relative declaring file
 */
function checkoutDeclaredHandles(srcDir = FRONTEND_SRC) {
  const declared = new Map();
  const walk = (dir) => {
    // SORTED: the report names the file that declares a handle, and a
    // name that depends on the filesystem's order is a different name on
    // every machine — the determinism rule, applied to a report.
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (TEST_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      const text = fs.readFileSync(full, 'utf-8');
      for (const handle of handlesIn(text)) {
        if (!declared.has(handle)) {
          declared.set(handle, path.relative(REPO_ROOT, full));
        }
      }
    }
  };
  walk(srcDir);
  return declared;
}

/**
 * The venue's served bundle: the app bundle and every chunk it names.
 *
 * Every chunk must be fetched: a chunk that could not be read makes the
 * walk INCOMPLETE, and an incomplete walk cannot say a handle is absent
 * (the handle may live in the chunk that failed). An incomplete walk is
 * an error here — the caller degrades to filing the failures as they are,
 * which is what happened before this module existed.
 *
 * @param {string} venue - the venue origin
 * @param {{request?: Function}} [options] - the transport, injectable for the unit spec
 * @returns {Promise<string>} the served bundle
 */
async function fetchVenueBundleText(venue, options = {}) {
  const send = options.request || request;
  const origin = String(venue || '').replace(/\/+$/, '');
  const index = await send('GET', `${origin}/`, { raw: true });
  const html = String(index.data || '');
  const appMatch = html.match(/js\/app\.[0-9a-f]+\.js/);
  if (!appMatch) {
    throw new Error('the venue serves no app bundle (the index names no js/app.<hash>.js)');
  }
  const app = await send('GET', `${origin}/${appMatch[0]}`, { raw: true });
  const appText = String(app.data || '');
  assertScript(appText, `${appMatch[0]}`);
  const paths = chunkPaths(appText);
  if (!paths) {
    throw new Error('the venue app bundle names no chunks (no readable chunk template)');
  }
  const parts = [appText];
  // The chunks are read in bounded parallel waves (the shape the repo
  // already owns for the sweeps): a fresh TLS handshake per chunk, one
  // after another, is the slowest way to ask a shared edge for a handful
  // of files. The wave is BOUNDED so the walk does not storm the venue,
  // and the FIRST failure wins — a chunk that cannot be read makes the
  // walk incomplete, and an incomplete walk cannot say a handle is
  // absent.
  const chunkBodies = await mapWithConcurrency(paths, CHUNK_FETCH_CONCURRENCY, async (chunkPath) => {
    const chunk = await send('GET', `${origin}${chunkPath}`, { raw: true });
    if (chunk.status !== 200) {
      throw new Error(`the venue chunk ${chunkPath} answered HTTP ${chunk.status}`);
    }
    const body = String(chunk.data || '');
    assertScript(body, chunkPath);
    return body;
  });
  parts.push(...chunkBodies);
  return parts.join('\n');
}

/**
 * The body the venue answered with is SCRIPT — not the SPA's fallback
 * page.
 *
 * The status cannot be trusted for this: the edge rewrites a missing
 * asset to the SPA's index with HTTP 200 (`proxy_intercept_errors on;
 * error_page 404 = @frontend_spa;` in the nginx template), so a chunk
 * that does not exist answers 200 and carries HTML. A walk that believed
 * the status would call itself complete on a chunk it never read, and
 * then report a handle living in that chunk as ABSENT — the direction
 * that hides a real defect behind a stale-venue verdict.
 *
 * @param {string} body - the served body
 * @param {string} what - the path it was served for (the message)
 * @throws {Error} when the body is not script
 */
function assertScript(body, what) {
  if (/^\s*</.test(body)) {
    throw new Error(`the venue answered ${what} with the SPA fallback page, not the script`);
  }
  if (!String(body || '').trim()) {
    // An empty body is not the chunk either: the walk would call itself
    // complete on a chunk it never read, and a handle living in that
    // chunk would be reported as absent.
    throw new Error(`the venue answered ${what} with an empty body, not the script`);
  }
}

module.exports = {
  handlesIn,
  bundleServesHandle,
  assertScript,
  parseChunkNaming,
  chunkPaths,
  checkoutDeclaredHandles,
  fetchVenueBundleText
};
