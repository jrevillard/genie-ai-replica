// F3 review: clamscan v2.4 reads ONLY options.clamdscan.host — a top-level host
// is a silent no-op and the lib falls back to executing a local clamdscan binary
// that doesn't exist in this image (the original silent-fail bug).
jest.mock('../../../config/appConfig', () => ({
  clamscan: { host: 'clamav', port: 3310, removeInfected: false, quarantineInfected: false, debugMode: false, socket: false, timeout: '60000', localFallback: true, path: '/usr/bin/clamdscan', active: true },
  upload: { uploadDir: 'uploads', allowedMimeTypes: [] },
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
const securityService = require('../../../services/securityService');  // singleton instance

describe('ClamAV options shape (F3)', () => {
  it('host lands inside clamdscan (where clamscan v2.4 actually reads it)', () => {
    expect(securityService.clamAVOptions.clamdscan.host).toBe('clamav');
    expect(securityService.clamAVOptions.clamdscan.port).toBe(3310);
  });
});
