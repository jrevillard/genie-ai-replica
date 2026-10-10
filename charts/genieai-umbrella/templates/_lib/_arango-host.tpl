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
