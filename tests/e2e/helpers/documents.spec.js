// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  matchesStatus,
  normalizeStatus,
  sweepDeleteOneFile,
  uploadFileViaApi,
  triggerIngestViaApi,
  waitForFileIngestedViaApi
} = require('./documents');

// Unit spec for the document status predicate (#1781).
//
// `matchesStatus` mirrors what AdminDashboard.vue's `filteredDocuments`
// renders, and it derives its normalisation from the SHARED vocabulary
// (`components/gov-chat-frontend/src/utils/documentStatus.js`) — the same
// `normalizeStatus` the admin filter applies. These cases pin the
// predicate's own contract; the shared identity is structural (one
// module — the helper owns the bridge to the frontend's ES module, and
// every reader of the vocabulary reads it THROUGH that bridge), so a
// frontend change to the normalisation cannot leave this copy stale.
/**
 * The scripted transport the helper specs drive: a queue of answers, one
 * per call, and the calls it recorded. ONE definition for the whole file —
 * the four describes below drive the same helpers and must not keep four
 * copies of it in step.
 *
 * @param {object[]} script - the answers, in order
 * @returns {{request: Function, calls: object[][]}} the transport and its log
 */
function scriptedTransport(script) {
  const calls = [];
  const request = async (method, path, options) => {
    calls.push([method, path, options]);
    if (script.length === 0) {
      throw new Error(`unexpected call ${method} ${path} — the script is exhausted`);
    }
    return script.shift();
  };
  return { request, calls };
}

test.describe('the document status predicate', () => {
  const file = (status) => ({ file_name: 'a.pdf', dataprep: { status } });

  test("'all' lists every document, with or without a dataprep block", () => {
    expect(matchesStatus(file('Ingested'), 'all')).toBe(true);
    expect(matchesStatus({ file_name: 'b.pdf' }, 'all')).toBe(true);
  });

  test("a selection lists only the documents whose status equals it — case and padding don't matter", () => {
    expect(matchesStatus(file('Ingested'), 'ingested')).toBe(true);
    expect(matchesStatus(file('ingested'), 'Ingested')).toBe(true);
    expect(matchesStatus(file('  Ingested  '), ' ingested ')).toBe(true);
    expect(matchesStatus(file('Pending'), 'ingested')).toBe(false);
    expect(matchesStatus(file('ingestion error'), 'error')).toBe(false);
  });

  test('a document without a dataprep block is never in a filtered selection', () => {
    // The empty selection is the sharp edge: a missing status normalises
    // to '', and a selection of '' would otherwise match every
    // dataprep-less document.
    expect(matchesStatus({ file_name: 'b.pdf' }, 'ingested')).toBe(false);
    expect(matchesStatus({ file_name: 'b.pdf' }, '')).toBe(false);
    expect(matchesStatus(file('Ingested'), '')).toBe(false);
  });

  test('the require-of-ESM floor is named at load, not a bare SyntaxError', () => {
    // No behaviour test can see the guard: on a capable runner the
    // require simply works, and on an incapable one the failure happens
    // before any spec loads. Pin the guard's presence — without it the
    // below-floor runner gets Node's own `Unexpected token 'export'`
    // with nothing to act on (#1804 review of #1781).
    const source = fs.readFileSync(require.resolve('./documents'), 'utf8');
    expect(source).toContain('process.features.require_module');
  });

  test('the predicate IS the shared vocabulary, on behaviour, across a sample', () => {
    // Property-style: for every sampled document and selection the
    // predicate answers exactly what the shared vocabulary's rule
    // answers — the two cannot drift apart while this holds, and it
    // survives any refactor of how the helper reaches the module. A
    // dead require beside a private copy is caught by the tripwire
    // below, not here.
    const statuses = [
      'all',
      'Ingested',
      'ingested ',
      ' PENDING',
      'Pending',
      'Ingestion Error',
      '',
      'killed',
      undefined
    ];
    const docs = [file('Ingested'), file('pending'), { file_name: 'no-block.pdf' }, file(undefined)];
    for (const doc of docs) {
      for (const selection of statuses) {
        const expected =
          normalizeStatus(selection) === 'all' ||
          (Boolean(doc.dataprep) && normalizeStatus(doc.dataprep.status) === normalizeStatus(selection));
        expect(matchesStatus(doc, selection)).toBe(expected);
      }
    }
  });

  test('no private normalisation is spelled inside matchesStatus', () => {
    // Tripwire for the drift the property test cannot see: a dead
    // require of the shared module with a hand-rolled copy inside the
    // predicate. Anchored to the predicate's own source — the whole
    // helper file may legitimately normalise other things (a file name,
    // a search term) and must not false-positive this gate.
    const source = fs.readFileSync(require.resolve('./documents'), 'utf8');
    const start = source.indexOf('function matchesStatus');
    // A negative start would make the slice vacuous (the tripwire would
    // pass on nothing): if the anchor is lost — say the predicate became
    // an arrow — the gate must fail loudly, not guard air.
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toMatch(/toLowerCase\(\)\.trim\(\)/);
  });
});

