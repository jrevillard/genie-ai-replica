/**
 * Find the LAST commit boundary in `buffer`.
 *
 * Boundaries (the latest one wins, so we commit as much complete text as the
 * stream has safely delivered):
 *   - paragraph break "\n\n"  (markdown blank line)
 *   - sentence terminator ".", "!", "?" optionally followed by a closing
 *     quote/bracket, then whitespace or end-of-string.
 *
 * A terminator immediately preceded by a DIGIT is ignored — that is a list
 * marker ("1.", "2.") or a decimal ("3.14"), neither of which ends a sentence.
 * Splitting there would fragment markdown lists.
 *
 * A terminator with NO following whitespace does NOT count: in a stream, that
 * whitespace typically arrives in the NEXT chunk and MUST become the separator
 * (re-appended verbatim after translation). Committing on a bare end-of-buffer
 * terminator yields an empty separator; the space then lands at the START of
 * the next unit's content and the translator trims it — collapsing
 * "Sentence one. Sentence two" into "Sentence one.Sentence two". So the
 * boundary requires an actual whitespace character, not end-of-string.
 *
 * Keeping the separator separate is what preserves markdown structure BETWEEN
 * units: the caller translates the content only and re-appends `separator`
 * verbatim afterwards. The translator never sees or alters the inter-unit
 * whitespace, so paragraphs ("\n\n") and line breaks survive intact.
 *
 * @param {string} buffer
 * @returns {{ contentEnd: number, separator: string } | null}
 */
function lastBoundaryEnd(buffer) {
  if (!buffer) return null;
  let best = null;

  // Paragraph boundary (markdown blank line): content stops before the "\n\n",
  // the "\n\n" itself is the separator.
  const para = buffer.lastIndexOf('\n\n');
  if (para >= 0) {
    best = { contentEnd: para, separator: '\n\n' };
  }

  // Sentence terminators. group 1 = terminator + optional closing quote/bracket
  // (stays in the content); group 2 = the WHOLE trailing whitespace run (the
  // separator). It must be the whole run: a markdown hard break is "  \n", and
  // capturing one char split it into " " (separator) + " \n" (start of the next
  // unit), which the translator then trimmed - the line break vanished and the
  // "[View full drought report](...)" link ran on inline after the sentence.
  // Negative lookbehind on a digit skips list markers ("1.") and decimals.
  // Requires an actual whitespace char (not end-of-string): see header note.
  const re = /(?<![0-9])([.!?]["')\]]?)(\s+)/g;
  let m;
  while ((m = re.exec(buffer)) !== null) {
    const candidate = { contentEnd: m.index + m[1].length, separator: m[2] };
    const candidateTotal = candidate.contentEnd + candidate.separator.length;
    const bestTotal = best ? best.contentEnd + best.separator.length : -1;
    if (candidateTotal > bestTotal) best = candidate;
  }

  return best;
}

/**
 * Find the FIRST commit boundary in `buffer` (same boundary rules as
 * lastBoundaryEnd; earliest wins).
 *
 * Used for streaming: a Bengali reader should see the answer sentence by
 * sentence, like the English reader sees it token by token. With the LAST
 * boundary, a paragraph that arrived faster than the translator drained it
 * committed as ONE unit - measured 6.1 s of silence, then 478 characters at
 * once. Sentence-sized units show the first sentence after ~0.7 s and finish
 * the same paragraph in 2.7 s, with no loss of number fidelity.
 *
 * @param {string} buffer
 * @returns {{ contentEnd: number, separator: string } | null}
 */
function firstBoundaryEnd(buffer) {
  if (!buffer) return null;
  let best = null;
  const para = buffer.indexOf('\n\n');
  if (para >= 0) best = { contentEnd: para, separator: '\n\n' };
  const re = /(?<![0-9])([.!?]["')\]]?)(\s+)/g;
  const m = re.exec(buffer);
  if (m) {
    const candidate = { contentEnd: m.index + m[1].length, separator: m[2] };
    if (!best || candidate.contentEnd < best.contentEnd) best = candidate;
  }
  return best;
}

/**
 * Extract a committable unit from the front of `buffer`.
 *
 * @param {string} buffer accumulated EN text so far
 * @param {{ maxBuffer?: number }} [opts] maxBuffer forces a commit at the last
 *   whitespace once the buffer grows beyond it (rare; avoids unbounded hold).
 * @returns {{ content: string, separator: string, remainder: string } | null}
 *   `content` is the text up to the boundary (terminator included, trailing
 *   whitespace excluded); `separator` is that trailing whitespace verbatim;
 *   `remainder` is everything still buffered after the separator.
 */
function extractCommittableUnit(buffer, opts = {}) {
  if (!buffer) return null;
  const maxBuffer = opts.maxBuffer || 1500;

  // Earliest boundary: one sentence per unit (see firstBoundaryEnd).
  const boundary = firstBoundaryEnd(buffer);
  if (boundary) {
    return {
      content: buffer.slice(0, boundary.contentEnd),
      separator: boundary.separator,
      remainder: buffer.slice(boundary.contentEnd + boundary.separator.length)
    };
  }

  if (buffer.length >= maxBuffer) {
    const ws = buffer.lastIndexOf(' ');
    if (ws > 0) {
      return { content: buffer.slice(0, ws), separator: ' ', remainder: buffer.slice(ws + 1) };
    }
    return { content: buffer, separator: '', remainder: '' };
  }

  return null;
}

module.exports = { lastBoundaryEnd, firstBoundaryEnd, extractCommittableUnit };
