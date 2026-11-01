// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/*
 * csvTopicsService — FR-42 topics for an imported CSV.
 *
 * David (2026-10-12): a CSV imports "as tabular markdown data WITH TOPICS".
 * A table's column names alone rarely name the subject — `col_1..col_9` or
 * `Region, Amount, Date` say nothing about maize yields. So ONE call per FILE
 * summarises the DICTIONARY (column names + inferred types + samples) into a
 * bounded topic-slug set plus a one-line purpose, and that description+topics
 * is stamped on EVERY concept the file produced (dictionary AND row-groups) —
 * a row-group with no topic is a retrieval orphan.
 *
 * CONTRACT — the import must NEVER block on the LLM (same bar as
 * llm-curation-service): an unreachable engine logs, falls back to the
 * filename slug, and the file still imports. The only way this call fails is
 * by degrading.
 *
 * REMOTE-ONLY (David's absolute rule): every call goes through the shared
 * frontmatter-service primitive, which resolves process.env.VLLM_ENDPOINT —
 * the remote GPU node in both local-Docker and Ansible deployments. This
 * module never constructs a host of its own and never defaults to localhost.
 * A deployment with VLLM_ENDPOINT unset must NOT silently reach a local GPU,
 * so an unset endpoint is treated as "engine not configured" and the call is
 * skipped rather than falling back to any address.
 */

const { logger } = require('../../shared-lib/logger');
const { slugify } = require('./tableConcepts');

const DEFAULT_MAX_TOPICS = 6;
const MAX_PURPOSE_LEN = 240;

// Soft target band (mirrors FIELD_RANGES.topic in frontmatter-service: 3-8).
const MIN_TOPICS = 3;
const MAX_TOPICS = 8;

const TOPICS_SYSTEM_PROMPT = `You label tabular datasets for a knowledge base.

You receive the DATA DICTIONARY of ONE table: each column's name, its inferred
type, and one sample value. From that alone, infer what the table is ABOUT.

Return ONLY a JSON object, no prose, no code fences:
{"topics": ["kebab-case-slug", ...], "purpose": "one sentence, max 20 words"}

Rules for "topics":
- 3 to 8 entries, each a short lowercase kebab-case slug (2-4 words).
- Name the SUBJECT and the dimensions, never the schema. Prefer
  "maize-production", "regional-agriculture-trade"; never "column", "region",
  "amount", "date", "csv", "data".
- Each slug must be independently meaningful to someone who has never seen
  this file.
Rules for "purpose": one declarative sentence naming what the table records.
If the columns are too generic to identify the subject, return generic-but-honest
topics (e.g. "tabular-data", "unclassified-dataset") rather than inventing a
specific subject. Never guess a domain the dictionary does not support.`;

/** One LLM call summarising the dictionary into topics + purpose.
 * Never throws — every failure path degrades and is logged.
 *
 * @param {object} args
 * @param {Array<{name,type,sample}>} args.columns the dictionary rows, exactly
 *        as produced by dictionaryForTopics. This is an ARRAY, not an object
 *        with a `headers` key — an earlier version of this contract expected
 *        `{headers}` here while the caller passed an array, so `columns` was
 *        ALWAYS empty and every call silently degraded to the filename slug
 *        (the LLM was never reached in production). The shape is asserted in
 *        the test suite for exactly that reason.
 * @param {string} args.fileName used for the fallback slug
 */
async function deriveTopics({ columns, fileName, opts = {} } = {}) {
  const fallbackSlug = slugify(String(fileName || '').replace(/\.[^.]+$/, '')) || 'tabular-dataset';
  const fallback = {
    topics: [fallbackSlug],
    purpose: `Tabular dataset imported from ${fileName || 'a CSV file'}.`,
    source: 'fallback-filename'
  };

  const cols = Array.isArray(columns) ? columns : [];
  if (cols.length === 0) {
    logger.warn('CSV topics: no dictionary columns — skipping LLM, using filename slug', { fileName });
    return fallback;
  }

  // REMOTE-ONLY GUARD: frontmatter-service defaults to the compose service
  // name 'http://vllm:8000' when VLLM_ENDPOINT is unset. Honouring that
  // fallback here would route an import at whatever GPU happens to be local —
  // forbidden. An unset endpoint means "no engine", not "the local one".
  // The gate is the shared helper — one owner, so a future change to the
  // opt-in semantics cannot drift this leg from the other three. Lazy
  // require for the same reason as the chat client below: the converter
  // stays pure for its unit tests.
  if (!require('../vllm-model-cache').optedInVllmBase()) {
    logger.warn('CSV topics: VLLM_ENDPOINT not set — engine not configured, using filename slug', { fileName });
    return { ...fallback, source: 'fallback-no-endpoint' };
  }

  // Lazy require: the converter is pure and unit-tested without the axios/OTel
  // surface of frontmatter-service (house style — services pull LLM clients in
  // lazily, see producer-service.js's topic-link-authoring require).
  let chat;
  try {
    chat = require('../frontmatter-service').vllmChatCompletions;
  } catch (err) {
    logger.warn('CSV topics: LLM client unavailable — using filename slug', { fileName, error: err.message });
    return { ...fallback, source: 'fallback-client-unavailable' };
  }

  const dictLines = cols
    .map(
      (c) =>
        `- ${c.name} (${c.type || 'unknown'}): ${c.sample === undefined || c.sample === '' ? '(no sample)' : c.sample}`
    )
    .join('\n');
  const userPrompt = `File: ${fileName}\n\nData dictionary:\n${dictLines}`;

  let raw;
  try {
    // maxTokens is bounded: the contract is 3-8 short slugs + one sentence,
    // and an unbounded budget invites a model that narrates.
    const resp = await chat(
      [
        { role: 'system', content: TOPICS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      { maxTokens: opts.maxTokens || 400, temperature: 0.0 }
    );
    const choice = resp && resp.data && resp.data.choices && resp.data.choices[0];
    raw = choice && choice.message && choice.message.content;
    if (choice && choice.finish_reason === 'length') {
      logger.warn('CSV topics: model hit the token cap — parsing what it finished', { fileName });
    }
  } catch (err) {
    // NON-FATAL BY CONTRACT: the import proceeds on the filename slug.
    logger.warn('CSV topics: LLM call failed — falling back to filename slug', {
      fileName,
      error: err.message,
      code: err.code || null
    });
    return { ...fallback, source: 'fallback-llm-error' };
  }

  const parsed = parseTopics(raw);
  if (!parsed) {
    logger.warn('CSV topics: unparseable LLM response — falling back to filename slug', {
      fileName,
      response: String(raw || '').slice(0, 200)
    });
    return { ...fallback, source: 'fallback-unparseable' };
  }

  const topics = normalizeTopics(parsed.topics);
  if (topics.length === 0) {
    logger.warn('CSV topics: LLM returned no usable topic — falling back to filename slug', { fileName });
    return { ...fallback, source: 'fallback-empty-topics' };
  }
  const purpose = String(parsed.purpose || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PURPOSE_LEN);

  logger.info('CSV topics derived', {
    fileName,
    columns: cols.length,
    topics: topics.length,
    source: 'llm'
  });
  return { topics, purpose, source: 'llm' };
}

/** Extract the JSON object from a guided-JSON completion.
 * vllmChatCompletions already forces response_format json_object, so this is
 * the tier-1 path; the greedy brace match tolerates a stray fence. Returns
 * null on ANY failure — never a partially-trusted object. */
function parseTopics(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (!obj || typeof obj !== 'object') return null;
    return { topics: obj.topics, purpose: obj.purpose };
  } catch {
    // Malformed or truncated JSON — degrade to the filename slug upstream.
    return null;
  }
}

/** Coerce the model's topic list into bounded kebab-case slugs.
 * The model is told the shape but is never trusted to honour it: a non-array,
 * a nested object, or a 40-item list must not reach the frontmatter. */
function normalizeTopics(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const slug = slugify(t);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= Math.min(MAX_TOPICS, DEFAULT_MAX_TOPICS)) break;
  }
  return out;
}

module.exports = { deriveTopics, parseTopics, normalizeTopics, MIN_TOPICS, MAX_TOPICS };
