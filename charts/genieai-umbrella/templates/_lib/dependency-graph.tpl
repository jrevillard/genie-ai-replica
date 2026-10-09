{{/*
Emit the dependency graph as a JSON blob suitable for mounting into the
pre-install hook Pod. The Pod's shell script reads it, evaluates edges, and
fails the install if a service is enabled but its dependencies are not.

Design note: the graph IS the extension surface for dep-check. Any
tier the operator enables that is not a graph node is not validated
by this hook — intentional. The hook is the contract, not
values.yaml. `enabled.json` only mirrors graph nodes; non-graph enables
(e.g. a feature flag toggle that does not add a node) are accepted as
out-of-scope and validated by whichever component owns the toggle.
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
