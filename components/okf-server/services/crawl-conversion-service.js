/**
 * crawl-conversion-service — server-side, streaming crawl→OKF conversion jobs.
 *
 * WHY THIS EXISTS (David, 2026-09-01/02)
 * --------------------------------------
 * The original design did the conversion IN THE BROWSER: download the crawled
 * .md, split client-side, POST concept batches. That architecture caps out
 * far below the 10 GB requirement — browser memory, main-thread freezes
 * (the "whole UI locks up" complaint), Kong's 60s route read_timeout killing
 * slow batches (live: a 109 MB wikipedia crawl died after 15 concepts), and
 * the tab having to stay open for the whole run.
 *
 * NOW: the frontend only TRIGGERS the conversion (POST returns 202
 * immediately — no long-running request behind the gateway). This service
 * streams the RAW file from doc-repo (/api/files/:id/download) line-by-line
 * (never fully in RAM → 10 GB works),
 * splits on `## Source:` markers, sanitizes, batches and ingests IN-PROCESS
 * (no HTTP hop), and writes live progress onto the repo document
 * (`repo.conversion`), which the frontend polls with short requests.
 *
 * The same crawl file can be converted multiple times — each run gets its
 * own repo (unique-name loop lives in the controller now, server-side) and
 * therefore its own conversion record: full traceability.
 *
 * MEMORY BOUNDS: one PAGE in memory at a time + one ≤4 MiB batch. The
 * 10 GB source never materializes. Mode A (whole crawl = one concept) is
 * inherently RAM- and body-bound: it is guarded to files that fit one
 * request (≈45 MB) with a clear error pointing at mode B.
 */

const readline = require('readline');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { authedAxios } = require('./service-token');
const { ingestRepoConcepts, buildMegaConcept } = require('./ingest-service');
const { withSpan } = require('../shared-lib/tracing');

const COLLECTION = 'okf_repositories';

/**
 * DB access — the DEPLOYED shared-lib (root shared/lib, copied to
 * /app/shared-lib by the Dockerfile) exposes getConnection(name), NOT getDb.
 * Resolve PER CALL: the shared-lib health-checks and recreates connections
 * itself, and a long-lived cached handle goes stale when its cleanup routine
 * drops idle connections mid-conversion (live: "No connection found for
 * default" killed a batch after a 21-minute PII-slow flush).
 */
async function getDb() {
  return dbService.getConnection('default');
}
/** DEBUG LOGGING (David, 2026-09-02): OKF_CONVERSION_DEBUG=1 turns on
 * fine-grained per-page/per-flush tracing. Values are embedded IN THE
 * MESSAGE STRING — winston strips structured metadata in this deployment
 * (long-standing gotcha), so msg-only is what actually reaches the logs. */
const DEBUG = process.env.OKF_CONVERSION_DEBUG === '1';
function dlog(msg) {
  if (DEBUG) logger.info(`[conv:debug] ${msg}`);
}
/** Serialized-bytes budget per ingest flush (mirrors the old client logic). */
const BATCH_BYTES = 4 * 1024 * 1024;
/** Concept count per flush — ingest-service caps ONE request at 200; the
 * in-process call still funnels through _ingestWithCap, so respect it. */
const BATCH_CONCEPTS = 200;
/** Progress patch cadence while accumulating a page (bytes). */
const PROGRESS_BYTES = 8 * 1024 * 1024;
/** Progress patch cadence during the split loop (pages). */
const PROGRESS_PAGES = 50;
/** Mode A ceiling: the whole file must fit ONE ingest payload (50mb chain). */
const MODE_A_SOURCE_LIMIT_BYTES = 45 * 1024 * 1024;
/** Per-file source cap (the deployment knob, authoritative here). */
const DEFAULT_MAX_CRAWL_SOURCE_MB = 10240;
/** Max conversions running at once (heavy jobs). */
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.OKF_MAX_CONCURRENT_CONVERSIONS || '2', 10) || 2);

const ACTIVE_STATES = ['queued', 'downloading', 'splitting', 'adding'];

/** repo_id → live runner promise (in-process registry). */
const live = new Map();
/** Simple FIFO semaphore so heavy conversions don't stampede the DB/LLM. */
const waiting = [];
let running = 0;
let swept = false;

