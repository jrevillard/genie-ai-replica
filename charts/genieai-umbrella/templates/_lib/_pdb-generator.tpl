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
{{- $services := $ctx.Values.services | default dict -}}
{{- $svc := index $services $ctx.name | default dict -}}
{{- $replicas := include "genieai-umbrella.resolveReplicas" (dict "Values" $ctx.Values "service" $ctx.name) | int -}}
{{- /* The minAvailable presence check is a nil check, NOT a truthiness
check: `minAvailable: 0` is legal (permit every voluntary eviction, keep
only the scheduler's non-disruption accounting) and sprig's `and`
short-circuits on the falsy 0 — a truthiness chain silently dropped the
PDB the values declared. */ -}}
{{- if and (ge $replicas 2) $svc.podDisruptionBudget (hasKey $svc.podDisruptionBudget "minAvailable") (not (kindIs "invalid" $svc.podDisruptionBudget.minAvailable)) -}}
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