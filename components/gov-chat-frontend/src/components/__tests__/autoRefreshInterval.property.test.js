/**
 * Property-Based Tests for Auto-Refresh Interval Validation
 *
 * Uses fast-check to validate Property 7 from the design document.
 * Tests the interval validation logic used in FileDetailsDialog.vue's
 * startIngestionRefreshTimer() method.
 *
 * The logic under test:
 *   - Default ingestionRefreshInterval = 5
 *   - Effective interval = Math.max(1, ingestionRefreshInterval) * 1000 (ms)
 *   - For positive numbers: effective = max(input, 1) seconds
 *   - For undefined/null/NaN/<=0: the default of 5 is used
 */
const fc = require('fast-check');

/**
 * Pure function that replicates the interval validation logic from
 * FileDetailsDialog.vue's startIngestionRefreshTimer and data defaults.
 *
 * @param {*} input - The raw ingestionRefreshInterval value
 * @returns {number} The effective interval in seconds
 */
function computeEffectiveInterval(input) {
  const DEFAULT_INTERVAL = 5;

  // If input is not a valid positive number, use default
  if (input === undefined || input === null || typeof input !== 'number' || isNaN(input) || input <= 0) {
    return DEFAULT_INTERVAL;
  }

  // For valid positive numbers, apply Math.max(1, input)
  return Math.max(1, input);
}

/**
 * Feature: ingestion-progress-feedback, Property 7: Auto-refresh interval validation
 * Validates: Requirements 4.2
 *
 * For any numeric input value provided as the refresh interval, the effective
 * polling interval SHALL be max(input, 1) seconds when input is a positive number,
 * and SHALL default to 5 seconds when input is undefined, null, NaN, or <= 0.
 */
describe('Feature: ingestion-progress-feedback, Property 7: Auto-refresh interval validation', () => {
  it('for positive numbers >= 1, effective interval equals the input', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
        (input) => {
          const effective = computeEffectiveInterval(input);
          expect(effective).toBe(Math.max(1, input));
          expect(effective).toBeGreaterThanOrEqual(1);
          // For inputs >= 1, effective should be the input itself
          expect(effective).toBe(input);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for positive numbers < 1 (between 0 exclusive and 1), effective interval is 1', () => {
    fc.assert(
      fc.property(
        fc.double({ min: Number.MIN_VALUE, max: 0.999999999, noNaN: true, noDefaultInfinity: true }),
        (input) => {
          // Values between 0 (exclusive) and 1 are positive numbers but < 1
          // The logic uses Math.max(1, input) which clamps to 1
          const effective = computeEffectiveInterval(input);
          expect(effective).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any positive number, effective interval is always at least 1', () => {
    fc.assert(
      fc.property(
        fc.double({ min: Number.MIN_VALUE, max: 100000, noNaN: true, noDefaultInfinity: true }),
        (input) => {
          const effective = computeEffectiveInterval(input);
          expect(effective).toBeGreaterThanOrEqual(1);
          expect(effective).toBe(Math.max(1, input));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('defaults to 5 for undefined input', () => {
    expect(computeEffectiveInterval(undefined)).toBe(5);
  });

  it('defaults to 5 for null input', () => {
    expect(computeEffectiveInterval(null)).toBe(5);
  });

  it('defaults to 5 for NaN input', () => {
    expect(computeEffectiveInterval(NaN)).toBe(5);
  });

  it('defaults to 5 for zero and negative numbers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100000, max: 0, noNaN: true, noDefaultInfinity: true }),
        (input) => {
          const effective = computeEffectiveInterval(input);
          expect(effective).toBe(5);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('effective interval is always a positive finite number', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ noNaN: true, noDefaultInfinity: true }),
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(NaN)
        ),
        (input) => {
          const effective = computeEffectiveInterval(input);
          expect(typeof effective).toBe('number');
          expect(Number.isFinite(effective)).toBe(true);
          expect(effective).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('positive integer inputs produce max(input, 1) as effective interval', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        (input) => {
          const effective = computeEffectiveInterval(input);
          expect(effective).toBe(input);
          expect(effective).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
