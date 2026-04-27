/**
 * inspect-chunks.js — Show all RAG chunks stored in ArangoDB for an ingested file.
 *
 * Usage:
 *   node inspect-chunks.js <filename_or_partial>
 *   node inspect-chunks.js --file-id <file_id>
 *   node inspect-chunks.js --list
 *
 * Examples:
 *   node inspect-chunks.js potato_calendar_dhaka.md
 *   node inspect-chunks.js potato          # partial match, shows picker if multiple
 *   node inspect-chunks.js --file-id 1777230779535_a5e215b2
 *   node inspect-chunks.js --list          # list all files in DB
 *
 * Env vars (all optional — defaults match set-env.sh):
 *   ARANGO_URL        (default: http://localhost:8529)
 *   ARANGO_DATABASE   (default: genie-ai)
 *   ARANGO_USER       (default: root)
 *   ARANGO_PASSWORD   (default: test)
 *   ARANGO_GRAPH_NAME (default: GRAPH_TEST)
 */

'use strict';

const { Database, aql } = require('arangojs');
const readline = require('readline');
require('dotenv').config();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ARANGO_URL   = process.env.ARANGO_URL       || 'http://localhost:8529';
const ARANGO_DB    = process.env.ARANGO_DATABASE   || process.env.ARANGO_DB_NAME || 'genie-ai';
const ARANGO_USER  = process.env.ARANGO_USER       || process.env.ARANGO_USERNAME || 'root';
const ARANGO_PASS  = process.env.ARANGO_PASSWORD   || 'test';
const GRAPH_NAME   = process.env.ARANGO_GRAPH_NAME || 'GRAPH_TEST';

const db = new Database({
  url: ARANGO_URL,
  databaseName: ARANGO_DB,
  auth: { username: ARANGO_USER, password: ARANGO_PASS },
});

// ---------------------------------------------------------------------------
// AQL helpers
// ---------------------------------------------------------------------------
async function query(q, bindVars = {}) {
  const cursor = await db.query(q, bindVars);
  return cursor.all();
}

async function listFiles() {
  return query(aql`
    FOR doc IN files
    SORT doc.upload_date DESC
    RETURN {
      file_id:  doc.file_id,
      name:     doc.file_name,
      status:   doc.dataprep.status,
      chunks:   doc.chunk_count,
      uploaded: doc.upload_date,
      labels:   doc.labels
    }
  `);
}

async function findFilesByName(partial) {
  return query(aql`
    FOR doc IN files
    FILTER CONTAINS(LOWER(doc.file_name), LOWER(${partial}))
    SORT doc.upload_date DESC
    RETURN {
      file_id:  doc.file_id,
      name:     doc.file_name,
      status:   doc.dataprep.status,
      chunks:   doc.chunk_count,
      uploaded: doc.upload_date
    }
  `);
}

async function findFileById(fileId) {
  const rows = await query(aql`
    FOR doc IN files
    FILTER doc.file_id == ${fileId}
    RETURN {
      file_id:  doc.file_id,
      name:     doc.file_name,
      status:   doc.dataprep.status,
      chunks:   doc.chunk_count,
      uploaded: doc.upload_date
    }
  `);
  return rows[0] || null;
}

