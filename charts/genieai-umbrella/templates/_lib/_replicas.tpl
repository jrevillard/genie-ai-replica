{{/*
Resolve the replica count of a service.

Two things this helper exists for:

1. `default` CANNOT express the fallback here. Sprig treats 0 as empty, so
   `replicas: 0` — the documented way to scale a tier off without deleting
   its values block — silently rendered 1 pod. Only an ABSENT key falls
   back to 1, which needs a `kindIs "invalid"` test.
2. The cluster-profile override lookup was duplicated in four templates.
   It lives here so a profile entry can never be honoured by the
   Deployment and ignored by the PodDisruptionBudget.

Usage:
  {{- $replicas := include "genieai-umbrella.resolveReplicas" (dict "Values" .Values "service" "backend") | int }}
*/}}
{{- define "genieai-umbrella.resolveReplicas" -}}
{{- $svc := index .Values.services .service -}}
{{- $replicas := 1 -}}
{{- if not (kindIs "invalid" $svc.replicas) -}}
{{- $replicas = int $svc.replicas -}}
{{- end -}}
{{- $profiles := default (dict) .Values.clusterProfileReplicas -}}
{{- if hasKey $profiles .Values.clusterProfile -}}
{{- $perService := index $profiles .Values.clusterProfile -}}
{{- if hasKey $perService .service -}}
{{- $replicas = int (index $perService .service) -}}
{{- end -}}
{{- end -}}
{{- $replicas -}}
{{- end -}}