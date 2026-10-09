{{/*
Emit the dependency graph as a JSON blob suitable for mounting into the
pre-install hook Pod. The Pod's shell script reads it, evaluates edges, and
fails the install if a service is enabled but its dependencies are not.
*/}}
{{- define "genieai-umbrella.dependencyGraph.json" -}}
{{- $graph := .Values.dependencyGraph -}}
{{- $json := dict "services" dict "data" dict -}}
{{- range $service, $deps := $graph.services -}}
{{- $_ := set $json.services $service (dict "deps" $deps) -}}
{{- end -}}
{{- range $data, $deps := $graph.data -}}
{{- $_ := set $json.data $data (dict "deps" $deps) -}}
{{- end -}}
{{- $json | toJson -}}
{{- end -}}
