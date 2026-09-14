/*
 * producer-service — Story 7.7 (David, 2026-09-14): import document-repository
 * files (pdf, docx, xlsx, md, html, txt — the repo's accepted upload formats,
 * appConfig.js allowedExtensions) into ONE OKF repository, processed, linked
 * and labeled AS A WHOLE. The Source Adapter Framework's Class-0 flagship
 * adapter: the files are ALREADY staged in doc-repo, so this service is pure
 * CONVERSION — it deliberately mirrors crawl-conversion-service's job pattern
 * (conversion record on the repo doc, shared FIFO slot semaphore, sweep,
 * terminal done|failed, batched ingestRepoConcepts, ONE curation pass at the
 * end, index concept LAST) so the dashboard/progress/lifecycle machinery
 * works unchanged. Downstream of this service everything is the normal
 * six-step OKF workflow.
 *
 * SOURCES-BUSY contract (the reason this story exists): ingested documents
 * CAN be imported, but the repository CANNOT be ingested until its source
 * documents are Retracted — lifecycle-service's buildingBlocker refuses the
 * ingest transition while any source_documents[] entry still serves the
 * free-form corpus (live fail-closed re-check, error SOURCES_NOT_RETRACTED).
 * The repo's OWN bundle zip (is_bundle=true, dataprep 'Ingested') is NOT a
 * source document — the gate keys on source_documents[] exclusively.
 */
const config = require('../config');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { authedAxios } = require('./service-token');
const { ingestRepoConcepts } = require('./ingest-service');
const { withSpan } = require('../shared-lib/tracing');
const crawlConversion = require('./crawl-conversion-service');
const { convertXlsx, slugify } = require('./converters/xlsxSheetConverter');

const COLLECTION = 'okf_repositories';

const MAX_FILES = Math.max(1, parseInt(process.env.OKF_MAX_IMPORT_FILES, 10) || 100);
const MAX_SEGMENTS_PER_FILE = 200;
const MIN_SEGMENT_CHARS = 200; // smaller sections merge into the previous one

const live = new Map(); // repo_id -> in-flight runner (same registry discipline as crawl)

async function getDb() {
  return dbService.getConnection();
}

async function patchConversion(repoId, patch) {
  const db = await getDb();
  await db.query(
    `LET doc = DOCUMENT(${COLLECTION}, @repo_id)
     FILTER doc != null
     UPDATE doc WITH { conversion: @patch, updated_at: @now } IN ${COLLECTION}`,
    { repo_id: repoId || '', patch, now: new Date().toISOString() }
  );
}

/** FIFO slot — SHARED with crawl conversion (one heavy conversion at a time). */
async function acquireSlot() {
  return crawlConversion.acquireSlot();
}
function releaseSlot() {
  return crawlConversion.releaseSlot();
}

// ── source stamping ─────────────────────────────────────────────────────────

/** Stamp the repo doc with source_documents[] (kind 'document' — never collides
 * with the crawl 'source_document' stamp) and stamp okf_repo_id onto each
 * source file's doc-repo metadata (Story 3.6's additive field) so the UI can
 * gate "already in an OKF repo". Stamps are fail-soft: the conversion reports
 * them, it does not die for them. */
