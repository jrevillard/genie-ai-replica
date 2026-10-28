{{- /*
Peer block for the Envoy Gateway data plane in ingress NetworkPolicies.

Envoy Gateway stamps its managed proxy pods with
gateway.envoyproxy.io/owning-gateway-{namespace,name}, so the peer is
exact — it names THIS Gateway's data plane, not every Envoy in the
cluster.

By default the data plane Deployment lands in the Gateway's own
namespace (EG 1.x behaviour), so the peer is a bare podSelector. An
operator can move it (EnvoyProxy CR provider override) via
ingress.dataplaneNamespace; when that namespace differs from the app
namespace a namespaceSelector is added.
*/ -}}
{{- define "genieai-umbrella.ingressDataPlanePeer" -}}
{{- $ingress := .Values.ingress | default dict -}}
{{- $dpNs := $ingress.dataplaneNamespace | default .Values.namespace -}}
{{- if ne $dpNs .Values.namespace -}}
- namespaceSelector:
    matchLabels:
      kubernetes.io/metadata.name: {{ $dpNs }}
  podSelector:
    matchLabels:
      app.kubernetes.io/component: proxy
      gateway.envoyproxy.io/owning-gateway-namespace: {{ .Values.namespace }}
      gateway.envoyproxy.io/owning-gateway-name: genieai
{{- else -}}
- podSelector:
    matchLabels:
      app.kubernetes.io/component: proxy
      gateway.envoyproxy.io/owning-gateway-namespace: {{ .Values.namespace }}
      gateway.envoyproxy.io/owning-gateway-name: genieai
{{- end -}}
{{- end -}}
