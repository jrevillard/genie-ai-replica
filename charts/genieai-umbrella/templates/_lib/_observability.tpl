{{- /*
  OTLP exporter endpoint for the in-cluster OpenTelemetry Collector.

  The OpenTelemetry Operator creates a Service named `<cr-name>-collector`
  inside the collector's namespace. The CR deployed by the umbrella
  chart is named `genieai-collector` by default, so the service hostname
  is `genieai-collector-collector`. Operators that rename the CR (for
  parallel stacks, multi-region installs, or upgrade-in-place) override
  `Values.observability.collectorCRName`; the helper does the rename for
  them everywhere the endpoint is referenced.

  The Collector OTLP/HTTP listener port (default 4318) is also a
  values override (`Values.observability.collectorPort`): a cluster
  with a non-default `spec.ports[0].port` on the operator-managed
  Service would otherwise see every span dropped at the source with
  no obvious error.

  Returns the full http URL: scheme + authority only — no path, no port
  beyond the collector's listener. The path component is appended by
  the OTel SDK at export time.
*/}}
{{- define "genieai-umbrella.otlpEndpoint" -}}
{{- $obs := .Values.observability | default dict -}}
{{- $cr := $obs.collectorCRName | default "genieai-collector" -}}
{{- $port := $obs.collectorPort | default 4318 -}}
{{- printf "http://%s-collector.%s.svc.cluster.local:%d" $cr .Values.namespace (int $port) -}}
{{- end -}}

{{- /*
  Shared log transform processors — included by BOTH collector
  pipelines (filelog agent and OTLP gateway) so every log source gets
  the same treatment:

  - transform/pii_redact: cross-cutting string-value redaction
    (passwords, bearer tokens, API keys, JWTs, emails) ported
    VERBATIM from configs/otel/otel-collector-config.yaml. The
    double-escape trap (\\s, \\. inside YAML single-quoted scalars)
    is preserved as-is — tests/otel-collector/run-pii-smoke.sh
    validates this copy before it ships. The in-process
    PIIRedactionProcessor (backend + document-repository tracing.js)
    remains the structured-log coverage; this collector regex is the
    defence for everything that reaches the pipeline as a string.
  - transform/extract_envelope_trace_context: lift trace/span ids
    embedded in log bodies into native trace context fields.
  - transform/stamp_log_metadata_from_msg: derive severity and a
    clean message from JSON or level-prefixed bodies.
  - transform/normalize_log_body: backend HTTP_REQUEST/INFO line
    parsing into structured http.* attributes.
  - transform/strip_python_log_prefix: drop CRITICAL/INFO/... prefixes
    from Python service lines.

  Deliberately NOT ported from the source config: the docker-label
  service.name stamp (fluentd/Compose labels do not exist here — the
  filelog agent stamps from k8s.container.name and OTLP SDKs set
  service.name in their Resource) and transform/kong_span_names
  (Kong is not deployed on the Kubernetes path; re-add from
  configs/otel/otel-collector-config.yaml if it ever is).

  Returns YAML at zero indent; callers nindent to their processors
  map (6 spaces).
*/}}
{{- define "genieai-umbrella.otelLogTransformProcessors" -}}
transform/pii_redact:
  error_mode: ignore
  log_statements:
    - context: log
      statements:
        - 'replace_pattern(body, "(?i)\"((?:password|api[_-]?key|apikey|session[_-]?id|user[_-]?id|email|mail|auth[_-]?token|bearer[_-]?token|authorization|token|secret|api[_-]?secret|credential(?:_id|s|)|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|private[_-]?key|secret[_-]?value|user[_-]?query|llm[_-]?response|document[_-]?text))\"\\s*[:=]\\s*\"[^\"]*\"", "\"$1\":\"[REDACTED]\"") where IsString(body)'
        - 'replace_pattern(body, "(?i)bearer\\s+[a-z0-9\\-_]{20,}", "bearer [REDACTED_BEARER]") where IsString(body)'
        - 'replace_pattern(body, "sk-[a-z0-9]{20,}", "[REDACTED_APIKEY]") where IsString(body)'
        - 'replace_pattern(body, "eyJ[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+", "[REDACTED_JWT]") where IsString(body)'
    - context: log
      statements:
        - 'replace_all_patterns(attributes, "value", "(?i)(?<p>(?:^|[^A-Za-z0-9]))(?<t>eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]+|sk-[A-Za-z0-9]{16,}|pk-[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|[A-Za-z0-9_=-]{40,})(?<s>(?:$|[^A-Za-z0-9]))", "${p}[REDACTED]${s}") where IsMap(attributes)'
