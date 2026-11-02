{{/*
GenieAI Helm Chart - Shared Template Helpers
*/}}

{{/*
Chart name
*/}}
{{- define "genieai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name
*/}}
{{- define "genieai.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s" $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "genieai.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Standard labels
*/}}
{{- define "genieai.labels" -}}
helm.sh/chart: {{ include "genieai.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: genieai
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels for a specific component
Usage: {{ include "genieai.selectorLabels" (dict "name" "vllm" "context" .) }}
*/}}
{{- define "genieai.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .context.Release.Name }}
{{- end }}

{{/*
Component labels (standard + selector)
Usage: {{ include "genieai.componentLabels" (dict "name" "vllm" "tier" "gpu" "context" .) }}
*/}}
{{- define "genieai.componentLabels" -}}
{{ include "genieai.labels" .context }}
{{ include "genieai.selectorLabels" (dict "name" .name "context" .context) }}
app.kubernetes.io/component: {{ .name }}
genieai/tier: {{ .tier }}
{{- end }}

{{/*
GPU node affinity - requiredDuringSchedulingIgnoredDuringExecution for gpu-pool=true
*/}}
{{- define "genieai.gpuAffinity" -}}
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: {{ .Values.nodePools.gpu.label }}
              operator: In
              values:
                - {{ .Values.nodePools.gpu.labelValue | quote }}
{{- end }}

{{/*
GPU tolerations - tolerate nvidia.com/gpu=present:NoSchedule
*/}}
{{- define "genieai.gpuTolerations" -}}
tolerations:
  - key: {{ .Values.nodePools.gpu.taint.key | quote }}
    operator: "Equal"
    value: {{ .Values.nodePools.gpu.taint.value | quote }}
    effect: {{ .Values.nodePools.gpu.taint.effect | quote }}
{{- end }}

{{/*
GPU resources - request and limit nvidia.com/gpu: 1
Usage: {{ include "genieai.gpuResources" .Values.gpu.vllm.resources }}
*/}}
{{- define "genieai.gpuResources" -}}
resources:
  requests:
    cpu: {{ .requests.cpu | quote }}
    memory: {{ .requests.memory | quote }}
    nvidia.com/gpu: {{ index .requests "nvidia.com/gpu" | quote }}
  limits:
    cpu: {{ .limits.cpu | quote }}
    memory: {{ .limits.memory | quote }}
    nvidia.com/gpu: {{ index .limits "nvidia.com/gpu" | quote }}
{{- end }}

{{/*
CPU node affinity - requiredDuringSchedulingIgnoredDuringExecution for cpu-pool=true
*/}}
{{- define "genieai.cpuAffinity" -}}
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: {{ .Values.nodePools.cpu.label }}
              operator: In
              values:
                - {{ .Values.nodePools.cpu.labelValue | quote }}
{{- end }}

{{/*
CPU resources (no GPU)
Usage: {{ include "genieai.cpuResources" .Values.cpu.backend.resources }}
*/}}
{{- define "genieai.cpuResources" -}}
resources:
  requests:
    cpu: {{ .requests.cpu | quote }}
    memory: {{ .requests.memory | quote }}
  limits:
    cpu: {{ .limits.cpu | quote }}
    memory: {{ .limits.memory | quote }}
{{- end }}

{{/*
Rolling update strategy
*/}}
{{- define "genieai.rollingUpdate" -}}
strategy:
  type: {{ .Values.strategy.type }}
  rollingUpdate:
    maxUnavailable: {{ .Values.strategy.rollingUpdate.maxUnavailable }}
    maxSurge: {{ .Values.strategy.rollingUpdate.maxSurge }}
{{- end }}

{{/*
HTTP readiness probe
Usage: {{ include "genieai.httpReadinessProbe" (dict "path" "/health" "port" 8000 "settings" .Values.gpuProbes.readiness) }}
*/}}
{{- define "genieai.httpReadinessProbe" -}}
readinessProbe:
  httpGet:
    path: {{ .path }}
    port: {{ .port }}
  periodSeconds: {{ .settings.periodSeconds }}
  timeoutSeconds: {{ .settings.timeoutSeconds }}
  successThreshold: {{ .settings.successThreshold }}
{{- end }}

{{/*
HTTP liveness probe
Usage: {{ include "genieai.httpLivenessProbe" (dict "path" "/health" "port" 8000 "settings" .Values.gpuProbes.liveness) }}
*/}}
{{- define "genieai.httpLivenessProbe" -}}
livenessProbe:
  httpGet:
    path: {{ .path }}
    port: {{ .port }}
  periodSeconds: {{ .settings.periodSeconds }}
  timeoutSeconds: {{ .settings.timeoutSeconds }}
  failureThreshold: {{ .settings.failureThreshold }}
{{- end }}

{{/*
HTTP startup probe for GPU services (long model loading)
Usage: {{ include "genieai.gpuStartupProbe" (dict "path" "/health" "port" 8000 "settings" .Values.gpuProbes.startup) }}
*/}}
{{- define "genieai.gpuStartupProbe" -}}
startupProbe:
  httpGet:
    path: {{ .path }}
    port: {{ .port }}
  initialDelaySeconds: {{ .settings.initialDelaySeconds }}
  periodSeconds: {{ .settings.periodSeconds }}
  failureThreshold: {{ .settings.failureThreshold }}
{{- end }}

{{/*
HTTP startup probe for slow-starting CPU services (databases, Keycloak)
Usage: {{ include "genieai.cpuSlowStartupProbe" (dict "path" "/health" "port" 8080 "settings" .Values.cpuProbes.slowStartup) }}
*/}}
{{- define "genieai.cpuSlowStartupProbe" -}}
startupProbe:
  httpGet:
    path: {{ .path }}
    port: {{ .port }}
  initialDelaySeconds: {{ .settings.initialDelaySeconds }}
  periodSeconds: {{ .settings.periodSeconds }}
  failureThreshold: {{ .settings.failureThreshold }}
{{- end }}

{{/*
TCP readiness probe
Usage: {{ include "genieai.tcpReadinessProbe" (dict "port" 8529 "settings" .Values.cpuProbes.readiness) }}
*/}}
{{- define "genieai.tcpReadinessProbe" -}}
readinessProbe:
  tcpSocket:
    port: {{ .port }}
  periodSeconds: {{ .settings.periodSeconds }}
  timeoutSeconds: {{ .settings.timeoutSeconds }}
  successThreshold: {{ .settings.successThreshold }}
{{- end }}

{{/*
TCP liveness probe
Usage: {{ include "genieai.tcpLivenessProbe" (dict "port" 8529 "settings" .Values.cpuProbes.liveness) }}
*/}}
{{- define "genieai.tcpLivenessProbe" -}}
livenessProbe:
  tcpSocket:
    port: {{ .port }}
  periodSeconds: {{ .settings.periodSeconds }}
  timeoutSeconds: {{ .settings.timeoutSeconds }}
  failureThreshold: {{ .settings.failureThreshold }}
{{- end }}

{{/*
TCP startup probe for slow-starting CPU services
Usage: {{ include "genieai.tcpSlowStartupProbe" (dict "port" 8529 "settings" .Values.cpuProbes.slowStartup) }}
*/}}
{{- define "genieai.tcpSlowStartupProbe" -}}
startupProbe:
  tcpSocket:
    port: {{ .port }}
  initialDelaySeconds: {{ .settings.initialDelaySeconds }}
  periodSeconds: {{ .settings.periodSeconds }}
  failureThreshold: {{ .settings.failureThreshold }}
{{- end }}

{{/*
Exec readiness probe
Usage: {{ include "genieai.execReadinessProbe" (dict "command" (list "pg_isready" "-U" "kong") "settings" .Values.cpuProbes.readiness) }}
*/}}
{{- define "genieai.execReadinessProbe" -}}
readinessProbe:
  exec:
    command:
      {{- range .command }}
      - {{ . | quote }}
      {{- end }}
  periodSeconds: {{ .settings.periodSeconds }}
  timeoutSeconds: {{ .settings.timeoutSeconds }}
  successThreshold: {{ .settings.successThreshold }}
{{- end }}

{{/*
Exec liveness probe
Usage: {{ include "genieai.execLivenessProbe" (dict "command" (list "pg_isready" "-U" "kong") "settings" .Values.cpuProbes.liveness) }}
*/}}
{{- define "genieai.execLivenessProbe" -}}
livenessProbe:
  exec:
    command:
      {{- range .command }}
      - {{ . | quote }}
      {{- end }}
  periodSeconds: {{ .settings.periodSeconds }}
  timeoutSeconds: {{ .settings.timeoutSeconds }}
  failureThreshold: {{ .settings.failureThreshold }}
{{- end }}

{{/*
Exec startup probe for slow-starting services
Usage: {{ include "genieai.execSlowStartupProbe" (dict "command" (list "pg_isready" "-U" "kong") "settings" .Values.cpuProbes.slowStartup) }}
*/}}
{{- define "genieai.execSlowStartupProbe" -}}
startupProbe:
  exec:
    command:
      {{- range .command }}
      - {{ . | quote }}
      {{- end }}
  initialDelaySeconds: {{ .settings.initialDelaySeconds }}
  periodSeconds: {{ .settings.periodSeconds }}
  failureThreshold: {{ .settings.failureThreshold }}
{{- end }}
