'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

const { sanitizeKey, generateKey, processDocument } = require('../../services/key-handler');

describe('key-handler', () => {
  describe('sanitizeKey', () => {
    it('should return a generated key when input is undefined', () => {
      const result = sanitizeKey(undefined);
      expect(result).toMatch(/^doc_\d+_/);
    });

    it('should return a generated key when input is null', () => {
      const result = sanitizeKey(null);
      expect(result).toMatch(/^doc_\d+_/);
    });

    it('should return a generated key when input is empty string', () => {
      const result = sanitizeKey('');
      expect(result).toMatch(/^doc_\d+_/);
    });

    it('should return a generated key when input is whitespace-only', () => {
      const result = sanitizeKey('   ');
      expect(result).toMatch(/^doc_\d+_/);
    });

    it('should return a generated key when input is not a string', () => {
      const result = sanitizeKey(123);
      expect(result).toMatch(/^doc_\d+_/);
    });

    it('should remove leading underscores', () => {
      const result = sanitizeKey('__myKey');
      expect(result).toBe('myKey');
    });

    it('should replace invalid characters with underscores', () => {
      const result = sanitizeKey('my key#1?');
      expect(result).toBe('my_key_1_');
    });

    it('should allow valid characters (letters, digits, underscore, hyphen, etc.)', () => {
      const validKey = 'abc123_-:.@()+,=;$!*%';
      const result = sanitizeKey(validKey);
      expect(result).toBe(validKey);
    });

    it('should prefix key with default prefix when key starts with a digit', () => {
      const result = sanitizeKey('123abc');
      expect(result).toBe('doc_123abc');
    });

    it('should prefix key with custom prefix when key starts with a digit', () => {
      const result = sanitizeKey('123abc', 'conv');
      expect(result).toBe('conv_123abc');
    });

    it('should truncate key longer than 254 characters', () => {
      const longKey = 'a'.repeat(300);
      const result = sanitizeKey(longKey);
      expect(result.length).toBe(254);
    });

    it('should not truncate key at exactly 254 characters', () => {
      const key = 'a'.repeat(254);
      const result = sanitizeKey(key);
      expect(result.length).toBe(254);
    });

    it('should handle Unicode characters (accented)', () => {
      const result = sanitizeKey('café_ naïve');
      expect(result).toBe('caf___na_ve');
    });

    it('should handle Unicode characters (CJK)', () => {
      const result = sanitizeKey('中文_test');
      expect(result).toBe('___test');
    });

    it('should handle Unicode emoji', () => {
      const result = sanitizeKey('test🎉key');
      expect(result).toBe('test__key');
    });

    it('should handle mixed valid/invalid at boundaries', () => {
      const result = sanitizeKey('abc#123_def!456');
      expect(result).toBe('abc_123_def!456');
    });

    it('should return a generated key when sanitization results in empty string', () => {
      // Input that becomes empty after removing leading underscores and invalid chars
      const result = sanitizeKey('___');
      expect(result).toMatch(/^doc_\d+_/);
    });

    it('should handle typical ArangoDB document keys', () => {
      expect(sanitizeKey('conv-1')).toBe('conv-1');
      expect(sanitizeKey('msg_123')).toBe('msg_123');
      expect(sanitizeKey('user:456')).toBe('user:456');
    });
  });

  describe('generateKey', () => {
    it('should generate key with default prefix', () => {
      const result = generateKey();
      expect(result).toMatch(/^doc_\d+_[0-9a-f_]+$/);
    });

    it('should generate key with custom prefix', () => {
      const result = generateKey('conv');
      expect(result).toMatch(/^conv_\d+_[0-9a-f_]+$/);
    });

    it('should generate unique keys on successive calls', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      expect(key1).not.toBe(key2);
    });

    it('should contain timestamp component', () => {
      const before = Date.now();
      const result = generateKey('test');
      const after = Date.now();
      const timestamp = parseInt(result.split('_')[1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('processDocument', () => {
    it('should throw when document is null', () => {
      expect(() => processDocument(null)).toThrow('Document cannot be null or undefined');
    });

    it('should throw when document is undefined', () => {
      expect(() => processDocument(undefined)).toThrow('Document cannot be null or undefined');
    });

    it('should sanitize _key field', () => {
      const doc = { _key: '123abc', name: 'Test' };
      const result = processDocument(doc);
      expect(result._key).toBe('doc_123abc');
    });

    it('should generate _key when missing', () => {
      const doc = { name: 'Test' };
      const result = processDocument(doc);
      expect(result._key).toMatch(/^doc_\d+_/);
    });

    it('should remove _id field', () => {
      const doc = { _key: 'test', _id: 'collection/test', name: 'Test' };
      const result = processDocument(doc);
      expect(result._id).toBeUndefined();
    });

    it('should remove _rev field', () => {
      const doc = { _key: 'test', _rev: 'abc123', name: 'Test' };
      const result = processDocument(doc);
      expect(result._rev).toBeUndefined();
    });

    it('should preserve other fields', () => {
      const doc = { _key: 'test', name: 'Test', value: 42 };
      const result = processDocument(doc);
      expect(result.name).toBe('Test');
      expect(result.value).toBe(42);
    });

    it('should not modify the original document', () => {
      const doc = { _key: 'test', _id: 'collection/test', _rev: 'abc' };
      processDocument(doc);
      expect(doc._id).toBe('collection/test');
      expect(doc._rev).toBe('abc');
    });

    it('should use custom prefix for generated keys', () => {
      const doc = { name: 'Test' };
      const result = processDocument(doc, 'conv');
      expect(result._key).toMatch(/^conv_\d+_/);
    });
  });
});
