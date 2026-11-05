// Zombie-job requeue contract, driven through the real start() entry point
// (what the supervisor invokes on every (re)spawn — issue #991). The worker
// is single-flight: a job still 'Crawling' when it starts has no live owner,
// and the poll loop only picks 'Pending' — so the startup requeue is the
// difference between recovery and permanent starvation. Ordering matters:
// the requeue must complete before the first poll tick (a job the poll just
// claimed would otherwise be flipped back to Pending mid-crawl).

jest.mock('worker_threads', () => ({ Worker: jest.fn(), isMainThread: true }));

// Mock handles are re-fetched after each resetModules (see beforeEach) —
// never cached at top level.
let crawlWorker;
let dbService;
let logger;
let fileService;
let db;
let jobCollection;
let zombieRows = [];
let pendingRows = [];

// The worker issues two queries per boot: the zombie requeue reads
// 'Crawling', the poll loop reads 'Pending'. Dispatch on the AQL so both
// share the mock.
const wireQueries = () => {
  db.query.mockImplementation(async (aql, bind) => {
    if (aql.includes("'Crawling'")) {
      // Honor the boot cutoff the production query applies: a job claimed
      // after this worker started is NOT an orphan.
      const rows =
        bind && bind.bootTime
          ? zombieRows.filter((j) => j.claimed_at == null || j.claimed_at < bind.bootTime)
          : zombieRows;
      return { all: async () => rows };
    }
    return { next: async () => pendingRows.shift() };
  });
};

