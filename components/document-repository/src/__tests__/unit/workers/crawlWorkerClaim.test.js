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

// The worker streams the crawl output next to the component root; this is
// the directory it resolves.
const uploadDir = path.join(__dirname, '..', '..', '..', '..', appConfig.upload.uploadDir || 'uploads');

// Fake timers freeze Date.now(), so the bound has to come from the REAL
// clock — captured at module load, i.e. before the first jest.useFakeTimers()
// in beforeEach swaps the global Date.
const realNow = Date.now.bind(Date);

// The poll → claim path crosses a real filesystem call (the upload
// directory), and how many event-loop turns a filesystem round-trip needs is
// NOT fixed — it depends on the host's disk and on how loaded the runner is.
// A fixed turn budget is therefore a guess, and it loses that race under CI
// load: the assertion then reads the mock before the claim write lands (the
// flake behind #1706/#1708). Wait for the observable state instead, with a
// hard wall-clock bound — the same "wait for a condition, never guess a
// delay" rule the E2E phases follow.
const WAIT_BOUND_MS = 10000;

const waitFor = async (predicate, description) => {
  const deadline = realNow() + WAIT_BOUND_MS;
  while (!predicate()) {
    if (realNow() > deadline) {
      throw new Error(`Timed out after ${WAIT_BOUND_MS}ms waiting for ${description}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// The claim is the write that puts a job in 'Crawling' with a claimed_at.
const claimWrite = () => jobCollection.update.mock.calls.find((c) => c[1] && c[1].status === 'Crawling');

describe('crawl worker job claim', () => {
  let crawlWorker;
  let dbService;
  let fileService;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    jest.clearAllMocks();
    jest.resetModules();
    jest.isolateModules(() => {
      crawlWorker = require('../../../workers/crawlWorker');
      // The module under test binds FRESH mock instances after resetModules —
      // the handles configured below must be the ones IT sees.
      ({ dbService } = require('../../../__tests__/__mocks__/shared-lib'));
      fileService = require('../../../services/fileService');
    });
    dbService.getConnection.mockResolvedValue(db);
    db.collection.mockReturnValue(jobCollection);
    // ONE Pending job — a fresh Pending job on every tick would make the poll
    // loop crawl forever.
    let pendingClaims = 1;
    db.query.mockImplementation(async (aql) => {
      if (aql.includes("'Crawling'")) return { all: async () => [] };
      const job =
        pendingClaims > 0 ? { _key: 'job-1', file_id: FILE_ID, url: 'http://example.test', depth: 1 } : undefined;
      pendingClaims -= 1;
      return { next: async () => job };
    });
    jest.spyOn(fileService, 'addCrawlLog').mockResolvedValue({});
  });

  afterEach(async () => {
    // The chain continues past the claim: the crawl ends, the stream closes
    // and the job is finalized. Let it settle before the streamed file is
    // removed, so the removal does not race the write and the write stream
    // is closed before the file goes.
    if (claimWrite()) {
      await waitFor(
        // The job leaves 'Crawling' when it is finalized — 'Succeeded',
        // 'Failed' or 'Killed' (the worker's terminal states). A bare "not
        // 'Crawling'" would also match a non-terminal write.
        () =>
          jobCollection.update.mock.calls.some((c) => c[1] && ['Succeeded', 'Failed', 'Killed'].includes(c[1].status)),
        'the crawl job to reach its terminal status'
      );
    }
    // The real timers stay OFF on purpose: the worker's poll loop re-arms
    // itself with setTimeout, so restoring the real clock while that re-arm
    // can still happen turns it into an endless real timer and the worker
    // never exits. Jest's fake timers are per test file, so leaving them
    // installed leaks nothing.
    fs.rmSync(path.join(uploadDir, `${FILE_ID}.md`), { force: true });
  });

  it('claims the job with a claimed_at timestamp', async () => {
    crawlWorker.start();
    await waitFor(() => Boolean(claimWrite()), "the crawl worker's claim write");

    const claim = claimWrite();
    expect(claim).toBeDefined();
    expect(claim[0]).toBe('job-1');
    // The orphan rule depends on this field: without it every job in flight
    // at boot looks like an orphan and gets crawled twice.
    expect(typeof claim[1].claimed_at).toBe('string');
    expect(Number.isNaN(Date.parse(claim[1].claimed_at))).toBe(false);
  });

  it('sees the claim even when the filesystem round-trip takes many event-loop turns', async () => {
    // The regression pin for #1706/#1708: the upload-directory probe the
    // claim path crosses can need any number of event-loop turns — the host
    // decides. A fixed turn budget loses that race; the wait above must not.
    // The spy DELAYS the real call instead of replacing it: the directory
    // probe must still create the upload directory, or the worker's write
    // stream fails with ENOENT on a host where the directory does not exist
    // yet (the suite would then pass only by the first test's side effect).
    const realAccess = fs.promises.access.bind(fs.promises);
    const access = jest.spyOn(fs.promises, 'access').mockImplementation(async (...args) => {
      for (let i = 0; i < 500; i++) await new Promise((resolve) => setImmediate(resolve));
      return realAccess(...args);
    });
    try {
      crawlWorker.start();
      await waitFor(() => Boolean(claimWrite()), "the crawl worker's claim write");

      const claim = claimWrite();
      expect(claim[0]).toBe('job-1');
    } finally {
      access.mockRestore();
    }
  });
});
