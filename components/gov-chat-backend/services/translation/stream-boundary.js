/**
 * Find the end-index (exclusive) of the LAST commit boundary in `buffer`.
 * Boundaries: paragraph break ("\n\n") or sentence terminator (".", "!", "?")
 * optionally followed by a closing quote/paren, then whitespace or end-of-string.
 * The trailing whitespace is consumed so the committed unit ends cleanly.
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

  // Sentence terminators: . ! ?  optionally followed by " ' ) ] then whitespace/EOL
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
 * @returns {{ unit: string, remainder: string } | null}
 */
function extractCommittableUnit(buffer, opts = {}) {
  if (!buffer) return null;
  const maxBuffer = opts.maxBuffer || 1500;

  const cut = lastBoundaryEnd(buffer);
  if (cut > 0) {
    return { unit: buffer.slice(0, cut), remainder: buffer.slice(cut) };
  }

  if (buffer.length >= maxBuffer) {
    const ws = buffer.lastIndexOf(' ');
    if (ws > 0) {
      return { unit: buffer.slice(0, ws), remainder: buffer.slice(ws) };
    }
    return { unit: buffer, remainder: '' };
  }

  return null;
}

module.exports = { lastBoundaryEnd, extractCommittableUnit };
