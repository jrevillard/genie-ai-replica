{{/*
Shared env-row emitters for values the whole chart wires identically.
genieai-umbrella.secretKeyRefEnv emits a JSON OBJECT (one env row);
wrap with list/include:
  $secretEnv := list (include "genieai-umbrella.secretKeyRefEnv" (dict ...) | fromJson)
genieai-umbrella.gpuApiKeyEnv emits a JSON ARRAY of rows.

genieai-umbrella.secretKeyRefEnv — one env row from a Secret key.
Context keys: var (env var name), secret, key, optional (bool, omit for
mandatory).

genieai-umbrella.gpuApiKeyEnv — the vllm-api-key rows every GPU consumer
mounts. Context keys: `keys` — a list of env var names among HF_TOKEN,
VLLM_API_KEY, HUGGINGFACEHUB_API_TOKEN, OPENAI_API_KEY. Every name
resolves to the same-named key on the vllm-api-key Secret, except the
HUGGINGFACEHUB_API_TOKEN and OPENAI_API_KEY aliases, which both read the
VLLM_API_KEY key.

genieai-umbrella.envMapRows — the rows of a MAP of environment variables,
as a JSON ARRAY. The chart takes the operator's environment as a map, not a
list: Helm merges maps key by key, so an overlay that sets one variable
replaces that one and keeps every default the chart declares beside it. A
list would be replaced wholesale — an overlay setting one variable would
silently drop all the others, and the deployment would come up with a
different configuration than the chart documents. The values are stringified:
a container env value is always a string, and `true`/`3` in the values file
would otherwise render as a YAML boolean or number that the API server
rejects.
*/}}
{{- define "genieai-umbrella.secretKeyRefEnv" -}}
{{- $ref := dict "name" .secret "key" .key -}}
{{- if hasKey . "optional" -}}{{- $_ := set $ref "optional" .optional -}}{{- end -}}
{{- dict "name" .var "valueFrom" (dict "secretKeyRef" $ref) | toJson -}}
{{- end -}}

{{- define "genieai-umbrella.gpuApiKeyEnv" -}}
{{- $rows := list -}}
{{- range .keys -}}
{{- $secretKey := . -}}
{{- if eq $secretKey "HUGGINGFACEHUB_API_TOKEN" -}}{{- $secretKey = "VLLM_API_KEY" -}}{{- end -}}
{{- if eq $secretKey "OPENAI_API_KEY" -}}{{- $secretKey = "VLLM_API_KEY" -}}{{- end -}}
{{- $rows = append $rows (dict "name" . "valueFrom" (dict "secretKeyRef" (dict "name" "vllm-api-key" "key" $secretKey))) -}}
{{- end -}}
{{- $rows | toJson -}}
{{- end -}}

{{- define "genieai-umbrella.envMapRows" -}}
{{- if kindIs "slice" . -}}
{{- fail "the environment map must be a MAP ({NAME: value}), not a list of {name, value} rows — a list renders one variable named 0 whose value is the Go-map string, and every default the chart declares beside it disappears" -}}
{{- end -}}
{{- $rows := list -}}
{{- range $name, $value := . -}}
{{- /* A nil value is an operator's typo, not an empty string: sprig's
`toString nil` produces the four-character text "<nil>", which would
reach the pod as a real value. The list path (envRows) rejects it for
the same reason — an environment variable is either set or absent. */ -}}
{{- if kindIs "invalid" $value -}}
{{- fail (printf "the environment variable %q has no value: declare an empty string if you mean an empty value" $name) -}}
{{- end -}}
{{- $rows = append $rows (dict "name" $name "value" (toString $value)) -}}
{{- end -}}
{{- toJson $rows -}}
{{- end -}}

{{/*
genieai-umbrella.boolEnvValue — a boolean values knob as an env STRING,
with an explicit default for the unset case. The realm's env rows carry
this in two dialects (a `ternary` over `kindIs "invalid"` and an `eq`
over `default false`); both reduce to this, and the default is an
argument so the two families keep their distinct values.
*/}}
{{/*
genieai-umbrella.envRows — the container env list, normalized and checked.

The chart hands the service factory a LIST of {name, value} or
{name, valueFrom} rows. This helper is the boundary where those rows
are validated and stringified, so a non-string value can never reach the
manifest: `v1.EnvVar.value` is typed `string`, and the API server
rejects a number or a boolean at apply time — minutes after the
install, with the pod's manifest as the only clue.

Rules:
  - a MAP env (the operator-facing shape) is rejected. `toYaml` of a map
    renders a YAML MAPPING under `env:`, which the API server rejects
    with a schema error naming neither the service nor the key. The map
    shape is converted first by genieai-umbrella.envMapRows.
  - every row must carry a name, and either a value or a valueFrom. A
    row with neither renders an env entry the kubelet ignores — a
    variable the chart documents but the pod never receives.
  - a value is stringified; a NIL value is an error, because an
    operator's `FOO:` with no value is a typo, not an empty string.

Usage: {{ include "genieai-umbrella.envRows" ($svc.env | default list) | fromJsonArray | toYaml }}
*/}}
{{- define "genieai-umbrella.envRows" -}}
{{- $env := . -}}
{{- if kindIs "map" $env -}}
{{- fail "the environment must be a LIST of {name, value} rows; a map renders as a YAML mapping under env:, which the API server rejects. Convert it with the genieai-umbrella.envMapRows helper." -}}
{{- end -}}
{{- if not (kindIs "slice" $env) -}}
{{- fail (printf "the environment must be a LIST of {name, value} rows, not %s" (kindOf $env)) -}}
{{- end -}}
{{- $rows := list -}}
{{- range $row := $env -}}
{{- if not (kindIs "map" $row) -}}
{{- fail (printf "each environment row must be a {name, value} map, not %s" (kindOf $row)) -}}
{{- end -}}
{{- if not (hasKey $row "name") -}}
{{- fail "each environment row must carry a name" -}}
{{- end -}}
{{- if hasKey $row "value" -}}
{{- $value := get $row "value" -}}
{{- if kindIs "invalid" $value -}}
{{- fail (printf "the environment row %q carries a nil value; declare an empty string instead" (get $row "name")) -}}
{{- end -}}
{{- $rows = append $rows (dict "name" (get $row "name") "value" (toString $value)) -}}
{{- else if hasKey $row "valueFrom" -}}
{{- $rows = append $rows (dict "name" (get $row "name") "valueFrom" (get $row "valueFrom")) -}}
{{- else -}}
{{- fail (printf "the environment row %q carries neither a value nor a valueFrom" (get $row "name")) -}}
{{- end -}}
{{- end -}}
{{- toJson $rows -}}
{{- end -}}


