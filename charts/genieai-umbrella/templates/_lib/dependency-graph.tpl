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

Tiers are a list rather than two hardcoded keys: the OPEA tier has the
same shape as the others and was missing only because it was written
second. A dep name resolves against services, then opea, then data.
*/}}
{{- define "genieai-umbrella.dependencyGraph.json" -}}
{{- $graph := .Values.dependencyGraph | default dict -}}
{{- $tiers := list "services" "data" "opea" -}}
{{- /* Type guard: the evaluator's `for dep in deps.get("deps", [])`
       raises TypeError on anything that is not a list of strings — and
       a render-time rejection names the values key, the runtime crash
       names neither. Only a SLICE whose elements are strings is
       accepted: a string would iterate per char (per-char entries slip
       past the `dep == ""` filter and dep-check silently passes), a
       null DELETES the chart's own list, and an override that lands as
       a map (`deps: {deps: null}` — the shape a mistyped --set leaves
       behind) reaches the evaluator as an object, not a list. */ -}}
{{- range $tier := $tiers }}
{{- $nodes := (index $graph $tier) | default dict }}
{{- range $node, $deps := $nodes }}
{{- if not (kindIs "slice" $deps) }}
{{- fail (printf "dependencyGraph.%s.%s.deps must be a list of strings, got %s — declare the dependencies as a YAML list" $tier $node (kindOf $deps)) -}}
{{- end }}
{{- range $dep := $deps }}
{{- if not (kindIs "string" $dep) }}
{{- fail (printf "dependencyGraph.%s.%s.deps must be a list of strings, got an element of type %s" $tier $node (kindOf $dep)) -}}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- $json := dict "services" dict "data" dict "opea" dict -}}
{{- range $tier := $tiers }}
{{- $nodes := (index $graph $tier) | default dict }}
{{- range $node, $deps := $nodes -}}
{{- $_ := set (index $json $tier) $node (dict "deps" $deps) -}}
{{- end -}}
{{- end -}}
{{- $json | toJson -}}
{{- end -}}