/** Resolve the per-file cap in bytes (OKF_MAX_CRAWL_SOURCE_MB, 10 GB default). */
function maxSourceBytesFromEnv() {
  const parsed = parseInt(process.env.OKF_MAX_CRAWL_SOURCE_MB || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 * 1024 : DEFAULT_MAX_CRAWL_SOURCE_MB * 1024 * 1024;
}

/**
 * One-time sweep: jobs interrupted by a server restart are marked failed.
 * Lazy (first startConversion call) — the DB connection is not up at require
 * time. In-process `live` runners are never touched (a restarted process has
 * an empty registry by definition).
 */
async function sweepInterruptedOnce() {
  if (swept) return;
  swept = true;
  try {
    const db = await getDb();
    await db.query(
      `
      FOR r IN ${COLLECTION}
        FILTER r.conversion != null && r.conversion.status IN @active
        UPDATE r WITH { conversion: MERGE(r.conversion, {
          status: 'failed',
          error: 'interrupted by server restart — start the conversion again',
          finished_at: DATE_ISOFORMAT(DATE_NOW())
        })} IN ${COLLECTION}
    `,
      { active: ACTIVE_STATES }
    );
  } catch (err) {
    logger.warn('Conversion sweep failed (non-fatal)', { error: err.message });
  }
}

/**
 * Patch `conversion` fields on the repo doc. Keep-soft: progress writes are
 * best-effort — a failed progress patch must never kill the conversion.
 */
async function patchConversion(repoId, patch) {
  try {
    const db = await getDb();
    await db.query(
      `
      LET doc = DOCUMENT(${COLLECTION}, @repo_id)
      FILTER doc != null
      UPDATE doc WITH { conversion: MERGE(IS_NULL(doc.conversion) ? {} : doc.conversion, @patch) } IN ${COLLECTION}
    `,
      { repo_id: repoId, patch: { ...patch, updated_at: new Date().toISOString() } }
    );
  } catch (err) {
    logger.warn('Conversion progress patch failed (non-fatal)', { repo_id: repoId, error: err.message });
  }
}

/**
 * SOURCE PROVENANCE (David, 2026-09-02): a repo created from a doc-repo
 * document must SHOW that document in the editor — stamp its details on the
 * repo doc at conversion start (fail-soft: a lookup failure leaves the id
 * only, never blocks the conversion). The editor renders
 * `repo.source_document` as the "Source document" panel.
 */
async function stampSourceDocument(repoId, { file_id, url, crawl_job_id }) {
  try {
    const res = await authedAxios.get(`${config.documentRepository.url}/api/files/${encodeURIComponent(file_id)}`, {
      timeout: 10000
    });
    const f = (res.data && (res.data.file || res.data)) || {};
    const db = await getDb();
    // The metadata size doubles as the cap/mode-A guard + progress total
    // (/download streams chunked with no content-length).
    await db.query(
      `LET doc = DOCUMENT(${COLLECTION}, @repo_id)
       FILTER doc != null
       UPDATE doc WITH {
         source_document: {
           kind: 'crawl',
           file_id: @file_id,
           file_name: @file_name,
           size_bytes: @size_bytes,
           file_type: @file_type,
           uploaded_date: @uploaded_date,
           url: @url,
           crawl_job_id: @crawl_job_id,
           generated_at: @generated_at
         },
         updated_at: @generated_at
       } IN ${COLLECTION}`,
      {
        repo_id: repoId,
        file_id,
        file_name: f.file_name || null,
        size_bytes: Number.isFinite(f.size) ? f.size : Number.isFinite(f.size_bytes) ? f.size_bytes : null,
        file_type: f.file_type || f.type || null,
        uploaded_date: f.uploaded_date || null,
        url: url || null,
        crawl_job_id: crawl_job_id || null,
        generated_at: new Date().toISOString()
      }
    );
    const size = Number.isFinite(f.size) ? f.size : Number.isFinite(f.size_bytes) ? f.size_bytes : null;
    return { file_name: f.file_name || null, size_bytes: size };
  } catch (err) {
    logger.warn('Source-document stamp failed (non-fatal)', { repo_id: repoId, file_id, error: err.message });
    return null;
  }
}

/** FIFO semaphore slot acquisition. */
function acquireSlot() {
  return new Promise((resolve) => {
    if (running < MAX_CONCURRENT) {
      running += 1;
      resolve();
    } else {
      waiting.push(resolve);
    }
  });
}

function releaseSlot() {
  running -= 1;
  const next = waiting.shift();
  if (next) {
    running += 1;
    next();
  }
}

/**
 * Port of the frontend sanitizer (crawlerToOkfService.sanitizeConceptBody):
 * external images → plain links (the editor CSP is img-src 'self' data:),
 * multi-line "card" links unwrapped. Runs server-side now so the 10 GB
 * source never touches a browser.
 */
function sanitizeCrawlBody(body) {
  if (!body) return body;
  let out = String(body);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, url) => {
    const text = (alt || '').trim() || 'image';
    return `[${text}](${url})`;
  });
  out = out.replace(/\[\s*\n+([^\]]*?)\s*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, inner, url) => {
    const lines = inner
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return `[link](${url})`;
    const head = lines[0].replace(/^#+\s*/, '');
    const rest = lines.slice(1);
    const linkLine = `[${head}](${url})`;
    return rest.length > 0 ? `${linkLine}\n\n${rest.join('\n\n')}` : head ? linkLine : `[link](${url})`;
  });
  return out;
}