async function stampSources(repoId, fileIds) {
  const db = await getDb();
  const metas = [];
  for (const file_id of fileIds) {
    let meta = { file_id, file_name: null, file_type: null, size_bytes: null, uploaded_date: null };
    try {
      const res = await authedAxios.get(`${config.documentRepository.url}/api/files/${encodeURIComponent(file_id)}`, {
        timeout: 10000
      });
      const f = (res.data && (res.data.file || res.data)) || {};
      meta = {
        file_id,
        file_name: f.file_name || null,
        file_type: f.file_type || f.type || f.mimetype || null,
        size_bytes: Number.isFinite(f.size) ? f.size : Number.isFinite(f.size_bytes) ? f.size_bytes : null,
        uploaded_date: f.uploaded_date || null,
        dataprep_status: (f.dataprep && f.dataprep.status) || null,
        is_bundle: f.is_bundle === true
      };
    } catch (err) {
      logger.warn('Source-doc meta fetch failed (non-fatal)', { file_id, error: err.message });
    }
    metas.push(meta);
    try {
      await authedAxios.patch(
        `${config.documentRepository.url}/api/files/${encodeURIComponent(file_id)}`,
        { okf_repo_id: repoId },
        { timeout: 10000 }
      );
    } catch (err) {
      logger.warn('okf_repo_id stamp failed (non-fatal)', { file_id, error: err.message });
    }
  }
  try {
    await db.query(
      `LET doc = DOCUMENT(${COLLECTION}, @repo_id)
       FILTER doc != null
       UPDATE doc WITH {
         source_documents: @docs,
         updated_at: @now
       } IN ${COLLECTION}`,
      {
        repo_id: repoId,
        now: new Date().toISOString(),
        docs: metas.map((m) => ({
          kind: 'document',
          file_id: m.file_id,
          file_name: m.file_name,
          file_type: m.file_type,
          size_bytes: m.size_bytes,
          uploaded_date: m.uploaded_date,
          import_state: 'imported',
          retracted_at: null
        }))
      }
    );
  } catch (err) {
    logger.warn('source_documents stamp failed (non-fatal)', { repo_id: repoId, error: err.message });
  }
  return metas;
}

// ── fetch + convert ─────────────────────────────────────────────────────────

async function fetchDocMeta(fileId) {
  const res = await authedAxios.get(`${config.documentRepository.url}/api/files/${encodeURIComponent(fileId)}`, {
    timeout: 10000
  });
  return (res.data && (res.data.file || res.data)) || {};
}

/** Stream /download into a Buffer with a hard byte cap (crawl-parity: the
 * content-length is often absent, so the cap is enforced on accumulation). */
async function downloadToBuffer(fileId, cap) {
  const res = await authedAxios.get(
    `${config.documentRepository.url}/api/files/${encodeURIComponent(fileId)}/download`,
    {
      responseType: 'stream',
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    res.data.on('data', (c) => {
      bytes += c.length;
      if (cap && bytes > cap) {
        res.data.destroy();
        const e = new Error(
          `document too large to convert (${bytes} bytes > limit ${cap}). Raise OKF_MAX_CRAWL_SOURCE_MB.`
        );
        e.code = 'DOC_SOURCE_TOO_LARGE';
        reject(e);
        return;
      }
      chunks.push(c);
    });
    res.data.on('end', () => resolve(Buffer.concat(chunks)));
    res.data.on('error', reject);
  });
}

/** Extract text (or structured drafts) from a document buffer by extension. */
async function convertDocument(buffer, ext, meta) {
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const out = await pdfParse(buffer);
    return { text: (out && out.text) || '' };
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const out = await mammoth.extractRawText({ buffer });
    return { text: (out && out.value) || '' };
  }
  if (ext === '.html' || ext === '.htm') {
    const TurndownService = require('turndown');
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    return { text: td.turndown(buffer.toString('utf8')) };
  }
  if (ext === '.xlsx') {
    return convertXlsx(buffer, meta); // FR-42: dictionary + row-groups, own links
  }
  // .md / .txt and every text/* fallback
  return { text: buffer.toString('utf8') };
}

// ── segmentation + cross-file links ─────────────────────────────────────────

/** Split markdown text into section concepts on H1/H2/H3 headings; a document
 * without usable headings stays ONE concept. Tiny sections merge forward.
 * The locator rides sources[] so popup cards can point at the exact section. */
