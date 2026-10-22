{{/*
Shared env-row emitters for values the whole chart wires identically.
genieai-umbrella.secretKeyRefEnv emits a JSON OBJECT (one env row);
wrap with list/include:
  $secretEnv := list (include "genieai-umbrella.secretKeyRefEnv" (dict ...) | fromJson)
genieai-umbrella.gpuApiKeyEnv emits a JSON ARRAY of rows.

genieai-umbrella.secretKeyRefEnv — one env row from a Secret key.
Context keys: var (env var name), secret, key, optional (bool, omit for
mandatory).

genieai-umbrella.gpuApiKeyEnv — the vllm-api-key rows every GPU consumer
mounts. Context keys: `keys` — a list of env var names among HF_TOKEN,
VLLM_API_KEY, HUGGINGFACEHUB_API_TOKEN. Every name resolves to the
same-named key on the vllm-api-key Secret, except the
HUGGINGFACEHUB_API_TOKEN alias, which reads the VLLM_API_KEY key.

genieai-umbrella.envMapRows — the rows of a MAP of environment variables,
as a JSON ARRAY. The chart takes the operator's environment as a map, not a
list: Helm merges maps key by key, so an overlay that sets one variable
replaces that one and keeps every default the chart declares beside it. A
list would be replaced wholesale — an overlay setting one variable would
silently drop all the others, and the deployment would come up with a
different configuration than the chart documents. The values are stringified:
a container env value is always a string, and `true`/`3` in the values file
would otherwise render as a YAML boolean or number that the API server
rejects.
*/}}
{{- define "genieai-umbrella.secretKeyRefEnv" -}}
{{- $ref := dict "name" .secret "key" .key -}}
{{- if hasKey . "optional" -}}{{- $_ := set $ref "optional" .optional -}}{{- end -}}
{{- dict "name" .var "valueFrom" (dict "secretKeyRef" $ref) | toJson -}}
{{- end -}}

{{- define "genieai-umbrella.gpuApiKeyEnv" -}}
{{- $rows := list -}}
{{- range .keys -}}
{{- $secretKey := . -}}
{{- if eq $secretKey "HUGGINGFACEHUB_API_TOKEN" -}}{{- $secretKey = "VLLM_API_KEY" -}}{{- end -}}
{{- $rows = append $rows (dict "name" . "valueFrom" (dict "secretKeyRef" (dict "name" "vllm-api-key" "key" $secretKey))) -}}
{{- end -}}
{{- $rows | toJson -}}
{{- end -}}

{{- define "genieai-umbrella.envMapRows" -}}
{{- $rows := list -}}
{{- range $name, $value := . -}}
{{- $rows = append $rows (dict "name" $name "value" (toString $value)) -}}
{{- end -}}
{{- toJson $rows -}}
{{- end -}}

{{/*
genieai-umbrella.boolEnvValue — a boolean values knob as an env STRING,
with an explicit default for the unset case. The realm's env rows carry
this in two dialects (a `ternary` over `kindIs "invalid"` and an `eq`
over `default false`); both reduce to this, and the default is an
argument so the two families keep their distinct values.
*/}}
{{- define "genieai-umbrella.boolEnvValue" -}}
{{- $v := .value -}}
{{- if kindIs "invalid" $v -}}{{- $v = .default -}}{{- end -}}
{{- ternary "true" "false" (eq ($v | toString) "true") -}}
{{- end -}}