const flush = async () => {
  // Drain the promise chain: start() → requeue (awaits) → .then(poll) →
  // first poll tick (awaits). Each await round releases one link.
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers(); // contain the poll loop's re-arm timer
  // Fresh module + FRESH mock instances: resetModules re-runs the shared-lib
  // mock factory, so the module under test binds NEW jest.fn objects — a
  // handle kept from before the reset silently points at a dead instance.
  zombieRows = [];
  pendingRows = [];
  jest.resetModules();
  jest.isolateModules(() => {
    crawlWorker = require('../../../workers/crawlWorker');
    ({ dbService, logger } = require('../../../__tests__/__mocks__/shared-lib'));
    fileService = require('../../../services/fileService');
  });
  db = { query: jest.fn(), collection: jest.fn() };
  jobCollection = { update: jest.fn().mockResolvedValue({}) };
  dbService.getConnection.mockResolvedValue(db);
  db.collection.mockReturnValue(jobCollection);
  jest.spyOn(fileService, 'addCrawlLog').mockResolvedValue({});
  wireQueries();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('crawl worker startup zombie requeue', () => {
  it('requeues a Crawling job back to Pending with a WARN crawl log', async () => {
    zombieRows.push({ _key: 'job-1', file_id: 'file-1', status: 'Crawling' });

    crawlWorker.start();
    await flush();

    expect(db.collection).toHaveBeenCalledWith('crawl_job');
    // the dead run's terminal fields are cleared with the requeue
    expect(jobCollection.update).toHaveBeenCalledWith('job-1', {
      status: 'Pending',
      error_message: null,
      finished_at: null,
      pages_crawled: 0
    });
    expect(fileService.addCrawlLog).toHaveBeenCalledWith(
      'file-1',
      'WARN',
      'System',
      expect.stringContaining('requeued')
    );
  });

  it('requeues every zombie, not just the first', async () => {
    zombieRows.push(
      { _key: 'job-1', file_id: 'file-1', status: 'Crawling' },
      { _key: 'job-2', file_id: 'file-2', status: 'Crawling' }
    );

    crawlWorker.start();
    await flush();

    expect(jobCollection.update.mock.calls.map((c) => c[0])).toEqual(['job-1', 'job-2']);
  });

  it('finalizes a kill_requested zombie as Killed instead of requeueing it', async () => {
    zombieRows.push({ _key: 'job-1', file_id: 'file-1', status: 'Crawling', kill_requested: true });

    crawlWorker.start();
    await flush();

    expect(jobCollection.update).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'Killed' }));
    expect(jobCollection.update).not.toHaveBeenCalledWith('job-1', { status: 'Pending' });
    expect(fileService.addCrawlLog).toHaveBeenCalledWith('file-1', 'WARN', 'System', expect.stringContaining('killed'));
  });

  it('a failing job does not strand the remaining zombies', async () => {
    zombieRows.push(
      { _key: 'job-bad', file_id: 'file-bad', status: 'Crawling' },
      { _key: 'job-good', file_id: 'file-good', status: 'Crawling' }
    );
    jobCollection.update.mockImplementation(async (key) => {
      if (key === 'job-bad') throw new Error('write failed');
      return {};
    });

    crawlWorker.start();
    await flush();

    expect(jobCollection.update).toHaveBeenCalledWith('job-good', expect.objectContaining({ status: 'Pending' }));
    expect(fileService.addCrawlLog).toHaveBeenCalledWith(
      'file-good',
      'WARN',
      'System',
      expect.stringContaining('requeued')
    );
  });

  it('leaves a job claimed after the boot untouched (not an orphan)', async () => {
    // A job claimed by a live worker after this one started must not be
    // flipped back to Pending.
    const claimedLater = new Date(Date.now() + 60000).toISOString();
    zombieRows.push({ _key: 'job-live', file_id: 'file-live', status: 'Crawling', claimed_at: claimedLater });

    crawlWorker.start();
    await flush();

    expect(jobCollection.update).not.toHaveBeenCalled();
  });

  it('recovers an orphan in the background requeue when the boot DB never came up', async () => {
    // The boot window exhausts (DB down), the poll loop starts anyway, and the
    // periodic requeue later recovers the orphan instead of stranding it.
    dbService.getConnection.mockRejectedValue(new Error('db down'));
    crawlWorker.start();
    await flush();

    // DB comes back; the orphan (claimed before boot) is there.
    dbService.getConnection.mockResolvedValue(db);
    zombieRows.push({
      _key: 'job-orphan',
      file_id: 'file-orphan',
      status: 'Crawling',
      claimed_at: new Date(Date.now() - 60000).toISOString()
    });

    jest.advanceTimersByTime(5000); // background requeue tick
    await flush();

    expect(jobCollection.update).toHaveBeenCalledWith('job-orphan', expect.objectContaining({ status: 'Pending' }));
  });

  it('retries the requeue on the poll cadence while the DB is down at boot', async () => {
    // Boot-time DB race: first two connection attempts fail, third succeeds.
    // The requeue must retry instead of stranding the previous container's
    // jobs for the whole process lifetime.
    dbService.getConnection.mockRejectedValue(new Error('db down'));
    zombieRows.push({ _key: 'job-1', file_id: 'file-1', status: 'Crawling' });

    crawlWorker.start();
    await flush();
    expect(jobCollection.update).not.toHaveBeenCalled(); // still failing

    dbService.getConnection.mockResolvedValue(db);
    jest.advanceTimersByTime(5000); // background retry → DB is up
    await flush();
    expect(jobCollection.update).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'Pending' }));
  });

  it('stops the background requeue once a pass succeeds', async () => {
    // Steady state must cost no query: the retry loop ends with the first
    // successful pass.
    crawlWorker.start();
    await flush();
    // Count the REQUEUE queries only — the poll loop queries on its own.
    const requeueQueries = () => db.query.mock.calls.filter((c) => String(c[0]).includes("'Crawling'")).length;
    const callsAfterBoot = requeueQueries();

    jest.advanceTimersByTime(60 * 1000);
    await flush();
    expect(requeueQueries()).toBe(callsAfterBoot);
  });

  it('boots cleanly with no zombies and no DB', async () => {
    // No zombies → no writes, and a dead DB must not stop the poll loop from
    // starting (the requeue arms the first tick either way).
    dbService.getConnection.mockRejectedValue(new Error('db down'));

    crawlWorker.start();
    await flush();

    expect(jobCollection.update).not.toHaveBeenCalled();
    expect(fileService.addCrawlLog).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Zombie requeue skipped'));
    // the poll loop is armed (first tick scheduled)
    jest.advanceTimersByTime(5000);
  });
});
