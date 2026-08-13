/**
 * Tests for validation-utils
 */

const { parsePositiveInt } = require('../../shared/lib/validation-utils');

describe('validation-utils', () => {
  describe('parsePositiveInt', () => {
    describe('valid inputs', () => {
      it('should parse valid positive integer string', () => {
        expect(parsePositiveInt('10', 0)).toBe(10);
      });

      it('should parse valid integer number', () => {
        expect(parsePositiveInt(25, 0)).toBe(25);
      });

      it('should parse zero when min is 0', () => {
        expect(parsePositiveInt('0', 5, { min: 0 })).toBe(0);
      });

      it('should respect max constraint', () => {
        expect(parsePositiveInt('150', 20, { min: 1, max: 100 })).toBe(100);
      });
    });

    describe('invalid inputs', () => {
      it('should return default for NaN', () => {
        expect(parsePositiveInt('abc', 20)).toBe(20);
      });

      it('should return default for undefined', () => {
        expect(parsePositiveInt(undefined, 20)).toBe(20);
      });

      it('should return default for null', () => {
        expect(parsePositiveInt(null, 20)).toBe(20);
      });

      it('should return default for empty string', () => {
        expect(parsePositiveInt('', 20)).toBe(20);
      });

      it('should return default for negative values', () => {
        expect(parsePositiveInt('-5', 20, { min: 0 })).toBe(20);
      });

      it('should return default for values below min', () => {
        expect(parsePositiveInt('5', 20, { min: 10 })).toBe(20);
      });
    });

    describe('edge cases', () => {
      it('should handle float strings by parsing integer part', () => {
        expect(parsePositiveInt('10.5', 0)).toBe(10);
      });

      it('should handle very large numbers', () => {
        expect(parsePositiveInt('999999999', 0, { max: 1000 })).toBe(1000);
      });

      it('should handle whitespace-padded strings', () => {
        expect(parsePositiveInt('  15  ', 0)).toBe(15);
      });
    });
  });
});