transform/extract_envelope_trace_context:
  error_mode: ignore
  log_statements:
    - context: log
      statements:
        # trace_id and span_id are pcommon.TraceID / pcommon.SpanID, not
        # strings: assigning the extracted string is REJECTED by OTTL
        # ("expects pcommon.TraceID but got string") and, under
        # error_mode: ignore, the failure is swallowed — the record is
        # emitted with an EMPTY trace id, so the log-to-trace link (the
        # Grafana datasource derivedField, the `trace_id:*` variable in
        # service-logs.json) never resolves. The converters build the
        # typed value from the hex string.
        - 'set(trace_id, TraceID(ExtractPatterns(body, "trace_id[\": ]+(?P<tid>[0-9a-f]{32})")["tid"])) where IsString(body) and IsMatch(body, "trace_id[\": ]+[0-9a-f]{32}")'
        - 'set(span_id, SpanID(ExtractPatterns(body, "span_id[\": ]+(?P<sid>[0-9a-f]{16})")["sid"])) where IsString(body) and IsMatch(body, "span_id[\": ]+[0-9a-f]{16}")'
transform/stamp_log_metadata_from_msg:
  error_mode: ignore
  log_statements:
    - context: log
      statements:
        - 'set(severity_text, ToUpperCase(ParseJSON(body)["level"])) where IsString(body) and Substring(body, 0, 1) == "{"'
        - 'set(severity_text, ToUpperCase(ExtractPatterns(body, "(?i)^(?P<sev>info|warn|warning|error|debug|fatal|trace)[: ]")["sev"])) where IsString(body) and IsMatch(body, "(?i)^(info|warn|warning|error|debug|fatal|trace)[: ]")'
        - 'set(severity_text, ToUpperCase(body["level"])) where IsMap(body) and IsString(body["level"])'
        - 'set(body, ParseJSON(body)["message"]) where IsString(body) and Substring(body, 0, 1) == "{" and IsString(ParseJSON(body)["message"])'
        - 'set(body, body["message"]) where IsMap(body) and IsString(body["message"])'
        - 'set(severity_number, 9) where severity_text == "INFO"'
        - 'set(severity_number, 13) where severity_text == "WARN"'
        - 'set(severity_number, 13) where severity_text == "WARNING"'
        - 'set(severity_number, 17) where severity_text == "ERROR"'
        - 'set(severity_number, 5) where severity_text == "DEBUG"'
        - 'set(severity_number, 21) where severity_text == "FATAL"'
        - 'set(severity_number, 1) where severity_text == "TRACE"'
