// format-utils.js — human-readable byte formatting.
// One copy, not three: the admin stats service and the database-operations
// service each grew their own _formatSize and had already diverged (one
// clamps the unit index at TB, the other renders "NaN undefined" past it).

/**
 * Format a byte count as a human-readable size.
 * @param {number} bytes - Byte count (negative or non-finite renders "0 B")
 * @returns {string} Human-readable size, e.g. "512 B", "4.88 KB", "1 TB"
 */
function formatSize(bytes) {
  // Negative or non-finite counts are garbage, never renderable sizes.
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { formatSize, readCollectionUsage };

/**
 * Decode the arangojs collection.figures() return into {count, size}.
 *
 * The driver's real shape (verified against ArangoDB 3.12 + arangojs 8.8.1
 * types, issue #1761): the live document count sits at the TOP level of the
 * return; byte sizes nest under figures.figures (documentsSize). One copy:
 * this decode was duplicated per service and the copies disagreed — that
 * disagreement produced a "NaN GB" database size behind fabricated defaults.
 *
 * MISSING values default to 0; GARBAGE values (NaN, negative) THROW naming
 * the collection — where the shape is decoded is where the garbage enters,
 * so that is where it must fail. A broken payload fails; it never renders
 * a confident wrong number.
 *
 * @param {Object} figures - collection.figures() return
 * @param {string} name - collection name (names the offender in the error)
 * @returns {{count: number, size: number}} validated usage figures
 */
function readCollectionUsage(figures, name) {
  const inner = (figures && figures.figures) || {};
  const count = figures && figures.count !== undefined ? figures.count : 0;
  const size = inner.documentsSize === undefined ? 0 : inner.documentsSize;
  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`Collection "${name}" reported an invalid document count: ${count}`);
  }
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Collection "${name}" reported an invalid byte size: ${size}`);
  }
  return { count, size };
}
