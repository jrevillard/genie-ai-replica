{{- /*
  OTLP exporter endpoint for the in-cluster OpenTelemetry Collector.

  The OpenTelemetry Operator creates a Service named `<cr-name>-collector`
  inside the collector's namespace. The CR deployed by the umbrella
  chart is named `genieai-collector` by default, so the service hostname
  is `genieai-collector-collector`. Operators that rename the CR (for
  parallel stacks, multi-region installs, or upgrade-in-place) override
  `Values.observability.collectorCRName`; the helper does the rename for
  them everywhere the endpoint is referenced.

  Returns the full http URL: scheme + authority only — no path, no port
  beyond the collector's listener (4318 OTLP/HTTP). The path component
  is appended by the OTel SDK at export time.
*/}}
{{- define "genieai-umbrella.otlpEndpoint" -}}
{{- $cr := .Values.observability.collectorCRName | default "genieai-collector" -}}
{{- printf "http://%s-collector.%s.svc.cluster.local:4318" $cr .Values.namespace -}}
{{- end -}}
