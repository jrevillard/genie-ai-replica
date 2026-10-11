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
{{- /* Type guard: a user override like `backend.deps: "keycloak,arangodb"`
       (a string) would otherwise emit `"deps": "keycloak,arangodb"` and
       the python evaluator's `for dep in deps` would iterate the chars
       of the string — empty per-char entries slip past the `dep == ""`
       filter and dep-check silently passes. Reject non-iterable
       values at render time. Helm's Values representation of a YAML
       list varies between releases (slice in some, map with int keys
       in others), so accept any collection kind; the failure case is
       specifically a scalar (string) which would iterate per char. */ -}}
{{- range $service, $deps := $graph.services }}
{{- if or (kindIs "string" $deps) (kindIs "bool" $deps) }}
{{- fail (printf "dependencyGraph.services.%s.deps must be a list, got %s" $service (kindOf $deps)) -}}
{{- end }}
{{- end }}
{{- range $data, $deps := $graph.data }}
{{- if or (kindIs "string" $deps) (kindIs "bool" $deps) }}
{{- fail (printf "dependencyGraph.data.%s.deps must be a list, got %s" $data (kindOf $deps)) -}}
{{- end }}
{{- end }}
{{- $json := dict "services" dict "data" dict -}}
{{- range $service, $deps := $graph.services -}}
{{- $_ := set $json.services $service (dict "deps" $deps) -}}
{{- end -}}
{{- range $data, $deps := $graph.data -}}
{{- $_ := set $json.data $data (dict "deps" $deps) -}}
{{- end -}}
{{- $json | toJson -}}
{{- end -}}
