{{/* Test-pod helpers. Lives in _lib/ by convention (shared partials
live in _lib/; a `define` in the consuming .yaml is legal but its
whitespace interactions with the surrounding document are easy to get
subtly wrong — the first version of the scaffolding include glued the
preceding line to `spec:` with a trimming dash and lint caught the
broken YAML). */}}

{{- /* One operator-supplied Secret NAME interpolated into the test
pods' shell script. The name reaches `sh` inside a pod carrying the
dep-check SA, so the FULL Kubernetes Secret-name shape is enforced —
the charset regex AND the DNS-subdomain bounds (253 chars total, 63
per dot-label): a violation fails the RENDER naming the values key,
never the shell. Takes {name, key}: `name` is the value, `key` the
values path for the failure message. */ -}}
{{- define "genieai-umbrella.validatedSecretName" -}}
{{- $name := toString .name -}}
{{- if not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$" $name) -}}
{{- fail (printf "%s (%q) is not a valid Secret name: lowercase alphanumerics, '.' and '-', bounded by alphanumerics" (.key | toString) $name) -}}
{{- end -}}
{{- if gt (len $name) 253 -}}
{{- fail (printf "%s (%q) is longer than the Kubernetes Secret-name bound (253 characters)" (.key | toString) $name) -}}
{{- end -}}
{{- range $label := splitList "." $name -}}
{{- if gt (len $label) 63 -}}
{{- fail (printf "%s (%q) carries a dot-label longer than the Kubernetes bound (63 characters)" (.key | toString) $label) -}}
{{- end -}}
{{- end -}}
{{- $name -}}
{{- end -}}

{{- /* The scaffolding BOTH test pods (test-namespace, test-data-deps)
share — SA, pull secrets, security posture, the tools emptyDir +
kubectl init, the alpine container and its PATH. Declared once so a
future edit cannot diverge the two pods (the kubectl-based Secret
assertions must run on the same image/SA posture as the namespace
assertions). The per-pod `command:` block follows the include. */ -}}
{{- define "genieai-umbrella.testPodScaffolding" -}}
{{- $g := .Values.global | default dict -}}
spec:
  restartPolicy: Never
  # The hook-owned dep-check SA (read-only grants on namespaces and
  # secrets) — the same SA the pre-upgrade hooks and both test pods
  # use; the assertions query `kubectl get`, which is NOT a noop: it
  # requires both the kubectl binary (alpine lacks it) and an SA-bound
  # RBAC grant.
  serviceAccountName: {{ include "genieai-common.fullname" . }}-dep-check
  {{- with $g.imagePullSecrets }}
  imagePullSecrets:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  # The full `restricted`-profile set. The namespace enforces `baseline`
  # (the GPU model tier cannot run non-root), and a test pod can carry the
  # stricter posture for free — it keeps passing if the namespace tightens.
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    seccompProfile:
      type: RuntimeDefault
  # `registry.k8s.io/kubectl` is distroless (no /bin/sh), so this Pod
  # ships kubectl via an init container that downloads the static binary
  # into the shared `tools` emptyDir. The main container is alpine
  # (sh is built in); kubectl is picked up via the PATH env, which
  # prepends /tools/bin.
  volumes:
    - name: tools
      emptyDir: {}
  initContainers:
    {{- include "genieai-umbrella.toolsInitContainer" . | nindent 4 }}
  containers:
    - name: test
      image: "{{ $g.toolingImageRegistry | default "docker.io" }}/alpine:3.20"
      imagePullPolicy: IfNotPresent
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        runAsNonRoot: true
        runAsUser: 65534
        capabilities:
          drop:
            - ALL
      env:
        - name: PATH
          value: /tools/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      volumeMounts:
        - name: tools
          mountPath: /tools
{{- end -}}