/**
 * Unit spec for the sweep's per-file delete (#1864).
 *
 * `sweepDeleteOneFile` is the sweep's whole per-file contract: a bare
 * DELETE, and — when the repository refuses with 409 STILL_SERVING — the
 * remedy that response itself prescribes, retract-then-delete. Before
 * #1864 the sweep issued the bare DELETE only, so any leftover that had
 * reached a serving state failed every later afterAll identically with a
 * bare `HTTP 409`: cleanup loud but structurally unable to succeed.
 *
 * The transport is injected (the same seam idea as auth.spec.js's
 * module-object swap, by parameter — the transport belongs to auth.js, so
 * documents.js has no module object of its own to swap). A scripted
 * transport answers exactly the calls the script lists and REFUSES any
 * further call: an extra request is a wrong sequence, not a pass.
 */
test.describe('the sweep per-file delete (retract-then-delete, #1864)', () => {
  const file = { file_name: 'test-document-leftover.pdf', file_id: 'f123' };

  // A transport that answers from a script in call order and fails any
  // call beyond it — the sequence IS the assertion subject, so an
  // unexpected call must fail loud, not fall off the script. The OPTIONS
  // are recorded too (#1864 review): the bearer header the sweep sends is
  // part of the contract — a refactor that drops it stays green on
  // method+path pins and only fails at the venue with a wave of 401s.
  const authed = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
  const bearerCall = (method, path, token = 'tok') => [method, path, authed(token)];

  const serving = (code = 'STILL_SERVING') => ({
    status: 409,
    data: {
      success: false,
      code,
      error: 'File is still serving the corpus',
      message: `File f123 is still serving the corpus (dataprep status: ingested) — retract it before deleting`
    },
    headers: {}
  });

  test('a clean delete is one DELETE and no retract, with the bearer header', async () => {
    const t = scriptedTransport([{ status: 200, data: { success: true }, headers: {} }]);
    expect(await sweepDeleteOneFile(t.request, file, 'tok')).toBeNull();
    expect(t.calls).toEqual([bearerCall('DELETE', '/api/files/f123')]);
  });

  test('a STILL_SERVING refusal retracts and deletes again, in that order', async () => {
    const t = scriptedTransport([
      serving(),
      { status: 200, data: { success: true, message: 'File retracted successfully' }, headers: {} },
      { status: 200, data: { success: true }, headers: {} }
    ]);
    expect(await sweepDeleteOneFile(t.request, file, 'tok')).toBeNull();
    // Every leg carries the SAME bearer header — the retract is no
    // anonymous call (#1864 review).
    expect(t.calls).toEqual([
      bearerCall('DELETE', '/api/files/f123'),
      bearerCall('POST', '/api/files/f123/retract'),
      bearerCall('DELETE', '/api/files/f123')
    ]);
  });

  test('a failed retract names the retract step and never re-attempts the delete', async () => {
    const t = scriptedTransport([
      serving(),
      { status: 500, data: { success: false, error: 'Dataprep retract failed' }, headers: {} }
    ]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toBe(
      'test-document-leftover.pdf: retract failed before delete (HTTP 500 — Dataprep retract failed)'
    );
    expect(t.calls).toEqual([bearerCall('DELETE', '/api/files/f123'), bearerCall('POST', '/api/files/f123/retract')]);
  });

  test('a failed retract surfaces the server details field', async () => {
    // doc-repo's retract 500 carries the RAW dataprep answer in
    // `details` — the actual failure reason, not just the class label
    // (#1864 review). Bounded: a verbose body cannot flood the report.
    const t = scriptedTransport([
      serving(),
      {
        status: 500,
        data: {
          success: false,
          error: 'Dataprep retract failed',
          details: { success: false, reason: 'chunk cascade refused' }
        },
        headers: {}
      }
    ]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toBe(
      'test-document-leftover.pdf: retract failed before delete (HTTP 500 — Dataprep retract failed' +
        ' — details: {"success":false,"reason":"chunk cascade refused"})'
    );
    expect(t.calls).toEqual([bearerCall('DELETE', '/api/files/f123'), bearerCall('POST', '/api/files/f123/retract')]);
  });

  test('a 401 on the retract leg keeps the token-expiry diagnosis', async () => {
    // The token can lapse between the first DELETE and the retract; that
    // leg owes the same verdict + expiry label the delete legs produce,
    // with the leg named (#1864 review).
    const t = scriptedTransport([serving(), { status: 401, data: { error: 'TOKEN_EXPIRED' }, headers: {} }]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toContain('the endpoint answered TOKEN_EXPIRED');
    expect(failure).toContain('on the retract after a STILL_SERVING refusal');
    expect(t.calls).toEqual([bearerCall('DELETE', '/api/files/f123'), bearerCall('POST', '/api/files/f123/retract')]);
  });

  test('a delete that still refuses after a successful retract carries the refusal', async () => {
    const t = scriptedTransport([serving(), { status: 200, data: { success: true }, headers: {} }, serving()]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    // The refusal surfaces the server's own remedy text (the body's
    // message), not just the status — the whole point of #1864's minimum
    // ask, kept for the case the remedy itself fails.
    expect(failure).toBe(
      'test-document-leftover.pdf: HTTP 409 (STILL_SERVING) — ' +
        'File f123 is still serving the corpus (dataprep status: ingested) — retract it before deleting'
    );
    expect(t.calls).toEqual([
      bearerCall('DELETE', '/api/files/f123'),
      bearerCall('POST', '/api/files/f123/retract'),
      bearerCall('DELETE', '/api/files/f123')
    ]);
  });

  test('another 409 code takes no retract — the remedy keys on STILL_SERVING', async () => {
    const t = scriptedTransport([serving('CRAWL_ACTIVE')]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toMatch(/HTTP 409 \(CRAWL_ACTIVE\)/);
    expect(t.calls).toEqual([bearerCall('DELETE', '/api/files/f123')]);
  });

  test('a 401 keeps the unauthorized description, without a retract', async () => {
    const t = scriptedTransport([{ status: 401, data: { error: 'TOKEN_EXPIRED' }, headers: {} }]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toContain('the endpoint answered TOKEN_EXPIRED');
    expect(t.calls).toEqual([bearerCall('DELETE', '/api/files/f123')]);
  });

  test('a 409 with an empty body takes no retract and reads as a bare status', async () => {
    // The transport resolves an empty body as null data; the code-keyed
    // guard must read that as "no code", not throw (#1864 review).
    const t = scriptedTransport([{ status: 409, data: null, headers: {} }]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toBe('test-document-leftover.pdf: HTTP 409');
    expect(t.calls).toEqual([bearerCall('DELETE', '/api/files/f123')]);
  });

  test('a plain server failure names its status and the server error', async () => {
    const t = scriptedTransport([{ status: 500, data: { success: false, error: 'boom' }, headers: {} }]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toBe('test-document-leftover.pdf: HTTP 500 — boom');
  });

  test('a transport error is named in the failure string, not thrown', async () => {
    const t = scriptedTransport([]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toMatch(/^test-document-leftover\.pdf: unexpected call DELETE/);
  });
});

test.describe('the API upload (multipart, the repository upload route)', () => {
  const FIXTURE = path.join(__dirname, '..', 'fixtures', 'ingest-probe-canary.md');

  // The same scripted transport the sweep spec uses: the recorded calls
  // ARE the assertion subject — the multipart request shape (boundary
  // header, bearer, field name, file name, content) is the contract.
  test('the upload rides a multipart body carrying the file part and the bearer', async () => {
    const record = { file_id: 'f1', file_name: 'ingest-probe-canary.md' };
    const t = scriptedTransport([{ status: 201, data: { success: true, data: record }, headers: {} }]);
    expect(await uploadFileViaApi(t.request, 'tok', FIXTURE)).toEqual(record);

    expect(t.calls).toHaveLength(1);
    const [method, path, options] = t.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/api/files/upload');
    expect(options.headers.Authorization).toBe('Bearer tok');
    // The Content-Type rides the transport's OWN channel (`contentType`):
    // the transport overwrites any Content-Type in the headers map, so a
    // multipart body sent as application/json is parsed as JSON by the
    // repository and refused with a 400 naming the body's first token.
    expect(options.headers['Content-Type']).toBeUndefined();
    // The boundary travels in the Content-Type AND the body: a mismatch
    // would be refused by multer before any handler ran.
    const boundary = /boundary=(.+)$/.exec(options.contentType)[1];
    expect(options.body).toContain(`--${boundary}\r\n`);
    expect(options.body).toContain('Content-Disposition: form-data; name="file"; filename="ingest-probe-canary.md"');
    expect(options.body).toContain('Content-Type: text/markdown');
    const content = fs.readFileSync(FIXTURE, 'utf8');
    expect(options.body).toContain(content);
    // The terminator closes the part — a body without it is not multipart.
    expect(options.body.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  test('a non-201 answer is a named failure carrying the status and the file', async () => {
    const t = scriptedTransport([{ status: 400, data: { success: false, error: 'Invalid file type' }, headers: {} }]);
    // ONE failure, ONE assertion: the message carries the status AND the
    // file it was about, so one regex proves both facts.
    await expect(uploadFileViaApi(t.request, 'tok', FIXTURE)).rejects.toThrow(
      /the upload of ingest-probe-canary\.md answered HTTP 400/
    );
  });

  test('a 201 without a file record is a named failure, not an undefined id', async () => {
    const t = scriptedTransport([{ status: 201, data: { success: true, data: {} }, headers: {} }]);
    await expect(uploadFileViaApi(t.request, 'tok', FIXTURE)).rejects.toThrow(/without a file record/);
  });
});

test.describe('the ingest trigger (the repository ingest route)', () => {
  test('an accepted ingest is one POST with the bearer, and the payload returns', async () => {
    const t = scriptedTransport([{ status: 200, data: { success: true }, headers: {} }]);
    expect(await triggerIngestViaApi(t.request, 'tok', 'f1')).toEqual({ success: true });
    expect(t.calls).toEqual([['POST', '/api/files/f1/ingest', { headers: { Authorization: 'Bearer tok' } }]]);
  });

  test('a 207 multi-status envelope is accepted too', async () => {
    const t = scriptedTransport([{ status: 207, data: { results: [] }, headers: {} }]);
    expect(await triggerIngestViaApi(t.request, 'tok', 'f1')).toEqual({ results: [] });
  });

  test("the repository's OWN 409 body ('An ingest for this file is already running') is the accepted state", async () => {
    // The repository answers the conflict in its own words, not the
    // producer's code: a repository that forwards the producer's body
    // answers with that. Both are the same state — a live task owns the
    // file, which is what the caller wants.
    const t = scriptedTransport([
      {
        status: 409,
        data: { success: false, error: 'Conflict', message: 'An ingest for this file is already running' },
        headers: {}
      }
    ]);
    // The call RESOLVES (it does not throw): the conflict is the accepted
    // state, and the payload rides back with the repository's own body.
    await expect(triggerIngestViaApi(t.request, 'tok', 'f1')).resolves.toMatchObject({
      error: 'Conflict',
      message: 'An ingest for this file is already running'
    });
    expect(t.calls).toEqual([['POST', '/api/files/f1/ingest', { headers: { Authorization: 'Bearer tok' } }]]);
  });

  test("dataprep's 409 idempotency guard (ingest_already_running) is the accepted state", async () => {
    const t = scriptedTransport([{ status: 409, data: { code: 'ingest_already_running' }, headers: {} }]);
    expect(await triggerIngestViaApi(t.request, 'tok', 'f1')).toEqual({ code: 'ingest_already_running' });
  });

  test('a 409 without the code, and any other status, fail loud with the status named', async () => {
    const t = scriptedTransport([
      { status: 409, data: { code: 'SOMETHING_ELSE' }, headers: {} },
      { status: 429, data: { error: 'busy' }, headers: {} }
    ]);
    await expect(triggerIngestViaApi(t.request, 'tok', 'f1')).rejects.toThrow(/HTTP 409/);
    await expect(triggerIngestViaApi(t.request, 'tok', 'f1')).rejects.toThrow(/HTTP 429/);
  });
});

test.describe('the ingest wait (the dataprep status over the API)', () => {
  const record = (status) => ({ status: 200, data: { data: { file_id: 'f1', dataprep: { status } } }, headers: {} });

  test('a file already ingested costs ONE read and returns the record', async () => {
    const t = scriptedTransport([record('Ingested')]);
    const file = await waitForFileIngestedViaApi(t.request, 'tok', 'f1');
    expect(file.file_id).toBe('f1');
    expect(t.calls).toHaveLength(1);
  });

  test('pending then ingested: the wait holds until the shared vocabulary reads ingested', async () => {
    const t = scriptedTransport([record('Pending'), record('Ingesting'), record('Ingested')]);
    const file = await waitForFileIngestedViaApi(t.request, 'tok', 'f1', { timeoutMs: 15000 });
    expect(file.dataprep.status).toBe('Ingested');
    // One read before the wait, at least one during it.
    expect(t.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('an Ingestion Error is terminal and fails AT ONCE with the status named', async () => {
    const t = scriptedTransport([record('Ingestion Error')]);
    await expect(waitForFileIngestedViaApi(t.request, 'tok', 'f1', { timeoutMs: 30000 })).rejects.toThrow(
      /dataprep status is 'Ingestion Error'/
    );
    expect(t.calls).toHaveLength(1);
  });

  test('a budget spent on pending expires with the observed value in the failure', async () => {
    const t = scriptedTransport([record('Pending'), record('Pending')]);
    // The OBSERVED status, not the expected one: the failure carries
    // 'Received: "pending"', and a regex on 'ingested' would match the
    // EXPECTED side of the very same message. The gap is a wildcard
    // because the reporter's colour codes sit between the label and the
    // value.
    await expect(waitForFileIngestedViaApi(t.request, 'tok', 'f1', { timeoutMs: 500 })).rejects.toThrow(
      /Received:.*"pending"/
    );
  });

  test('a non-200 record read is a named failure, not a poll tick', async () => {
    const t = scriptedTransport([{ status: 500, data: { error: 'boom' }, headers: {} }]);
    await expect(waitForFileIngestedViaApi(t.request, 'tok', 'f1', { timeoutMs: 30000 })).rejects.toThrow(/HTTP 500/);
    expect(t.calls).toHaveLength(1);
  });

  test('an expired session (401) is named as the session, not as a missing file', async () => {
    const t = scriptedTransport([{ status: 401, data: { error: 'TOKEN_EXPIRED' }, headers: {} }]);
    // The realm's access token lives 300 s: a wait that outlives it dies
    // on the 401, and the failure has to say WHICH it was.
    // The SESSION branch, not the bare status: the generic branch reads
    // 'HTTP 401', the session branch names the verdict the realm sent.
    await expect(waitForFileIngestedViaApi(t.request, 'expired-token', 'f1', { timeoutMs: 30000 })).rejects.toThrow(
      /the endpoint answered TOKEN_EXPIRED/
    );
    expect(t.calls).toHaveLength(1);
  });

  test('a killed ingest is terminal and fails AT ONCE with the status named', async () => {
    const t = scriptedTransport([record('Killed')]);
    await expect(waitForFileIngestedViaApi(t.request, 'tok', 'f1', { timeoutMs: 30000 })).rejects.toThrow(
      /dataprep status is 'Killed'/
    );
    expect(t.calls).toHaveLength(1);
  });

  test('the degraded ingest is terminal too — it is not the Ingested the callers assert', async () => {
    const t = scriptedTransport([record('Ingested with Warnings')]);
    await expect(waitForFileIngestedViaApi(t.request, 'tok', 'f1', { timeoutMs: 30000 })).rejects.toThrow(
      /dataprep status is 'Ingested with Warnings'/
    );
    expect(t.calls).toHaveLength(1);
  });
});
