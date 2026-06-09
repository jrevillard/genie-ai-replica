'use strict';

const { mockFileRecord } = require('../mocks/files');

const mockCrawledFileRecord = {
  ...mockFileRecord,
  file_id: 'file-crawl456',
  file_name: 'example.com_Home Page.md',
  file_type: 'text/markdown',
  storage_path: null,
  file_hash: '',
  source_url: 'https://example.com',
  author: 'crawler',
  language: 'en',
  crawl_date: '2025-06-01T12:00:00.000Z'
};

const mockIngestedFileRecord = {
  ...mockFileRecord,
  file_id: 'file-ingest789',
  chunk_count: 42,
  dataprep: {
    status: 'Ingested',
    ingest_date: '2025-06-01T11:00:00.000Z',
    retract_date: ''
  }
};

const mockCrawlJob = {
  _key: 'job_file-crawl456',
  file_id: 'file-crawl456',
  url: 'https://example.com',
  status: 'Succeeded',
  depth: 0,
  config: {
    followExternalLinks: false,
    maxExternalDepth: 0,
    singlePage: true
  },
  max_pages: 1,
  pages_crawled: 1,
  kill_requested: false,
  started_at: '2025-06-01T12:00:00.000Z',
  finished_at: '2025-06-01T12:00:05.000Z',
  error_message: null
};

const mockFileUpload = {
  originalname: 'test-document.pdf',
  mimetype: 'application/pdf',
  size: 1024,
  buffer: Buffer.from('fake pdf content')
};

const mockHtmlUpload = {
  originalname: 'page.html',
  mimetype: 'text/html',
  size: 512,
  buffer: Buffer.from('<html><body><p>Hello world this is a test document for language detection</p></body></html>')
};

module.exports = {
  mockFileRecord,
  mockCrawledFileRecord,
  mockIngestedFileRecord,
  mockCrawlJob,
  mockFileUpload,
  mockHtmlUpload
};