async function getChunks(fileId) {
  const sourceCol = db.collection(`${GRAPH_NAME}_SOURCE`);
  return query(aql`
    FOR doc IN ${sourceCol}
    FILTER doc.file_id == ${fileId}
    SORT doc.chunk_index ASC
    RETURN {
      chunk:  doc.chunk_index,
      labels: doc.chunk_labels,
      text:   doc.text
    }
  `);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
const SEP  = '='.repeat(70);
const DASH = '-'.repeat(70);

function displayFileList(rows) {
  if (!rows.length) {
    console.log('\nNo files found in the database.\n');
    return;
  }
  const col1 = 44, col2 = 15, col3 = 6, col4 = 19;
  console.log(
    `\n${'FILE NAME'.padEnd(col1 + 1)} ${'STATUS'.padEnd(col2 + 1)} ${'CHUNKS'.padStart(col3)}  ${'UPLOADED'.padEnd(col4 + 2)} FILE ID`
  );
  console.log('-'.repeat(120));
  for (const r of rows) {
    const name     = (r.name     || '(unknown)').slice(0, col1).padEnd(col1);
    const status   = (r.status   || '-').slice(0, col2).padEnd(col2);
    const chunks   = String(r.chunks ?? 0).padStart(col3);
    const uploaded = (r.uploaded || '').slice(0, col4).padEnd(col4);
    const fid      = r.file_id   || '-';
    console.log(`${name}  ${status}  ${chunks}  ${uploaded}  ${fid}`);
  }
  console.log();
}

function displayChunks(meta, chunks) {
  const name   = meta.name    || meta.file_id;
  const status = meta.status  || '?';
  const fid    = meta.file_id || '?';

  console.log(`\n${SEP}`);
  console.log(`  File  : ${name}`);
  console.log(`  ID    : ${fid}`);
  console.log(`  Status: ${status}   |   Chunks in graph: ${chunks.length}`);
  console.log(SEP);

  if (!chunks.length) {
    console.log('\n  No chunks found in ArangoDB for this file.');
    console.log('  (It may not be ingested yet, or was retracted.)\n');
    return;
  }

  for (const r of chunks) {
    const idx      = r.chunk ?? '?';
    const labels   = (r.labels && r.labels.length) ? r.labels.join(', ') : '(no labels)';
    console.log(`\nCHUNK ${idx}  |  labels: [${labels}]`);
    console.log(DASH);
    console.log(r.text || '');
  }

  console.log(`\n  Total: ${chunks.length} chunks\n`);
}

// ---------------------------------------------------------------------------
// Interactive picker (when multiple files match)
// ---------------------------------------------------------------------------
function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); }));
}

async function pickFromMatches(matches, partial) {
  console.log(`\nFound ${matches.length} files matching '${partial}':\n`);
  matches.forEach((m, i) => {
    const name   = (m.name   || '(unknown)').padEnd(45);
    const status = (m.status || '-').padEnd(12);
    const chunks = String(m.chunks ?? 0).padStart(3);
    console.log(`  [${i + 1}] ${name}  status=${status}  chunks=${chunks}  id=${m.file_id}`);
  });
  console.log();

  const answer = await askQuestion('Enter number to inspect (or q to quit): ');
  if (answer.toLowerCase() === 'q') process.exit(0);

  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= matches.length) {
    console.error('Invalid selection.');
    process.exit(1);
  }
  return matches[idx];
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage:');
    console.error('  node inspect-chunks.js <filename_or_partial>');
    console.error('  node inspect-chunks.js --file-id <file_id>');
    console.error('  node inspect-chunks.js --list');
    process.exit(1);
  }

  if (args[0] === '--list')    return { mode: 'list' };
  if (args[0] === '--file-id') return { mode: 'id',   value: args[1] };
  return { mode: 'name', value: args[0] };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { mode, value } = parseArgs();

  try {
    if (mode === 'list') {
      displayFileList(await listFiles());
      return;
    }

    if (mode === 'id') {
      if (!value) { console.error('--file-id requires a value.'); process.exit(1); }
      const meta = await findFileById(value);
      if (!meta) { console.error(`No file found with file_id '${value}'.`); process.exit(1); }
      displayChunks(meta, await getChunks(value));
      return;
    }

    // mode === 'name'
    const matches = await findFilesByName(value);
    if (!matches.length) {
      console.error(`\nNo files found matching '${value}'. Use --list to see all files.\n`);
      process.exit(1);
    }

    const meta = matches.length === 1 ? matches[0] : await pickFromMatches(matches, value);
    displayChunks(meta, await getChunks(meta.file_id));

  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
