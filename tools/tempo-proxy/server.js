// tempo-proxy — Bridges Grafana Tempo/TraceQL API ↔ VictoriaTraces Jaeger API
//
// Grafana 12 Explore Traces app uses Tempo protocol with protobuf JSON responses.
// VictoriaTraces only supports Jaeger API.
// This proxy translates Tempo endpoints → VictoriaTraces Jaeger API,
// extracts service/operation from TraceQL, and returns Tempo protobuf JSON format.

const http = require('http');
const { init: initProtobuf, encodeTraceByIDResponse, encodeTrace } = require('./protobuf-encoder');

const VICTORIATRACES = process.env.VICTORIATRACES_URL || 'http://victoriatraces:10428';
const PORT = parseInt(process.env.PORT || '10429', 10);

// ── Protobuf encoder initialization ────────────────────────────────────
let protobufReady = false;
initProtobuf()
  .then(() => { protobufReady = true; })
  .catch((err) => { console.error(`[tempo-proxy] protobuf init failed: ${err.message}`); });

// ── Jaeger ↔ Tempo ID formats ─────────────────────────────────────────
function traceIDFromJaeger(jaegerID) {
  return jaegerID.padStart(32, '0').toLowerCase();
}

function spanIDFromJaeger(jaegerID) {
  return jaegerID.padStart(16, '0').toLowerCase();
}

// ── Jaeger trace → OTel ResourceSpans (Tempo TraceByID format) ──────
// TraceByIDResponse.trace = Trace { repeated ResourceSpans resourceSpans }
// OTel protobuf uses snake_case in JSON encoding
function jaegerToResourceSpans(jaegerTrace) {
  const { processes = {}, spans = [] } = jaegerTrace;

  const byProcess = new Map();
  for (const span of spans) {
    const pid = span.processID;
    if (!byProcess.has(pid)) byProcess.set(pid, []);
    byProcess.get(pid).push(span);
  }

  const resourceSpans = [];
  for (const [pid, procSpans] of byProcess) {
    const process = processes[pid] || { serviceName: 'unknown', tags: [] };
    const attributes = [];
    attributes.push({ key: 'service.name', value: { stringValue: process.serviceName } });
    for (const tag of process.tags || []) {
      attributes.push(tagToOtelAttribute(tag));
    }

    const scopeSpans = [{
      scope: { name: '', version: '' },
      spans: procSpans.map(jaegerSpanToOtel),
    }];

    resourceSpans.push({ resource: { attributes }, scopeSpans });
  }

  return resourceSpans;
}

function jaegerSpanToOtel(span) {
  const otlp = {
    trace_id: traceIDFromJaeger(span.traceID),
    span_id: spanIDFromJaeger(span.spanID),
    name: span.operationName,
    start_time_unix_nano: String(span.startTime * 1000),
    end_time_unix_nano: String((span.startTime + span.duration) * 1000),
    status: {},
    attributes: [],
    events: (span.logs || []).map((log) => ({
      time_unix_nano: String(log.timestamp * 1000),
      attributes: (log.fields || []).map(tagToOtelAttribute),
    })),
  };

  if (span.parentSpanID) otlp.parent_span_id = spanIDFromJaeger(span.parentSpanID);

  for (const tag of span.tags || []) {
    otlp.attributes.push(tagToOtelAttribute(tag));
  }

  const errorTag = (span.tags || []).find((t) => t.key === 'error');
  if (errorTag && errorTag.value !== 'false' && errorTag.value !== 'unset') {
    otlp.status = { code: 2, message: 'Error' };
  } else {
    otlp.status = { code: 1 };
  }

  return otlp;
}

function tagToOtelAttribute(tag) {
  const val = tag.value;
  const result = { key: tag.key };
  const tagType = tag.type || '';
  // Only convert to numeric when Jaeger tag type is explicitly numeric
  // This prevents version strings like "0.66" being encoded as doubleValue
  if (tagType === 'bool' || typeof val === 'boolean') {
    result.value = { boolValue: val };
  } else if (tagType === 'int64' || tagType === 'int') {
    result.value = { intValue: String(parseInt(val, 10)) };
  } else if (tagType === 'float64' || tagType === 'float') {
    result.value = { doubleValue: parseFloat(val) };
  } else {
    result.value = { stringValue: String(val) };
  }
  return result;
}

// ── Build SpanSets for TraceSearchMetadata ──────────────────────────
function buildSpanSets(trace) {
  const root = trace.spans?.find((s) => !s.parentSpanID) || trace.spans?.[0];
  if (!root) return [];

  const spans = [];
  for (const span of trace.spans || []) {
    spans.push({
      spanID: spanIDFromJaeger(span.spanID),
      name: span.operationName,
      startTimeUnixNano: span.startTime * 1000,
      durationNanos: span.duration * 1000,
      attributes: [],
    });
  }

  return [{
    spans,
    matched: spans.length,
    attributes: [],
  }];
}