transform/normalize_log_body:
  error_mode: ignore
  log_statements:
    - context: log
      statements:
        - 'set(severity_text, "INFO") where IsString(body) and Substring(body, 0, 13) == "HTTP_REQUEST:"'
        - 'set(severity_number, 9) where severity_text == "INFO" and severity_number == 0'
        - 'set(attributes["http.method"], ExtractPatterns(body, "^HTTP_REQUEST: (?P<m>[A-Z]+) ")["m"]) where IsString(body) and Substring(body, 0, 13) == "HTTP_REQUEST:"'
        - 'set(attributes["http.path"], ExtractPatterns(body, "^HTTP_REQUEST: [A-Z]+ (?P<p>[^ ?]+)")["p"]) where IsString(body) and Substring(body, 0, 13) == "HTTP_REQUEST:"'
        - 'set(attributes["http.status_code"], ExtractPatterns(body, "^HTTP_REQUEST: [A-Z]+ [^ ]+( [?] [^ ]*)? (?P<s>[0-9]+) ")["s"]) where IsString(body) and Substring(body, 0, 13) == "HTTP_REQUEST:"'
        - 'set(attributes["http.response_time_ms"], ExtractPatterns(body, "^HTTP_REQUEST: [A-Z]+ [^ ]+( [?] [^ ]*)? [0-9]+ (?P<ms>[0-9.]+) ms")["ms"]) where IsString(body) and Substring(body, 0, 13) == "HTTP_REQUEST:"'
        - 'set(attributes["http.user_agent"], ExtractPatterns(body, "Headers:[ ](?:-|[^ ]+)[ ](?P<ua>.+)$")["ua"]) where IsString(body) and Substring(body, 0, 13) == "HTTP_REQUEST:"'
        - 'set(body, Concat([ExtractPatterns(body, "^HTTP_REQUEST: (?P<m>[A-Z]+) ")["m"], " ", ExtractPatterns(body, "^HTTP_REQUEST: [A-Z]+ (?P<p>[^ ?]+)")["p"], " ", ExtractPatterns(body, "^HTTP_REQUEST: [A-Z]+ [^ ]+( [?] [^ ]*)? (?P<s>[0-9]+) ")["s"], " ", ExtractPatterns(body, "^HTTP_REQUEST: [A-Z]+ [^ ]+( [?] [^ ]*)? [0-9]+ (?P<ms>[0-9.]+) ms")["ms"], " ms"], "")) where IsString(body) and Substring(body, 0, 13) == "HTTP_REQUEST:"'
        - 'set(attributes["http.client_ip"], ExtractPatterns(body, "(?P<ip>[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+):[0-9]+")["ip"]) where IsString(body) and Substring(body, 0, 5) == "INFO:" and IsMatch(body, "^[A-Z]+:[ ]+[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+:")'
        - 'set(attributes["http.method"], ExtractPatterns(body, "\" (?P<m>[A-Z]+) (?P<p>[^ ?\"]+)")["m"]) where IsString(body) and Substring(body, 0, 5) == "INFO:" and IsMatch(body, "^[A-Z]+:[ ]+[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+:")'
        - 'set(attributes["http.path"], ExtractPatterns(body, "\" (?P<m>[A-Z]+) (?P<p>[^ ?\"]+)")["p"]) where IsString(body) and Substring(body, 0, 5) == "INFO:" and IsMatch(body, "^[A-Z]+:[ ]+[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+:")'
        - 'set(attributes["http.status_code"], ExtractPatterns(body, "\" (?P<s>[0-9]{3}) ")["s"]) where IsString(body) and Substring(body, 0, 5) == "INFO:" and IsMatch(body, "^[A-Z]+:[ ]+[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+:")'
        - 'set(body, Concat([ExtractPatterns(body, "\" (?P<m>[A-Z]+) ")["m"], " ", ExtractPatterns(body, "\" (?P<m>[A-Z]+) (?P<p>[^ ?\"]+)")["p"], " ", ExtractPatterns(body, "\" (?P<s>[0-9]{3}) ")["s"]], "")) where IsString(body) and Substring(body, 0, 5) == "INFO:" and IsMatch(body, "^[A-Z]+:[ ]+[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+:")'
        - 'set(body, ExtractPatterns(body, "^\\[[^]]+\\][ ](?P<m>.+)$")["m"]) where IsString(body) and IsMatch(body, "^\\[[0-9]{4}-[0-9]{2}-[0-9]{2}[ ][0-9]{2}:[0-9]{2}:[0-9]{2}\\][ ]")'
transform/strip_python_log_prefix:
  error_mode: ignore
  log_statements:
    - context: log
      statements:
        - 'set(body, ExtractPatterns(body, "^(CRITICAL|ERROR|WARNING|INFO|DEBUG|TRACE)[: ]+(?P<m>.*)$")["m"]) where IsString(body) and IsMatch(body, "^(CRITICAL|ERROR|WARNING|INFO|DEBUG|TRACE)[: ]+")'
{{- end -}}

{{/*
genieai-umbrella.otlpPort — the Collector's OTLP/HTTP listener port, the
port half of otlpEndpoint. Every NetworkPolicy egress rule that admits
telemetry reads the port from here, so a non-default collectorPort is
one edit, not one per policy.
*/}}
{{- define "genieai-umbrella.otlpPort" -}}
{{- $obs := .Values.observability | default dict -}}
{{- $obs.collectorPort | default 4318 -}}
{{- end -}}

{{/*
genieai-umbrella.observabilityEnabledFlag — the value of the
ENABLE_OBSERVABILITY env row: "1" when any signal tier is on. One
definition for every service that carries the row.
*/}}
{{- define "genieai-umbrella.observabilityEnabledFlag" -}}
{{- /* Normalized before it is read: a cleared observability tier (or a
cleared signal block) must degrade to "0" instead of crashing the
template engine on a nil parent. */ -}}
{{- $obs := .Values.observability | default dict -}}
{{- $logs := $obs.logs | default dict -}}
{{- $metrics := $obs.metrics | default dict -}}
{{- $traces := $obs.traces | default dict -}}
{{- /* The switch is coerced to a BOOL: sprig's `ternary` refuses a
non-bool argument ("invalid value; expected bool"), and a CLEARED
signal block leaves `enabled` nil — the tier is off, not broken. */ -}}
{{- $on := or (and (kindIs "bool" $logs.enabled) $logs.enabled) (and (kindIs "bool" $metrics.enabled) $metrics.enabled) (and (kindIs "bool" $traces.enabled) $traces.enabled) -}}
{{- ternary "1" "0" $on -}}
{{- end -}}
