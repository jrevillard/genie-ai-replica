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
{{- $global := $ctx.Values.global | default dict -}}
{{- $svcName := $ctx.name -}}
{{- /* The service entry is copied before it is defaulted: the copy
keeps the defaulting local to this render (no write-back into the
chart's values), and the image block is materialized so a cleared
`image` reads as an empty map — the guard below then reports it BY
NAME instead of the template engine crashing on a nil parent. */ -}}
{{- $services := $ctx.Values.services | default dict -}}
{{- $svc := deepCopy (index $services $svcName | default dict) -}}
{{- $_ := set $svc "image" ($svc.image | default dict) -}}
{{- $replicas := include "genieai-umbrella.resolveReplicas" (dict "Values" $ctx.Values "service" $svcName) | int -}}
{{- $component := $ctx.component | default $svcName -}}
{{- $objectName := lower $svcName -}}
{{- if not $svc.image.repository -}}
{{- fail (printf "services.%s.image.repository is required — the chart carries no default image for this service; set services.%s.image.repository and services.%s.image.tag" $svcName $svcName $svcName) -}}
{{- end -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "genieai-common.fullname" $ctx }}-{{ $objectName }}
  namespace: {{ $ctx.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $component) | nindent 4 }}
spec:
  replicas: {{ $replicas }}
{{- $selectorLabels := include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" $ctx.Values "component" $component) }}
  selector:
    matchLabels:
      {{- $selectorLabels | nindent 6 }}
  template:
    metadata:
      labels:
        {{- $selectorLabels | nindent 8 }}
      {{- with $svc.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
    spec:
      # Pod-level securityContext: seccompProfile is part of the
      # `restricted` profile the services opt into (the namespace itself
      # enforces `baseline` — see _model-deployment.tpl for why it cannot
      # go stricter). The
      # runAsUser/runAsNonRoot defaults that previously sat here
      # are removed: each service declares its own identity via
      # `securityContext` (container level) in values.yaml, pinned to
      # the USER its image ships (frontend 101, clamav 1000, backend
      # 1000 — see #1227: every image now runs non-root by default
      # and its Dockerfile pre-chowns the paths it writes).
      #
      # `podSecurityContext` (e.g. fsGroup on documentRepository) is
      # merged into the same `securityContext:` block — emitting two
      # sibling `securityContext:` keys is invalid YAML and the helm
      # post-render unmarshaller rejects it with 'mapping key
      # "securityContext" already defined'.
      securityContext:
        seccompProfile:
          type: RuntimeDefault
        {{- with $svc.podSecurityContext }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      {{- with $svc.volumes }}
      volumes:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $global.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- /* global.imageRegistry (the documented install knob, the Helm
      convention) wins over the top-level imageRegistry; both target only
      the genie-ai-* factory images. */}}
      {{- $registry := $global.imageRegistry | default $ctx.Values.imageRegistry }}
      containers:
        - name: {{ $objectName }}
          image: {{- if $registry }} {{ $registry }}/{{ $svc.image.repository }}{{ else }} {{ $svc.image.repository }}{{ end }}:{{ $svc.image.tag | default "latest" }}
          # Per-service pullPolicy wins; global pullPolicy follows; the
          # tag decides otherwise (mutable tags pull Always — see the
          # helper).
          imagePullPolicy: {{ include "genieai-umbrella.imagePullPolicy" (dict "tag" $svc.image.tag "pullPolicy" ($svc.image.pullPolicy | default $global.imagePullPolicy)) }}
          {{- with $svc.workingDir }}
          workingDir: {{ . }}
          {{- end }}
          {{- with $svc.command }}
          command:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $svc.args }}
          args:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          ports:
            - name: http
              containerPort: {{ $svc.port }}
          env:
            {{- /* The PROCESS must listen on the port the plumbing dials:
            containerPort, Service targetPort, NetworkPolicy and probes
            all move with `services.<svc>.port`, and an application that
            reads `PORT` would otherwise stay on the image's own default
            — the pod would never go Ready, with nothing in the render
            to say why. Services whose image takes the port another way
            (clamd reads clamd.conf, redis-server takes --port) simply
            ignore this variable. */ -}}
            {{- (list (dict "name" "PORT" "value" ($svc.port | toString))) | concat (include "genieai-umbrella.envRows" ($svc.env | default list) | fromJsonArray) | toYaml | nindent 12 }}
          {{- with $svc.secrets }}
          envFrom:
            {{- range . }}
            # optional: true — the chart references secrets the
            # deployment does NOT create (operator-provided contract
            # for arango-root-secret, translation-cache-password,
            # etc.). Without optional, a missing Secret produces
            # CreateContainerConfigError at pod start and the
            # operator can only fix it by creating the Secret by
            # hand, defeating the chart-driven install path.
            # With optional: true, the Secret's keys are exposed
            # when the Secret exists and silently absent when it
            # doesn't — the pod runs and the application code
            # decides what to do with unset env vars.
            - secretRef:
                name: {{ .name }}
                optional: true
            {{- end }}
          {{- end }}
          resources:
            {{- toYaml $svc.resources | nindent 12 }}
          securityContext:
            # Per-service `services.<svc>.securityContext` overrides
            # entirely. The default below carries only the bits that
            # are safe regardless of UID: no privilege escalation,
            # and only NET_RAW dropped from capabilities. Since #1227
            # every service pins its full identity in values.yaml
            # (runAsNonRoot + runAsUser + drop ALL) — each image runs
            # non-root by default and its Dockerfile pre-chowns the
            # paths it writes, so entrypoints no longer chown at
            # startup and need no extra capabilities.
            {{- $scc := $svc.securityContext | default (dict "allowPrivilegeEscalation" false "capabilities" (dict "drop" (list "NET_RAW"))) -}}
            {{- toYaml $scc | nindent 12 }}
          {{- with $svc.volumeMounts }}
          volumeMounts:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- /* Normalized: a CLEARED probes block (`probes: null`) means
          "no probes", the same degrade-gracefully contract every other
          clearable block follows — a bare $svc.probes.readiness crashed
          the render with a nil-pointer error instead. */ -}}
          {{- $probes := $svc.probes | default dict -}}
          {{- with $probes.readiness }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $probes.liveness }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $probes.startup }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
{{- end -}}

{{/*
genieai-umbrella.imagePullPolicy — the pull policy for a service image.
Takes `{"tag": <tag>, "pullPolicy": <override or nil>}`.

A mutable branch tag moves under its own name, and IfNotPresent keeps
serving whatever digest the first deploy cached — a green reconcile over
stale code. So the default follows the tag: `main`, `latest` and
`stable*` are Always; a pinned tag (a version, a SHA) is IfNotPresent.
An explicit per-service `image.pullPolicy` (or the global one) wins over
both.
*/}}
{{- define "genieai-umbrella.imagePullPolicy" -}}
{{- $tag := .tag | default "latest" -}}
{{- $mutable := or (eq $tag "main") (eq $tag "latest") (hasPrefix "stable" $tag) -}}
{{- .pullPolicy | default (ternary "Always" "IfNotPresent" $mutable) -}}
{{- end -}}