// ── Jaeger trace search → Tempo TraceSearchMetadata format ──────────
// SearchResponse.traces = repeated TraceSearchMetadata
function jaegerSearchToTempoTraces(jaegerData) {
  const traces = [];
  for (const trace of jaegerData || []) {
    const root = trace.spans?.find((s) => !s.parentSpanID) || trace.spans?.[0];
    if (!root) continue;

    // Build serviceStats from processes
    const serviceStats = {};
    for (const span of trace.spans || []) {
      const proc = trace.processes?.[span.processID];
      if (!proc) continue;
      const svc = proc.serviceName;
      if (!serviceStats[svc]) serviceStats[svc] = { spanCount: 0, errorCount: 0 };
      serviceStats[svc].spanCount++;
      const errTag = (span.tags || []).find((t) => t.key === 'error');
      if (errTag && errTag.value !== 'false' && errTag.value !== 'unset') {
        serviceStats[svc].errorCount++;
      }
    }

    traces.push({
      traceID: traceIDFromJaeger(trace.traceID),
      rootServiceName: trace.processes?.[root.processID]?.serviceName || 'unknown',
      rootTraceName: root.operationName,
      startTimeUnixNano: root.startTime * 1000, // uint64 → number
      durationMs: Math.max(1, Math.round(root.duration / 1000)), // uint32 → number, min 1ms
      spanSets: buildSpanSets(trace),
      serviceStats,
    });
  }
  return { traces };
}

// ── TraceQL → Jaeger param extraction ──────────────────────────────
function extractJaegerParamsFromTraceQL(traceQL) {
  const params = { service: '', operation: '' };
  if (!traceQL) return params;

  let q = decodeURIComponent(traceQL);

  const serviceMatch = q.match(/resource\.service\.name\s*=\s*"([^"]+)"/)
    || q.match(/\.service\s*=\s*"([^"]+)"/)
    || q.match(/name\s*=\s*"([^"]+)"/);
  if (serviceMatch) params.service = serviceMatch[1];

  const opMatch = q.match(/\.name\s*=\s*"([^"]+)"/);
  if (opMatch && !params.service) params.operation = opMatch[1];

  return params;
}

// ── Service name cache ────────────────────────────────────────────────
let serviceCache = { names: [], ts: 0 };
const SERVICE_CACHE_TTL = 30_000;

async function getServiceNames() {
  const now = Date.now();
  if (serviceCache.names.length > 0 && now - serviceCache.ts < SERVICE_CACHE_TTL) {
    return serviceCache.names;
  }
  try {
    const { status, body } = await proxyRequest(`${VICTORIATRACES}/select/jaeger/api/services`);
    if (status === 200) {
      const resp = JSON.parse(body);
      serviceCache = { names: resp.data || [], ts: now };
    }
  } catch (e) {
    console.error(`[tempo-proxy] failed to fetch services: ${e.message}`);
  }
  return serviceCache.names;
}

// ── HTTP helpers ────────────────────────────────────────────────────
function proxyRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: 15000,
    };
    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data);
  console.log(`[tempo-proxy] RESP ${status} body=${body.substring(0, 300)}`);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// ── Route handlers ──────────────────────────────────────────────────

async function handleServices(req, res) {
  // Tempo GET /api/services → Jaeger /api/services
  // Response: {"data":["svc1","svc2"]} — same format
  const url = `${VICTORIATRACES}/select/jaeger/api/services`;
  const { status, body } = await proxyRequest(url);
  if (status !== 200) return jsonResponse(res, status, { error: 'upstream error' });
  const jaegerResp = JSON.parse(body);
  jsonResponse(res, 200, { data: jaegerResp.data || [] });
}

async function handleOperations(req, res) {
  // Tempo GET /api/operations?service=X → Jaeger /api/services/X/operations
  // Response: {"data":["op1","op2"]} — same format
  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const service = params.get('service');
  if (!service) return jsonResponse(res, 400, { error: 'missing service parameter' });

  const url = `${VICTORIATRACES}/select/jaeger/api/services/${encodeURIComponent(service)}/operations`;
  const { status, body } = await proxyRequest(url);
  if (status !== 200) return jsonResponse(res, status, { error: 'upstream error' });
  const jaegerResp = JSON.parse(body);
  jsonResponse(res, 200, { data: jaegerResp.data || [] });
}

