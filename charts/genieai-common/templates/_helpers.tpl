{{/*
Expand the name of the chart.
*/}}
{{- define "genieai-common.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
We truncate at 50 chars because some K8s name fields are limited to this (RFC 1123).
*/}}
{{- define "genieai-common.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart name and version label.
*/}}
{{- define "genieai-common.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels — applied to all umbrella resources.
Includes helm.sh/chart, app.kubernetes.io/name, app.kubernetes.io/instance,
app.kubernetes.io/version, app.kubernetes.io/managed-by, plus genie-ai-specific
labels for Prometheus / OpenTelemetry service discovery.
*/}}
{{- define "genieai-common.labels" -}}
helm.sh/chart: {{ include "genieai-common.chart" . }}
{{ include "genieai-common.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
genieai.io/component: {{ .Values.component | default "umbrella" | quote }}
genieai.io/managed-by: helm
{{- end -}}

{{/*
Selector labels — used in Deployment selectors and Service selectors.
Note: must NOT include version (selector is immutable).
*/}}
{{- define "genieai-common.selectorLabels" -}}
app.kubernetes.io/name: {{ include "genieai-common.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Component label — emits a `genieai.io/component: <name>` label for any resource.
The receiving component name comes from `.Values.component` (overridden per
template).
*/}}
{{- define "genieai-common.componentLabel" -}}
genieai.io/component: {{ .Values.component | default "umbrella" | quote }}
{{- end -}}

{{/*
Service selector — emits the right selector labels for service discovery.
Differs from `selectorLabels` by including the component-only label so that
network policies can target one app.
*/}}
{{- define "genieai-common.serviceSelector" -}}
app.kubernetes.io/name: {{ include "genieai-common.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
genieai.io/component: {{ .Values.component | default "umbrella" | quote }}
{{- end -}}
