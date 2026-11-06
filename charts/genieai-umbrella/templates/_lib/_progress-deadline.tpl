{{/*
The progress deadline every Deployment the chart renders carries.

Kubernetes defaults `spec.progressDeadlineSeconds` to 600s, and that
clock starts when the DEPLOYMENT is created — not when the pod runs. On
a first install the pod is created minutes later (multi-GB images still
pulling), so the pod inherits only what is left of the 600s window. Past
it, the Deployment reports ProgressDeadlineExceeded, Helm declares the
release failed and UNINSTALLS it — deleting the resources the next
attempt needs, so the install restarts from scratch and can loop.

Precedence, same direction as every other knob here: the service's own
`progressDeadlineSeconds` wins, the chart-wide
`global.progressDeadlineSeconds` is the fallback, and the chart default
(1800s) is the last resort. The chart NEVER renders the field as unset —
the Kubernetes 600s fallback is exactly the value that breaks a cold
start on a slow node.

The default is 1800s, calibrated on the reference venue (an 18-minute
first install, almost all of it image pulls — the OPEA images are
multi-GB by nature, so a cold pull eating into the window is the normal
case). A venue slower than that declares its own value, below its own
INSTALL timeout: the deadline fires an uninstall (an INSTALL failure —
an upgrade aborts without uninstalling), so it must never outlive the
install wait it sits in.

The per-service keys are NOT declared in values.yaml on purpose: Helm
merges overlay values over chart values, but a concrete per-service
default would still always be present (an overlay can set the key, never
remove it), and the helper reads the service key before the chart-wide
one — together that makes the global knob inert for exactly the services
it matters most for (the backend among them). The shape block documents
the key; an overlay declares it when it wants to override.

Context: (dict "Values" <values> "service" <service name or "">).
The service name is empty for the deployments no service owns (the OPEA
model and translation deployments) — those read the chart-wide value.
*/}}
{{- define "genieai-umbrella.progressDeadlineSeconds" -}}
{{- $ctx := . -}}
{{- /* Helm has no nil: an UNSET value is tracked with a separate flag and
the raw value is read only where it exists. */ -}}
{{- $found := false -}}
{{- $raw := 0 -}}
{{- $source := "" -}}
{{- with $ctx.service -}}
{{- $svc := index ($ctx.Values.services | default dict) . | default dict -}}
{{- if hasKey $svc "progressDeadlineSeconds" -}}
{{- $found = true -}}
{{- $raw = $svc.progressDeadlineSeconds -}}
{{- $source = printf "services.%s.progressDeadlineSeconds" . -}}
{{- end -}}
{{- end -}}
{{- if not $found -}}
{{- with $ctx.Values.global -}}
{{- if hasKey . "progressDeadlineSeconds" -}}
{{- $found = true -}}
{{- $raw = .progressDeadlineSeconds -}}
{{- $source = "global.progressDeadlineSeconds" -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- /* An explicit `null` CLEARS the knob (the chart's cleared-knob
convention): Helm hands the key over with kind "invalid", and the
default the chart declares must apply — the schema types the key as
integer-or-null so the cleared value reaches this template. */ -}}
{{- if eq (kindOf $raw) "invalid" -}}
{{- $found = false -}}
{{- $source = "" -}}
{{- $raw = 0 -}}
{{- end -}}
{{- $deadline := 1800 -}}
{{- if $found -}}
{{- /* A BOOLEAN or a string is a typo, not a deadline: `int true` is 1,
which is a one-second progress window — the exact pathology this knob
exists to remove. Fail by name, with the value the operator wrote. */ -}}
{{- /* Helm's YAML parser hands every value read from values.yaml over
as a float64 (the `--set` CLI path yields an int64), so both numeric
kinds are accepted — but a BOOLEAN or a string is a typo, and `int true`
is 1, a one-second progress window: the exact pathology this knob
exists to remove. A fractional number is a typo too. */ -}}
{{- if not (or (kindIs "int64" $raw) (kindIs "float64" $raw)) -}}
{{- fail (printf "%s must be an integer number of seconds (got %v of type %s) — a deadline under 1 second reports ProgressDeadlineExceeded before the pod can start" $source $raw (kindOf $raw)) -}}
{{- end -}}
{{- /* Compared numerically, not through %v: Go renders float64
1000000 as "1e+06", so a string comparison would reject a legitimate
whole deadline of a million seconds. */ -}}
{{- if ne (float64 (int $raw)) (float64 $raw) -}}
{{- fail (printf "%s must be a whole number of seconds (got %v) — a fractional deadline is a typo" $source $raw) -}}
{{- end -}}
{{- $deadline = int $raw -}}
{{- end -}}
{{- if lt $deadline 1 -}}
{{- fail (printf "%s must be at least 1 second (got %d) — a Deployment with no progress window reports ProgressDeadlineExceeded before its pods can start" $source $deadline) -}}
{{- end -}}
{{- $deadline -}}
{{- end -}}