async function handleSearch(req, res) {
  // SearchResponse: { traces: repeated TraceSearchMetadata, metrics: SearchMetrics }
  // NO status field, NO warnings field
  const urlParsed = new URL(req.url, `http://localhost:${PORT}`);
  const params = urlParsed.searchParams;

  let service = params.get('service') || '';
  let operation = params.get('operation') || '';
  let start = params.get('start') || '';
  let end = params.get('end') || '';
  let limit = params.get('limit') || '20';

  if (!service) {
    const traceQL = params.get('q') || '';
    const extracted = extractJaegerParamsFromTraceQL(traceQL);
    service = extracted.service;
    operation = extracted.operation;
  }

  if (!service && req.method === 'POST') {
    const bodyText = await readBody(req);
    try {
      const json = JSON.parse(bodyText);
      const extracted = extractJaegerParamsFromTraceQL(json.traceQL || '');
      service = extracted.service;
      operation = extracted.operation;
      if (json.start) start = String(json.start);
      if (json.end) end = String(json.end);
      if (json.limit) limit = String(json.limit);
    } catch (e) { /* ignore */ }
  }

  // VictoriaTraces requires 'service' param — fetch all services if none specified
  let services = service ? [service] : await getServiceNames();

  // Convert start/end from seconds (Grafana Tempo) to microseconds (VictoriaTraces Jaeger API)
  const microStart = start ? (parseInt(start) < 1e12 ? String(parseInt(start) * 1000000) : start) : '';
  const microEnd = end ? (parseInt(end) < 1e12 ? String(parseInt(end) * 1000000) : end) : '';

  // Query all services in parallel to avoid timeout
  const promises = services.map(async (svc) => {
    const jaegerParams = new URLSearchParams();
    jaegerParams.set('service', svc);
    jaegerParams.set('limit', limit);
    if (microStart) jaegerParams.set('start', microStart);
    if (microEnd) jaegerParams.set('end', microEnd);
    if (operation) jaegerParams.set('operation', operation);

    try {
      const url = `${VICTORIATRACES}/select/jaeger/api/traces?${jaegerParams}`;
      const { status, body } = await proxyRequest(url);
      if (status === 200) {
        const jaegerResp = JSON.parse(body);
        return jaegerSearchToTempoTraces(jaegerResp.data).traces;
      }
    } catch (e) {
      console.error(`[tempo-proxy] failed to fetch traces for ${svc}: ${e.message}`);
    }
    return [];
  });

  const results = await Promise.all(promises);
  const allTraces = results.flat();

  // Sort by startTime descending, limit results
  allTraces.sort((a, b) => b.startTimeUnixNano - a.startTimeUnixNano);
  const limited = allTraces.slice(0, parseInt(limit, 10));
  // SearchResponse format: { traces: [...] }
  jsonResponse(res, 200, { traces: limited });
}

function handleMetricsQueryRange(req, res) {
  // Grafana Explore Traces sends: GET /api/v1/query_range?query=<TraceQL>&start=&end=&step=
  // Response format: { results: [{ name: string, timeseries: [{ labels, values }] }] }
  jsonResponse(res, 200, { results: [] });
}

function handleMetricsQuery(req, res) {
  // GET /api/v1/query?query=<TraceQL>&time=<unix_ts>
  jsonResponse(res, 200, { results: [] });
}

async function handleSearchTagsV2(req, res) {
  // SearchTagsV2Response: { scopes: [{ name: "scope", tags: ["key1","key2"] }] }
  // Group known tags under "resource" scope
  const services = await getServiceNames();
  jsonResponse(res, 200, {
    scopes: [
      { name: 'resource', tags: ['service.name'] },
      { name: 'span', tags: ['name', 'status'] },
    ],
  });
}

async function handleSearchTagValuesV2(req, res) {
  // SearchTagValuesV2Response: { tagValues: [{ type: "string", value: "v1" }] }
  const pathMatch = req.url.match(/\/api\/(?:v2\/)?search\/(?:tags|tag)\/([^/]+)\/values/);
  const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const tag = pathMatch ? pathMatch[1] : (urlParams.get('tag') || '');

  if (tag === 'resource.service.name' || tag === 'service.name') {
    const services = await getServiceNames();
    jsonResponse(res, 200, {
      tagValues: services.map((s) => ({ type: 'string', value: s })),
    });
  } else if (tag === 'name' || tag === 'span.name') {
    jsonResponse(res, 200, {
      tagValues: [{ type: 'string', value: 'HTTP GET' }],
    });
  } else if (tag === 'status') {
    jsonResponse(res, 200, {
      tagValues: [
        { type: 'string', value: 'ok' },
        { type: 'string', value: 'error' },
        { type: 'string', value: 'unset' },
      ],
    });
  } else {
    jsonResponse(res, 200, { tagValues: [] });
  }
}

