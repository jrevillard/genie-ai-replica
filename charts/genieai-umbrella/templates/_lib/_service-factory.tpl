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
{{- $replicas := include "genieai-umbrella.resolveReplicas" (dict "Values" $ctx.Values "service" $svcName) | int -}}
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
      # Pod-level securityContext: seccompProfile is mandatory
      # (PSA restricted admission rejects pods without it). The
      # runAsUser/runAsNonRoot defaults that previously sat here
      # are removed: the frontend/clamav entrypoints write to
      # paths owned by the image's default USER (root=0 for the
      # frontend, 100 for clamav) and crash-loop on 65534. Each
      # service declares its own user via `securityContext` (container
      # level) in values.yaml.
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
      {{- with $ctx.Values.global.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- /* global.imageRegistry (the documented install knob, the Helm
      convention) wins over the top-level imageRegistry; both target only
      the genie-ai-* factory images. */}}
      {{- $registry := $ctx.Values.global.imageRegistry | default $ctx.Values.imageRegistry }}
      containers:
        - name: {{ $objectName }}
          image: {{- if $registry }} {{ $registry }}/{{ $svc.image.repository }}{{ else }} {{ $svc.image.repository }}{{ end }}:{{ $svc.image.tag | default "latest" }}
          # Per-service pullPolicy wins; global pullPolicy follows; the
          # tag decides otherwise (mutable tags pull Always — see the
          # helper).
          imagePullPolicy: {{ include "genieai-umbrella.imagePullPolicy" (dict "tag" $svc.image.tag "pullPolicy" ($svc.image.pullPolicy | default $ctx.Values.global.imagePullPolicy)) }}
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
            {{- toYaml $svc.env | nindent 12 }}
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
            # and only NET_RAW dropped from capabilities. We KEEP
            # CHOWN, FOWNER, DAC_OVERRIDE, SETUID, SETGID — needed
            # by entrypoints that chown paths at startup (the
            # embedded-nginx frontend). Dropping ALL also drops
            # CHOWN, which made the chown fail with EPERM even when
            # running as root. UID and runAsNonRoot are service-
            # specific — the frontend/clamav entrypoints write
            # to paths owned by the image's default USER (root for
            # the frontend, 100 for clamav) and break when forced
            # to 65534. Each service declares its own `securityContext`
            # in values.yaml.
            {{- $scc := $svc.securityContext | default (dict "allowPrivilegeEscalation" false "capabilities" (dict "drop" (list "NET_RAW"))) -}}
            {{- toYaml $scc | nindent 12 }}
          {{- with $svc.volumeMounts }}
          volumeMounts:
            {{- toYaml . | nindent 12 }}
          {{- end }}
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
