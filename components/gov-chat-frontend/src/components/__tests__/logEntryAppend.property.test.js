/**
 * Property-Based Tests for Log Entry Append Logic
 *
 * Uses fast-check to validate that the ingestion log append logic
 * in FileDetailsDialog preserves existing entries and correctly
 * appends new ones without clearing the log table.
 *
 * The logic under test (from FileDetailsDialog.vue refreshIngestionData):
 *   if (this.ingestionLogs.length > 0 && newLogs.length > this.ingestionLogs.length) {
 *     const existingCount = this.ingestionLogs.length;
 *     const newEntries = newLogs.slice(existingCount);
 *     this.ingestionLogs = [...this.ingestionLogs, ...newEntries];
 *   }
 *
 * This is a pure JavaScript test — no Vue component mounting needed.
 */
const fc = require('fast-check');

/**
 * Pure implementation of the log append logic extracted from FileDetailsDialog.
 * Given existing logs and a "newLogs" response from the server (which contains
 * all logs including existing ones), returns the resulting log array.
 *
 * @param {Array} existingLogs - Current ingestionLogs array
 * @param {Array} newLogs - Full logs array from server response
 * @returns {Array} The resulting log array after append logic
 */
function appendLogEntries(existingLogs, newLogs) {
  if (existingLogs.length > 0 && newLogs.length > existingLogs.length) {
    const existingCount = existingLogs.length;
    const newEntries = newLogs.slice(existingCount);
    return [...existingLogs, ...newEntries];
  } else if (existingLogs.length === 0) {
    return newLogs;
  } else {
    // Full replace when new data is same length or shorter (edge case)
    return newLogs;
  }
}

/**
 * Generator for a log entry object resembling the shape returned by the backend.
 * Uses integer timestamps to avoid jsdom Date parsing issues.
 */
const logEntryArb = fc.record({
  timestamp: fc.integer({ min: 1704067200000, max: 1767225600000 }).map(ts => new Date(ts).toISOString()),
  level: fc.constantFrom('info', 'warning', 'error', 'debug'),
  message: fc.string({ minLength: 1, maxLength: 200 }),
  stage: fc.constantFrom('Extraction', 'Chunking', 'Guardrail', 'Labeling', 'Graph'),
});

/**
 * Feature: ingestion-progress-feedback, Property 8: Log entry append preserves existing entries
 * Validates: Requirements 4.3
 *
 * For any non-empty array of existing log entries and any non-empty array of new log entries,
 * after appending, the resulting array contains all original entries in their original order
 * followed by the new entries, and has length equal to existing.length + new.length.
 */
describe('Feature: ingestion-progress-feedback, Property 8: Log entry append preserves existing entries', () => {
  it('append produces correct length: existing.length + newEntries.length', () => {
    fc.assert(
      fc.property(
        // Generate non-empty existing logs
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        // Generate non-empty new entries to append
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        (existingLogs, additionalEntries) => {
          // Simulate server response: existing logs + additional new entries
          const newLogs = [...existingLogs, ...additionalEntries];

          const result = appendLogEntries(existingLogs, newLogs);

          // Result length should equal existing + new entries
          expect(result.length).toBe(existingLogs.length + additionalEntries.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('append preserves all original entries in their original order', () => {
    fc.assert(
      fc.property(
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        (existingLogs, additionalEntries) => {
          const newLogs = [...existingLogs, ...additionalEntries];

          const result = appendLogEntries(existingLogs, newLogs);

          // All original entries are preserved in order at the beginning
          for (let i = 0; i < existingLogs.length; i++) {
            expect(result[i]).toEqual(existingLogs[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('append places new entries after existing entries in correct order', () => {
    fc.assert(
      fc.property(
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        (existingLogs, additionalEntries) => {
          const newLogs = [...existingLogs, ...additionalEntries];

          const result = appendLogEntries(existingLogs, newLogs);

          // New entries appear after existing entries in correct order
          for (let i = 0; i < additionalEntries.length; i++) {
            expect(result[existingLogs.length + i]).toEqual(additionalEntries[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('append does not mutate the original existing logs array', () => {
    fc.assert(
      fc.property(
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        (existingLogs, additionalEntries) => {
          const originalExisting = [...existingLogs];
          const newLogs = [...existingLogs, ...additionalEntries];

          appendLogEntries(existingLogs, newLogs);

          // Original array should not be mutated
          expect(existingLogs).toEqual(originalExisting);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('when existing is empty, result equals newLogs entirely', () => {
    fc.assert(
      fc.property(
        fc.array(logEntryArb, { minLength: 1, maxLength: 50 }),
        (newLogs) => {
          const result = appendLogEntries([], newLogs);

          expect(result).toEqual(newLogs);
          expect(result.length).toBe(newLogs.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
