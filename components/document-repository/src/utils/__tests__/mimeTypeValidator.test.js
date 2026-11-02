const { validateFileType } = require('../mimeTypeValidator');

// Locks the file-type v16+ ESM import (fileTypeFromBuffer) and the magic-byte
// double-check — the path the upload E2E bug fixed (5b865adf).
const pad = (magic) => Buffer.concat([Buffer.from(magic), Buffer.alloc(8192)]);

describe('validateFileType', () => {
  it('accepts a file whose magic bytes match an allowed type', async () => {
    const result = await validateFileType({
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
      buffer: pad('%PDF-1.7\n'),
    });
    expect(result.isValid).toBe(true);
  });

  it('rejects a renamed executable via magic-byte detection', async () => {
    const result = await validateFileType({
      originalname: 'evil.pdf',
      mimetype: 'application/pdf',
      buffer: pad('MZ'),
    });
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Detected MIME type/);
  });
});
