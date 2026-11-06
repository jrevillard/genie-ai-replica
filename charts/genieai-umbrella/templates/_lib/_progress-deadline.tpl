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

The default is 900s — sized for a NORMAL cold start (the images pull in
minutes), not for a pathological venue: a cluster whose pulls take a
quarter of an hour declares its own value, below its own Helm timeout
(the deadline fires an uninstall, so it must never outlive the wait it
sits in).

The per-service keys are NOT declared in values.yaml on purpose: Helm
merges chart values OVER overlay values, so a concrete per-service value
would always be present and would always win over the chart-wide one —
making the global knob inert for exactly the services it matters most
for (the backend among them). The shape block documents the key; an
overlay declares it when it wants to override.

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
{{- $deadline := 900 -}}
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
{{- if ne (printf "%v" (int $raw)) (printf "%v" $raw) -}}
{{- fail (printf "%s must be a whole number of seconds (got %v) — a fractional deadline is a typo" $source $raw) -}}
{{- end -}}
{{- $deadline = int $raw -}}
{{- end -}}
{{- if lt $deadline 1 -}}
{{- fail (printf "%s must be at least 1 second (got %d) — a Deployment with no progress window reports ProgressDeadlineExceeded before its pods can start" $source $deadline) -}}
{{- end -}}
{{- $deadline -}}
{{- end -}}
