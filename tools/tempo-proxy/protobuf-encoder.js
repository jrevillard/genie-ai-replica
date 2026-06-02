// protobuf-encoder — Encodes TraceByIDResponse and Trace to binary protobuf
//
// Uses official google-protobuf generated code (NOT protobufjs).
// google-protobuf produces wire-compatible binary with Go's proto.Unmarshal.
//
// Input: OTel protobuf JSON (snake_case) from jaegerToResourceSpans() in server.js.
// Output: binary protobuf Buffer.

'use strict';

const common_pb = require('./proto-gen/opentelemetry/proto/common/v1/common_pb.js');
const resource_pb = require('./proto-gen/opentelemetry/proto/resource/v1/resource_pb.js');
const trace_pb = require('./proto-gen/opentelemetry/proto/trace/v1/trace_pb.js');
const tempo_pb = require('./proto-gen/tempopb/trace_pb.js');

// Expose init() as no-op for backward compat — google-protobuf needs no async init
async function init() {
  console.log('[tempo-proxy] protobuf encoder initialized (google-protobuf)');
}

function setAnyValue(anyValue, av) {
  // av is { stringValue, boolValue, intValue, doubleValue }
  if (av.stringValue !== undefined && av.stringValue !== null) {
    anyValue.setStringValue(String(av.stringValue));
  } else if (av.boolValue !== undefined && av.boolValue !== null) {
    anyValue.setBoolValue(Boolean(av.boolValue));
  } else if (av.intValue !== undefined && av.intValue !== null) {
    // google-protobuf setIntValue takes number (lossy > 2^53) or Long
    anyValue.setIntValue(String(av.intValue));
  } else if (av.doubleValue !== undefined && av.doubleValue !== null && Number.isFinite(Number(av.doubleValue))) {
    anyValue.setDoubleValue(Number(av.doubleValue));
  }
}

function convertKeyValue(kv) {
  const keyValue = new common_pb.KeyValue();
  keyValue.setKey(kv.key);
  if (kv.value) {
    const anyValue = new common_pb.AnyValue();
    setAnyValue(anyValue, kv.value);
    keyValue.setValue(anyValue);
  }
  return keyValue;
}

function convertSpanEvent(evtProto, evt) {
  if (evt.time_unix_nano !== undefined) {
    evtProto.setTimeUnixNano(evt.time_unix_nano);
  }
  if (evt.name) evtProto.setName(evt.name);
  if (evt.attributes && evt.attributes.length) {
    for (const attr of evt.attributes) {
      evtProto.addAttributes(convertKeyValue(attr));
    }
  }
}

function convertSpan(spanProto, span) {
  // trace_id and span_id are hex strings, proto expects bytes
  spanProto.setTraceId(stringToBytes(span.trace_id));
  spanProto.setSpanId(stringToBytes(span.span_id));
  if (span.name) spanProto.setName(span.name);

  // uint64 fields — google-protobuf handles string numbers for uint64 via set*
  // but setStartTimeUnixNano only takes number or Long. Use string and let
  // google-protobuf handle the conversion internally.
  if (span.start_time_unix_nano !== undefined) {
    spanProto.setStartTimeUnixNano(span.start_time_unix_nano);
  }
  if (span.end_time_unix_nano !== undefined) {
    spanProto.setEndTimeUnixNano(span.end_time_unix_nano);
  }

  if (span.parent_span_id) {
    spanProto.setParentSpanId(stringToBytes(span.parent_span_id));
  }
  if (span.attributes && span.attributes.length) {
    for (const attr of span.attributes) {
      spanProto.addAttributes(convertKeyValue(attr));
    }
  }
  if (span.events && span.events.length) {
    for (const evt of span.events) {
      const evtProto = new trace_pb.SpanEvent();
      convertSpanEvent(evtProto, evt);
      spanProto.addEvents(evtProto);
    }
  }
  if (span.status) {
    const status = new trace_pb.Status();
    status.setCode(span.status.code || 0);
    if (span.status.message) status.setMessage(span.status.message);
    spanProto.setStatus(status);
  }
}

function convertScopeSpans(scopeSpansProto, ss) {
  const scope = new common_pb.InstrumentationScope();
  if (ss.scope) {
    if (ss.scope.name) scope.setName(ss.scope.name);
    if (ss.scope.version) scope.setVersion(ss.scope.version);
  }
  scopeSpansProto.setScope(scope);

  if (ss.spans && ss.spans.length) {
    for (const span of ss.spans) {
      const spanProto = new trace_pb.Span();
      convertSpan(spanProto, span);
      scopeSpansProto.addSpans(spanProto);
    }
  }
  if (ss.schema_url) scopeSpansProto.setSchemaUrl(ss.schema_url);
}

function convertResourceSpans(rsProto, rs) {
  const resource = new resource_pb.Resource();
  if (rs.resource && rs.resource.attributes && rs.resource.attributes.length) {
    for (const attr of rs.resource.attributes) {
      resource.addAttributes(convertKeyValue(attr));
    }
  }
  rsProto.setResource(resource);

  if (rs.scopeSpans && rs.scopeSpans.length) {
    for (const ss of rs.scopeSpans) {
      const ssProto = new trace_pb.ScopeSpans();
      convertScopeSpans(ssProto, ss);
      rsProto.addScopeSpans(ssProto);
    }
  }
  if (rs.schema_url) rsProto.setSchemaUrl(rs.schema_url);
}

// Hex string → Uint8Array (for trace_id, span_id, parent_span_id)
function stringToBytes(hex) {
  if (!hex) return new Uint8Array(0);
  const buf = Buffer.from(hex, 'hex');
  return new Uint8Array(buf);
}

function encodeTraceByIDResponse(jsonData) {
  const response = new tempo_pb.TraceByIDResponse();

  if (jsonData.trace && jsonData.trace.resourceSpans && jsonData.trace.resourceSpans.length) {
    const trace = new tempo_pb.Trace();
    for (const rs of jsonData.trace.resourceSpans) {
      const rsProto = new trace_pb.ResourceSpans();
      convertResourceSpans(rsProto, rs);
      trace.addResourcespans(rsProto);
    }
    response.setTrace(trace);
  }

  return Buffer.from(response.serializeBinary());
}

function encodeTrace(jsonData) {
  const trace = new tempo_pb.Trace();
  if (jsonData.resourceSpans && jsonData.resourceSpans.length) {
    for (const rs of jsonData.resourceSpans) {
      const rsProto = new trace_pb.ResourceSpans();
      convertResourceSpans(rsProto, rs);
      trace.addResourcespans(rsProto);
    }
  }
  return Buffer.from(trace.serializeBinary());
}

module.exports = { init, encodeTraceByIDResponse, encodeTrace };
