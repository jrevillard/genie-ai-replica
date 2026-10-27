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
  image: {{ .Values.global.toolingImageRegistry | default "docker.io" }}/curlimages/curl:8.10.1
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
      # The node's architecture, detected at runtime unless the operator
      # forces one: an arm64 cluster (Apple Silicon minikube) cannot
      # execute the amd64 binary, and the pod that needs it — the
      # helm-test pod, the pre-upgrade drift hook — never starts.
      ARCH="{{ .Values.global.toolingArch }}"
      if [ -z "$ARCH" ]; then
        case "$(uname -m)" in
          x86_64|amd64) ARCH=amd64 ;;
          aarch64|arm64) ARCH=arm64 ;;
          *) ARCH=amd64 ;;
        esac
      fi
      # Three attempts per download, back-to-back sleeps: these pods run
      # as hook Jobs whose backoffLimit is 0-1, and a single transient
      # failure on dl.k8s.io or github.com would fail the init container,
      # fail the Job, and abort the whole helm upgrade — for the drift
      # hook, a check whose script ends in `exit 0` precisely so it can
      # never block.
      fetch() {
        for i in 1 2 3; do
          if curl -fsSL "$1" -o "$2"; then
            return 0
          fi
          rm -f "$2"
          sleep 2
        done
        return 1
      }
      # kubectl only: nothing in the hook Jobs or test pods shells out to
      # jq (the pre-upgrade detect hook parses with grep/sed), so
      # downloading it paid a second external fetch — and a second
      # mirror requirement for air-gapped installs — for an unused
      # binary.
      fetch "$BASE/release/v1.33.0/bin/linux/$ARCH/kubectl" /tools/bin/kubectl
      chmod +x /tools/bin/kubectl
{{- end -}}
