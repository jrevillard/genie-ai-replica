#!/usr/bin/env node
/**
 * Internal-link checker for the GENIE.AI docs site (Hugo + Docsy).
 *
 * It catches the ways a docs link breaks here:
 *
 *   1. The target does not exist at all (deleted or misspelled page) — the
 *      reader gets a hard 404.  The homepage link to
 *      `/docs/core/development-guide/` was one: no page ever carried that
 *      path, so it 404ed rather than redirecting anywhere.
 *   2. The target exists only as an alias — the click works, but the reader
 *      pays a redirect hop and the URL bar shows a path that is not the
 *      page's address.
 *   3. The target page exists but the `#anchor` does not — the reader lands
 *      on the page and finds nothing.
 *   4. A `{{< relref >}}` shortcode points at a page that does not exist.
 *      Hugo resolves those at build time and fails the build, but the
 *      `pages` job runs on `main` only: the breakage is published before
 *      anyone sees it.
 *
 * It also refuses a `slug:` on a section's `_index.md`.  Hugo's handling of a
 * section slug is version-dependent: recent versions publish the *slug* as
 * the canonical URL of the section and of all its children, older versions
 * keep the *directory* path and turn the slug into an alias.  The site is
 * built by the CI `pages` job from the floating `hugomods/hugo:exts` image,
 * so a Hugo upgrade can silently move every page of a section.  With no
 * section slug, the published URL of a page is simply its content path, and
 * the URL family cannot move.
 *
 * Finally it rejects a link to the project on the wrong GitLab host: the
 * repository is self-hosted, and a `gitlab.com` link to it answers 403.
 *
 * Usage:  node scripts/check-links.mjs [--fix] [--config <file>] [contentDir]
 * Exit code 0 = all links resolve to a published URL, 1 = problems found.
 *
 * --fix rewrites every internal link to the canonical published URL of its
 * target.  Unresolvable targets are left untouched and reported.
 *
 * No dependencies — runs on the plain node image used by CI.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const FIX = args.includes('--fix');

function optionValue(name) {
  const prefix = name + '=';
  const inline = args.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const at = args.indexOf(name);
  if (at !== -1 && at + 1 < args.length) return args[at + 1];
  return null;
}

const positionals = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config') {
    i += 1;
    continue;
  }
  if (args[i].startsWith('--')) continue;
  positionals.push(args[i]);
}

const CONTENT = resolve(process.cwd(), positionals[0] ?? join(HERE, '..', 'content', 'en'));
const CONFIG = resolve(process.cwd(), optionValue('--config') ?? join(HERE, '..', 'hugo.toml'));

// ---------------------------------------------------------------- front matter

function parseFrontMatter(text) {
  const fm = { aliases: [] };
  if (!text.startsWith('---')) return fm;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return fm;
  const block = text.slice(3, end);
  let inAliases = false;
  for (const line of block.split('\n')) {
    if (/^aliases:\s*$/.exec(line)) {
      inAliases = true;
      continue;
    }
    if (inAliases) {
      const m = /^\s*-\s+(\S+)\s*$/.exec(line);
      if (m) {
        fm.aliases.push(m[1]);
        continue;
      }
      if (line.trim() === '') continue;
      inAliases = false;
    }
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (key === 'aliases') {
      // inline list form: aliases: ["/a", "/b"]
      const inline = /^\[(.*)\]$/.exec(value);
      if (inline)
        fm.aliases.push(
          ...inline[1]
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean)
        );
      else if (value) fm.aliases.push(value);
      continue;
    }
    fm[key] = value;
  }
  return fm;
}

// --------------------------------------------------------------- line scanner

// A fenced code block opens with a fence and an optional info string, and
// closes with a bare fence of the same character.  A fence line that carries
// an info string never closes a block, and a fence inside a blockquote still
// opens a block — both matter for the headings we read below.
const FENCE_LINE = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^\s*(?:>\s*)*(#{1,6})\s+(.*?)\s*$/;

/** Split a file into lines, flagging the ones that sit inside a code fence. */
function scanLines(source) {
  const lines = [];
  let fence = null;
  for (const text of source.split('\n')) {
    const f = FENCE_LINE.exec(text);
    if (f) {
      if (fence === null) {
        fence = { char: f[1][0], length: f[1].length };
      } else if (f[2].trim() === '' && f[1][0] === fence.char && f[1].length >= fence.length) {
        fence = null;
      }
      lines.push({ text, inFence: false });
      continue;
    }
    lines.push({ text, inFence: fence !== null });
  }
  return lines;
}

