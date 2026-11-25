/**
 * The shared outbound http.request double for the translation suites — ONE
 * home for the request-interface model the test files were each
 * hand-rolling (an EventEmitter req with write/setTimeout/destroy stubs,
 * path-routed responses, delivery triggers). Any new interface piece the
 * service starts reading is added HERE, once — the same silent-drift
 * failure mode the per-file copies documented, no longer spanning files.
 *
 * Requires `http` directly: the consuming file's `jest.mock('http')` puts
 * the mock in THIS module's registry too, so the double binds onto the same
 * mock the file already clears per test.
 *
 * Serves the GPU backend's three request kinds off one http mock:
 *   - `/health`           — status, hang (never answers), error hooks
 *   - `/v1/models`        — status 200 + a JSON body (+ afterResponse)
 *   - `/chat/completions` (and anything else) — the chat spec
 * and captures every request's opts plus the chat requests' written bodies.
 *
 * `specs` (all optional):
 *   health: { status, onRequest, hang, emitError, emitErrorAfterMs }
 *   models: { json, afterResponse }
 *   chat:   { status, json, beforeResponse, emitTimeout, afterResponse }
 *
 * Returns `{ calls, chatWrites }` — `calls` is every captured request's
 * opts; `chatWrites` is the parsed body of each chat/completions write.
 */
const { EventEmitter } = require('events');

const http = require('http');

/**
 * ONE request/response double — the interface the service touches. The
 * request is an EventEmitter with the write/setTimeout/destroy stubs; the
 * response carries statusCode, setEncoding and the drain (`resume`) the
 * refusal paths call. `captureWrite` receives every written chunk (the
 * files that parse the body do it there).
 */
function createRequestDouble({ captureWrite } = {}) {
  const req = new EventEmitter();
  req.write = jest.fn((chunk) => {
    if (captureWrite) captureWrite(chunk);
  });
  req.setTimeout = jest.fn();
  // A real ClientRequest emits 'error' when destroyed with one — the abort
  // wiring relies on it.
  req.destroy = jest.fn((err) => {
    if (err) req.emit('error', err);
  });
  const res = new EventEmitter();
  res.setEncoding = () => {};
  // The refusal paths drain the response (`resume`); a real IncomingMessage
  // carries it, so the double models it as a jest.fn the tests can pin.
  res.resume = jest.fn();
  return { req, res };
}

function serveTranslationHttp({ health = {}, models = {}, chat = {} } = {}) {
  const calls = [];
  const chatWrites = [];
  http.request.mockImplementation((opts, cb) => {
    calls.push(opts);
    const path = String(opts.path);
    const { req, res } = createRequestDouble({
      captureWrite: (chunk) => {
        if (path.includes('/chat/completions')) chatWrites.push(JSON.parse(chunk));
      },
    });
    req.end = jest.fn();
    process.nextTick(() => {
      if (path.endsWith('/health')) {
        if (health.onRequest) health.onRequest();
        if (health.hang) {
          // The endpoint accepted the connection and never answers: the
          // request dangles until its own socket timeout.
          return;
        }
        if (health.emitErrorAfterMs) {
          // Answers with an error on a later tick — past the budget timer
          // a won race would have settled on.
          setTimeout(
            () => req.emit('error', new Error('connect ETIMEDOUT after the budget')),
            health.emitErrorAfterMs
          );
          return;
        }
        if (health.emitError) {
          req.emit('error', new Error(health.emitError));
          return;
        }
        res.statusCode = health.status || 200;
        cb(res);
        res.emit('end');
        return;
      }
      if (path.endsWith('/v1/models')) {
        res.statusCode = 200;
        cb(res);
        res.emit('data', JSON.stringify(models.json !== undefined ? models.json : { data: [] }));
        res.emit('end');
        if (models.afterResponse) models.afterResponse();
        return;
      }
      if (chat.beforeResponse) {
        chat.beforeResponse();
        return;
      }
      if (chat.emitTimeout) {
        req.emit('timeout');
        return;
      }
      res.statusCode = chat.status || 200;
      cb(res);
      if (chat.json !== undefined) res.emit('data', JSON.stringify(chat.json));
      res.emit('end');
      if (chat.afterResponse) chat.afterResponse();
    });
    return req;
  });
  return { calls, chatWrites };
}

module.exports = { createRequestDouble, serveTranslationHttp };
