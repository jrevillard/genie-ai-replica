/**
 * Self-test for check-links.mjs — the CI guard that keeps the internal docs
 * links pointing at published URLs.
 *
 * Run:  node --test scripts/
 *
 * The guard is worthless if it cannot fail, so every assertion below mutates
 * one real breakage and demands that the checker reports it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-links.mjs')

/** A fixture that mirrors the real content tree: a section with a page, and a
 *  legacy alias kept for a page that moved. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'check-links-'))
  const write = (rel, body) => {
    const file = join(root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body)
  }
  write('docs/_index.md', '---\ntitle: "Docs"\n---\n\n# Docs\n')
  write('docs/operate/_index.md', '---\ntitle: "Operations"\n---\n\n# Ops\n')
  write('docs/operate/page.md', '---\ntitle: "Page"\naliases:\n  - /docs/operations/page/\n---\n\n# Page\n')
  return root
}

function run(contentDir, fix = false) {
  try {
    const out = execFileSync(process.execPath, fix ? [SCRIPT, '--fix', contentDir] : [SCRIPT, contentDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

test('accepts a Markdown link that points at a content path (Hugo rewrites those)', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\n[ok](/docs/operate/page/)\n'
  )
  const r = run(root)
  assert.equal(r.code, 0, r.out)
})

test('rejects a Markdown link whose target does not exist', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\n[dead](/docs/nowhere/)\n'
  )
  const r = run(root)
  assert.equal(r.code, 1)
  assert.match(r.out, /\/docs\/nowhere\//)
})

test('rejects a raw-HTML href whose target does not exist', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/_index.md'),
    '---\ntitle: "Docs"\n---\n\n<a href="/docs/nowhere/">Nowhere</a>\n'
  )
  const r = run(root)
  assert.equal(r.code, 1)
  assert.match(r.out, /\[html\]/)
  assert.match(r.out, /\/docs\/nowhere\//)
})

test('rejects a link that points at an alias — the reader would land on a redirect', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\naliases:\n  - /docs/operations/page/\n---\n\n# Page\n\n[legacy](/docs/operations/page/)\n'
  )
  const r = run(root)
  assert.equal(r.code, 1)
  assert.match(r.out, /redirect/)
  assert.match(r.out, /\/docs\/operations\/page\//)
  assert.match(r.out, /\/docs\/operate\/page\//)
})

test('rejects a section that declares a slug — its URL family depends on the Hugo version', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/_index.md'),
    '---\ntitle: "Operations"\nslug: operations\n---\n\n# Ops\n'
  )
  const r = run(root)
  assert.equal(r.code, 1)
  assert.match(r.out, /slug/)
})

test('--fix rewrites an alias link to the published URL and leaves dead links alone', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\naliases:\n  - /docs/operations/page/\n---\n\n# Page\n\n[legacy](/docs/operations/page/)\n\n[dead](/docs/nowhere/)\n'
  )
  const r = run(root, true)
  assert.equal(r.code, 1, 'the dead link must still be reported')
  const body = readFileSync(join(root, 'docs/operate/page.md'), 'utf8')
  assert.match(body, /\[legacy\]\(\/docs\/operate\/page\/\)/)
  assert.doesNotMatch(body, /\[legacy\]\(\/docs\/operations\/page\/\)/)
  assert.match(body, /\[dead\]\(\/docs\/nowhere\/\)/)
})

test('ignores links inside fenced code blocks', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\n```\n[dead](/docs/nowhere/)\n```\n'
  )
  const r = run(root)
  assert.equal(r.code, 0, r.out)
})
