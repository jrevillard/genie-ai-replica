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

module.exports = { formatSize };
