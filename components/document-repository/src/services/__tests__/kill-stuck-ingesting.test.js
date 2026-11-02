/**
 * I.1 pins — stuck-"Ingesting" recovery.
 *
 * 1. reconcileStuckIngesting (boot reconciliation): files orphaned in 'Ingesting'
 *    are moved to 'Ingestion Error' (H1's contract status) with a System log line;
 *    DB failure is non-fatal (boot must not crash).
 * 2. killIngestion forwards dataprep's failure status (404 orphaned task) instead
 *    of a blanket 500 — the UI must see a real kill failure.
 */

// shared-lib is mocked via jest.config.js moduleNameMapper → __mocks__/shared-lib.js
const { dbService } = require('../../shared-lib');
const fileService = require('../fileService');
const metadataService = require('../metadataService');
const fileController = require('../../controllers/fileController');

jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');

describe('reconcileStuckIngesting (I.1 boot reconciliation)', () => {
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = { query: jest.fn() };
    dbService.getConnection.mockResolvedValue(mockDb);
  });

  it("moves 'Ingesting' rows to 'Ingestion Error' and writes a System log line each", async () => {
    mockDb.query.mockResolvedValueOnce({
      all: jest.fn().mockResolvedValue([
        { file_id: 'stuck-1', dataprep: { status: 'Ingestion Error', ingest_date: 'x' } },
        { file_id: 'stuck-2', dataprep: { status: 'Ingestion Error' } },
      ]),
    });
    mockDb.collection = jest.fn().mockReturnValue({
      save: jest.fn().mockResolvedValue({ new: {} }),
    });

    const count = await fileService.reconcileStuckIngesting();

    expect(count).toBe(2);
    const aql = mockDb.query.mock.calls[0][0];
    expect(aql).toContain("FILTER f.dataprep.status == 'Ingesting'");
    expect(aql).toContain("'Ingestion Error'");
    expect(mockDb.collection).toHaveBeenCalledWith('ingestion_log');
    expect(mockDb.collection('ingestion_log').save).toHaveBeenCalledTimes(2);
    const logged = mockDb.collection('ingestion_log').save.mock.calls[0][0];
    expect(logged.file_id).toBe('stuck-1');
    expect(logged.stage).toBe('System');
  });

  it('returns null (retry signal) and does not throw when the DB is unreachable (boot must survive)', async () => {
    dbService.getConnection.mockRejectedValue(new Error('connection refused'));

    await expect(fileService.reconcileStuckIngesting()).resolves.toBeNull();
  });

  it('returns null when the query itself fails mid-flight (non-fatal during, not just before)', async () => {
    mockDb.query.mockRejectedValueOnce(new Error('cursor boom'));

    await expect(fileService.reconcileStuckIngesting()).resolves.toBeNull();
  });

  it('a failed per-file log write is swallowed (status update already applied)', async () => {
    mockDb.query.mockResolvedValueOnce({
      all: jest.fn().mockResolvedValue([{ file_id: 'stuck-1', dataprep: {} }]),
    });
    mockDb.collection = jest.fn().mockReturnValue({
      save: jest.fn().mockRejectedValue(new Error('log write boom')),
    });

    await expect(fileService.reconcileStuckIngesting()).resolves.toBe(1);
  });
});

describe('killIngestion forwards dataprep failures (I.1 kill honesty)', () => {
  it('forwards dataprep 404 (orphaned task) as 404 with its message AND reconciles the row to Ingestion Error', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 404, data: { detail: 'No active ingestion task found for this file.' } },
    });
    metadataService.updateMetadata = jest.fn().mockResolvedValue({});
    fileService.addIngestionLog = jest.fn().mockResolvedValue({});

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await fileController.killIngestion({ params: { fileId: 'orphan-1' } }, res);

    expect(metadataService.updateMetadata).toHaveBeenCalledWith('orphan-1', {
      dataprep: { status: 'Ingestion Error' },
    });
    expect(fileService.addIngestionLog).toHaveBeenCalledWith('orphan-1', expect.objectContaining({ stage: 'System' }));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'No active ingestion task found for this file.',
      })
    );
  });

  it('kill 404 whose reconciliation fails (row already deleted) still returns the 404, never 500', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 404, data: { detail: 'No active ingestion task found for this file.' } },
    });
    metadataService.updateMetadata = jest.fn().mockRejectedValue(new Error('not found'));

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await fileController.killIngestion({ params: { fileId: 'gone' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'No active ingestion task found for this file.' })
    );
  });

  it('network-level failure (no response) still maps to 500 and does not reconcile', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    metadataService.updateMetadata = jest.fn();

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await fileController.killIngestion({ params: { fileId: 'x' } }, res);

    expect(metadataService.updateMetadata).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'ECONNREFUSED' })
    );
  });
});
