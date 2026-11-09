// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
'use strict';

/**
 * Single source of truth for OKF slug/identity derivation (issue #1190).
 *
 * One leaf module (requires nothing) so every consumer — including the
 * cycle-excused graph-lifecycle/bundle-export pair — shares the same
 * grammar. Consumers keep their exact current semantics through the
 * options: no stored identity changes in the unification.
 *
 * Grammar: lowercase, every run of non-[a-z0-9] characters becomes ONE
 * dash, leading/trailing dashes trimmed. (A separate run-collapse pass is
 * redundant — the `+` already collapses runs.)
 *
 * Options:
 *   fold — NFKD-normalize and strip combining marks (U+0300–U+036F) BEFORE
 *          lowercasing: ASCII-folds diacritics ('Café' → 'cafe'). Only the
 *          ingest path folds (the #1176 divergence — folding is identity-
 *          visible for existing stored concepts, so it is opt-in).
 *   cap  — truncate to N characters AFTER trimming (0 = no cap).
 *
 * Returns the empty string for empty/non-Latin input; callers apply their
 * own fallback ('concept', 'repo', 'crawl-page-N', …). Non-string input is
 * NEVER String()-coerced — it is treated as empty (junk types must not
 * become identities).
 */
function slugify(value, opts = {}) {
  const { fold = false, cap = 0 } = opts;
  let s = typeof value === 'string' ? value : '';
  if (fold) {
    s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  }
  s = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cap > 0) s = s.slice(0, cap);
  return s;
}

/**
 * Repo name from a raw source artifact (a crawl filename or seed URL) —
 * the grammar crawlerToOkfService used to pre-apply client-side. Strips
 * the URL scheme + www and a document extension, then applies the base
 * grammar with a 200-char cap; `fallback` covers input that slugs to
 * nothing (missing, or non-Latin).
 */
function nameFromSource(value, fallback) {
  const slug = slugify(
    typeof value === 'string' && value
      ? value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\.(md|html?|txt)$/i, '')
      : '',
    { cap: 200 }
  );
  return slug || fallback || '';
}

/**
 * The repo-slug profile shared by graph-lifecycle and bundle-export:
 * 80-char cap, 'repo' fallback. Feeds `OKF_<slug>_v<n>` graph names,
 * bundle zip filenames and the `okf:t:<slug>:admin` ACL scope segment —
 * one definition so the identity-visible grammar cannot drift per site.
 */
const slugFor = (name) => slugify(name, { cap: 80 }) || 'repo';

module.exports = { slugify, nameFromSource, slugFor };