{{/*
genieai-umbrella.validatedConvergenceEnvSecrets — the operator-declared
rows of the Keycloak convergence Job, VALIDATED, as a JSON list.

Every row is OPERATOR-FACING: each overlay hand-writes five of them
(data.keycloak.convergence.envSecrets), and a typo'd key (`envvar`
instead of `envVar`) rendered `name: null` and reached the API server,
which rejects the whole Job at apply time with "spec.template.spec.
containers[0].env[N].name: Required value": a message naming neither
the values key nor the row. A row that is a SCALAR (the classic
missing-dash YAML mistake) crashed the render with a raw Go-template
error in whichever template read it first.

The validation therefore lives in ONE place, and every consumer of the
rows goes through it — the emitters, the placeholder-completeness guard
and the helm test that lists the Secrets the Job reads. A validator
that only the emitter runs is a validator the other readers bypass.

The envVar is also checked for shape: it is an environment variable
NAME, and the realm's `$(env:VAR)` substitution and the Kubernetes
EnvVar both expect one. A numeric name ("90210") passes a non-empty
check and renders as a YAML integer, which the API server rejects at
apply time.

Usage:
  {{- $rows := include "genieai-umbrella.validatedConvergenceEnvSecrets" .Values.data.keycloak.convergence.envSecrets | fromJsonArray }}
*/}}
{{- define "genieai-umbrella.validatedConvergenceEnvSecrets" -}}
{{- $rows := . | default list -}}
{{- range $i, $row := $rows -}}
{{- if not (kindIs "map" $row) -}}
{{- fail (printf "data.keycloak.convergence.envSecrets[%d] must be a map {envVar, secretName, secretKey}, got %s" $i (kindOf $row)) -}}
{{- end -}}
{{- range $key := list "envVar" "secretName" "secretKey" -}}
{{- if not (hasKey $row $key) -}}
{{- fail (printf "data.keycloak.convergence.envSecrets[%d] has no %q — every row needs {envVar, secretName, secretKey}" $i $key) -}}
{{- end -}}
{{- $value := get $row $key -}}
{{- if or (kindIs "invalid" $value) (eq (toString $value) "") -}}
{{- fail (printf "data.keycloak.convergence.envSecrets[%d].%s is empty" $i $key) -}}
{{- end -}}
{{- end -}}
{{- if not (regexMatch "^[A-Za-z_][A-Za-z0-9_]*$" (toString (get $row "envVar"))) -}}
{{- fail (printf "data.keycloak.convergence.envSecrets[%d].envVar (%q) is not an environment variable name: it must start with a letter or an underscore and hold only letters, digits and underscores" $i (toString (get $row "envVar"))) -}}
{{- end -}}
{{- if not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$" (toString (get $row "secretName"))) -}}
{{- fail (printf "data.keycloak.convergence.envSecrets[%d].secretName (%q) is not a valid Secret name: lowercase alphanumerics, '.' and '-', bounded by alphanumerics" $i (toString (get $row "secretName"))) -}}
{{- end -}}
{{- end -}}
{{- toJson $rows -}}
{{- end -}}

{{/*
genieai-umbrella.convergenceEnvSecretRows — the same rows, rendered as
the Job's env entries. The envVar is QUOTED: an unquoted numeric name
renders as a YAML integer, and the API server rejects the EnvVar name
at apply time.

Usage: {{ include "genieai-umbrella.convergenceEnvSecretRows" .Values.data.keycloak.convergence.envSecrets | nindent 12 }}
*/}}
{{- define "genieai-umbrella.convergenceEnvSecretRows" -}}
{{- $rows := include "genieai-umbrella.validatedConvergenceEnvSecrets" . | fromJsonArray -}}
{{- $out := list -}}
{{- range $row := $rows -}}
{{- $out = append $out (printf "- name: %s\n  valueFrom:\n    secretKeyRef:\n      name: %s\n      key: %s" (get $row "envVar" | quote) (get $row "secretName" | quote) (get $row "secretKey" | quote)) -}}
{{- end -}}
{{- join "\n" $out -}}
{{- end -}}

{{- define "genieai-umbrella.boolEnvValue" -}}
{{- $v := .value -}}
{{- if kindIs "invalid" $v -}}{{- $v = .default -}}{{- end -}}
{{- ternary "true" "false" (eq ($v | toString) "true") -}}
{{- end -}}