/**
 * The ranges an inline code span covers on a line.  A link written inside
 * backticks is a sample of markup, not a link: the accessibility page shows
 * the very `href="#main-content"` it reports as missing.
 */
function codeRanges(line) {
  const ranges = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 0;
    while (line[i + run] === '`') run += 1;
    const marker = '`'.repeat(run);
    const end = line.indexOf(marker, i + run);
    if (end === -1) {
      i += run;
      continue;
    }
    ranges.push([i, end + run]);
    i = end + run;
  }
  return ranges;
}

// ------------------------------------------------------------------ page model

/** @type {Map<string, {url: string, key: string, fm: object}>} */
const pages = new Map();
const contentPaths = new Map(); // content path -> file
const baseNames = new Map(); // file base name -> [files]
const headingIds = new Map(); // file -> Set of heading ids

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.md')) pages.set(full, null);
  }
}
walk(CONTENT);

const files = [...pages.keys()].sort();
const rel = (f) => relative(CONTENT, f).split(sep).join('/');

const published = new Set(); // published urls
const urlToFile = new Map(); // published url -> file
const contentPath = new Map(); // content path -> published url
const aliasMap = new Map(); // legacy alias -> published url
const slugViolations = []; // sections that declare a slug

function normalise(url) {
  if (!url.endsWith('/')) url += '/';
  return url;
}

/**
 * The content path of a page: the path Hugo addresses it by inside the
 * content tree, without the file extension and without the `_index` of a
 * branch bundle.  The home page has the empty path.
 */
function contentKey(file) {
  const r = rel(file);
  if (r === 'index.md') return '';
  if (r.endsWith('/_index.md')) return r.slice(0, -'/_index.md'.length);
  return r.slice(0, -'.md'.length);
}

// ------------------------------------------------------------------ heading ids

/**
 * The anchor id Hugo gives a heading, computed the way Hugo computes it
 * (markup/goldmark/autoid.go): trim the heading text, keep letters, digits
 * and underscores in lower case, turn spaces and dashes into dashes, and drop
 * everything else.  An explicit `{#id}` on the heading wins.
 */
function headingId(text) {
  const explicit = /\{#([^}]*)\}\s*$/.exec(text);
  if (explicit) return explicit[1];
  let out = '';
  for (const ch of text.trim().toLowerCase()) {
    if (ch === '-' || ch === ' ') out += '-';
    else if (ch.match(/[\p{L}\p{N}_]/u)) out += ch;
  }
  return out;
}

/** Every anchor id of a page, in document order, duplicates numbered. */
function pageHeadingIds(source) {
  const seen = new Map();
  const ids = [];
  for (const line of scanLines(source)) {
    if (line.inFence) continue;
    const m = ATX_HEADING.exec(line.text);
    if (!m) continue;
    const base = headingId(m[2]) || 'heading';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    ids.push(count === 0 ? base : `${base}-${count}`);
  }
  return ids;
}

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const fm = parseFrontMatter(source);
  const key = contentKey(file);
  const isSection = rel(file).endsWith('_index.md');

  if (isSection && fm.slug) {
    // A section slug makes the URL family depend on the Hugo version.
    slugViolations.push({ file: rel(file), slug: fm.slug });
  }

  // The published URL of a page is its content path.  A page-level `slug:`
  // renames the last segment and leaves the plain path behind as an alias;
  // an explicit `url:` overrides the path entirely.
  const plain = key === '' ? '/' : '/' + key + '/';
  let url = plain;
  if (fm.url) {
    url = normalise(fm.url);
  } else if (!isSection && fm.slug) {
    const parent = plain.slice(0, plain.lastIndexOf('/'));
    url = normalise(parent + '/' + fm.slug);
  }

  published.add(url);
  urlToFile.set(url, file);
  pages.set(file, { url, key, fm });
  contentPath.set(plain, url);
  contentPaths.set(key, file);
  if (key === '') contentPaths.set('index', file);

  // every path that Hugo redirects to this page
  for (const a of fm.aliases) aliasMap.set(normalise(a), url);
  if (url !== plain) aliasMap.set(plain, url);

  const base = rel(file).replace(/\.md$/, '').split('/').pop();
  if (!baseNames.has(base)) baseNames.set(base, []);
  baseNames.get(base).push(file);

  headingIds.set(file, new Set(pageHeadingIds(source)));
}

// ------------------------------------------------------------------ resolution

