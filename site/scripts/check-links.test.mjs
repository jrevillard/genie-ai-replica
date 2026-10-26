/**
 * Self-test for check-links.mjs — the CI guard that keeps internal docs links
 * pointing at published URLs.
 *
 * Run:  node --test scripts/
 *
 * The guard is worthless if it cannot fail, so each mutation below asserts
 * that the checker reports (or repairs) the exact breakage it claims to
 * catch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-links.mjs')

/** Build a fixture that mirrors the real trap: a section whose published URL
 *  (slug) differs from its directory name. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'check-links-'))
  const write = (rel, body) => {
    const file = join(root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body)
  }
  write('docs/_index.md', '---\ntitle: "Docs"\n---\n\n# Docs\n')
  write('docs/operate/_index.md', '---\ntitle: "Operations"\nslug: operations\naliases:\n  - /docs/operations/\n---\n\n# Ops\n')
  write('docs/operate/page.md', '---\ntitle: "Page"\n---\n\n# Page\n')
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

test('rejects a raw-HTML href that points at a content path — Hugo never rewrites those', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/_index.md'),
    '---\ntitle: "Docs"\n---\n\n<a href="/docs/operate/">Operate</a>\n'
  )
  const r = run(root)
  assert.equal(r.code, 1)
  assert.match(r.out, /\[html\]/)
  assert.match(r.out, /\/docs\/operate\//)
})

test('--fix rewrites a raw-HTML href to the published URL and leaves dead links alone', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/_index.md'),
    '---\ntitle: "Docs"\n---\n\n<a href="/docs/operate/">Operate</a>\n'
  )
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\n[dead](/docs/nowhere/)\n'
  )
  const r = run(root, true)
  assert.equal(r.code, 1, 'the dead link must still be reported')
  const html = readFileSync(join(root, 'docs/_index.md'), 'utf8')
  assert.match(html, /href="\/docs\/operations\/"/)
  assert.doesNotMatch(html, /href="\/docs\/operate\/"/)
})

test('accepts an alias as a valid target', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\n[alias](/docs/operations/)\n'
  )
  const r = run(root)
  assert.equal(r.code, 0, r.out)
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

test('resolves a relative Markdown link against the content path', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\n[sibling](./other/)\n'
  )
  writeFileSync(
    join(root, 'docs/operate/other.md'),
    '---\ntitle: "Other"\n---\n\n# Other\n'
  )
  const r = run(root)
  assert.equal(r.code, 0, r.out)
})

test('rejects a relative Markdown link with no target file', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\n[gone](./tracing/)\n'
  )
  const r = run(root)
  assert.equal(r.code, 1)
  assert.match(r.out, /\.\/tracing\//)
})

test('--fix rewrites a relative link to the published URL of its target', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\n[sibling](./other/)\n'
  )
  writeFileSync(
    join(root, 'docs/operate/other.md'),
    '---\ntitle: "Other"\n---\n\n# Other\n'
  )
  run(root, true)
  const body = readFileSync(join(root, 'docs/operate/page.md'), 'utf8')
  assert.match(body, /\(\/docs\/operations\/other\/\)/)
})

test('ignores a placeholder href in prose', () => {
  const root = fixture()
  writeFileSync(
    join(root, 'docs/operate/page.md'),
    '---\ntitle: "Page"\n---\n\n# Page\n\nraw HTML (`href="…"`) is never rewritten\n'
  )
  const r = run(root)
  assert.equal(r.code, 0, r.out)
})
