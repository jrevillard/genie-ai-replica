'use strict';

const mockFileRecord = {
  file_id: 'file-abc123',
  file_name: 'test-document.pdf',
  file_size: 1024,
  file_type: 'application/pdf',
  storage_path: './uploads/file-abc123.pdf',
  file_hash: 'sha256hash123',
  labels: ['category-a'],
  author: 'Test Author',
  uploaded_date: '2025-06-01T10:00:00.000Z',
  create_date: '2025-05-15T08:30:00.000Z',
  crawl_date: '',
  source_url: '',
  language: 'en',
  chunk_count: 0,
  dataprep: {
    status: 'Pending',
    ingest_date: '',
    retract_date: ''
  }
};

/**
 * Factory for creating mock file upload objects (multer req.file shape).
 * @param {Object} overrides - Properties to override on the default mock
 * @returns {Object} Mock file upload object
 */
function createMockFile(overrides = {}) {
  return {
    originalname: 'test-document.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.alloc(1024, 'fake pdf content for testing'),
    ...overrides
  };
}

/**
 * Factory for creating mock file metadata records (ArangoDB document shape).
 * @param {Object} overrides - Properties to override on the default mock
 * @returns {Object} Mock file metadata record
 */
function createMockFileRecord(overrides = {}) {
  return {
    ...mockFileRecord,
    ...overrides,
    dataprep: {
      ...mockFileRecord.dataprep,
      ...(overrides.dataprep || {})
    }
  };
}

/**
 * Factory for creating mock file upload request bodies.
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock upload request body
 */
function createMockUploadBody(overrides = {}) {
  return {
    author: 'Test Author',
    labels: [],
    language: '',
    ...overrides
  };
}

module.exports = {
  createMockFile,
  createMockFileRecord,
  createMockUploadBody,
  mockFileRecord
};
