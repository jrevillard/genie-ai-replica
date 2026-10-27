{{/*
Emit a PodDisruptionBudget for the given service.

The PDB is rendered only when both are true:
  - the resolved replica count is >= 2 (cluster-profile override or default)
  - podDisruptionBudget is a non-null map with a numeric minAvailable

Caller context keys (top-level, not merged into Values):
  name       - service slug; indexes .Values.services for the replica
               count and the podDisruptionBudget block
  component  - workload class read by the labels/selector helpers
  Values     - chart values
  Chart      - chart metadata
  Release    - release metadata

Usage:
  {{- include "genieai-umbrella.pdbForService" (dict "name" "backend" "component" "backend" "Values" .Values "Chart" .Chart "Release" .Release) }}
*/}}
{{- define "genieai-umbrella.pdbForService" -}}
{{- $ctx := . -}}
{{- $svc := index $ctx.Values.services $ctx.name -}}
{{- $replicas := include "genieai-umbrella.resolveReplicas" (dict "Values" $ctx.Values "service" $ctx.name) | int -}}
{{- if and (ge $replicas 2) $svc.podDisruptionBudget (hasKey $svc.podDisruptionBudget "minAvailable") $svc.podDisruptionBudget.minAvailable -}}
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "genieai-common.fullname" $ctx }}-{{ lower $ctx.component }}
  namespace: {{ $ctx.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $ctx.component) | nindent 4 }}
spec:
  minAvailable: {{ $svc.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $ctx.component) | nindent 6 }}
{{- print "\n" -}}
{{- end -}}
{{- end -}}