// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// concept-splitter — lossless splitting of an oversized concept document.
//
// WHY THIS EXISTS
//
// Contextual Retrieval builds a "document context" for a document and truncates
// it to a budget derived from the serving model's context window. When a
// document is larger than that budget, chunks drawn from the end of it are
// embedded against a description of the *start* of the document, which degrades
// both the chunk embedding and the graph entities extracted from it. Nothing
// fails; the ingest reports success. So a concept document larger than the
// budget must not persist, and splitting is the required remedy.
//
// WHY NOT reuse segmentMarkdown
//
// `producer-service.js` has `segmentMarkdown`, which splits on H1-H3. It is
// unsuitable here: it DROPS sections below MIN_SEGMENT_CHARS (silently losing
// content, unacceptable for a lossless split), it caps at MAX_SEGMENTS_PER_FILE
// by merging the overflow tail, and it has no maximum section SIZE — the only
// bound that matters here.
//
// LOSSLESSNESS IS STRUCTURAL, NOT A CONVENTION
//
// Every piece this returns is a half-open LINE RANGE [start, end) into the
// document's own line array, and the ranges are contiguous, ordered, and cover
// the whole document. Concatenating them therefore reproduces the original
// byte-for-byte, by construction rather than by care. An earlier draft merged
// by inserting blank lines between units, which silently altered documents that
// had no blank line at that point; the tests assert the round-trip against real
// corpus bodies, so that class of bug cannot pass.
//
// UNSPLITTABLE IS A REAL ANSWER
//
// When one heading section is larger than the ceiling — measured, one Wikipedia
// page carries a 315,919-character section — there is no split that preserves
// meaning. Rather than hard-wrap mid-sentence and pretend the document is fine,
// the caller is told to shorten the source.

'use strict';

const DEFAULT_CEILING = 250000;

const IS_HEADING = (line) => /^#{1,6}\s+\S/.test(line);
const IS_BLANK = (line) => line.trim() === '';

/**
 * Split `body` into pieces that each fit `ceiling` characters, or report that it
 * cannot be split without damaging it.
 *
 * Decomposition escalates only as far as it must: markdown headings, then
 * blank-line-delimited paragraphs, then line boundaries. A unit that already
 * fits is never decomposed further.
 *
 * @param {string} body raw concept body (frontmatter already stripped)
 * @param {number} [ceiling] maximum characters per part
 * @returns {{parts: string[], unsplittable: boolean, reason: string|null, ceiling: number}}
 */
function splitConceptBody(body, ceiling = DEFAULT_CEILING) {
  if (typeof body !== 'string') {
    return { parts: [], unsplittable: true, reason: 'body is not a string', ceiling };
  }
  const limit = Math.max(1, Math.floor(ceiling));

  if (body.length === 0) return { parts: [''], unsplittable: false, reason: null, ceiling: limit };
  if (body.length <= limit) return { parts: [body], unsplittable: false, reason: null, ceiling: limit };

  // Preserve the document's own line ending so re-joining is byte-exact.
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const lenOf = (from, to) => lines.slice(from, to).join(eol).length;

  /** Contiguous [start,end) groups cut at every line satisfying `pred`. */
  function boundaries(start, end, pred) {
    const out = [];
    let cut = start;
    for (let i = start; i < end; i += 1) {
      if (pred(lines[i])) {
        if (i > cut) out.push([cut, i]);
        cut = i;
      }
    }
    if (cut < end) out.push([cut, end]);
    return out;
  }

  /** Combine adjacent ranges while the combined span still fits. */
  function greedyMerge(pieces) {
    const out = [];
    let start = pieces[0][0];
    let end = pieces[0][1];
    for (let i = 1; i < pieces.length; i += 1) {
      if (lenOf(start, pieces[i][1]) <= limit) {
        end = pieces[i][1];
      } else {
        out.push([start, end]);
        [start, end] = pieces[i];
      }
    }
    out.push([start, end]);
    return out;
  }

  function splitRange(start, end) {
    if (lenOf(start, end) <= limit) return [[start, end]];

    for (const pred of [IS_HEADING, IS_BLANK]) {
      const groups = boundaries(start, end, pred);
      if (groups.length <= 1) continue;
      const pieces = [];
      for (const [s, e] of groups) {
        const sub = splitRange(s, e);
        if (!Array.isArray(sub)) return sub; // propagate unsplittable
        pieces.push(...sub);
      }
      return greedyMerge(pieces);
    }

    // Line boundaries — the last resort that still preserves content.
    if (end - start > 1) {
      const pieces = [];
      for (let i = start; i < end; i += 1) {
        const sub = splitRange(i, i + 1);
        if (!Array.isArray(sub)) return sub;
        pieces.push([i, i + 1]);
      }
      return greedyMerge(pieces);
    }

    return {
      unsplittable: true,
      reason:
        `a single ${lenOf(start, end)}-character line exceeds the ${limit}-character ceiling and has no ` +
        `heading, paragraph, or line boundary to split on — shorten the source content for this concept`
    };
  }

  const result = splitRange(0, lines.length);
  if (!Array.isArray(result)) {
    return { parts: [], unsplittable: true, reason: result.reason, ceiling: limit };
  }
  return {
    parts: result.map(([from, to]) => lines.slice(from, to).join(eol)),
    unsplittable: false,
    reason: null,
    ceiling: limit
  };
}

module.exports = { splitConceptBody, DEFAULT_CEILING };
