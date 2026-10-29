{{/* Test-pod helpers. Lives in _lib/ (a .tpl file) because helm lint
parses .yaml templates as YAML, and a `define` body inside a .yaml
template is not YAML — lint dies on the scaffolding's colons before the
renderer ever runs. */}}

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