function segmentMarkdown(text, { baseSlug, title, meta }) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  let cur = { heading: null, lines: [] };
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (m) {
      if (cur.heading !== null || cur.lines.join('').trim()) sections.push(cur);
      cur = { heading: m[2], lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.heading !== null || cur.lines.join('').trim()) sections.push(cur);

  if (sections.length === 0) return [];
  let usable = sections.filter((s) => s.lines.join('').trim().length >= MIN_SEGMENT_CHARS);
  if (usable.length === 0) usable = [sections[0]];
  if (usable.length > MAX_SEGMENTS_PER_FILE) {
    const overflow = usable.slice(MAX_SEGMENTS_PER_FILE - 1).join('');
    usable = usable.slice(0, MAX_SEGMENTS_PER_FILE - 1);
    usable[usable.length - 1].lines.push(overflow); // merged tail — never silently dropped
  }

  return usable.map((s, i) => {
    const multi = usable.length > 1;
    const path = multi ? `${baseSlug}-sec${i + 1}.md` : `${baseSlug}.md`;
    const secTitle = (s.heading && s.heading.trim()) || title || baseSlug;
    return {
      path,
      frontmatter: {
        type: 'topic',
        title: secTitle,
        sources: [
          {
            kind: 'document',
            resource: meta.baseResource,
            file_id: meta.file_id,
            file_name: meta.file_name,
            locator: multi ? `section "${secTitle}"` : 'whole document'
          }
        ]
      },
      body: `${s.lines.join('\n').trim()}\n`
    };
  });
}

/** Cross-file link resolution (the crawl rewriteCrossLinks analog, generalized
 * to the whole corpus): a markdown link whose target resolves to ANOTHER
 * concept in THIS import becomes frontmatter links[]. Self-references and
 * dangling targets never enter the list. Runs AFTER all files are drafted —
 * a file may link to any other. */
function resolveCrossFileLinks(drafts) {
  const pathSet = new Set(drafts.map((d) => d.path.replace(/\.md$/, '')));
  let links = 0;
  for (const d of drafts) {
    const ownId = d.path.replace(/\.md$/, '');
    const resolved = [];
    const seen = new Set();
    const body = String(d.body || '');
    const re = /\[([^\]]*)\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      let target = m[2].replace(/^\.\//, '').split('#')[0].trim();
      if (!target.toLowerCase().endsWith('.md')) target += '.md';
      const id = target.replace(/\.md$/, '');
      if (id === ownId || seen.has(id) || !pathSet.has(id)) continue;
      seen.add(id);
      resolved.push({ to_concept_id: id, label: (m[1] || '').trim() || 'related' });
    }
    if (resolved.length) {
      d.frontmatter = Object.assign({}, d.frontmatter, { links: resolved });
      links += resolved.length;
    }
  }
  return links;
}

// ── the run ──────────────────────────────────────────────────────────────────

