#!/usr/bin/env node
/**
 * Internal-link checker for the GENIE.AI docs site (Hugo + Docsy).
 *
 * Catches the two ways a docs link breaks here:
 *
 *   1. The target does not exist at all (deleted or misspelled page).
 *   2. The target exists only under a different URL than the one written —
 *      which is harmless for Markdown links (Hugo resolves those by content
 *      path) but FATAL for raw-HTML `href="..."` attributes, because Hugo
 *      never rewrites raw HTML.
 *
 * Usage:  node scripts/check-links.mjs [--fix] [contentDir]
 * Exit code 0 = all links resolve, 1 = broken links found.
 *
 * --fix rewrites every internal link to the canonical published URL of its
 * target (resolving content paths and aliases). Unresolvable targets are
 * left untouched and reported.
 *
 * No dependencies — runs on the plain node image used by CI.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const args = process.argv.slice(2)
const FIX = args.includes('--fix')
const CONTENT = args.find((a) => !a.startsWith('--'))
  ? join(process.cwd(), args.find((a) => !a.startsWith('--')))
  : join(HERE, '..', 'content', 'en')

// ---------------------------------------------------------------- front matter

function parseFrontMatter(text) {
  const fm = { aliases: [] }
  if (!text.startsWith('---')) return fm
  const end = text.indexOf('\n---', 3)
  if (end === -1) return fm
  const block = text.slice(3, end)
  let inAliases = false
  for (const line of block.split('\n')) {
    if (/^aliases:\s*$/.test(line)) {
      inAliases = true
      continue
    }
    if (inAliases) {
      const m = /^\s*-\s+(\S+)\s*$/.exec(line)
      if (m) {
        fm.aliases.push(m[1])
        continue
      }
      if (line.trim() === '') continue
      inAliases = false
    }
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (key === 'aliases') {
      // inline list form: aliases: ["/a", "/b"]
      const inline = /^\[(.*)\]$/.exec(value)
      if (inline) fm.aliases.push(...inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean))
      else if (value) fm.aliases.push(value)
      continue
    }
    fm[key] = value
  }
  return fm
}

// ------------------------------------------------------------------ page model

/** @type {Map<string, {url: string, file: string, fm: object}>} */
const pages = new Map()

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (entry.endsWith('.md')) pages.set(full, null)
  }
}
walk(CONTENT)

const files = [...pages.keys()].sort()
const rel = (f) => relative(CONTENT, f).split(sep).join('/')

// Section URL: a directory's published URL is its path, unless the section's
// _index.md carries `slug:` (then the slug replaces the last path segment) or
// `url:` (then it wins outright). Children inherit the section URL.
const sectionUrl = new Map() // dir -> published url prefix

function dirOf(file) {
  return file.slice(0, file.lastIndexOf('/'))
}

for (const file of files) {
  if (!rel(file).endsWith('_index.md')) continue
  const dir = dirOf(file)
  const fm = parseFrontMatter(readFileSync(file, 'utf8'))
  const parent = dir.slice(0, dir.lastIndexOf('/'))
  const parentUrl = (parent === CONTENT ? '' : (sectionUrl.get(parent) ?? '/' + relative(CONTENT, parent).split(sep).join('/'))).replace(/\/$/, '')
  let url
  if (fm.url) url = fm.url
  else if (fm.slug) url = parentUrl + '/' + fm.slug
  else url = '/' + rel(file).replace(/\/?_index\.md$/, '')
  if (!url.endsWith('/')) url += '/'
  sectionUrl.set(dir, url)
}

const published = new Set() // published urls
const contentPath = new Map() // "/docs/a/b" content path -> published url
const aliasMap = new Map() // alias -> published url

for (const file of files) {
  const r = rel(file)
  const fm = parseFrontMatter(readFileSync(file, 'utf8'))
  const isIndex = r.endsWith('_index.md')
  let url
  if (fm.url) url = fm.url
  else if (isIndex) url = sectionUrl.get(dirOf(file))
  else {
    const dir = dirOf(file)
    const base = sectionUrl.get(dir) ?? '/' + relative(CONTENT, dir).split(sep).join('/') + '/'
    const name = fm.slug ?? r.slice(r.lastIndexOf('/') + 1).replace(/\.md$/, '')
    url = base + name + '/'
  }
  if (!url.endsWith('/')) url += '/'
  published.add(url)
  pages.set(file, { url, file, fm })

  // the content path Hugo resolves Markdown links against
  contentPath.set('/' + r.replace(/\.md$/, '').replace(/\/_index$/, ''), url)
  for (const a of fm.aliases) aliasMap.set(a, url)
}

// ------------------------------------------------------------------- link scan

const MD_LINK = /\]\(([^)\s]+)(\s+"[^"]*")?\)/g
const HTML_LINK = /href="([^"]*)"/g

const broken = []
let rewritten = 0

/** Resolve an internal target to its canonical published URL. */
function canonical(target) {
  const [path, anchor] = target.split('#')
  if (!path) return null
  if (published.has(path)) return path + (anchor ? '#' + anchor : '')
  const byContent = contentPath.get(path) ?? contentPath.get(path.replace(/\/$/, ''))
  if (byContent) return byContent + (anchor ? '#' + anchor : '')
  const byAlias = aliasMap.get(path)
  if (byAlias) return byAlias + (anchor ? '#' + anchor : '')
  return null
}

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const lines = raw.split('\n')
  let inFence = false
  let fenceMarker = ''
  let dirty = false
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    const fence = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (fence[1][0] === fenceMarker) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const handle = (target, kind) => {
      if (!target.startsWith('/')) return target
      const path = target.split('#')[0]
      if (!path) return target
      const resolved = canonical(target)
      if (!resolved) {
        broken.push({ file: rel(file), line: i + 1, kind, target })
        return target
      }
      // Hugo rewrites Markdown links that point at a content path, but never
      // rewrites raw-HTML href attributes — so for HTML only a published URL
      // or an alias actually works.
      const direct = published.has(path) || aliasMap.has(path)
      const viaContentPath = !direct
      if (!FIX && viaContentPath && kind === 'html') {
        broken.push({ file: rel(file), line: i + 1, kind, target })
        return target
      }
      if (resolved !== target) rewritten++
      return resolved
    }

    line = line.replace(MD_LINK, (match, target, title) => '](' + handle(target, 'md') + (title ?? '') + ')')
    line = line.replace(HTML_LINK, (match, target) => 'href="' + handle(target, 'html') + '"')
    if (line !== lines[i]) dirty = true
    lines[i] = line
  }
  if (FIX && dirty) {
    writeFileSync(file, lines.join('\n'))
  }
}

// ---------------------------------------------------------------------- report

if (broken.length === 0) {
  console.log(
    `check-links: OK — ${published.size} pages, ${aliasMap.size} aliases, no broken internal links.` +
      (FIX ? ` Rewrote ${rewritten} link(s).` : '')
  )
  process.exit(0)
}

console.error(`check-links: ${broken.length} broken internal link(s):\n`)
for (const b of broken) {
  console.error(`  ${b.file}:${b.line}  [${b.kind}]  ${b.target}`)
}
console.error('')
process.exit(1)
