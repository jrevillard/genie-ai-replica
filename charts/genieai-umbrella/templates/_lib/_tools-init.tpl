{{/*
toolsInitContainer — the init container that downloads kubectl and jq into
a shared emptyDir at /tools (so the main container has sh, kubectl, jq via
PATH=/tools/bin:...). Renders ONLY the initContainers entry. The caller
is responsible for adding `volumes: - name: tools emptyDir: {}` to the
pod spec and `volumeMounts: - name: tools mountPath: /tools` plus
`env: - name: PATH value: /tools/bin:...` to the main container.
The kubeletToolsMirror values key lets air-gapped clusters point both
URLs at a single internal mirror.
*/}}
{{- define "genieai-umbrella.toolsInitContainer" -}}
- name: tools
  image: {{ .Values.global.imageRegistry | default "docker.io" }}/curlimages/curl:8.10.1
  imagePullPolicy: IfNotPresent
  securityContext:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    runAsNonRoot: true
    runAsUser: 65534
    capabilities:
      drop:
        - ALL
  volumeMounts:
    - name: tools
      mountPath: /tools
  command:
    - /bin/sh
    - -c
    - |
      set -eu
      mkdir -p /tools/bin
      BASE="{{ .Values.global.kubeletToolsMirror | default "https://dl.k8s.io" }}"
      BASE_JQ="{{ .Values.global.kubeletToolsMirror | default "https://github.com/jqlang" }}"
      curl -fsSL "$BASE/release/v1.33.0/bin/linux/amd64/kubectl" -o /tools/bin/kubectl
      chmod +x /tools/bin/kubectl
      curl -fsSL "$BASE_JQ/jq/releases/download/jq-1.7.1/jq-linux-amd64" -o /tools/bin/jq
      chmod +x /tools/bin/jq
{{- end -}}
