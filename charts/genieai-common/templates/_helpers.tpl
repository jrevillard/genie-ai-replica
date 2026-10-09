{{/*
Expand the name of the chart.
*/}}
{{- define "genieai-common.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
Truncate at 40 chars: the name budget must reserve the longest hook suffix
("-sealed-secret-validate", 23 chars) within the 63-char K8s object-name
limit — fullname + "-sealed-secret-validate" tops out exactly at 63.
*/}}
{{- define "genieai-common.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 40 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 40 | trimSuffix "-" -}}
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
Component context — the merged component view every labels call in the chart
uses. Keeps the deepCopy (prevents component leaking into the shared values
tree) in one place instead of every call site. include can only return text,
so this renders the resolved genie-ai component label line; call sites pass
the plain dict (dict "Chart" .Chart "Release" .Release "Values" .Values
"component" <name>) to genieai-common.labels, which composes it below.
*/}}
{{- define "genieai-common.componentContext" -}}
{{- $ctx := merge (deepCopy .Values) (dict "component" (.component | default "umbrella")) -}}
genieai.io/component: {{ $ctx.component | quote }}
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
app.kubernetes.io/component: {{ .component | default "umbrella" | quote }}
{{ include "genieai-common.componentContext" . }}
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
