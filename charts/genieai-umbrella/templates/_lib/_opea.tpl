{{/*
genieai-umbrella.opeaGpuEndpoint — returns the full GPU endpoint URL for a given path key.

Signature: {{ include "genieai-umbrella.opeaGpuEndpoint" (dict "root" . "path" "<key>") }}

Modes:
  - external (default): joins opea.gpu.nodeHost with opea.gpu.paths.<key>.
    Fails at render time when nodeHost is empty — the orchestrator env rows
    carry these URLs verbatim, and an empty value would reach the pods as a
    literal empty-string endpoint (connection failure at runtime instead of
    a named error at install time).
  - in-cluster: returns an in-cluster Service URL using a fixed
    service-name:port map (llm→vllm:8000, embedding→tei:80,
    reranker→tei-reranker:80, translation→vllm-translation:9031,
    docling→docling:5001).

Unknown path key → fail. Unknown mode → fail.
*/}}
{{- define "genieai-umbrella.opeaGpuEndpoint" -}}
{{- $root := .root -}}
{{- $key  := .path -}}
{{- $mode := $root.Values.opea.gpu.mode -}}

{{- $validKeys := list "llm" "embedding" "reranker" "translation" "docling" -}}
{{- if not (has $key $validKeys) -}}
{{- fail (printf "unknown opea.gpu endpoint key: %s" $key) -}}
{{- end -}}

{{- if eq $mode "in-cluster" -}}
  {{- if eq $key "llm" -}}
http://vllm.{{ $root.Values.namespace }}.svc.cluster.local:8000
  {{- else if eq $key "embedding" -}}
http://tei.{{ $root.Values.namespace }}.svc.cluster.local:80
  {{- else if eq $key "reranker" -}}
http://tei-reranker.{{ $root.Values.namespace }}.svc.cluster.local:80
  {{- else if eq $key "translation" -}}
http://vllm-translation.{{ $root.Values.namespace }}.svc.cluster.local:9031
  {{- else if eq $key "docling" -}}
http://docling.{{ $root.Values.namespace }}.svc.cluster.local:5001
  {{- end -}}

{{- else if eq $mode "external" -}}
  {{- $host := $root.Values.opea.gpu.nodeHost -}}
  {{- if not $host -}}
{{- fail "opea.gpu.mode=external requires opea.gpu.nodeHost (e.g. https://gpu-node:444); without it every orchestrator would render an empty GPU endpoint" -}}
  {{- else -}}
{{- trimSuffix "/" $host }}{{ index $root.Values.opea.gpu.paths $key }}
  {{- end -}}

{{- else -}}
{{- fail (printf "unknown opea.gpu.mode: %s (expected external or in-cluster)" $mode) -}}
{{- end -}}
{{- end -}}

{{/*
genieai-umbrella.opeaSslSkipVerify — returns "1" when the GPU node uses a
self-signed certificate (nodeHost starts with https://), else "0".

This mirrors the backend's NODE_TLS_REJECT_UNAUTHORIZED=0 rationale: the
GPU node's certificate is signed by an internal CA that the trust store
does not carry.

Signature: {{ include "genieai-umbrella.opeaSslSkipVerify" . }}
*/}}
{{- define "genieai-umbrella.opeaSslSkipVerify" -}}
{{- if hasPrefix "https://" .Values.opea.gpu.nodeHost -}}1{{- else -}}0{{- end -}}
{{- end -}}
