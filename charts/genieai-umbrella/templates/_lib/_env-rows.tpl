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
