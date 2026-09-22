'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

const { parseCsvObjects } = require('../../../services/agri/csv');
const { extractEntry } = require('../../../services/agri/zip');

describe('A. csv parseCsvObjects — short rows', () => {
  test('missing cells become null, not undefined', () => {
    const csv = 'a,b,c\n1,2';
    const rows = parseCsvObjects(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toBe('1');
    expect(rows[0].b).toBe('2');
    expect(rows[0].c).toBeNull();
  });

  test('extra cells beyond header are kept on _extras', () => {
    const csv = 'a,b\n1,2,3,extra';
    const rows = parseCsvObjects(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toBe('1');
    expect(rows[0].b).toBe('2');
    expect(rows[0]._extras).toEqual(['3', 'extra']);
  });
});

describe('B. zip extractEntry — truncated buffer', () => {
  test('throws a clear truncation error when central directory lies about compressedSize', async () => {
    // Build a zip where central claims compressedSize=200 but only 1 byte of
    // actual data exists. dataStart=38, dataEnd=238 > buffer.length=115 → throws.
    //
    // Layout (115 bytes): local(39) | central(54) | eocd(22)
    const nameBuf = Buffer.from('test.csv', 'utf8');
    const nameLen = nameBuf.length; // 8

    // --- Build tiny zip: only 1 byte of data, but central claims 200 bytes ---
    // Layout (115 bytes total): local(39) | central(54) | eocd(22)
    //   dataStart = 0 + 30 + 8 + 0 = 38
    //   dataEnd   = 38 + 200 = 238 > buffer.length(115) → throws
    const tinyDataLen = 1;
    const lsBuffer = Buffer.alloc(30 + nameLen + tinyDataLen);
    lsBuffer.writeUInt32LE(0x04034b50, 0);
    lsBuffer.writeUInt16LE(0, 4);
    lsBuffer.writeUInt16LE(0, 6);
    lsBuffer.writeUInt16LE(0, 8);
    lsBuffer.writeUInt16LE(0, 10);
    lsBuffer.writeUInt16LE(0x21, 12);
    lsBuffer.writeUInt32LE(0, 14);
    lsBuffer.writeUInt32LE(200, 18); // LIE: claims 200 bytes
    lsBuffer.writeUInt32LE(tinyDataLen, 22);
    lsBuffer.writeUInt16LE(nameLen, 26);
    lsBuffer.writeUInt16LE(0, 28);
    nameBuf.copy(lsBuffer, 30);

    const csBufferOffset = 30 + nameLen + tinyDataLen; // 39
    const csBuffer = Buffer.alloc(46 + nameLen);
    csBuffer.writeUInt32LE(0x02014b50, 0);
    csBuffer.writeUInt16LE(0, 4);
    csBuffer.writeUInt16LE(0, 6);
    csBuffer.writeUInt16LE(0, 8);
    csBuffer.writeUInt16LE(0, 10);
    csBuffer.writeUInt16LE(0, 12);
    csBuffer.writeUInt16LE(0x21, 14);
    csBuffer.writeUInt32LE(0, 16);
    csBuffer.writeUInt32LE(200, 20); // LIE: 200 bytes compressed
    csBuffer.writeUInt32LE(tinyDataLen, 24);
    csBuffer.writeUInt16LE(nameLen, 28);
    csBuffer.writeUInt16LE(0, 30);
    csBuffer.writeUInt16LE(0, 32);
    csBuffer.writeUInt16LE(0, 34);
    csBuffer.writeUInt16LE(0, 36);
    csBuffer.writeUInt32LE(0, 38);
    csBuffer.writeUInt32LE(0, 42); // local header at 0
    nameBuf.copy(csBuffer, 46);

    const eocdBuf = Buffer.alloc(22);
    eocdBuf.writeUInt32LE(0x06054b50, 0);
    eocdBuf.writeUInt16LE(0, 4);
    eocdBuf.writeUInt16LE(0, 6);
    eocdBuf.writeUInt16LE(1, 8);
    eocdBuf.writeUInt16LE(1, 10);
    eocdBuf.writeUInt32LE(46 + nameLen, 12);
    eocdBuf.writeUInt32LE(csBufferOffset, 16);
    eocdBuf.writeUInt16LE(0, 20);

    const tinyTruncated = Buffer.concat([lsBuffer, csBuffer, eocdBuf]);
    // buffer = 39 + 54 + 22 = 115
    // dataStart = 0 + 30 + 8 + 0 = 38
    // dataEnd = 38 + 200 = 238 > 115 → throws truncation

    await expect(extractEntry(tinyTruncated, 'test.csv')).rejects.toThrow('truncated');
  });
});

describe('C. inaturalist multi-taxon pipe encoding', () => {
  let capturedUrl;

  beforeEach(() => {
    capturedUrl = null;
    jest.mock('../../../services/agri/http', () => ({
      fetchJson: jest.fn((url) => {
        capturedUrl = url;
        return Promise.resolve({ results: [] });
      })
    }));
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('taxon_name URL param contains raw pipe between taxa', async () => {
    // Re-import after mock is in place
    jest.isolateModules(() => {
      const inaturalist = require('../../../services/agri/adapters/inaturalist');
      inaturalist
        .fetch(
          {},
          {
            placeId: 7563,
            taxa: 'Spodoptera frugiperda|Hemileia vastatrix',
            withinDays: 90,
            perPage: 200
          }
        )
        .catch(() => {});
    });

    // Allow event loop to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(capturedUrl).not.toBeNull();
    // Space encoding is fine; the pipe between taxa must be raw '|', not %7C
    expect(capturedUrl).toContain('taxon_name=Spodoptera%20frugiperda');
    expect(capturedUrl).toContain('Hemileia%20vastatrix');
    // Raw pipe — encodeURIComponent encodes '|' as %7C; we restore it to '|'
    expect(capturedUrl).toMatch(/taxon_name=([^&]+)/);
    const match = capturedUrl.match(/taxon_name=([^&]+)/);
    expect(match[1]).toContain('|');
    expect(match[1]).not.toContain('%7C');
  });
});
