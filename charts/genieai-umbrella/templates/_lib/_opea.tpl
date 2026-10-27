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
{{- /* No docling Deployment is rendered in-cluster; an empty endpoint
makes dataprep use its in-process docling converter (the same fallback
an empty env var produces). */ -}}
{{- "" -}}
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
genieai-umbrella.opeaSslSkipVerify — returns "1" when the operator declared
the GPU node's certificate untrusted, else "0".

Driven by opea.gpu.skipTlsVerify, NOT by the nodeHost scheme. An https://
endpoint says nothing about whether its certificate is in the trust store,
and disabling verification is not a decision a template takes on the
operator's behalf — Compose exposes the same variable and defaults it to 0
for the same reason. The alternative reads as "the chart trusts whatever
answers on that port", and prompts, the VLLM_API_KEY bearer and translated
answers all cross it.

Signature: {{ include "genieai-umbrella.opeaSslSkipVerify" . }}
*/}}
{{- define "genieai-umbrella.opeaSslSkipVerify" -}}
{{- if .Values.opea.gpu.skipTlsVerify -}}1{{- else -}}0{{- end -}}
{{- end -}}

{{/*
genieai-umbrella.opeaGpuHostname — the bare host of opea.gpu.nodeHost
(scheme, port, and path stripped; bracketed IPv6 literals preserved).
Feeds the GPU_NODE_HOST env the model-id auto-detection gates on.
Empty nodeHost → empty string (auto-detection stays off).
*/}}
{{- define "genieai-umbrella.opeaGpuHostname" -}}
{{- regexReplaceAll "^([a-z]+://)?(\\[[^\\]]+\\]|[^:/]+).*" (.Values.opea.gpu.nodeHost | default "") "$2" -}}
{{- end -}}

{{/*
genieai-umbrella.opeaNetworkFromUrl — the ipBlock CIDRs and ports for ANY
named external destination, as JSON: `{"cidrs": [...], "ports": [...]}`.
Takes `{"root": <root ctx>, "url": <url>}`.

The destination is NAMED (opea.gpu.nodeHost for the six orchestrators, the
backend's translation endpoint for the BFF), so the egress rule does not
have to be 0.0.0.0/0 the way it was when the chart ignored the URL:

  - an IPv4 literal in the URL becomes a /32 — exact, and no operator
    action (a laptop overlay pointing at 10.0.0.110:444 gets exactly
    that);
  - a DNS name cannot become a CIDR, so opea.gpu.allowedCIDRs applies
    (the knob the crawler tier already uses), and an empty list falls
    back to 0.0.0.0/0 — the same approximation Compose makes, since a
    NetworkPolicy has no way to express a hostname;
  - the port comes from the URL (`:444`, `:8443`, …). A URL with NO
    explicit port falls back to the SCHEME's port — 443 for https, 80
    for plain http: a rule permitting 443 while the client dials 80
    drops every connection under default-deny. The old rule hardcoded
    443 + 444 on both ports at once.
*/}}
{{- define "genieai-umbrella.opeaNetworkFromUrl" -}}
{{- $root := .root -}}
{{- $url := .url | default "" -}}
{{- if contains "[" $url -}}
{{- fail (printf "an IPv6 literal (%s) is not supported as a named destination: the egress rule can only express an IPv4 CIDR, and an IPv6 connection matches no ipBlock — use a DNS name" $url) -}}
{{- end -}}
{{- $host := regexReplaceAll "^([a-z]+://)?(\\[[^\\]]+\\]|[^:/]+).*" $url "$2" -}}
{{- $isIPv4 := regexMatch "^[0-9]{1,3}(\\.[0-9]{1,3}){3}$" $host -}}
{{- $cidrs := list -}}
{{- if $isIPv4 -}}
{{- $cidrs = append $cidrs (printf "%s/32" $host) -}}
{{- else if $root.Values.opea.gpu.allowedCIDRs -}}
{{- $cidrs = $root.Values.opea.gpu.allowedCIDRs -}}
{{- else -}}
{{- $cidrs = list "0.0.0.0/0" -}}
{{- end -}}
{{- $port := "443" -}}
{{- $matched := regexFind ":([0-9]{1,5})(?:/|$)" $url -}}
{{- if $matched -}}
{{- $port = regexFind "[0-9]{1,5}" $matched -}}
{{- else if regexMatch "^http://" $url -}}
{{- $port = "80" -}}
{{- end -}}
{{- dict "cidrs" $cidrs "ports" (list $port) | toJson -}}
{{- end -}}

{{/*
genieai-umbrella.opeaGpuEgressRule — the NetworkPolicy egress rule for the
external GPU node (opea.gpu.nodeHost). One definition for the six
orchestrators that all dial it; they differ only in which other peers
they reach.

Relative indentation: callers apply `| nindent 4`.
*/}}
{{- define "genieai-umbrella.opeaGpuEgressRule" -}}
{{- include "genieai-umbrella.opeaEgressRuleFromUrl" (dict "root" . "url" (.Values.opea.gpu.nodeHost | default "")) -}}
{{- end -}}

{{/*
genieai-umbrella.opeaEgressRuleFromUrl — the same rule for an arbitrary
named destination. Takes `{"root": <root ctx>, "url": <url>}`.
Relative indentation: callers apply `| nindent 4`.
*/}}
{{- define "genieai-umbrella.opeaEgressRuleFromUrl" -}}
{{- include "genieai-umbrella.opeaEgressRuleFromNetwork" (dict "net" (include "genieai-umbrella.opeaNetworkFromUrl" . | fromJson)) -}}
{{- end -}}

{{- define "genieai-umbrella.opeaEgressRuleFromNetwork" -}}
{{- $net := .net -}}
{{- /* The destination is named, so the rule is a /32 when the host is an
       IP and the operator's CIDR list otherwise — not 0.0.0.0/0 on two
       ports. */}}
- to:
{{- range $cidr := $net.cidrs }}
  - ipBlock:
      cidr: {{ $cidr }}
{{- end }}
  ports:
{{- range $port := $net.ports }}
  - protocol: TCP
    port: {{ $port }}
{{- end }}
{{- end -}}