async function runDocumentsConversion(job) {
  const { repo_id, file_ids, requested_name, classification, actor } = job;
  const startedAt = new Date().toISOString();
  await patchConversion(repo_id, {
    status: 'converting',
    stage: 'converting',
    requested_name,
    files_done: 0,
    files_total: file_ids.length,
    concepts_done: 0,
    batches_done: 0,
    per_file: [],
    error: null,
    started_at: startedAt,
    finished_at: null
  });

  const assertRepoAlive = async () => {
    const db = await getDb();
    let repo = null;
    try {
      repo = await db.collection(COLLECTION).document(repo_id);
    } catch (err) {
      if (!(err && (err.code === 404 || err.errorNum === 1204 || err.statusCode === 404))) throw err;
    }
    if (!repo || repo.deleted_at) {
      const e = new Error('repository ' + repo_id + ' was deleted mid-conversion — terminating the import');
      e.code = 'REPO_GONE';
      throw e;
    }
  };

  const cap = crawlConversion.maxSourceBytesFromEnv();
  const allDrafts = [];
  const perFile = [];
  let filesDone = 0;

  const flush = async (batch) => {
    if (batch.length === 0) return;
    await assertRepoAlive();
    await ingestRepoConcepts(repo_id, { concepts: batch, classification, skipCuration: true }, actor); // IMPORT (not RAG)
  };

  try {
    for (const file_id of file_ids) {
      await assertRepoAlive();
      const meta = {
        file_id,
        file_name: file_id,
        baseResource: `${config.documentRepository.url}/api/files/${file_id}`
      };
      try {
        const f = await fetchDocMeta(file_id);
        meta.file_name = f.file_name || file_id;
        meta.file_type = f.file_type || f.type || f.mimetype || null;
        const size = Number.isFinite(f.size) ? f.size : null;
        if (size && size > cap) {
          throw Object.assign(new Error(`document too large (${size} > ${cap}) — raise OKF_MAX_CRAWL_SOURCE_MB`), {
            code: 'DOC_SOURCE_TOO_LARGE'
          });
        }
        const buf = await downloadToBuffer(file_id, cap);
        const ext = (String(meta.file_name).match(/(\.[a-z0-9]+)\s*$/i) || [])[1];
        const lower = (ext || '').toLowerCase();
        if (!['.pdf', '.docx', '.xlsx', '.md', '.html', '.htm', '.txt'].includes(lower)) {
          throw Object.assign(new Error(`unsupported document format "${lower || meta.file_name}"`), {
            code: 'DOC_FORMAT_UNSUPPORTED'
          });
        }
        const converted = await convertDocument(buf, lower, meta);
        if (lower === '.xlsx') {
          allDrafts.push(...converted.concepts);
          perFile.push({ file_id, file_name: meta.file_name, status: 'imported', concepts: converted.concepts.length });
        } else {
          const baseSlug = slugify(String(meta.file_name).replace(/\.[^.]+$/, '')) || `document-${perFile.length + 1}`;
          const title =
            String(meta.file_name)
              .replace(/\.[^.]+$/, '')
              .replace(/[-_]+/g, ' ')
              .trim() || baseSlug;
          const drafts = segmentMarkdown(converted.text, { baseSlug, title, meta });
          allDrafts.push(...drafts);
          perFile.push({ file_id, file_name: meta.file_name, status: 'imported', concepts: drafts.length });
        }
      } catch (err) {
        // PER-FILE ISOLATION (the import report's partial-failure framing):
        // one bad document never aborts the batch.
        logger.warn(`Document import failed for file=${file_id}: ${err.message}`);
        perFile.push({
          file_id,
          file_name: meta.file_name,
          status: 'failed',
          error: err.message,
          code: err.code || 'CONVERSION_FAILED'
        });
      }
      filesDone += 1;
      await patchConversion(repo_id, {
        status: 'converting',
        files_done: filesDone,
        per_file: perFile.slice()
      });
    }

    if (allDrafts.length === 0) {
      throw Object.assign(new Error('no concepts could be derived from the selected documents'), {
        code: 'NOTHING_IMPORTED'
      });
    }

    // WHOLE-CORPUS LINKING (David: "processed, linked … as a whole"): one pass
    // across ALL drafts — a file may link any other.
    await patchConversion(repo_id, { status: 'cross-linking', stage: 'cross-linking' });
    const linkCount = resolveCrossFileLinks(allDrafts);

    // Batched ingest (crawl-parity sizes).
    await patchConversion(repo_id, { status: 'classifying', stage: 'classifying' });
    const BATCH = 200;
    let batches = 0;
    for (let i = 0; i < allDrafts.length; i += BATCH) {
      await flush(allDrafts.slice(i, i + BATCH));
      batches += 1;
      await patchConversion(repo_id, { concepts_done: Math.min(allDrafts.length, i + BATCH), batches_done: batches });
    }

    // Rooted-graph index concept LAST (links resolve per-path) — the file set
    // becomes the repository's table of contents.
    const indexTitle = requested_name || 'Imported knowledge base';
    const contents = allDrafts
      .map((d) => `- [${(d.frontmatter && d.frontmatter.title) || d.path.replace(/\.md$/, '')}](./${d.path})`)
      .join('\n');
    await flush([
      {
        path: 'index.md',
        frontmatter: {
          type: 'index',
          title: indexTitle,
          sources: file_ids.map((file_id) => ({ kind: 'document', file_id }))
        },
        body:
          `# ${indexTitle}\n\nThis repository was imported from ${file_ids.length} document(s). ` +
          `The concepts below are the imported content, linked where the documents reference each other.\n\n## Contents\n\n${contents}\n`
      }
    ]);
    batches += 1;

    // WHOLE-CORPUS LABELING: ONE curation pass over the whole import — the
    // SAME shared finalize every adapter uses (crawl parity; fail-soft).
    if (classification) {
      await patchConversion(repo_id, { status: 'classifying', stage: 'curating' });
      try {
        const cDb = await getDb();
        const cRepo = await cDb.collection(COLLECTION).document(repo_id);
        const { runImportCuration } = require('./ingest-service');
        await runImportCuration(repo_id, cRepo, classification);
      } catch (err) {
        logger.warn('Documents curation pass failed (non-fatal)', { repo_id, error: err.message });
      }
    }

    const failedFiles = perFile.filter((p) => p.status === 'failed').length;
    await patchConversion(repo_id, {
      status: 'done',
      stage: 'done',
      files_done: filesDone,
      files_total: file_ids.length,
      concepts_done: allDrafts.length,
      batches_done: batches,
      links: linkCount,
      summary: {
        files_total: file_ids.length,
        files_imported: filesDone - failedFiles,
        files_failed: failedFiles,
        concepts: allDrafts.length,
        links: linkCount
      },
      finished_at: new Date().toISOString()
    });
    logger.info(
      `Documents conversion DONE repo=${repo_id} files=${filesDone}/${file_ids.length} concepts=${allDrafts.length} links=${linkCount}`
    );
  } catch (err) {
    logger.error(`Documents conversion FAILED repo=${repo_id} code=${err.code || '-'}: ${err.message}`);
    await patchConversion(repo_id, {
      status: 'failed',
      error: err.message,
      code: err.code || 'CONVERSION_FAILED',
      per_file: perFile.slice(),
      finished_at: new Date().toISOString()
    });
    throw err;
  }
}

