// components/shared/lib/__tests__/boolean-env.test.js
'use strict';

const { booleanEnv } = require('../boolean-env');

describe('booleanEnv', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('default value behaviour', () => {
    it('returns the defaultValue when env var is undefined and default is true', () => {
      delete process.env.TEST_BOOLEAN_UNSET;
      expect(booleanEnv('TEST_BOOLEAN_UNSET', true)).toBe(true);
    });

    it('returns the defaultValue when env var is undefined and default is false', () => {
      delete process.env.TEST_BOOLEAN_UNSET;
      expect(booleanEnv('TEST_BOOLEAN_UNSET', false)).toBe(false);
    });

    it('returns false by default when no defaultValue argument is passed', () => {
      delete process.env.TEST_BOOLEAN_UNSET;
      expect(booleanEnv('TEST_BOOLEAN_UNSET')).toBe(false);
    });
  });

  describe('explicit env values', () => {
    it('treats 1 as true regardless of defaultValue', () => {
      process.env.TEST_BOOLEAN_VAR = '1';
      expect(booleanEnv('TEST_BOOLEAN_VAR', false)).toBe(true);
    });

    it('treats "true" as true', () => {
      process.env.TEST_BOOLEAN_VAR = 'true';
      expect(booleanEnv('TEST_BOOLEAN_VAR', false)).toBe(true);
    });

    it('treats "TRUE" as true (canonical OTel uppercase)', () => {
      process.env.TEST_BOOLEAN_VAR = 'TRUE';
      expect(booleanEnv('TEST_BOOLEAN_VAR', false)).toBe(true);
    });

    it('treats "yes" as true', () => {
      process.env.TEST_BOOLEAN_VAR = 'yes';
      expect(booleanEnv('TEST_BOOLEAN_VAR', false)).toBe(true);
    });

    it('treats "0" as false even when defaultValue is true', () => {
      process.env.TEST_BOOLEAN_VAR = '0';
      expect(booleanEnv('TEST_BOOLEAN_VAR', true)).toBe(false);
    });

    it('treats "no" as false', () => {
      process.env.TEST_BOOLEAN_VAR = 'no';
      expect(booleanEnv('TEST_BOOLEAN_VAR', true)).toBe(false);
    });

    it('treats arbitrary strings as false (no implicit truthiness)', () => {
      process.env.TEST_BOOLEAN_VAR = 'enabled';
      expect(booleanEnv('TEST_BOOLEAN_VAR', false)).toBe(false);
    });

    it('trims whitespace around the value', () => {
      process.env.TEST_BOOLEAN_VAR = '  1  ';
      expect(booleanEnv('TEST_BOOLEAN_VAR', false)).toBe(true);
    });
  });
});