{{/*
toolsInitContainer — the init container that downloads kubectl into
a shared emptyDir at /tools (so the main container has sh and kubectl via
PATH=/tools/bin:...). Nothing in the hook Jobs or the test pods shells
out to jq, so it is not downloaded — a second binary would be a second
external fetch and a second mirror requirement for no consumer.
Renders ONLY the initContainers entry. The caller
is responsible for adding `volumes: - name: tools emptyDir: {}` to the
pod spec and `volumeMounts: - name: tools mountPath: /tools` plus
`env: - name: PATH value: /tools/bin:...` to the main container.
The kubeletToolsMirror values key lets air-gapped clusters point the
URL at a single internal mirror.
*/}}

{{- define "genieai-umbrella.toolsInitContainer" -}}
{{- $global := .Values.global | default dict -}}
- name: tools
  {{- /* busybox, not curlimages/curl: the curl images ship layers whose
  PAX headers carry the build host's overlayfs xattrs
  (SCHILY.xattr.user.overlay.*, measured on 8.10.1 AND 8.14.1), and
  storage stacks that refuse user.* setxattr (fuse-overlayfs in an
  unprivileged nest — the class of venue this chart dev-deploys to)
  fail the extraction with EPERM: ImagePullBackOff on every hook.
  busybox:1.36 carries no such records (control-measured) and wget
  covers every fetch here — with checksum verification, since wget
  validates no certificates. */}}
  image: {{ $global.toolingImageRegistry | default "docker.io" }}/busybox:1.36
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
      BASE="{{ $global.kubeletToolsMirror | default "https://dl.k8s.io" }}"
      # The node's architecture, detected at runtime unless the operator
      # forces one: an arm64 cluster (Apple Silicon minikube) cannot
      # execute the amd64 binary, and the pod that needs it — the
      # helm-test pod, the pre-upgrade drift hook — never starts.
      ARCH="{{ $global.toolingArch }}"
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
          if wget -q -O "$2" "$1"; then
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
      # busybox wget performs NO TLS certificate validation ("TLS
      # certificate validation not implemented") — the checksum file is
      # the endpoint-authenticity control, not the transport. The mirror
      # must therefore serve the .sha256 alongside the binary.
      fetch "$BASE/release/v1.33.0/bin/linux/$ARCH/kubectl" /tools/bin/kubectl
      fetch "$BASE/release/v1.33.0/bin/linux/$ARCH/kubectl.sha256" /tools/bin/kubectl.sha256
      # dl.k8s.io serves the checksum as a BARE hash (no filename
      # field); mirrors may serve either shape — take the first field
      # and build the checksum line ourselves. (First live pass caught
      # the naive `sha256sum -c <file>` failing on every install.)
      expected="$(awk '{print $1}' /tools/bin/kubectl.sha256 | head -n 1)"
      if ! echo "$expected  kubectl" | sha256sum -c - >/dev/null 2>&1; then
        echo "kubectl checksum mismatch against $BASE — refusing to use the download" >&2
        exit 1
      fi
      rm -f /tools/bin/kubectl.sha256
      chmod +x /tools/bin/kubectl
{{- end -}}