function normaliseSegments(segments) {
  const out = [];
  for (const s of segments) {
    if (s === '' || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return out.join('/');
}

/**
 * The directory a relative path is resolved against.  A section resolves
 * inside itself (`./page` in `docs/observe/_index.md` is
 * `docs/observe/page`), a page resolves inside its own folder.
 */
function baseDir(file) {
  const key = contentKey(file);
  if (rel(file).endsWith('_index.md')) return key;
  const at = key.lastIndexOf('/');
  return at === -1 ? '' : key.slice(0, at);
}

/**
 * Resolve a RELATIVE link.
 *
 * Markdown links are resolved by Hugo against the content path of the
 * referring page; raw-HTML href attributes are resolved by the browser
 * against the published URL of that page.  With no section slug the two
 * spaces are the same, so one resolution serves both.
 */
function canonicalRelative(target, file) {
  const [path, anchor] = target.split('#');
  if (!path) return null;
  const suffix = anchor ? '#' + anchor : '';

  const candidate = normalise('/' + normaliseSegments([...baseDir(file).split('/'), ...path.split('/')]));
  const viaContent = contentPath.get(candidate);
  if (viaContent) return { url: viaContent + suffix, file: urlToFile.get(viaContent) };

  const resolved = normaliseSegments([...pages.get(file).url.split('/'), ...path.split('/')]);
  const url = '/' + resolved.replace(/\/$/, '') + '/';
  if (published.has(url)) return { url: url + suffix, file: urlToFile.get(url) };
  const byAlias = aliasMap.get(url);
  if (byAlias) return { url: byAlias + suffix, file: urlToFile.get(byAlias) };
  return null;
}

/**
 * Resolve a `relref` target the way Hugo resolves it (hugolib/
 * pagecollections.go): against the referring page first, then against the
 * content root, then — for a target without a slash — against every page
 * carrying that file name.
 */
function resolveRelref(target, file) {
  const raw = target.replace(/\.md$/, '').replace(/\/+$/, '');
  if (raw === '') return { file: contentPaths.get(''), ambiguous: false };

  const isAbsolute = raw.startsWith('/');
  const ref = isAbsolute ? raw.replace(/^\/+/, '') : raw;
  if (!isAbsolute) {
    const relative = normaliseSegments([...baseDir(file).split('/'), ...ref.split('/')]);
    if (contentPaths.has(relative)) return { file: contentPaths.get(relative), ambiguous: false };
  }
  if (!ref.startsWith('.')) {
    const absolute = normaliseSegments(ref.split('/'));
    if (contentPaths.has(absolute)) return { file: contentPaths.get(absolute), ambiguous: false };
  }
  if (!ref.includes('/')) {
    const hits = baseNames.get(ref) ?? [];
    if (hits.length === 1) return { file: hits[0], ambiguous: false };
    if (hits.length > 1) return { file: null, ambiguous: true };
  }
  return { file: null, ambiguous: false };
}

// -------------------------------------------------------------- config guard

/**
 * The checker models one site: one language, the content path as the
 * published URL, and Hugo's "github" anchor style.  A configuration that
 * breaks one of those assumptions silently invalidates every answer the
 * checker gives, so it is reported instead.
 */
function checkConfig(path) {
  const violations = [];
  if (!existsSync(path)) return violations;
  let section = '';
  const languages = new Set();
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      section = sec[1].trim();
      const lang = /^languages\.([A-Za-z0-9_-]+)$/.exec(section);
      if (lang) languages.add(lang[1]);
      if (section === 'permalinks') violations.push('a [permalinks] table');
      continue;
    }
    const kv = /^([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim().replace(/^["']|["']$/g, '');
    if (section === '' && key === 'uglyURLs' && value === 'true') violations.push('uglyURLs = true');
    if (section === '' && key === 'permalinks') violations.push('a permalinks table');
    if (section === 'markup.goldmark.parser' && key === 'autoIDType' && value !== 'github') {
      violations.push(`markup.goldmark.parser.autoIDType = ${value}`);
    }
  }
  if (languages.size > 1) violations.push(`${languages.size} languages`);
  return violations;
}

const configViolations = checkConfig(CONFIG);

// ------------------------------------------------------------------- link scan

const MD_LINK = /\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const HTML_LINK = /href="([^"]*)"/g;
const REFERENCE_LINK = /^(\s*)\[([^\]]+)\]:\s*(\S+)(\s+.*)?$/;
const RELREF = /\{\{<\s*relref\s+"([^"]+)"[^>]*>\}\}/g;

const broken = [];
const brokenAnchors = [];
const brokenRelrefs = [];
const redirected = [];
const wrongHost = [];

// The repository is self-hosted: a link to it on gitlab.com answers 403.
const WRONG_HOST_PREFIXES = ['http://gitlab.com/un/itu/', 'https://gitlab.com/un/itu/'];

function isWrongHost(target) {
  const lower = target.toLowerCase();
  return WRONG_HOST_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// The characters a URI scheme may contain after its first letter.
const SCHEME_TAIL_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789+.-';

/** True when the target starts with a URI scheme (`https:`, `mailto:`, `tel:`). */
function hasScheme(target) {
  const colon = target.indexOf(':');
  if (colon < 1) return false;
  const scheme = target.slice(0, colon).toLowerCase();
  const first = scheme[0];
  if (first < 'a' || first > 'z') return false;
  for (let i = 1; i < scheme.length; i++) {
    if (!SCHEME_TAIL_CHARS.includes(scheme[i])) return false;
  }
  return true;
}

// A link written as a placeholder in prose, not as a real target.
const PLACEHOLDER_CHARS = ['…', '{', '}', '<', '>'];

function hasPlaceholder(target) {
  return PLACEHOLDER_CHARS.some((char) => target.includes(char));
}

/** True when the path ends in a file extension — an image, a PDF, a script. */
function hasFileExtension(path) {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = path.slice(dot + 1);
  if (ext.length < 2 || ext.length > 5) return false;
  for (const char of ext) {
    const lower = char.toLowerCase();
    const alnum = (lower >= 'a' && lower <= 'z') || (lower >= '0' && lower <= '9');
    if (!alnum) return false;
  }
  return true;
}

/**
 * True when a reference definition names a target, as opposed to prose: a
 * reference definition may legitimately read `[note]: see below`.
 */
function isLinkLike(target) {
  if (!target) return false;
  if (target.startsWith('#') || target.startsWith('/')) return true;
  if (target.startsWith('./') || target.startsWith('../')) return true;
  return hasScheme(target);
}

/** Report a link whose anchor does not exist on the page it points at. */
function checkAnchor(file, line, kind, target, anchor, page) {
  if (!anchor) return;
  const ids = headingIds.get(page);
  if (!ids || ids.size === 0) return;
  if (!ids.has(anchor)) {
    brokenAnchors.push({ file: rel(file), line, kind, target, anchor, page: rel(page) });
  }
}

/** Resolve an internal target to its canonical published URL. */
function canonical(target) {
  const [path, anchor] = target.split('#');
  if (!path) return null;
  const wanted = normalise(path);
  const suffix = anchor ? '#' + anchor : '';
  if (published.has(wanted)) return { url: wanted + suffix, file: urlToFile.get(wanted) };
  const byContent = contentPath.get(wanted);
  if (byContent) return { url: byContent + suffix, file: urlToFile.get(byContent) };
  const byAlias = aliasMap.get(wanted);
  if (byAlias) return { url: byAlias + suffix, file: urlToFile.get(byAlias) };
  return null;
}

for (const file of files) {
  const lines = scanLines(readFileSync(file, 'utf8'));
  let dirty = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].inFence) continue;
    let line = lines[i].text;

    const spans = codeRanges(line);
    const inCode = (index) => spans.some(([from, to]) => index >= from && index < to);

    const handle = (target, kind) => {
      if (!target) return target;
      if (hasScheme(target)) {
        // absolute URL, mailto:, tel:
        if (isWrongHost(target)) {
          wrongHost.push({ file: rel(file), line: i + 1, kind, target });
        }
        return target;
      }
      if (target.startsWith('#')) {
        // an anchor on the page itself
        checkAnchor(file, i + 1, kind, target, target.slice(1), file);
        return target;
      }
      if (hasPlaceholder(target)) return target; // placeholder in prose

      if (target.startsWith('/')) {
        const path = target.split('#')[0];
        if (!path) return target;
        // A link to a file (an image, a PDF) is not a page link: Hugo serves it
        // from the static tree, and there is no content page to resolve it to.
        if (hasFileExtension(path)) return target;
        const resolved = canonical(target);
        if (!resolved) {
          broken.push({ file: rel(file), line: i + 1, kind, target });
          return target;
        }
        const wanted = normalise(path);
        // A link that resolves through an alias still works, but the reader
        // lands on a redirect.  Point the link at the published URL instead.
        if (!published.has(wanted) && aliasMap.has(wanted)) {
          redirected.push({ file: rel(file), line: i + 1, kind, target, canonical: resolved.url });
        }
        checkAnchor(file, i + 1, kind, target, target.split('#')[1], resolved.file);
        return resolved.url;
      }

      // A relative link: resolve it, but leave it relative — the site has no
      // section slug, so the content path and the published URL agree.
      const path = target.split('#')[0];
      if (!path) return target;
      if (hasFileExtension(path)) return target;
      const resolved = canonicalRelative(target, file);
      if (!resolved) {
        broken.push({ file: rel(file), line: i + 1, kind, target });
        return target;
      }
      checkAnchor(file, i + 1, kind, target, target.split('#')[1], resolved.file);
      return target;
    };

    line = line.replace(MD_LINK, (match, target, title, offset) => {
      if (inCode(offset + match.indexOf(target))) return match;
      return '](' + handle(target, 'md') + (title ?? '') + ')';
    });
    line = line.replace(HTML_LINK, (match, target, offset) => {
      if (inCode(offset + match.indexOf(target))) return match;
      return 'href="' + handle(target, 'html') + '"';
    });
    // A reference-style link definition: `[label]: /docs/some/page/`.  Hugo
    // rewrites it like an inline Markdown link, so it is checked the same way.
    line = line.replace(REFERENCE_LINK, (match, indent, label, target, rest, offset) => {
      if (!isLinkLike(target)) return match;
      const at = offset + match.length - (rest ?? '').length - target.length;
      if (inCode(at)) return match;
      return indent + '[' + label + ']: ' + handle(target, 'ref') + (rest ?? '');
    });
    // A `relref` shortcode: Hugo resolves it at build time, so a target that
    // does not exist breaks the build rather than the link.
    for (const m of line.matchAll(RELREF)) {
      const target = m[1];
      const [ref, anchor] = target.split('#');
      const resolved = resolveRelref(ref, file);
      if (!resolved.file) {
        brokenRelrefs.push({
          file: rel(file),
          line: i + 1,
          target,
          ambiguous: resolved.ambiguous
        });
        continue;
      }
      checkAnchor(file, i + 1, 'relref', target, anchor, resolved.file);
    }
    if (line !== lines[i].text) dirty = true;
    lines[i].text = line;
  }
  if (FIX && dirty) {
    writeFileSync(file, lines.map((l) => l.text).join('\n'));
  }
}