// ── entry ────────────────────────────────────────────────────────────────────

async function startDocumentsConversion({ repo_id, file_ids, requested_name, classification, actor }) {
  if (!repo_id) throw Object.assign(new Error('repo_id is required'), { code: 'VALIDATION_ERROR', status: 400 });
  if (!Array.isArray(file_ids) || file_ids.length === 0) {
    throw Object.assign(new Error('file_ids must be a non-empty array'), { code: 'VALIDATION_ERROR', status: 400 });
  }
  if (file_ids.length > MAX_FILES) {
    throw Object.assign(
      new Error(`too many documents selected (${file_ids.length} > ${MAX_FILES}) — raise OKF_MAX_IMPORT_FILES`),
      { code: 'TOO_MANY_FILES', status: 400 }
    );
  }
  if (new Set(file_ids).size !== file_ids.length) {
    throw Object.assign(new Error('file_ids contains duplicates'), { code: 'VALIDATION_ERROR', status: 400 });
  }

  await crawlConversion.sweepInterruptedOnce();
  if (live.has(repo_id)) {
    throw Object.assign(new Error('a conversion is already running for this repository — wait for it to finish'), {
      code: 'CONVERSION_IN_FLIGHT',
      status: 409
    });
  }

  const queued = {
    status: 'queued',
    stage: 'queued',
    files_done: 0,
    files_total: file_ids.length,
    error: null,
    started_at: new Date().toISOString()
  };
  await patchConversion(repo_id, queued);
  await stampSources(repo_id, file_ids);

  const job = { repo_id, file_ids, requested_name, classification, actor: actor || null };
  const runner = (async () => {
    await acquireSlot();
    try {
      await withSpan('okf.documents.conversion', async (span) => {
        span.setAttribute('okf.repo_id', repo_id);
        span.setAttribute('okf.files_total', file_ids.length);
        await runDocumentsConversion(job);
      });
    } catch {
      // Terminal state already recorded by runDocumentsConversion.
    } finally {
      releaseSlot();
      live.delete(repo_id);
    }
  })();
  live.set(repo_id, runner);
  return queued;
}

function isTerminal(conversion) {
  return !!conversion && ['done', 'failed'].includes(conversion.status);
}

module.exports = {
  startDocumentsConversion,
  isTerminal,
  live,
  // exported for unit tests (pure functions)
  segmentMarkdown,
  resolveCrossFileLinks
};
