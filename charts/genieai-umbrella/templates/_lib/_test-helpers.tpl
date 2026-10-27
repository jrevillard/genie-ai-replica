{{/*
The HTTP probe helper the helm-test pods share.

Two test templates need it (the stateless reachability test and the
observability test), and they carried IDENTICAL copies — with a
comment in one of them that stated the argument order the other did not
use: the implementation is

    check <host> <port> [path] <expected>

A caller following the wrong comment probes a host named "200" and
compares a status code against a path: the probe asserts nothing and
the helm test fails the install for a typo. One definition, one order.

The script must be rendered INSIDE a YAML block scalar (the pod's
`command: [sh, -c, <script>]`), so callers use it with the right
indentation:

    {{- include "genieai-umbrella.testCheckHelper" . | nindent 10 }}
*/}}
{{- define "genieai-umbrella.testCheckHelper" -}}
# Each call: <host> <port> [path] <expected-status>
check() {
  host=$1
  port=$2
  path=${3:-/health}
  expected=$4
  code=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://${host}:${port}${path}" 2>/dev/null || echo 000)
  if [ "$code" = "$expected" ]; then
    echo "PASS: ${host}:${port}${path} -> ${code}"
  else
    echo "FAIL: ${host}:${port}${path} expected ${expected}, got ${code}"
    failures=$((failures+1))
  fi
}
{{- end -}}
