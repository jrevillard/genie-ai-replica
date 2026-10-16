{{- /*
Peer block for the Envoy Gateway data plane in ingress NetworkPolicies.

Envoy Gateway stamps its managed proxy pods with
gateway.envoyproxy.io/owning-gateway-{namespace,name}, so the peer is
exact — it names THIS Gateway's data plane, not every Envoy in the
cluster. The data plane Deployment/Service are created by the controller
in ingress.dataplaneNamespace (Envoy Gateway default: envoy-gateway-system).

NetworkPolicy `from` entries with BOTH namespaceSelector and podSelector
AND the two selectors — an in-namespace peer renders with the
namespaceSelector dropped (redundant but harmless either way).
*/ -}}
{{- define "genieai-umbrella.ingressDataPlanePeer" -}}
- namespaceSelector:
    matchLabels:
      kubernetes.io/metadata.name: {{ .Values.ingress.dataplaneNamespace | default "envoy-gateway-system" }}
  podSelector:
    matchLabels:
      app.kubernetes.io/component: proxy
      gateway.envoyproxy.io/owning-gateway-namespace: {{ .Values.namespace }}
      gateway.envoyproxy.io/owning-gateway-name: genieai
{{- end -}}
