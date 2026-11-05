// Zombie-job requeue (issue #991): the crawl worker is single-flight, so any
// job still 'Crawling' when the worker starts is a leftover from a dead
// predecessor — the poll loop only picks 'Pending', and before this requeue
// such a job starved forever. The requeue must set it back to 'Pending' and
// leave a WARN in the crawl log so the restart is visible to the operator.

jest.mock('worker_threads', () => ({ Worker: jest.fn() }));

const { dbService } = require('../../../__tests__/__mocks__/shared-lib');
const fileService = require('../../../services/fileService');

const db = {
  query: jest.fn(),
  collection: jest.fn()
};
const jobCollection = { update: jest.fn().mockResolvedValue({}) };
let zombieRows = [];

beforeEach(() => {
  jest.clearAllMocks();
  zombieRows = [];
  dbService.getConnection.mockResolvedValue(db);
  db.query.mockResolvedValue({ all: jest.fn().mockImplementation(async () => zombieRows) });
  db.collection.mockReturnValue(jobCollection);
  jest.spyOn(fileService, 'addCrawlLog').mockResolvedValue({});
});

describe('crawlWorker requeueZombieJobs', () => {
  it('requeues a Crawling job back to Pending with a WARN crawl log', async () => {
    const { requeueZombieJobs } = require('../../../workers/crawlWorker');
    zombieRows.push({ _key: 'job-1', file_id: 'file-1', status: 'Crawling' });

    await requeueZombieJobs();

    expect(db.collection).toHaveBeenCalledWith('crawl_job');
    expect(jobCollection.update).toHaveBeenCalledWith('job-1', { status: 'Pending' });
    expect(fileService.addCrawlLog).toHaveBeenCalledWith(
      'file-1',
      'WARN',
      'System',
      expect.stringContaining('requeued')
    );
  });

  it('requeues every zombie, not just the first', async () => {
    const { requeueZombieJobs } = require('../../../workers/crawlWorker');
    zombieRows.push(
      { _key: 'job-1', file_id: 'file-1', status: 'Crawling' },
      { _key: 'job-2', file_id: 'file-2', status: 'Crawling' }
    );

    await requeueZombieJobs();

    expect(jobCollection.update).toHaveBeenCalledTimes(2);
    expect(jobCollection.update.mock.calls.map((c) => c[0])).toEqual(['job-1', 'job-2']);
  });

  it('does nothing when there are no zombies', async () => {
    const { requeueZombieJobs } = require('../../../workers/crawlWorker');

    await requeueZombieJobs();

    expect(jobCollection.update).not.toHaveBeenCalled();
    expect(fileService.addCrawlLog).not.toHaveBeenCalled();
  });

  it('survives a DB failure without throwing (the poll loop still starts)', async () => {
    const { requeueZombieJobs } = require('../../../workers/crawlWorker');
    dbService.getConnection.mockRejectedValue(new Error('db down'));

    await expect(requeueZombieJobs()).resolves.toBeUndefined();
    expect(jobCollection.update).not.toHaveBeenCalled();
  });
});