async function handleTraceById(req, res) {
  // Supports both V1 (/api/traces/{id} → tempopb.Trace) and
  // V2 (/api/v2/traces/{id} → tempopb.TraceByIDResponse).
  // Grafana Tempo datasource ALWAYS uses proto.Unmarshal (never checks Content-Type).
  // Returns binary protobuf encoded via google-protobuf (Go-compatible wire format).
  const match = req.url.match(/^\/api\/(v2\/)?traces\/([0-9a-fA-F]+)(\?.*)?$/);
  if (!match) return jsonResponse(res, 400, { error: 'invalid trace ID' });

  const isV2 = !!match[1];
  const traceId = match[2];
  const url = `${VICTORIATRACES}/select/jaeger/api/traces/${traceId}`;
  const { status, body } = await proxyRequest(url);
  if (status !== 200) return jsonResponse(res, status, { error: 'upstream error' });

  const jaegerResp = JSON.parse(body);
  const traces = jaegerResp.data || [];

  // Merge all traces' resourceSpans into one
  const allResourceSpans = [];
  for (const trace of traces) {
    const resourceSpans = jaegerToResourceSpans(trace);
    allResourceSpans.push(...resourceSpans);
  }

  const traceData = {
    trace: { resourceSpans: allResourceSpans },
  };

  if (!protobufReady) {
    console.error('[tempo-proxy] protobuf not ready, falling back to JSON');
    return jsonResponse(res, 200, traceData);
  }

  try {
    const buf = isV2
      ? encodeTraceByIDResponse(traceData)
      : encodeTrace(traceData.trace);
    console.log(`[tempo-proxy] RESP 200 protobuf ${buf.length} bytes (V${isV2 ? '2' : '1'})`);
    res.writeHead(200, { 'Content-Type': 'application/protobuf' });
    return res.end(buf);
  } catch (err) {
    console.error(`[tempo-proxy] protobuf encode error: ${err.message}`);
    return jsonResponse(res, 500, { error: `protobuf encode: ${err.message}` });
  }
}

// ── Main router ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];

  try {
    console.log(`[tempo-proxy] ${req.method} ${req.url} accept=${req.headers.accept || 'none'}`);

    if (path === '/' || path === '/ready' || path === '/health' || path === '/api/echo' || path === '/api/echo/') {
      jsonResponse(res, 200, { status: 'ok' });

    // Tempo datasource endpoints — exact protobuf JSON format
    } else if (path === '/api/services') {
      await handleServices(req, res);
    } else if (path === '/api/operations') {
      await handleOperations(req, res);
    } else if (path === '/api/search') {
      // SearchResponse: { traces: [...], metrics: {...} }
      await handleSearch(req, res);
    } else if (path === '/api/v2/search/tags') {
      // SearchTagsV2Response: { scopes: [{ name, tags }] }
      await handleSearchTagsV2(req, res);
    } else if (path.match(/^\/api\/v2\/search\/tag\/[^/]+\/values$/)) {
      // SearchTagValuesV2Response: { tagValues: [{ type, value }] }
      await handleSearchTagValuesV2(req, res);
    } else if (path.match(/^\/api\/search\/tags\/[^/]+\/values$/)) {
      await handleSearchTagValuesV2(req, res);
    } else if (path === '/api/metrics/query_range') {
      handleMetricsQueryRange(req, res);
    } else if (path === '/api/metrics/query') {
      handleMetricsQueryRange(req, res);
    } else if (path === '/api/v1/query_range') {
      handleMetricsQueryRange(req, res);
    } else if (path === '/api/v1/query') {
      handleMetricsQuery(req, res);
    } else if (path.match(/^\/api\/v2\/traces\/[0-9a-fA-F]+/)) {
      // TraceByIDResponse V2 (protobuf binary when Accept: application/protobuf)
      await handleTraceById(req, res);
    } else if (path === '/api/traces' || path === '/api/traces/') {
      // SearchResponse (same as /api/search)
      await handleSearch(req, res);
    } else if (path.startsWith('/api/traces/')) {
      // Trace V1 (protobuf binary when Accept: application/protobuf)
      await handleTraceById(req, res);
    } else if (path.startsWith('/api/v2/')) {
      jsonResponse(res, 200, { scopes: [] });
    } else {
      console.log(`[tempo-proxy] 404 for ${req.method} ${req.url}`);
      jsonResponse(res, 404, { error: 'not found' });
    }
  } catch (err) {
    console.error(`[tempo-proxy] ${req.method} ${req.url} → ${err.message}`);
    jsonResponse(res, 502, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`tempo-proxy listening on :${PORT}, backend: ${VICTORIATRACES}`);
});
