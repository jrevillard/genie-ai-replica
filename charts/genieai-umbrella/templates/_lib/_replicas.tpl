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
{{- $services := .Values.services | default dict -}}
{{- $svc := index $services .service | default dict -}}
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

{{/*
Resolve the instance count of a DATA-TIER component (the Keycloak CR's
`spec.instances`, the CNPG Cluster's `spec.instances`).

The stateless tier's helper cannot be reused as-is: there the profile
map WINS over the per-service value, because `services.<svc>.replicas`
is documented as a baseline. For the data tier the operator's explicit
count is the thing they sized the database for, so it wins: a template
that overrode `data.keycloak.instances: 5` with a literal 2 on the prod
profile discarded the operator's sizing with no warning and no error —
helm template, lint, kubeconform and the CRD gate all stayed green.

So the order is: the explicit value, then the cluster profile, then 1.

The explicit value is ABSENT by default (values.yaml declares
`instances: null`), which is what keeps "unset" distinguishable from
"the operator pinned 1". A number in values.yaml could not carry that
distinction: 1 is both the chart default and a legitimate operator
choice.

Usage:
  {{- $instances := include "genieai-umbrella.resolveInstances" (dict "Values" .Values "tier" "keycloak") | int }}
*/}}
{{- define "genieai-umbrella.resolveInstances" -}}
{{- $tier := .tier -}}
{{- $data := .Values.data | default dict -}}
{{- $explicit := index $data $tier "instances" -}}
{{- $instances := 1 -}}
{{- /* An explicit 0 is rejected by the schema (minimum: 1): a data
tier with no instance cannot serve, and "scale to zero" is not a thing
a CNPG Cluster or a Keycloak CR can express. Coercing it to 1 here
would turn the operator's mistake into a running database they did not
ask for; failing names the value. Only an EXPLICIT 0 is an error — the
"nothing declared" case falls through to the profile and then to 1. */ -}}
{{- if not (kindIs "invalid" $explicit) -}}
{{- $instances = int $explicit -}}
{{- if eq $instances 0 -}}
{{- fail (printf "the instance count of the %q data tier is 0: declare a count of at least 1" $tier) -}}
{{- end -}}
{{- else -}}
{{- $profiles := default (dict) .Values.clusterProfileInstances -}}
{{- if hasKey $profiles .Values.clusterProfile -}}
{{- $perTier := index $profiles .Values.clusterProfile -}}
{{- if hasKey $perTier $tier -}}
{{- $instances = int (index $perTier $tier) -}}
{{- if eq $instances 0 -}}
{{- fail (printf "the instance count of the %q data tier is 0 in clusterProfileInstances.%s: declare a count of at least 1" $tier .Values.clusterProfile) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $instances -}}
{{- end -}}
