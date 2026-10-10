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
matching Service that the kube-arangodb operator names after the CR
(`<cr-name>`). The chart's ArangoDeployment template honors
`.Values.data.arangodb.mode` ONLY and does NOT auto-promote between
profiles: a single-mode CR stays single under prod or staging until an
operator flips the mode value. This helper mirrors that contract and
returns the Service hostname that the CR is actually serving.
*/}}
{{- define "genieai-umbrella.arangoHost" -}}
{{- if eq (.Values.data.arangodb.mode | default "single") "cluster" -}}
arangodb-cluster
{{- else -}}
arangodb-single
{{- end -}}
{{- end -}}
