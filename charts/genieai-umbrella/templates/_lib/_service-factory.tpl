{{/*
Standard Deployment body for umbrella-managed services.
Reads `.Values.services.<name>` entries; the caller passes a context with
`.component` set to the workload class and `.name` to the service slug.

Usage:
  {{- include "genieai-umbrella.serviceDeployment" (dict "name" "backend" "component" "backend" "Values" .Values "Chart" .Chart "Release" .Release) | nindent 0 }}
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
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "genieai-common.fullname" $ctx }}-{{ $svcName }}
  namespace: {{ $ctx.Values.namespace }}
  labels:
    {{- /*
    The caller passes `.component` to identify the workload class
    (e.g. `ai-vllm` for AI tier services, or omits it to default to
    $svcName). All three label/selector merges below use $component —
    not $svcName — so callers can decouple selector identity from
    the service slug when the two differ.
    */ -}}
    {{- include "genieai-common.labels" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $component))) | nindent 4 }}
spec:
  replicas: {{ $replicas }}
  selector:
    matchLabels:
      {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $component))) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $component))) | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ $svcName }}
          image: {{ $svc.image.repository }}:{{ $svc.image.tag | default "latest" }}
          imagePullPolicy: {{ $ctx.Values.global.imagePullPolicy | default "IfNotPresent" }}
          ports:
            - name: http
              containerPort: {{ $svc.port }}
          env:
            {{- toYaml $svc.env | nindent 12 }}
          envFrom:
            {{- /*
            Plain Secret names — SealedSecrets in this chart are named
            WITHOUT a namespace prefix; envFrom consumes the whole
            Secret so its keys ARE the env var names.
            */ -}}
            {{- range $svc.secrets }}
            - secretRef:
                name: {{ .name }}
            {{- end }}
          resources:
            {{- toYaml $svc.resources | nindent 12 }}
          {{- /*
          Upstream images ship with fixed UIDs and need writable
          scratch dirs:
            nginx-unprivileged  UID  101  /var/cache/nginx + /var/run
            clamav:1.3          UID  100
            curlimages          UID  1000
          Per-service `securityContext` override at the values level;
          the factory default is the full PSA-restricted set
          (runAsNonRoot, runAsUser 65534, allowPrivilegeEscalation
          false, drop ALL) when `services.<name>.securityContext` is
          unset in values.

          Operators that ship custom UIDs set:
            services.backend.securityContext:
              runAsNonRoot: true
              runAsUser: 1000
              allowPrivilegeEscalation: false
              capabilities:
                drop: ["ALL"]
          */ -}}
          securityContext:
            {{- /*
            PSA-restricted complete default: runAsNonRoot/runAsUser
            alone are REJECTED by enforce=restricted —
            allowPrivilegeEscalation false and capabilities drop ALL
            are mandatory too. A values override replaces the whole
            block, so custom UIDs must re-include all four fields.
            */ -}}
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