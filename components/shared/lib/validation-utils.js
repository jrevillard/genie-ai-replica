/**
 * Validation utilities for input parsing and sanitization
 */

/**
 * Parse a string to a positive integer with validation.
 * Returns defaultValue if input is NaN, negative, or not a valid number.
 *
 * @param {string|number} value - The value to parse
 * @param {number} defaultValue - Default value if parsing fails or value is invalid
 * @param {Object} options - Optional constraints
 * @param {number} options.min - Minimum allowed value (default: 0)
 * @param {number} options.max - Maximum allowed value (default: Infinity)
 * @returns {number} Parsed integer or defaultValue
 */
function parsePositiveInt(value, defaultValue, options = {}) {
  const { min = 0, max = Infinity } = options;

  const parsed = parseInt(value, 10);

  // Check for NaN
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  // Check for negative values
  if (parsed < min) {
    return defaultValue;
  }

  // Check for maximum constraint
  if (parsed > max) {
    return max;
  }

  return parsed;
}

module.exports = {
  parsePositiveInt
};
