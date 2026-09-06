// queue_full call-site: VictoriaLogsTransport.log() emits via OTel
// `@opentelemetry/api-logs` `logs.getLogger(...).emit(...)`. When that emit
// throws (e.g. the BatchLogRecordProcessor queue is full), the catch block
// swallows the failure (CAP-1: must not block the Node service) and
// increments the bounded `log_record_dropped_total{reason=queue_full}`
// counter so the drop is observable in Prometheus.
//
// === Test gap (documented per coordinator's spec) ===
//
// The throw-path assertion (`emit()` throws → counter increments with
// `reason: 'queue_full'`) is skipped because `jest.mock('@opentelemetry/
// api-logs', factory)` does NOT intercept the require issued from inside
// `components/shared/lib/victorialogs-transport.js` — that file lives
// outside the backend's jest rootDir (`components/gov-chat-backend/`) and
// outside the project's transform scope, so jest falls back to the real
// `@opentelemetry/api-logs` (whose `logs.getLogger()` returns a NoopLogger
// whose `.emit()` is a no-op, never throws). The moduleNameMapper entry
// (`<rootDir>/node_modules/@opentelemetry/api-logs`) and `roots: [.../
// shared/lib]` config do NOT change this — both verified.
//
// Per the spec ("Skip if mocking proves too brittle; in that case leave a
// comment in the test file explaining the gap and proceed."), the test
// instead does a static source-level check on the transport file: it
// verifies the counter IIFE, the bounded enum reason, and the catch
// increment are all wired in the source. The runtime increment path is
// covered indirectly by the `log-record-dropped-mirrors` parity test
// (LOG_DROPPED_REASON.QUEUE_FULL must equal canonical 'queue_full') and
// validated end-to-end against a live VictoriaLogs instance during the
// broader admin-logs-victorialogs PRD epic.

const fs = require('fs');
const path = require('path');

const transportPath = path.join(__dirname, '..', '..', 'shared', 'lib', 'victorialogs-transport.js');
const source = fs.readFileSync(transportPath, 'utf8');

describe('VictoriaLogsTransport — log_record_dropped_total{reason=queue_full} (static check)', () => {
  it('module-loads the log_record_dropped_total counter via getMeter().createCounter()', () => {
    expect(source).toMatch(/getMeter\(/);
    expect(source).toMatch(/createCounter\(['"]log_record_dropped_total['"]/);
  });

  it('increments the counter in the log() catch block with the bounded queue_full reason', () => {
    expect(source).toMatch(/_droppedCounter\.add\(1,\s*\{\s*reason:\s*LOG_DROPPED_REASON\.QUEUE_FULL\s*\}\)/);
  });

  it('wraps the emit call in a try/catch so a swallowed emit is observable', () => {
    expect(source).toMatch(/logger\.emit\(/);
    expect(source).toMatch(/} catch\s*\{/);
  });

  it('defines the bounded LOG_DROPPED_REASON mirror with the queue_full value', () => {
    expect(source).toMatch(/QUEUE_FULL:\s*['"]queue_full['"]/);
  });
});
