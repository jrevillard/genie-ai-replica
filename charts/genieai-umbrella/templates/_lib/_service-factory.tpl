{{/*
Standard Deployment body for umbrella-managed services. Reads
`.Values.services.<name>` entries; the caller passes a context with
`.component` set to the workload class and `.name` to the service slug.

Usage:
  {{- include "genieai-umbrella.serviceDeployment" (dict "name" "backend" "component" "backend" "Values" .Values "Chart" .Chart "Release" .Release) | nindent 0 }}

The `.component` key is passed at the TOP level of the dict (not merged
into `.Values`) because the `genieai-common.labels` and
`genieai-common.serviceSelector` helpers read `.component` directly from
the dot context. A merge into `.Values` would put the per-call value
where nothing reads it, and the helpers would fall back to the
top-level `.Values.component` (default: "umbrella") instead.
*/}}
{{- define "genieai-umbrella.serviceDeployment" -}}
{{- $ctx := . -}}
{{- $svcName := $ctx.name -}}
{{- $svc := index $ctx.Values.services $svcName -}}
{{- $replicas := $svc.replicas | default 1 -}}
{{- with $ctx.Values.clusterProfileReplicas -}}
{{- if hasKey . $ctx.Values.clusterProfile -}}
{{- $profileReplicas := index . $ctx.Values.clusterProfile -}}
{{- if hasKey $profileReplicas $svcName -}}
{{- $replicas = index $profileReplicas $svcName -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $component := $ctx.component | default $svcName -}}
{{- $objectName := lower $svcName -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "genieai-common.fullname" $ctx }}-{{ $objectName }}
  namespace: {{ $ctx.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $component) | nindent 4 }}
spec:
  replicas: {{ $replicas }}
  selector:
    matchLabels:
      {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $component) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $component) | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ $objectName }}
          image: {{ $svc.image.repository }}:{{ $svc.image.tag | default "latest" }}
          imagePullPolicy: {{ $ctx.Values.global.imagePullPolicy | default "IfNotPresent" }}
          ports:
            - name: http
              containerPort: {{ $svc.port }}
          env:
            {{- toYaml $svc.env | nindent 12 }}
          {{- with $svc.secrets }}
          envFrom:
            {{- range . }}
            - secretRef:
                name: {{ .name }}
            {{- end }}
          {{- end }}
          resources:
            {{- toYaml $svc.resources | nindent 12 }}
          securityContext:
            {{- $scc := $svc.securityContext | default (dict "runAsNonRoot" true "runAsUser" 65534 "allowPrivilegeEscalation" false "capabilities" (dict "drop" (list "ALL"))) -}}
            {{- toYaml $scc | nindent 12 }}
          {{- with $svc.probes.readiness }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $svc.probes.liveness }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $svc.probes.startup }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
{{- end -}}
