const path = require("path");
const { logger } = require("../shared-lib");

/**
 * Validates that a resolved path stays within its expected base directory.
 * Prevents directory traversal attacks (e.g., ../).
 *
 * @param {string} baseDir - The allowed base directory
 * @param {string} userInput - User-controlled path segment (userId, fileName, date, etc.)
 * @returns {string} The safe, resolved absolute path
 * @throws {Error} If the resolved path escapes baseDir
 */
function sanitizePath(baseDir, userInput) {
  const normalizedBase = path.resolve(baseDir);
  const resolved = path.resolve(normalizedBase, userInput);

  if (
    !resolved.startsWith(normalizedBase + path.sep) &&
    resolved !== normalizedBase
  ) {
    logger.warn("path-sanitizer.traversal_blocked", {
      baseDir: normalizedBase,
      userInput,
      resolved,
    });
    throw new Error(
      "Path traversal detected: resolved path escapes allowed directory",
    );
  }

  return resolved;
}

/**
 * Validates that a date string matches YYYY-MM-DD format (no path traversal possible).
 * @param {string} dateStr
 * @returns {boolean}
 */
function isValidDateStr(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

module.exports = { sanitizePath, isValidDateStr };
