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
# Each call: <host> <port> <path> <expected-status>, or the convenience
# form <host> <port> <expected-status> (path defaults to /health). The
# two forms were documented as one, but a 3-argument call bound the
# status to the path and the expected value to nothing — a call the
# helper's own documentation invited could never pass.
check() {
  host=$1
  port=$2
  if [ "$#" -ge 4 ]; then
    path=$3
    expected=$4
  else
    path=/health
    expected=$3
  fi
  # busybox wget has no curl's -w '%{http_code}': the status rides in
  # the `  HTTP/1.1 <code>` header line `wget -S` prints to stderr
  # (measured live: a 200 parses to "200", a dead port leaves the
  # capture empty). A connection failure therefore parses to nothing
  # and reads as 000 — the same contract the curl form had.
  code=$(wget -q -T 5 -S -O /dev/null "http://${host}:${port}${path}" 2>&1 | grep -oE 'HTTP/[0-9.]+ [0-9]+' | tail -1 | grep -oE '[0-9]+$' || true)
  code=${code:-000}
  if [ "$code" = "$expected" ]; then
    echo "PASS: ${host}:${port}${path} -> ${code}"
  else
    echo "FAIL: ${host}:${port}${path} expected ${expected}, got ${code}"
    failures=$((failures+1))
  fi
}
{{- end -}}
