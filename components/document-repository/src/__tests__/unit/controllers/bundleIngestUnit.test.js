'use strict';

// Story 2.5 AC5 — unit tests: _ingestFileById threads graph_name into the
// dataprep axios payload (the core deliverable of Story 2.5).
// Copyright (c) 2024-2026 International Telecommunication Union (ITU)

jest.mock('../../../../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() }
}));

jest.mock('../../../config/appConfig', () => ({
  upload: { maxFilesUpload: 5 },
  dataprep: { host: 'http://dataprep', port: '5000', ingestPath: '/v1/dataprep' },
  virusScanning: true
}));

jest.mock('../../../services/fileService', () => ({}));
jest.mock('../../../services/metadataService', () => ({
  updateMetadata: jest.fn()
}));
jest.mock('archiver', () => ({ create: jest.fn() }));
jest.mock('axios', () => ({ default: { post: jest.fn() }, post: jest.fn() }));

const axios = require('axios');
const fileController = require('../../../controllers/fileController');

describe('_ingestFileById graph_name threading (Story 2.5 AC5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const okfFile = {
    file_id: 'file-1',
    file_name: 'bundle.md',
    file_type: 'text/markdown',
    labels: ['t:tenant1'],
    storage_path: '/uploads/file-1.md',
    graph_name: 'OKF_a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    dataprep: { status: 'Pending', retract_date: null }
  };

  it('threads graph_name into the dataprep payload (7th key)', async () => {
    fileController._getFileBase64 = jest.fn().mockResolvedValue({ file: okfFile, base64String: 'YjY0' });
    axios.post.mockResolvedValue({ data: { success: true, chunk_count: 3 } });

    const result = await fileController._ingestFileById('file-1');

    expect(result.success).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const payload = axios.post.mock.calls[0][1];
    expect(payload.graphName).toBe('OKF_a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(payload.fileId).toBe('file-1');
    expect(payload.fileName).toBe('bundle.md');
    expect(payload.fileBase64).toBe('YjY0');
  });

  it('sends graphName null for legacy free-form files (backward compat — existing routes unaffected)', async () => {
    const legacyFile = { ...okfFile, graph_name: null, labels: ['Healthcare'] };
    fileController._getFileBase64 = jest.fn().mockResolvedValue({ file: legacyFile, base64String: 'YjY0' });
    axios.post.mockResolvedValue({ data: { success: true } });

    await fileController._ingestFileById('file-1');

    const payload = axios.post.mock.calls[0][1];
    expect(payload.graphName).toBeNull();
  });

  it('does not re-ingest an already-ingested file', async () => {
    const ingestedFile = { ...okfFile, dataprep: { status: 'Ingested' } };
    fileController._getFileBase64 = jest.fn().mockResolvedValue({ file: ingestedFile, base64String: 'YjY0' });

    const result = await fileController._ingestFileById('file-1');

    expect(result.success).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
