// F3: the four dataprep callback routes accept the machine identity
// ('dataprep-service' realm role, mapped scalar by the middleware) and still
// reject plain users. The 403 on PATCH /status was the D5 blocker — every
// ingested doc stuck at 'Ingesting' with no terminal state possible.
jest.mock('../../../middlewares/keycloak-auth-middleware', () => {
  const mockAuthorizeRole = jest.fn((roles) => (req, res, next) => {
    const role = req.headers['x-test-role'];
    if (roles.map((r) => r.toLowerCase()).includes(String(role).toLowerCase())) return next();
    return res.status(403).json({ error: 'FORBIDDEN' });
  });
  return { authenticateToken: (req, res, next) => next(), authorizeRole: mockAuthorizeRole };
});
jest.mock('../../../config/appConfig', () => ({ upload: { uploadDir: 'uploads', allowedMimeTypes: [] }, clamscan: { host: 'clamav', port: 3310 }, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

jest.mock('../../../controllers/fileController', () => ({
  downloadFile: jest.fn((q, r) => r.json({})),
  downloadMultipleFiles: jest.fn((q, r) => r.json({})),
  getFiles: jest.fn((q, r) => r.json({})),
  getMetadata: jest.fn((q, r) => r.json({})),
  searchMetadata: jest.fn((q, r) => r.json({})),
  viewFile: jest.fn((q, r) => r.json({})),
  viewFileInBrowser: jest.fn((q, r) => r.json({})),
  uploadFile: jest.fn((q, r) => r.json({})),
  uploadMultipleFiles: jest.fn((q, r) => r.json({})),
  deleteFile: jest.fn((q, r) => r.json({})),
  deleteMultipleFiles: jest.fn((q, r) => r.json({})),
  getCrawlJob: jest.fn((q, r) => r.json({})),
  getCrawlLogs: jest.fn((q, r) => r.json({})),
  getCrawlMetrics: jest.fn((q, r) => r.json({})),
  ingestFile: jest.fn((q, r) => r.json({})),
  ingestMultipleFiles: jest.fn((q, r) => r.json({})),
  killCrawlTask: jest.fn((q, r) => r.json({})),
  killIngestion: jest.fn((q, r) => r.json({})),
  retractFile: jest.fn((q, r) => r.json({})),
  retractMultipleFiles: jest.fn((q, r) => r.json({})),
  scheduleSiteCrawl: jest.fn((q, r) => r.json({})),
  updateFile: jest.fn((q, r) => r.json({})),
  uploadLink: jest.fn((q, r) => r.json({})),
  addIngestionLog: jest.fn((q, r) => r.json({})),
  getIngestionLogs: jest.fn((q, r) => r.json({})),
  updateFileStatus: jest.fn((q, r) => r.json({})),
}));
jest.mock('../../../controllers/ingestionProgressController', () => ({
  getProgress: jest.fn((q, r) => r.json({ ok: 'progress' })),
  updateProgress: jest.fn((q, r) => r.json({ ok: 'progress-updated' })),
}));
jest.mock('../../../middlewares/fileUpload', () => ({ uploadSingle: (q,r,n)=>n(), uploadMultiple: (q,r,n)=>n(), validateFiles: (q,r,n)=>n() }));

const express = require('express');
const buildRoutes = require('../../../routes/fileRoutes');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/files', buildRoutes);
  return app;
}

async function hit(app, method, path, role) {
  const server = app.listen(0);
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'x-test-role': role }
    });
  } finally { server.closeAllConnections?.(); server.close(); }
}

describe('dataprep callback routes (F3)', () => {
  const app = makeApp();

  it.each([
    ['POST', '/api/files/f1/ingestion-log'],
    ['GET', '/api/files/f1/ingestion-log'],
    ['PATCH', '/api/files/f1/status'],
    ['PATCH', '/api/files/f1/ingestion-progress'],
  ])('%s %s: dataprep-service role → handler runs (200-shape)', async (method, path) => {
    const res = await hit(app, method, path, 'dataprep-service');
    expect(res.status).toBe(200);
  });

  it('PATCH status: plain User role → 403', async () => {
    const res = await hit(app, 'PATCH', '/api/files/f1/status', 'User');
    expect(res.status).toBe(403);
  });

  it('PATCH status: Admin still accepted', async () => {
    const res = await hit(app, 'PATCH', '/api/files/f1/status', 'Admin');
    expect(res.status).toBe(200);
  });
});
