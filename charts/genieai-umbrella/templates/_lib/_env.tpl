{{/*
genieai-umbrella.envMapRows — turn a map of environment variables into the
list of {name, value} rows a container spec carries.

The chart takes the operator's environment as a MAP, not a list. Helm merges
maps key by key, so an overlay that sets one variable replaces that one and
keeps every default the chart declares beside it. A list would be replaced
wholesale: an overlay setting one variable would silently drop all the
others, and the deployment would come up with a different configuration than
the chart documents.

The values are stringified — a container env value is always a string, and
`true`/`3` in the values file would otherwise render as a YAML boolean or
number that the API server rejects.

Signature: {{ include "genieai-umbrella.envMapRows" . }}
Returns: a JSON array of {"name": ..., "value": ...}
*/}}
{{- define "genieai-umbrella.envMapRows" -}}
{{- $rows := list -}}
{{- range $name, $value := . -}}
{{- $rows = append $rows (dict "name" $name "value" (toString $value)) -}}
{{- end -}}
{{- toJson $rows -}}
{{- end -}}
