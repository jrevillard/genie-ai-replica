// ragas-job-result.js — READ-ONLY: fetch a finished (or in-flight) sidecar
// job and report what it measured.
//
// Why a separate fetcher: the polling loops that ran INSIDE the okf-server
// container died when the container was recreated, even though the sidecar
// job kept running. This one is invoked per poll, so the container's
// lifetime does not matter.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-job-result.js <job_id> [outfile]
const http = require('http');

const jobId = process.argv[2];
const outFile = process.argv[3] || null;
if (!jobId) {
  console.error('usage: node ragas-job-result.js <job_id> [outfile]');
  process.exit(2);
}
const SIDECAR = process.env.OKF_RAGAS_URL || 'http://ragas-service:8090';
const METRICS = [
  'context_entities_recall',
  'factual_correctness',
  'answer_relevancy',
  'faithfulness',
  'answer_correctness',
  'context_precision',
  'context_recall'
];

http
  .get(`${SIDECAR}/jobs/${jobId}`, {
    headers: { 'x-ragas-secret': process.env.RAGAS_INTERNAL_SECRET || process.env.OKF_INTERNAL_SECRET || '' }
  })
  .on('response', (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      let job = {};
      try {
        job = JSON.parse(d);
      } catch {
        console.log(`job ${jobId}: unparseable response`);
        process.exit(1);
      }
      console.log(`job ${jobId}: status=${job.status} progress=${JSON.stringify(job.progress || {})}`);
      if (job.error) console.log(`  error: ${String(job.error).slice(0, 300)}`);
      const pq = (job.result && job.result.per_query) || [];
      if (!pq.length) {
        console.log('  (no per_query yet)');
        process.exit(/done|failed|error|cancel/i.test(job.status) ? 0 : 1);
      }
      console.log(`  per_query rows: ${pq.length}`);
      METRICS.forEach((m) => {
        const v = pq.map((q) => q[m]).filter((x) => typeof x === 'number' && !Number.isNaN(x));
        if (v.length) {
          console.log(
            `  ${m.padEnd(26)} scored ${String(v.length).padStart(3)}/${pq.length}  mean ${(
              v.reduce((a, b) => a + b, 0) / v.length
            ).toFixed(4)}`
          );
        } else {
          console.log(`  ${m.padEnd(26)} scored   0/${pq.length}`);
        }
      });
      if (outFile) {
        require('fs').writeFileSync(outFile, JSON.stringify(pq));
        console.log(`  per_query written to ${outFile}`);
      }
      process.exit(/done|failed|error|cancel/i.test(job.status) ? 0 : 1);
    });
  })
  .on('error', (e) => {
    console.log(`job ${jobId}: ERR ${e.message}`);
    process.exit(1);
  });
