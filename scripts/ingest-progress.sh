#!/usr/bin/env bash
# Usage: ./scripts/ingest-progress.sh
# Shows live ingestion progress + ETA for the file currently being processed.

BCID=$(docker ps --format "{{.ID}} {{.Names}}" | awk '/genieai_backend\./{print $1; exit}')
[ -z "$BCID" ] && { echo "backend container not found"; exit 1; }

docker exec -e ARANGO_PASSWORD="$(grep ^ARANGO_PASSWORD= /root/genie-ai/.env | cut -d= -f2-)" "$BCID" node -e "
const { Database } = require('arangojs');
const db = new Database({
  url: 'http://arango-vector-db:8529',
  databaseName: 'genie-ai',
  auth: { username: 'root', password: process.env.ARANGO_PASSWORD },
});
(async () => {
  // The file currently in 'Ingesting' state
  const f = (await (await db.query(
    \"FOR f IN files FILTER f.dataprep.status IN ['Ingesting','Pending'] SORT f.dataprep.status ASC, f.uploaded_date DESC LIMIT 1 RETURN f\"
  )).all())[0];
  if (!f) { console.log('No file currently ingesting.'); return; }

  console.log('File:    ', f.file_name);
  console.log('Status:  ', f.dataprep.status);

  // Recent Graph-stage batches: each entry says 'Processing Batch N/M'
  const logs = await (await db.query(
    \"FOR l IN ingestion_log FILTER l.stage == 'Graph' SORT l.timestamp DESC LIMIT 200 RETURN l\"
  )).all();

  // Parse batch entries (newest first). Only keep the most-recent contiguous
  // run that belongs to the *current* file: same total AND each batch number
  // strictly less than the next one we've already kept as we go back in time.
  const all = [];
  for (const l of logs) {
    const m = (l.message || '').match(/Batch\\s+(\\d+)\\/(\\d+)/);
    if (m) all.push({ ts: new Date(l.timestamp).getTime(), n: +m[1], total: +m[2] });
  }
  if (!all.length) { console.log('No Graph-stage batches yet.'); return; }

  const latest = all[0];
  const batches = [latest];
  for (let i = 1; i < all.length; i++) {
    const b = all[i];
    if (b.total !== latest.total) break;
    if (b.n >= batches[batches.length - 1].n) break;
    batches.push(b);
  }

  const oldest = batches[batches.length - 1];
  const span = (latest.ts - oldest.ts) / 1000;
  const done = latest.n - oldest.n;
  const perBatch = done > 0 ? span / done : 0;
  const left = Math.max(0, latest.total - latest.n);
  const etaSec = left * perBatch;

  const fmt = s => {
    s = Math.max(0, Math.round(s));
    const m = Math.floor(s / 60), r = s % 60;
    return m + 'm ' + r + 's';
  };

  console.log('Batch:   ', latest.n + '/' + latest.total + '  (' + Math.round(latest.n * 100 / latest.total) + '%)');
  console.log('Pace:    ', perBatch.toFixed(1), 's/batch  (over last', done, 'batches)');
  console.log('Elapsed: ', fmt((Date.now() - oldest.ts) / 1000), '(in this sample)');
  console.log('ETA:     ', fmt(etaSec), '(approx', left, 'batches left)');
  console.log('Latest:  ', new Date(latest.ts).toISOString(), '-', logs[0].level, logs[0].message.substring(0, 120));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
"
