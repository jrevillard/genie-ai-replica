/**
 * Streaming-translation boundary detection.
 *
 * The chat answer streams in from chatqna as English tokens. To translate it
 * while streaming (without a final flip), the backend buffers incoming text and
 * commits a unit to the translation LLM at a "boundary" — so the translator
 * always gets a complete, self-contained piece (a paragraph or sentence).
 *
 * A translation model cannot reliably translate a partial prefix (see issue #829
 * research: the translation of a prefix ≠ the prefix of the translation), so we
 * never translate mid-sentence unless forced by the maxBuffer safety limit.
 */

/**
 * Find the end-index (exclusive) of the LAST commit boundary in `buffer`.
 * Boundaries, in priority: paragraph break ("\n\n") or a sentence terminator
 * (".", "!", "?") optionally followed by a closing quote/paren, then whitespace
 * or end-of-string.
 *
 * @param {string} buffer
 * @returns {number} index just past the last boundary, or -1 if none
 */
function lastBoundaryEnd(buffer) {
  if (!buffer) return -1;
  let best = -1;

  // Paragraph boundary (markdown blank line)
  const para = buffer.lastIndexOf('\n\n');
  if (para >= 0) best = Math.max(best, para + 2);

  // Sentence terminators: . ! ?  optionally followed by " ' ) ] then whitespace/EOL.
  // The trailing whitespace is consumed so the committed unit ends cleanly and
  // the remainder starts on a fresh token.
  const re = /[.!?]["')\]]?(?:\s|$)/g;
  let m;
  while ((m = re.exec(buffer)) !== null) {
    best = Math.max(best, m.index + m[0].length);
  }

  return best;
}

/**
 * Extract a committable unit from the front of `buffer`.
 *
 * @param {string} buffer accumulated EN text so far
 * @param {{ maxBuffer?: number }} [opts] maxBuffer forces a commit at the last
 *   whitespace once the buffer grows beyond it (rare; avoids unbounded hold).
 * @returns {{ unit: string, remainder: string } | null} the unit to translate
 *   now plus the remainder to keep buffering, or null if no boundary yet and
 *   the buffer is still small.
 */
function extractCommittableUnit(buffer, opts = {}) {
  if (!buffer) return null;
  const maxBuffer = opts.maxBuffer || 1500;

  const cut = lastBoundaryEnd(buffer);
  if (cut > 0) {
    return { unit: buffer.slice(0, cut), remainder: buffer.slice(cut) };
  }

  // Safety: buffer too large with no boundary — commit at the last whitespace
  // (word boundary) so we don't hold an unbounded amount of text.
  if (buffer.length >= maxBuffer) {
    const ws = buffer.lastIndexOf(' ');
    if (ws > 0) {
      return { unit: buffer.slice(0, ws), remainder: buffer.slice(ws) };
    }
    // No whitespace at all (e.g. a very long token) — commit everything.
    return { unit: buffer, remainder: '' };
  }

  return null;
}

module.exports = { lastBoundaryEnd, extractCommittableUnit };
