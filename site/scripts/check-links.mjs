#!/usr/bin/env node
/**
 * Internal-link checker for the GENIE.AI docs site (Hugo + Docsy).
 *
 * It catches the three ways a docs link breaks here:
 *
 *   1. The target does not exist at all (deleted or misspelled page).
 *   2. The target exists only as an alias — the click works, but the reader
 *      pays a redirect hop and the URL bar shows a path that is not the
 *      page's address.  This is the class of defect the homepage link to
 *      `/docs/core/development-guide/` was.
 *   3. A raw-HTML `href="..."` that Hugo cannot rewrite.  Hugo rewrites
 *      Markdown links that point at a content path, but never touches raw
 *      HTML, so such a link 404s without any build error.
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
 * Usage:  node scripts/check-links.mjs [--fix] [contentDir]
 * Exit code 0 = all links resolve to a published URL, 1 = problems found.
 *
 * --fix rewrites every internal link to the canonical published URL of its
 * target.  Unresolvable targets are left untouched and reported.
 *
 * No dependencies — runs on the plain node image used by CI.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const CONTENT = args.find((a) => !a.startsWith('--'))
  ? resolve(
      process.cwd(),
      args.find((a) => !a.startsWith('--'))
    )
  : join(HERE, '..', 'content', 'en');

// ---------------------------------------------------------------- front matter

function parseFrontMatter(text) {
  const fm = { aliases: [] };
  if (!text.startsWith('---')) return fm;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return fm;
  const block = text.slice(3, end);
  let inAliases = false;
  for (const line of block.split('\n')) {
    if (/^aliases:\s*$/.test(line)) {
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

// ------------------------------------------------------------------ page model

/** @type {Map<string, {url: string, file: string, fm: object}>} */
const pages = new Map();

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
const contentPath = new Map(); // "/docs/a/b" content path -> published url
const aliasMap = new Map(); // alias -> published url
const slugViolations = []; // sections that declare a slug

function dirOf(file) {
  return file.slice(0, file.lastIndexOf('/'));
}

function normalise(url) {
  if (!url.endsWith('/')) url += '/';
  return url;
}

for (const file of files) {
  const r = rel(file);
  const fm = parseFrontMatter(readFileSync(file, 'utf8'));
  const isIndex = r.endsWith('_index.md');
  const dir = dirOf(file);

  if (isIndex && fm.slug) {
    // A section slug makes the URL family depend on the Hugo version.
    slugViolations.push({ file: r, slug: fm.slug });
  }

  // The published URL of a page is its content path.  A page-level `slug:`
  // renames the last segment and leaves the plain path behind as an alias;
  // an explicit `url:` overrides the path entirely.
  const plain = normalise('/' + r.replace(/\.md$/, '').replace(/\/_index$/, ''));
  let url = plain;
  if (fm.url) {
    url = normalise(fm.url);
  } else if (!isIndex && fm.slug) {
    const parent = plain.slice(0, plain.lastIndexOf('/'));
    url = normalise(parent + '/' + fm.slug);
  }

  published.add(url);
  pages.set(file, { url, file, fm });
  contentPath.set(plain, url);

  // every path that Hugo redirects to this page
  for (const a of fm.aliases) aliasMap.set(normalise(a), url);
  if (url !== plain) aliasMap.set(plain, url);
}

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
 * Resolve a RELATIVE link.
 *
 * Markdown links are resolved by Hugo against the content path of the
 * referring page; raw-HTML href attributes are resolved by the browser
 * against the published URL of that page.  With no section slug the two
 * spaces are the same, so one resolution serves both.
 */
function canonicalRelative(target, file, kind) {
  const [path, anchor] = target.split('#');
  if (!path) return null;
  const suffix = anchor ? '#' + anchor : '';

  if (kind === 'md') {
    const dir = rel(file).split('/').slice(0, -1);
    const candidate = normalise('/' + normaliseSegments([...dir, ...path.split('/')]));
    const viaContent = contentPath.get(candidate);
    if (viaContent) return viaContent + suffix;
  }

  const base = pages.get(file).url;
  const resolved = normaliseSegments([...base.split('/'), ...path.split('/')]);
  const url = '/' + resolved.replace(/\/$/, '') + '/';
  if (published.has(url)) return url + suffix;
  const byAlias = aliasMap.get(url);
  if (byAlias) return byAlias + suffix;
  return null;
}

// ------------------------------------------------------------------- link scan

const MD_LINK = /\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const HTML_LINK = /href="([^"]*)"/g;

const broken = [];
const redirected = [];
const wrongHost = [];
let rewritten = 0;

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

/** Resolve an internal target to its canonical published URL. */
function canonical(target) {
  const [path, anchor] = target.split('#');
  if (!path) return null;
  const wanted = normalise(path);
  if (published.has(wanted)) return wanted + (anchor ? '#' + anchor : '');
  const byContent = contentPath.get(wanted);
  if (byContent) return byContent + (anchor ? '#' + anchor : '');
  const byAlias = aliasMap.get(wanted);
  if (byAlias) return byAlias + (anchor ? '#' + anchor : '');
  return null;
}

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  let inFence = false;
  let fenceMarker = '';
  let dirty = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const handle = (target, kind) => {
      if (!target) return target;
      if (hasScheme(target)) {
        // absolute URL, mailto:, tel:
        if (isWrongHost(target)) {
          wrongHost.push({ file: rel(file), line: i + 1, kind, target });
        }
        return target;
      }
      if (target.startsWith('#')) return target; // same-page anchor
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
          redirected.push({ file: rel(file), line: i + 1, kind, target, canonical: resolved });
        }
        // Hugo rewrites Markdown links that point at a content path, but never
        // rewrites raw-HTML href attributes — so for HTML only a published URL
        // or an alias actually works.
        const direct = published.has(wanted) || aliasMap.has(wanted);
        if (!FIX && !direct && kind === 'html') {
          broken.push({ file: rel(file), line: i + 1, kind, target });
          return target;
        }
        if (resolved !== target) rewritten++;
        return resolved;
      }

      // A relative link: resolve it, but leave it relative — the site has no
      // section slug, so the content path and the published URL agree.
      const path = target.split('#')[0];
      if (!path) return target;
      if (hasFileExtension(path)) return target;
      const resolved = canonicalRelative(target, file, kind);
      if (!resolved) {
        broken.push({ file: rel(file), line: i + 1, kind, target });
        return target;
      }
      return target;
    };

    line = line.replace(MD_LINK, (match, target, title) => '](' + handle(target, 'md') + (title ?? '') + ')');
    line = line.replace(HTML_LINK, (match, target) => 'href="' + handle(target, 'html') + '"');
    if (line !== lines[i]) dirty = true;
    lines[i] = line;
  }
  if (FIX && dirty) {
    writeFileSync(file, lines.join('\n'));
  }
}

// ---------------------------------------------------------------------- report

const problems = broken.length + redirected.length + slugViolations.length + wrongHost.length;

if (problems === 0) {
  console.log(`check-links: OK — ${published.size} pages, ${aliasMap.size} aliases, no broken internal links.`);
  process.exit(0);
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

if (broken.length) {
  console.error(`check-links: ${broken.length} broken internal link(s):\n`);
  for (const b of broken) {
    console.error(`  ${b.file}:${b.line}  [${b.kind}]  ${b.target}`);
  }
  console.error('');
}

process.exit(1);
