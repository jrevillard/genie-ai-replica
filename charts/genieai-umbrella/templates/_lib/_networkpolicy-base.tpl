{{/*
Standard NetworkPolicy body for service tier.
- Default-deny ingress (only ingress controller + same-tier allowlist)
- Default-deny egress (only DNS + cross-tier allowlists)

The caller passes a list of allowed ingress sources and egress targets.
*/}}
{{- define "genieai-umbrella.networkPolicyBody" -}}
{{- $ctx := . -}}
ingress:
  - from:
      - podSelector: {}
        namespaceSelector: {}
    ports:
      - protocol: TCP
        port: {{ $ctx.port }}
egress:
  # DNS resolution — kube-system CoreDNS. The `name: kube-system` label is
  # NOT a real namespace label; the immutable, always-present one is
  # kubernetes.io/metadata.name (K8s >= 1.21 sets it on every namespace).
  - to:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: kube-system
    ports:
      - protocol: UDP
        port: 53
{{- end -}}