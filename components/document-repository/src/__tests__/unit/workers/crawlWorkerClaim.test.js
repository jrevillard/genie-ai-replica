// The claim write is the pillar of the orphan rule (issue #991): the startup
// requeue only requeues jobs claimed BEFORE this worker started, and that
// distinction exists solely because the claim writes `claimed_at`. This suite
// drives the real poll → claim path (the Crawler is stubbed, the database is
// the mock) and asserts the claim record the orphan rule depends on.

jest.mock('worker_threads', () => ({ Worker: jest.fn(), isMainThread: true }));
jest.mock('../../../utils/crawler', () =>
  jest.fn().mockImplementation(() => ({
    crawl: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn()
  }))
);

const fs = require('fs');
const path = require('path');

const appConfig = require('../../../config/appConfig');

const db = {
  query: jest.fn(),
  collection: jest.fn()
};
const jobCollection = { update: jest.fn().mockResolvedValue({}) };
const FILE_ID = 'claim-test-file';

const uploadDir = path.join(__dirname, '..', '..', '..', appConfig.upload.uploadDir || 'uploads');

// Real event-loop turns: the claim write sits behind real filesystem work
// (the upload directory), so a microtask flush is not enough.
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

afterEach(() => {
  fs.rmSync(path.join(uploadDir, `${FILE_ID}.md`), { force: true });
});

describe('crawl worker job claim', () => {
  let crawlWorker;
  let dbService;
  let fileService;

  beforeEach(() => {
    jest.resetModules();
    jest.isolateModules(() => {
      crawlWorker = require('../../../workers/crawlWorker');
      ({ dbService } = require('../../../__tests__/__mocks__/shared-lib'));
      fileService = require('../../../services/fileService');
    });
    dbService.getConnection.mockResolvedValue(db);
    db.collection.mockReturnValue(jobCollection);
    db.query.mockImplementation(async (aql) => {
      if (aql.includes("'Crawling'")) return { all: async () => [] };
      return { next: async () => ({ _key: 'job-1', file_id: FILE_ID, url: 'http://example.test', depth: 1 }) };
    });
    jest.spyOn(fileService, 'addCrawlLog').mockResolvedValue({});
  });

  it('claims the job with a claimed_at timestamp', async () => {
    crawlWorker.start();
    await flush();

    const claim = jobCollection.update.mock.calls.find((c) => c[1] && c[1].status === 'Crawling');
    expect(claim).toBeDefined();
    expect(claim[0]).toBe('job-1');
    // The orphan rule depends on this field: without it every job in flight
    // at boot looks like an orphan and gets crawled twice.
    expect(typeof claim[1].claimed_at).toBe('string');
    expect(Number.isNaN(Date.parse(claim[1].claimed_at))).toBe(false);
  });
});
