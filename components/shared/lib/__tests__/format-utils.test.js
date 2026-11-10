'use strict';

const { formatSize, readCollectionUsage } = require('../format-utils');

describe('formatSize', () => {
  it('formats 0 bytes', () => {
    expect(formatSize(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatSize(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(5000)).toBe('4.88 KB');
  });

  it('formats megabytes and gigabytes', () => {
    expect(formatSize(1048576)).toBe('1 MB');
    expect(formatSize(1073741824)).toBe('1 GB');
  });

  it('clamps at the largest unit instead of rendering undefined', () => {
    // 1 PiB: the unclamped index runs past the sizes array.
    expect(formatSize(Math.pow(1024, 5))).toBe('1024 TB');
  });

  it('renders garbage counts as "0 B", never NaN', () => {
    expect(formatSize(-5000)).toBe('0 B');
    expect(formatSize(NaN)).toBe('0 B');
    expect(formatSize(Infinity)).toBe('0 B');
    expect(formatSize(undefined)).toBe('0 B');
  });
});

describe('readCollectionUsage', () => {
  it('decodes the real driver shape: top-level count, nested documentsSize', () => {
    // Verified against ArangoDB 3.12 + arangojs 8.8.1 types (issue #1761).
    expect(readCollectionUsage({ count: 100, figures: { documentsSize: 5000 } }, 'users')).toEqual({
      count: 100,
      size: 5000
    });
  });

  it('defaults MISSING values to 0', () => {
    expect(readCollectionUsage({ figures: {} }, 'empty')).toEqual({ count: 0, size: 0 });
    expect(readCollectionUsage(null, 'nullish')).toEqual({ count: 0, size: 0 });
  });

  it('throws NAMING the collection on garbage counts and sizes', () => {
    // Garbage must fail at the source — `|| 0` here once turned a broken
    // payload into a confident zero ("NaN GB" was its sibling failure).
    expect(() => readCollectionUsage({ count: 1, figures: { documentsSize: NaN } }, 'weird')).toThrow(
      'Collection "weird" reported an invalid byte size: NaN'
    );
    expect(() => readCollectionUsage({ count: -5, figures: {} }, 'neg')).toThrow(
      'Collection "neg" reported an invalid document count: -5'
    );
  });
});