/** Open a streaming read of the crawled markdown from doc-repo. */
async function openSourceStream(fileId) {
  // /download streams the RAW file (express sendFile). /view would return a
  // JSON envelope with the file base64-encoded — markers would never match.
  const res = await authedAxios.get(`${config.documentRepository.url}/api/files/${fileId}/download`, {
    responseType: 'stream',
    // Idle-timeout only: a 10 GB download is legitimately slow, but a
    // stalled stream must fail. axios applies `timeout` between bytes.
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });
  return res;
}

/**
 * Stream-split the temp file into crawled pages, invoking onPage({url, body})
 * for every non-empty page. The SINGLE shared split implementation — the
 * cross-link map pass and the rewrite+ingest pass see IDENTICAL pages
 * (David: "we cannot afford any problems with splitting").
 */
async function iteratePages(tmpPath, onPage) {
  const rl = readline.createInterface({ input: fs.createReadStream(tmpPath), crlfDelay: Infinity });
  let current = null; // { url, lines: [] }
  const closePage = async () => {
    if (!current) return;
    const pageUrl = current.url || '';
    let body = current.lines.join('\n');
    current = null;
    body = body.replace(/^---\s*\n/, '');
    body = body
      .split('\n')
      .filter((line) => line.trim() !== '---')
      .join('\n')
      .trim();
    if (!body) return;
    await onPage({ url: pageUrl, body });
  };
  for await (const line of rl) {
    const marker = line.match(/^## Source:\s*(.*?)\s*$/);
    if (marker) {
      await closePage();
      current = { url: marker[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  await closePage();
}

/**
 * Normalize a crawl URL to the cross-link map key (scheme/www/fragment/
 * trailing-slash insensitive) so links like
 * https://www.x.example/p/#sec still resolve to the crawled page.
 */
function crawlUrlKey(u) {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return String(u).trim().toLowerCase();
  }
}

/**
 * Rewrite markdown links pointing at OTHER crawled pages into
 * concept-relative links (./path.md). Out-of-crawl links stay absolute.
 */
function rewriteCrossLinks(body, pageMap) {
  if (!body || !pageMap || pageMap.size === 0) return body;
  return String(body).replace(/\]\((https?:\/\/[^)\s]+)\)/g, (m, linkUrl) => {
    const target = pageMap.get(crawlUrlKey(linkUrl));
    return target ? `](./${target})` : m;
  });
}

/**
 * DOWNLOAD phase: stream doc-repo's raw response to a local temp file.
 * Enforces the per-file cap MID-STREAM (metadata sizes can lie). Resolves
 * with the byte count downloaded. The caller owns unlinking the file.
 */
async function downloadToTempFile(repoId, res, cap, onBytes) {
  const tmpPath = path.join(os.tmpdir(), `okf-conv-${repoId}.md`);
  const out = fs.createWriteStream(tmpPath);
  let bytes = 0;
  await new Promise((resolve, reject) => {
    res.data.on('data', (chunk) => {
      bytes += chunk.length;
      out.write(chunk);
      if (bytes > cap) {
        out.destroy();
        res.data.destroy(new Error('exceeded the per-file source cap'));
        return;
      }
      if (typeof onBytes === 'function') onBytes(bytes);
    });
    res.data.on('end', () => out.end());
    res.data.on('error', (e) => {
      out.destroy();
      reject(e);
    });
    out.on('error', reject);
    out.on('finish', resolve);
  });
  return { tmpPath, bytes };
}

/** Slug a URL/path to a concept path (same shape as ingest-service's). */
function conceptPathForUrl(url, fallbackIndex) {
  if (!url) return `crawl-page-${fallbackIndex}.md`;
  try {
    const u = new URL(url);
    const slug = `${u.hostname}${u.pathname}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return (slug || `crawl-page-${fallbackIndex}`) + '.md';
  } catch {
    return `crawl-page-${fallbackIndex}.md`;
  }
}

function deriveTitleFromBody(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

/**
 * Run the conversion for one repo. Resolves when the job reaches a terminal
 * state; progress is visible on the repo doc the whole time.
 */
async function runConversion(job) {
  const { repo_id, file_id, url, split_mode, requested_name, actor } = job;
  dlog(`job start repo=${repo_id} file=${file_id} url=${url || '-'} mode=${split_mode} name=${requested_name || '-'}`);
  const startedAt = new Date().toISOString();
  await patchConversion(repo_id, {
    status: 'downloading',
    stage: 'downloading',
    requested_name,
    bytes_done: 0,
    bytes_total: null,
    pages_done: 0,
    batches_done: 0,
    error: null,
    started_at: startedAt,
    finished_at: null
  });

  let bytesTotal = null;
  let bytesDone = 0;
  let pagesDone = 0;
  let batchesDone = 0;
  let nextProgressBytes = PROGRESS_BYTES;
  let nextProgressPages = PROGRESS_PAGES;
  let tmpPath = null;
  const pagePaths = [];

  const flushBatch = async (concepts) => {
    if (concepts.length === 0) return;
    const t0 = Date.now();
    dlog(
      `flush repo=${repo_id} batch=${batchesDone + 1} concepts=${concepts.length} bytes≈${pendingApprox(concepts)} started=${t0 % 100000}`
    );
    await ingestRepoConcepts(repo_id, { concepts }, actor);
    batchesDone += 1;
    dlog(`flush done repo=${repo_id} batch=${batchesDone} concepts=${concepts.length} ms=${Date.now() - t0}`);
    await patchConversion(repo_id, {
      status: 'adding',
      stage: 'adding',
      bytes_done: bytesDone,
      pages_done: pagesDone,
      batches_done: batchesDone
    });
  };

  // Rough serialized size for the debug line (no stringify of big bodies).
  function pendingApprox(list) {
    return list.reduce((n, c) => n + (c.body ? c.body.length : 0), 0);
  }

  try {
    // Size authority, in order: doc-repo metadata (fetched at start), then
    // the response content-length. /download often streams chunked with no
    // content-length — without the metadata size, the cap + mode-A guard
    // and the progress bar would silently never fire.
    const metaSize = Number(job.source_size);
    const res = await openSourceStream(file_id);
    dlog(
      `stream open file=${file_id} status=${res.status} len=${res.headers && res.headers['content-length']} metaSize=${Number.isFinite(metaSize) ? metaSize : '-'}`
    );
    const lenHeader = parseInt(
      res.headers && (res.headers['content-length'] || res.headers['x-original-content-length']),
      10
    );
    if (Number.isFinite(metaSize) && metaSize > 0) bytesTotal = metaSize;
    else if (Number.isFinite(lenHeader) && lenHeader > 0) bytesTotal = lenHeader;
    const sourceBytes = bytesTotal;

    // Per-file cap + mode A body limit — fail BEFORE any ingest work.
    const cap = maxSourceBytesFromEnv();
    if (Number.isFinite(sourceBytes) && sourceBytes > cap) {
      const e = new Error(
        `The crawled file is too large to convert (${fmtBytes(sourceBytes)} > limit ${fmtBytes(cap)}). Raise OKF_MAX_CRAWL_SOURCE_MB to allow it.`
      );
      e.code = 'CRAWL_SOURCE_TOO_LARGE';
      throw e;
    }
    if (split_mode === 'A' && Number.isFinite(sourceBytes) && sourceBytes > MODE_A_SOURCE_LIMIT_BYTES) {
      const e = new Error(
        `Whole-crawl mode needs the file to fit a single ingest payload (limit ${fmtBytes(MODE_A_SOURCE_LIMIT_BYTES)}); this file is ${fmtBytes(sourceBytes)}. Use "One concept per page" — it scales to the deployment cap.`
      );
      e.code = 'MODE_A_TOO_LARGE';
      throw e;
    }

    // DOWNLOAD phase — stream to a temp file first. The in-process ingest of
    // a batch can take minutes (PII/LLM retries); doing it while the source
    // socket idles gets the stream ABORTED upstream (live: attempt 3 died
    // with 'aborted' at 4.6 MB). A local temp file decouples them completely.
    const effectiveCap = split_mode === 'A' ? Math.min(cap, MODE_A_SOURCE_LIMIT_BYTES) : cap;
    const dl = await downloadToTempFile(repo_id, res, effectiveCap, (b) => {
      if (b >= nextProgressBytes) {
        nextProgressBytes += PROGRESS_BYTES;
        patchConversion(repo_id, {
          status: 'downloading',
          bytes_done: b,
          bytes_total: bytesTotal,
          pages_done: 0,
          batches_done: 0
        });
      }
    });
    tmpPath = dl.tmpPath;
    bytesDone = dl.bytes;
    bytesTotal = bytesTotal || bytesDone; // no length source → real download size

    // SPLIT + ADD phases read from the local temp file — no upstream socket.
    if (split_mode === 'A') {
      await patchConversion(repo_id, { status: 'splitting', bytes_done: bytesDone, bytes_total: bytesTotal });
      const raw = (await fs.promises.readFile(tmpPath)).toString('utf8');
      const mega = buildMegaConcept(raw, file_id);
      if (mega.length > 0) {
        // Mode B pushes {path, title}; keep the same shape so the index
        // block below can render entries for both modes.
        pagePaths.push({ path: mega[0].path, title: mega[0].frontmatter && mega[0].frontmatter.title });
        await flushBatch(mega);
      }
      pagesDone = mega.length;
    } else {
      // CROSS-LINKING (David, 2026-09-02): "topics must be cross-linked where
      // appropriate across files". The OKF graph derives direct page-to-page
      // edges from concept-relative markdown links, so we rewrite links that
      // point at OTHER crawled pages from absolute URLs to ./path.md. A page
      // may link forward, so the map must be complete BEFORE any rewrite:
      // PASS 1 splits and collects the map (bodies discarded), PASS 2 splits
      // identically, rewrites links and ingests. ONE shared iterator keeps
      // the two passes bit-identical — no split divergence, ever.
      await patchConversion(repo_id, { status: 'splitting', bytes_done: bytesDone, bytes_total: bytesTotal });

      const pageMap = new Map(); // normalized crawl url -> concept path
      let mapIndex = 0;
      await iteratePages(tmpPath, ({ url, body }) => {
        mapIndex += 1;
        if (url) pageMap.set(crawlUrlKey(url), conceptPathForUrl(url, mapIndex));
        if (body.length === 0) return; // never (iterator skips empties)
      });

      let pending = []; // concepts awaiting a batch flush
      let pendingBytes = 0;
      let addIndex = 0;
      await iteratePages(tmpPath, async ({ url, body }) => {
        addIndex += 1;
        pagesDone += 1;
        const conceptPath = conceptPathForUrl(url, addIndex);
        const rewritten = rewriteCrossLinks(body, pageMap);
        const title = deriveTitleFromBody(rewritten) || url || conceptPath.replace(/\.md$/, '');
        pagePaths.push({ path: conceptPath, title });
        if (pagesDone >= nextProgressPages) {
          nextProgressPages += PROGRESS_PAGES;
          await patchConversion(repo_id, {
            status: 'splitting',
            bytes_done: bytesDone,
            bytes_total: bytesTotal,
            pages_done: pagesDone,
            batches_done: batchesDone
          });
        }
        pending.push({
          path: conceptPath,
          frontmatter: {
            type: 'topic',
            title,
            sources: url
              ? [{ kind: 'crawl', resource: url, file_id, crawl_job_id: job.crawl_job_id || null }]
              : [{ kind: 'crawl', file_id, crawl_job_id: job.crawl_job_id || null }]
          },
          body: sanitizeCrawlBody(rewritten)
        });
        pendingBytes += body.length;
        if (pending.length >= BATCH_CONCEPTS || pendingBytes >= BATCH_BYTES) {
          const batch = pending;
          pending = [];
          pendingBytes = 0;
          await flushBatch(batch);
        }
      });
      if (pending.length > 0) {
        const batch = pending;
        pending = [];
        await flushBatch(batch);
      }
    }
    // Rooted-graph index concept (ingested LAST; links resolve per-path).
    if (pagePaths.length > 0) {
      const indexTitle = requested_name || 'Crawled knowledge base';
      const contents = pagePaths.map((p) => `- [${p.title || p.path.replace(/\.md$/, '')}](./${p.path})`).join('\n');
      const index = [
        {
          path: 'index.md',
          frontmatter: {
            type: 'index',
            title: indexTitle,
            sources: [{ kind: 'crawl', file_id, crawl_job_id: job.crawl_job_id || null }]
          },
          body: `# ${indexTitle}\n\nThis repository was created from a website crawl. The concepts below are the crawled pages, one per page.\n\n## Contents\n\n${contents}\n`
        }
      ];
      await ingestRepoConcepts(repo_id, { concepts: index }, actor);
      batchesDone += 1;
    }

    await patchConversion(repo_id, {
      status: 'done',
      stage: 'done',
      bytes_done: bytesDone,
      bytes_total: bytesTotal,
      pages_done: pagesDone,
      batches_done: batchesDone,
      finished_at: new Date().toISOString()
    });
    logger.info(
      `Crawl conversion DONE repo=${repo_id} pages=${pagesDone} batches=${batchesDone} bytes=${bytesDone} (values in message — winston strips metadata)`
    );
  } catch (err) {
    logger.error(
      `Crawl conversion FAILED repo=${repo_id} code=${err.code || '-'} at_bytes=${bytesDone} pages=${pagesDone} error=${err.message}`
    );
    await patchConversion(repo_id, {
      status: 'failed',
      error: err.message,
      code: err.code || 'CONVERSION_FAILED',
      bytes_done: bytesDone,
      pages_done: pagesDone,
      batches_done: batchesDone,
      finished_at: new Date().toISOString()
    });
    throw err;
  } finally {
    if (tmpPath) {
      fs.promises.unlink(tmpPath).catch(() => {});
    }
  }
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return String(n);
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Register + start a conversion for an ALREADY-CREATED repo. Returns the
 * initial conversion record immediately; the job runs in the background.
 * @param {Object} p
 * @param {string} p.repo_id    existing repo (the controller created it)
 * @param {string} p.file_id    doc-repo file_id of the crawled .md
 * @param {string} [p.url]      crawl seed URL
 * @param {string} [p.crawl_job_id] audit provenance
 * @param {'A'|'B'} p.split_mode
 * @param {string} [p.requested_name]
 * @param {Object} [p.actor]
 * @returns {Promise<Object>} the conversion record written to the repo doc
 */
