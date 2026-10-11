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
{{- $cr := .Values.observability.collectorCRName | default "genieai-collector" -}}
{{- $port := .Values.observability.collectorPort | default 4318 -}}
{{- printf "http://%s-collector.%s.svc.cluster.local:%d" $cr .Values.namespace (int $port) -}}
{{- end -}}
