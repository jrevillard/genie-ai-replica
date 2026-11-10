'use strict';

const { formatSize } = require('../format-utils');

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