// ---------------------------------------------------------------------- report

const problems =
  broken.length +
  brokenAnchors.length +
  brokenRelrefs.length +
  redirected.length +
  slugViolations.length +
  wrongHost.length +
  configViolations.length;

if (problems === 0) {
  console.log(`check-links: OK — ${published.size} pages, ${aliasMap.size} aliases, no broken internal links.`);
  process.exit(0);
}

if (configViolations.length) {
  console.error(`check-links: ${configViolations.length} site configuration(s) the checker cannot model:\n`);
  for (const v of configViolations) {
    console.error(`  ${v} — the checker assumes one language, the content path as URL, and github anchor ids`);
  }
  console.error('');
}

if (slugViolations.length) {
  console.error(
    `check-links: ${slugViolations.length} section(s) declare a slug — the published URL family would depend on the Hugo version:\n`
  );
  for (const s of slugViolations) {
    console.error(`  ${s.file}: slug: ${s.slug} — drop it and declare the old URL as an alias instead`);
  }
  console.error('');
}

if (wrongHost.length) {
  console.error(`check-links: ${wrongHost.length} link(s) point at the project on the wrong GitLab host:\n`);
  for (const w of wrongHost) {
    console.error(
      `  ${w.file}:${w.line}  [${w.kind}]  ${w.target}  ->  use https://opensource.unicc.org/un/itu/genie-ai`
    );
  }
  console.error('');
}

