{{/*
Emit a PodDisruptionBudget for the given service.

The PDB is rendered only when both are true:
  - the resolved replica count is >= 2 (cluster-profile override or default)
  - podDisruptionBudget is a non-null map with a numeric minAvailable

Caller context keys (top-level, not merged into Values):
  component  - service slug read by labels/selector helpers
  Values     - chart values
  Chart      - chart metadata
  Release    - release metadata

Usage:
  {{- include "genieai-umbrella.pdbForService" (dict "component" "backend" "Values" .Values "Chart" .Chart "Release" .Release) }}
*/}}
{{- define "genieai-umbrella.pdbForService" -}}
{{- $ctx := . -}}
{{- $svc := index $ctx.Values.services $ctx.component -}}
{{- $replicas := int ($svc.replicas | default 1) -}}
{{- with $ctx.Values.clusterProfileReplicas -}}
{{- if hasKey . $ctx.Values.clusterProfile -}}
{{- $profileReplicas := index . $ctx.Values.clusterProfile -}}
{{- if hasKey $profileReplicas $ctx.component -}}
{{- $replicas = int (index $profileReplicas $ctx.component) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if and (ge $replicas 2) $svc.podDisruptionBudget (hasKey $svc.podDisruptionBudget "minAvailable") $svc.podDisruptionBudget.minAvailable -}}
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "genieai-common.fullname" $ctx }}-{{ $ctx.component }}
  namespace: {{ $ctx.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $ctx.component) | nindent 4 }}
spec:
  minAvailable: {{ $svc.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $ctx.component) | nindent 6 }}
{{- end -}}
{{- end -}}