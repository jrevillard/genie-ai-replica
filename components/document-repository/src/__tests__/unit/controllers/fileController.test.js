jest.mock('../../../services/fileService', () => ({}));
jest.mock('../../../services/metadataService', () => ({}));
jest.mock('archiver', () => ({ create: jest.fn() }));
jest.mock('axios', () => ({ default: { post: jest.fn() }, post: jest.fn() }));
jest.mock('fs', () => ({
  promises: { access: jest.fn(), readFile: jest.fn() }
}));

const fileController = require('../../../controllers/fileController');

describe('fileController', () => {
  describe('_formatFileRecord', () => {
    it('should map all fields correctly from file record', () => {
      const input = {
        file_id: '123',
        file_name: 'test.pdf',
        file_size: 1024,
        file_type: 'application/pdf',
        storage_path: '/uploads/test.pdf',
        file_hash: 'abc123',
        labels: ['label1'],
        author: 'John',
        uploaded_date: '2025-01-01T00:00:00Z',
        create_date: '2024-12-01T00:00:00Z',
        crawl_date: '',
        source_url: 'https://example.com',
        language: 'en',
        chunk_count: 10,
        dataprep: {
          status: 'Ingested',
          ingest_date: '2025-01-01T00:00:00Z',
          retract_date: ''
        }
      };

      const result = fileController._formatFileRecord(input);

      expect(result.file_id).toBe('123');
      expect(result.file_name).toBe('test.pdf');
      expect(result.file_size).toBe(1024);
      expect(result.file_type).toBe('application/pdf');
      expect(result.storage_path).toBe('/uploads/test.pdf');
      expect(result.file_hash).toBe('abc123');
      expect(result.labels).toEqual(['label1']);
      expect(result.author).toBe('John');
      // Key rename: uploaded_date -> upload_date for backward compatibility
      expect(result.upload_date).toBe('2025-01-01T00:00:00Z');
      expect(result.create_date).toBe('2024-12-01T00:00:00Z');
      expect(result.crawl_date).toBe('');
      expect(result.source_url).toBe('https://example.com');
      expect(result.language).toBe('en');
      expect(result.chunk_count).toBe(10);
      expect(result.dataprep.status).toBe('Ingested');
    });

    it('should not include extra fields from input', () => {
      const input = {
        file_id: '123',
        file_name: 'test.pdf',
        file_size: 1024,
        file_type: 'application/pdf',
        storage_path: '/uploads/test.pdf',
        file_hash: 'abc',
        labels: [],
        author: '',
        uploaded_date: '2025-01-01',
        create_date: '2024-12-01',
        crawl_date: '',
        source_url: '',
        language: 'en',
        chunk_count: 0,
        dataprep: { status: 'Pending', ingest_date: '', retract_date: '' },
        _key: 'secret-key',
        _rev: 'secret-rev',
        extraField: 'should not appear'
      };

      const result = fileController._formatFileRecord(input);
      expect(result._key).toBeUndefined();
      expect(result._rev).toBeUndefined();
      expect(result.extraField).toBeUndefined();
      expect(result.uploaded_date).toBeUndefined(); // Renamed to upload_date
    });
  });

  describe('_processLabels', () => {
    it('should return empty array when no labels', () => {
      expect(fileController._processLabels({})).toEqual([]);
      expect(fileController._processLabels({ labels: null })).toEqual([]);
      expect(fileController._processLabels({ labels: undefined })).toEqual([]);
    });

    it('should pass through array of strings', () => {
      const result = fileController._processLabels({ labels: ['a', 'b', 'c'] });
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should parse JSON string', () => {
      const result = fileController._processLabels({ labels: '["x","y","z"]' });
      expect(result).toEqual(['x', 'y', 'z']);
    });

    it('should split comma-separated string', () => {
      const result = fileController._processLabels({ labels: 'alpha, beta, gamma' });
      expect(result).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('should trim whitespace from labels', () => {
      const result = fileController._processLabels({ labels: '  a , b  ,  c ' });
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should filter out empty labels', () => {
      const result = fileController._processLabels({ labels: ['a', '', '  ', 'b'] });
      expect(result).toEqual(['a', 'b']);
    });

    it('should convert non-string labels to strings', () => {
      const result = fileController._processLabels({ labels: [123, true, null] });
      expect(result).toEqual(['123', 'true', 'null']);
    });

    it('should handle single string value (not array)', () => {
      const result = fileController._processLabels({ labels: 'single' });
      expect(result).toEqual(['single']);
    });

    it('should return empty array on invalid JSON parse', () => {
      // '{invalid}' will fail JSON.parse, then split by comma
      const result = fileController._processLabels({ labels: '{invalid}' });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('_getFileAndPath (path traversal guard)', () => {
    const metadataService = require('../../../services/metadataService');

    it('should throw if fileId is missing', async () => {
      await expect(fileController._getFileAndPath(null)).rejects.toEqual(
        expect.objectContaining({ status: 400, error: 'Missing file ID' })
      );
    });

    it('should throw if metadata not found', async () => {
      metadataService.getMetadataById = jest.fn().mockResolvedValue(null);

      await expect(fileController._getFileAndPath('nonexistent')).rejects.toEqual(
        expect.objectContaining({ status: 404, error: 'File not found' })
      );
    });

    it('should throw if resolved path is outside upload directory', async () => {
      const metadata = {
        file_id: '123',
        file_name: '../../../etc/passwd',
        storage_path: '../../../etc/passwd'
      };
      metadataService.getMetadataById = jest.fn().mockResolvedValue(metadata);

      await expect(fileController._getFileAndPath('123')).rejects.toEqual(
        expect.objectContaining({ status: 400, error: 'Invalid file path' })
      );
    });

    it('should throw if physical file does not exist', async () => {
      const metadata = {
        file_id: '123',
        file_name: 'test.pdf',
        storage_path: './uploads/test.pdf'
      };
      metadataService.getMetadataById = jest.fn().mockResolvedValue(metadata);

      const fs = require('fs');
      fs.promises.access = jest.fn().mockRejectedValue(new Error('ENOENT'));

      await expect(fileController._getFileAndPath('123')).rejects.toEqual(
        expect.objectContaining({ status: 404, error: 'File not found' })
      );
    });

    it('should return file and resolved path for valid file', async () => {
      const metadata = {
        file_id: '123',
        file_name: 'test.pdf',
        storage_path: './uploads/test.pdf'
      };
      metadataService.getMetadataById = jest.fn().mockResolvedValue(metadata);

      const fs = require('fs');
      fs.promises.access = jest.fn().mockResolvedValue();

      const result = await fileController._getFileAndPath('123');
      expect(result.file).toEqual(metadata);
      expect(result.filePath).toBeDefined();
      expect(result.filePath).toContain('uploads');
    });
  });

  describe('_ingestFileById (re-ingestion guard)', () => {
    const axios = require('axios');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('blocks re-ingestion when status is "Ingested" (canonical capitalized form)', async () => {
      jest.spyOn(fileController, '_getFileBase64').mockResolvedValue({
        file: { file_id: 'f1', dataprep: { status: 'Ingested' } },
        base64String: 'b64'
      });

      const result = await fileController._ingestFileById('f1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been ingested/i);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('blocks re-ingestion case-insensitively (lowercase "ingested")', async () => {
      jest.spyOn(fileController, '_getFileBase64').mockResolvedValue({
        file: { file_id: 'f1', dataprep: { status: 'ingested' } },
        base64String: 'b64'
      });

      const result = await fileController._ingestFileById('f1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been ingested/i);
      expect(axios.post).not.toHaveBeenCalled();
    });

    // 'Ingested with Warnings' is indexed but incomplete, and re-ingesting it after
    // raising the phase budget is its documented remedy — so it must NOT be
    // blocked. The hazard is the opposite one: dataprep appends to the graph, so
    // re-ingesting without clearing first leaves two copies of every chunk under
    // one file_id, and the chunk_count written back describes only the new copy.
    describe('a degraded document is re-ingestable, and is cleared first', () => {
      const config = require('../../../config/appConfig');

      beforeEach(() => {
        // The module-level mocks are empty objects; each describe supplies the
        // methods its path actually calls.
        const metadataService = require('../../../services/metadataService');
        const fileService = require('../../../services/fileService');
        metadataService.updateMetadata = jest.fn().mockResolvedValue({});
        fileService.deleteIngestionLogs = jest.fn().mockResolvedValue({});

        jest.spyOn(fileController, '_getFileBase64').mockResolvedValue({
          file: { file_id: 'f1', chunk_count: 260, dataprep: { status: 'Ingested with Warnings' } },
          base64String: 'b64'
        });
        axios.post.mockResolvedValue({ data: { success: true, chunk_count: 3 } });
      });

      it('clears the previous chunks before ingesting', async () => {
        const result = await fileController._ingestFileById('f1');

        expect(result.success).toBe(true);
        const urls = axios.post.mock.calls.map((c) => c[0]);
        const retractIdx = urls.findIndex((u) => String(u).includes(config.dataprep.retractPath));
        const ingestIdx = urls.findIndex((u) => String(u).includes(config.dataprep.ingestPath));

        expect(retractIdx).toBeGreaterThanOrEqual(0);
        expect(ingestIdx).toBeGreaterThanOrEqual(0);
        // Order is the whole point: clearing after the ingest would still duplicate.
        expect(retractIdx).toBeLessThan(ingestIdx);
      });

      it('clears by file_id, not by display name', async () => {
        await fileController._ingestFileById('f1');

        const retractCall = axios.post.mock.calls.find((c) => String(c[0]).includes(config.dataprep.retractPath));
        expect(retractCall[1]).toEqual({ fileId: 'f1' });
      });

      it('leaves a non-degraded re-ingest chunk count alone', async () => {
        // clearedPreviously only guards the degraded path. Initialising it true,
        // or hoisting the assignment out of the branch, would zero the count of a
        // document that was never cleared — Retracted, Ingestion Error, or never
        // ingested — where file.chunk_count is still meaningful. The guard's
        // positive direction is well pinned; this is its negative.
        const metadataService = require('../../../services/metadataService');
        for (const status of ['Retracted', 'Ingestion Error', 'Pending']) {
          jest.clearAllMocks();
          metadataService.updateMetadata = jest.fn().mockResolvedValue({});
          axios.post.mockResolvedValue({
            data: { success: true, status: 200, message: 'Ingestion started in background.' }
          });
          jest.spyOn(fileController, '_getFileBase64').mockResolvedValue({
            file: { file_id: 'f1', chunk_count: 42, dataprep: { status } },
            base64String: 'b64'
          });

          await fileController._ingestFileById('f1');

          const counts = metadataService.updateMetadata.mock.calls.map((c) => c[1].chunk_count);
          expect(counts[counts.length - 1]).toBe(42);
        }
      });

      it('does not reinstate the pre-clear count when the ingest succeeds', async () => {
        // dataprep's ingest response carries no chunk_count ("Ingestion started
        // in background"), so the write-back falls through to `file.chunk_count`
        // — read at the top of the function, i.e. the PREVIOUS run's count of
        // chunks the clear just deleted. That is the same stale number the
        // reset exists to remove, restored 20 lines later.
        const metadataService = require('../../../services/metadataService');

        // dataprep's real ingest response — it starts the ingest in the
        // background and reports no chunk_count, so the write-back has to come
        // from somewhere else. The shared fixture above supplies one, which is
        // not what any deployment returns and would mask this entirely.
        axios.post.mockResolvedValue({
          data: { success: true, status: 200, message: 'Ingestion started in background.' }
        });

        const result = await fileController._ingestFileById('f1');

        expect(result.success).toBe(true);
        const counts = metadataService.updateMetadata.mock.calls.map((c) => c[1].chunk_count);
        // Assert the pre-clear value never comes back, not merely that 0 appears
        // somewhere: the reset already puts a 0 in the list, so `toContain(0)`
        // passed with the stale-number guard removed.
        expect(counts).not.toContain(260);
        expect(counts[counts.length - 1]).toBe(0);
      });

      it('zeroes the chunk count, so a failed ingest does not leave a stale one', async () => {
        // dataprep's retract_file sets the status to 'Retracted'. If the ingest
        // POST then fails, the document would show 'Retracted' beside the
        // previous run's chunk count — a number describing chunks that are gone.
        const metadataService = require('../../../services/metadataService');
        axios.post.mockResolvedValueOnce({ data: { success: true } }).mockRejectedValueOnce(new Error('ingest down'));

        // The ingest POST's rejection propagates to the route's handler, which is
        // where the document is left in exactly the state under test.
        await expect(fileController._ingestFileById('f1')).rejects.toThrow('ingest down');

        expect(metadataService.updateMetadata).toHaveBeenCalledWith('f1', { chunk_count: 0 });
      });

      it('completes the re-ingest when zeroing the chunk count fails', async () => {
        const metadataService = require('../../../services/metadataService');
        // The graph is already empty by this point, so a metadata write failure
        // is cosmetic. Aborting on it would strand the document cleared but
        // still showing the previous run's count — the exact state the zeroing
        // exists to prevent — and would report a failed re-ingest for a
        // successful one.
        // Only the CLEARING write fails, i.e. the first of the two. The success
        // path writes the real count afterwards and that one is pre-existing
        // behaviour for every re-ingest, not this MR's business — pinning it
        // here would quietly widen the change to a path nobody asked about.
        //
        // Distinguished by ORDER, not by value: clearedPreviously makes the
        // success-path write `chunk_count: 0` too, so both calls carry the
        // same number.
        let calls = 0;
        metadataService.updateMetadata = jest.fn(async () => {
          calls += 1;
          if (calls === 1) throw new Error('arango down');
          return {};
        });
        axios.post.mockResolvedValue({
          data: { success: true, status: 200, message: 'Ingestion started in background.' }
        });

        const result = await fileController._ingestFileById('f1');

        expect(result.success).toBe(true);
      });

      it('keeps the ingestion log: it is the diagnosis the operator is reading', async () => {
        const fileService = require('../../../services/fileService');
        await fileController._ingestFileById('f1');

        // _retractFileById would have called this. The degraded re-ingest path
        // must not: the log is what names the cause that made the document
        // degraded in the first place.
        expect(fileService.deleteIngestionLogs).not.toHaveBeenCalled();
      });

      it('aborts rather than double-indexing when the clear fails', async () => {
        axios.post.mockRejectedValueOnce(new Error('dataprep down'));

        const result = await fileController._ingestFileById('f1');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/previous chunks/i);
        // The ingest must not have been attempted — that is the corrupting call.
        const urls = axios.post.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes(config.dataprep.ingestPath))).toBe(false);
      });

      it('aborts when dataprep reports the clear as unsuccessful', async () => {
        axios.post.mockResolvedValueOnce({ data: { success: false, error: 'no such graph' } });

        const result = await fileController._ingestFileById('f1');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/previous chunks/i);
        const urls = axios.post.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes(config.dataprep.ingestPath))).toBe(false);
      });
    });
  });

  // Dataprep's ingest idempotency guard answers 409 when an ingest for the same
  // fileId is already running. That is a SUCCESS signal for the live task, not
  // a file failure: marking the file 'Ingestion Error' poisoned a healthy
  // ingest and left a false permanent ERROR record in the ingestion log.
  describe('_ingestFileById (dataprep 409 idempotency guard)', () => {
    const axios = require('axios');
    const metadataService = require('../../../services/metadataService');
    const fileService = require('../../../services/fileService');

    const conflict = (detail) => {
      const error = new Error('Request failed with status code 409');
      error.response = { status: 409, data: { detail } };
      return error;
    };

    beforeEach(() => {
      jest.clearAllMocks();
      metadataService.updateMetadata = jest.fn().mockResolvedValue({});
      fileService.addIngestionLog = jest.fn().mockResolvedValue({});
      jest.spyOn(fileController, '_getFileBase64').mockResolvedValue({
        file: { file_id: 'f1', dataprep: { status: 'Pending' } },
        base64String: 'b64'
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      // clearAllMocks resets call records, NOT implementations: without this
      // the last 409 rejection stays installed on axios.post and leaks into
      // the next describe, failing an unrelated test with a 409 it never set up.
      axios.post.mockReset();
    });

    it('does not mark the file as Ingestion Error when the ingest is already running', async () => {
      axios.post.mockRejectedValue(conflict("An ingest task for fileId 'f1' is already running"));

      await expect(fileController._ingestFileById('f1')).rejects.toThrow('Request failed with status code 409');

      // The live task owns this file and writes its own final status. A second
      // writer would race it — and 'Ingestion Error' is a poison: the file is
      // never Pending again, so the ingestion worker never re-claims it.
      // Asserting "no write at all" rather than "no write of this shape":
      // a differently-shaped failure write would slip past the weaker form.
      expect(metadataService.updateMetadata).not.toHaveBeenCalled();
    });

    it('records the ignored duplicate as an INFO ingestion-log row, not an ERROR one', async () => {
      axios.post.mockRejectedValue(conflict("An ingest task for fileId 'f1' is already running"));

      await expect(fileController._ingestFileById('f1')).rejects.toThrow();

      expect(fileService.addIngestionLog).toHaveBeenCalledWith(
        'f1',
        expect.objectContaining({ level: 'INFO', stage: 'dataprep' })
      );
      expect(fileService.addIngestionLog).not.toHaveBeenCalledWith('f1', expect.objectContaining({ level: 'ERROR' }));
    });

    // Only the guard's own conflict is carved out: a 409 that names THIS file
    // AND says it is already running. Every other conflict is a real failure
    // and must still mark the file.
    it.each([
      ['is not the idempotency guard at all', 'Conflict: the file is locked'],
      ['names this file but is not the guard', "Conflict: fileId 'f1' is locked"],
      ['names a different file', "An ingest task for fileId 'other-file' is already running"],
      [
        "names a file whose id merely contains ours ('f1' is inside 'f12')",
        "An ingest task for fileId 'f12' is already running"
      ]
    ])('still errors on a 409 that %s', async (_case, detail) => {
      axios.post.mockRejectedValue(conflict(detail));

      await expect(fileController._ingestFileById('f1')).rejects.toThrow('Request failed with status code 409');

      expect(metadataService.updateMetadata).toHaveBeenCalledWith(
        'f1',
        expect.objectContaining({ dataprep: expect.objectContaining({ status: 'Ingestion Error' }) })
      );
      expect(fileService.addIngestionLog).toHaveBeenCalledWith('f1', expect.objectContaining({ level: 'ERROR' }));
    });

    it('still errors on a 409 after a degraded clear already destroyed the file chunks', async () => {
      // The 'Ingested with Warnings' path retracts the file's chunks and
      // zeroes its count BEFORE the ingest POST. A 409 arriving after that
      // leaves the file wiped — so it must be reported as a failure, not
      // shrugged off as a duplicate.
      jest.spyOn(fileController, '_getFileBase64').mockResolvedValue({
        file: { file_id: 'f1', chunk_count: 260, dataprep: { status: 'Ingested with Warnings' } },
        base64String: 'b64'
      });
      // The retract (first POST) succeeds; the ingest (second POST) gets the 409.
      axios.post
        .mockResolvedValueOnce({ data: { success: true } })
        .mockRejectedValueOnce(conflict("An ingest task for fileId 'f1' is already running"));

      await expect(fileController._ingestFileById('f1')).rejects.toThrow('Request failed with status code 409');

      expect(metadataService.updateMetadata).toHaveBeenCalledWith(
        'f1',
        expect.objectContaining({ dataprep: expect.objectContaining({ status: 'Ingestion Error' }) })
      );
      expect(fileService.addIngestionLog).toHaveBeenCalledWith('f1', expect.objectContaining({ level: 'ERROR' }));
    });
  });

  describe('_retractFileById (retraction guard)', () => {
    const axios = require('axios');
    const metadataService = require('../../../services/metadataService');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('blocks retraction when status is "Retracted" (canonical capitalized form)', async () => {
      metadataService.getMetadataById = jest.fn().mockResolvedValue({
        file_id: 'f1',
        dataprep: { status: 'Retracted' }
      });

      const result = await fileController._retractFileById('f1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been retracted/i);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('blocks retraction case-insensitively (lowercase "retracted")', async () => {
      metadataService.getMetadataById = jest.fn().mockResolvedValue({
        file_id: 'f1',
        dataprep: { status: 'retracted' }
      });

      const result = await fileController._retractFileById('f1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been retracted/i);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('cleans up ingestion logs on successful retraction', async () => {
      const fileService = require('../../../services/fileService');
      fileService.deleteIngestionLogs = jest.fn().mockResolvedValue(3);

      metadataService.getMetadataById = jest.fn().mockResolvedValue({
        file_id: 'f1',
        dataprep: { status: 'Ingested', ingest_date: '2025-01-01T00:00:00Z' }
      });
      metadataService.updateMetadata = jest.fn().mockResolvedValue(true);
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });

      const result = await fileController._retractFileById('f1');

      expect(result.success).toBe(true);
      expect(metadataService.updateMetadata).toHaveBeenCalledWith(
        'f1',
        expect.objectContaining({ dataprep: expect.objectContaining({ status: 'retracted' }) })
      );
      expect(fileService.deleteIngestionLogs).toHaveBeenCalledWith('f1');
    });
  });

  describe('ingestMultipleFiles (batch HTTP handler)', () => {
    let req, res;

    beforeEach(() => {
      jest.clearAllMocks();
      req = { body: { fileIds: ['f1', 'f2'] } };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns 207 with per-file results when all files ingest successfully', async () => {
      jest.spyOn(fileController, '_ingestFileById').mockResolvedValue({ success: true });

      await fileController.ingestMultipleFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(207);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          successCount: 2,
          failureCount: 0,
          results: expect.arrayContaining([
            { fileId: 'f1', success: true },
            { fileId: 'f2', success: true }
          ])
        })
      );
    });

    it('returns 207 with all failures when no file is found', async () => {
      jest
        .spyOn(fileController, '_ingestFileById')
        .mockRejectedValue(Object.assign(new Error('File metadata not found in database'), { status: 404 }));

      await fileController.ingestMultipleFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(207);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          successCount: 0,
          failureCount: 2,
          results: expect.arrayContaining([
            { fileId: 'f1', success: false, error: expect.stringMatching(/not found/i) },
            { fileId: 'f2', success: false, error: expect.stringMatching(/not found/i) }
          ])
        })
      );
    });

    it('returns 207 with mixed per-file outcomes', async () => {
      jest.spyOn(fileController, '_ingestFileById').mockImplementation(async (id) => {
        if (id === 'f1') return { success: true };
        return { success: false, error: 'File has already been ingested' };
      });

      await fileController.ingestMultipleFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(207);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          successCount: 1,
          failureCount: 1,
          results: [
            { fileId: 'f1', success: true },
            { fileId: 'f2', success: false, error: expect.stringMatching(/already been ingested/i) }
          ]
        })
      );
    });

    it('returns 400 when request body fails Joi validation', async () => {
      req.body = { fileIds: [] }; // empty array fails min(1)
      const spy = jest.spyOn(fileController, '_ingestFileById');

      await fileController.ingestMultipleFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Validation error' }));
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('retractMultipleFiles (batch HTTP handler)', () => {
    let req, res;

    beforeEach(() => {
      jest.clearAllMocks();
      req = { body: { fileIds: ['f1', 'f2'] } };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns 207 with per-file results when all files retract successfully', async () => {
      jest.spyOn(fileController, '_retractFileById').mockResolvedValue({ success: true });

      await fileController.retractMultipleFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(207);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          successCount: 2,
          failureCount: 0,
          results: expect.arrayContaining([
            { fileId: 'f1', success: true },
            { fileId: 'f2', success: true }
          ])
        })
      );
    });

    it('returns 207 with all failures when no file is found', async () => {
      jest
        .spyOn(fileController, '_retractFileById')
        .mockRejectedValue(Object.assign(new Error('File metadata not found in database'), { status: 404 }));

      await fileController.retractMultipleFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(207);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          successCount: 0,
          failureCount: 2
        })
      );
    });

    it('returns 207 with mixed per-file outcomes (e.g. already retracted)', async () => {
      jest.spyOn(fileController, '_retractFileById').mockImplementation(async (id) => {
        if (id === 'f1') return { success: true };
        return { success: false, error: 'File has already been retracted' };
      });

      await fileController.retractMultipleFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(207);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          successCount: 1,
          failureCount: 1,
          results: [
            { fileId: 'f1', success: true },
            { fileId: 'f2', success: false, error: expect.stringMatching(/already been retracted/i) }
          ]
        })
      );
    });

    it('returns 400 when request body fails Joi validation', async () => {
      req.body = { fileIds: [] };
      const spy = jest.spyOn(fileController, '_retractFileById');

      await fileController.retractMultipleFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Validation error' }));
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
