{{/*
Cross-service URL injection.

values.yaml is a static configuration surface and is never templated, so
HTTP URLs that one Deployment needs to reach another cannot live there.
This helper renders such URLs as Kubernetes env entries at template time.

Usage:
  {{- include "genieai-umbrella.crossServiceURLs" (list $ctx (list
    (dict "name" "KEYCLOAK_URL" "host" "keycloak-service" "port" 8080 "path" "/auth")
    (dict "name" "ARANGO_URL"    "host" (include "genieai-umbrella.arangoHost" .) "port" 8529)
    ...)) | nindent 12 }}

The `path` field is optional (omit it for endpoints served at the root).
Each list element renders to one `- name: <key> value: http://<host>.<ns>:<port><path>`
env entry.
*/}}
{{- define "genieai-umbrella.crossServiceURLs" -}}
{{- $ctx := index . 0 -}}
{{- $urls := index . 1 -}}
{{- range $urls -}}
- name: {{ .name }}
  value: {{ printf "http://%s.%s.svc.cluster.local:%v%s" .host $ctx.Values.namespace (int .port) (default "" .path) | quote }}
{{- end -}}
{{- end -}}

{{/*
ArangoDB service hostname.

The ArangoDeployment custom resource owns both the database tier and the
matching Service. The cluster auto-promotes from `single` to `cluster`
under the production and staging cluster profiles, while dev keeps the
single-node topology. Switching the resulting Service name on the `mode`
field alone would emit `arangodb-single` against a deployment actually
running `arangodb-cluster` and DNS would fail for every consumer (NXDOMAIN).

This helper returns the Service hostname the cluster is actually serving.
*/}}
{{- define "genieai-umbrella.arangoHost" -}}
{{- $mode := .Values.data.arangodb.mode | default "single" -}}
{{- if and (eq $mode "single") (or (eq .Values.clusterProfile "prod") (eq .Values.clusterProfile "staging")) -}}
{{- $mode = "cluster" -}}
{{- end -}}
{{- if eq $mode "cluster" -}}
arangodb-cluster
{{- else -}}
arangodb-single
{{- end -}}
{{- end -}}