async function startConversion({ repo_id, file_id, url, crawl_job_id, split_mode, requested_name, actor }) {
  if (!repo_id || !file_id) {
    const e = new Error('startConversion requires repo_id and file_id');
    e.code = 'VALIDATION_ERROR';
    e.status = 400;
    throw e;
  }
  if (!['A', 'B'].includes(split_mode)) {
    const e = new Error(`split_mode must be 'A' or 'B' (got ${JSON.stringify(split_mode)})`);
    e.code = 'VALIDATION_ERROR';
    e.status = 400;
    throw e;
  }
  await sweepInterruptedOnce();

  const queued = {
    status: 'queued',
    stage: 'queued',
    file_id,
    url: url || null,
    split_mode,
    error: null,
    started_at: new Date().toISOString()
  };
  await patchConversion(repo_id, queued);

  // Provenance first (fail-soft) so the editor can show the source document
  // even while the conversion is still queued — and its size doubles as the
  // cap/mode-A guard + progress total for the run.
  const sourceMeta = await stampSourceDocument(repo_id, { file_id, url, crawl_job_id });
  const job = {
    repo_id,
    file_id,
    url,
    crawl_job_id,
    split_mode,
    requested_name,
    source_size: sourceMeta && Number.isFinite(sourceMeta.size_bytes) ? sourceMeta.size_bytes : null,
    actor: actor || null
  };
  const runner = (async () => {
    dlog(`runner queued repo=${repo_id} running=${running}/${MAX_CONCURRENT} waiting=${waiting.length}`);
    await acquireSlot();
    dlog(`runner START repo=${repo_id}`);
    try {
      await withSpan('okf.crawl.conversion', async (span) => {
        span.setAttribute('okf.repo_id', repo_id);
        span.setAttribute('okf.file_id', file_id);
        span.setAttribute('okf.split_mode', split_mode);
        await runConversion(job);
      });
    } catch {
      // Terminal state already recorded by runConversion; swallow so the
      // background promise never surfaces as an unhandled rejection.
    } finally {
      releaseSlot();
      live.delete(repo_id);
    }
  })();
  live.set(repo_id, runner);
  return queued;
}

/** Terminal-state predicate used by polling UIs. */
function isTerminal(conversion) {
  return !!conversion && ['done', 'failed'].includes(conversion.status);
}

module.exports = { startConversion, isTerminal, sanitizeCrawlBody, maxSourceBytesFromEnv, MODE_A_SOURCE_LIMIT_BYTES };