if (redirected.length) {
  console.error(`check-links: ${redirected.length} link(s) point at a redirect instead of the published URL:\n`);
  for (const r of redirected) {
    console.error(`  ${r.file}:${r.line}  [${r.kind}]  ${r.target}  ->  ${r.canonical}`);
  }
  console.error('');
}

if (brokenRelrefs.length) {
  console.error(`check-links: ${brokenRelrefs.length} relref shortcode(s) point at a page that does not exist:\n`);
  for (const r of brokenRelrefs) {
    const reason = r.ambiguous ? ' (ambiguous: several pages carry that name)' : '';
    console.error(`  ${r.file}:${r.line}  [relref]  ${r.target}${reason}`);
  }
  console.error('');
}

if (brokenAnchors.length) {
  console.error(`check-links: ${brokenAnchors.length} link(s) point at an anchor that does not exist:\n`);
  for (const b of brokenAnchors) {
    console.error(`  ${b.file}:${b.line}  [${b.kind}]  ${b.target}  ->  no heading #${b.anchor} in ${b.page}`);
  }
  console.error('');
}

if (broken.length) {
  console.error(`check-links: ${broken.length} broken internal link(s):\n`);
  for (const b of broken) {
    console.error(`  ${b.file}:${b.line}  [${b.kind}]  ${b.target}`);
  }
  console.error('');
}

process.exit(1);
