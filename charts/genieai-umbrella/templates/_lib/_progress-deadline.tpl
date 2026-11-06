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
(900s) is the last resort. The chart NEVER renders the field as unset —
the Kubernetes 600s fallback is exactly the value that breaks a cold
start on a slow node.

Context: (dict "Values" <values> "service" <service name or "">).
The service name is empty for the deployments no service owns (the OPEA
model and translation deployments) — those read the chart-wide value.
*/}}
{{- define "genieai-umbrella.progressDeadlineSeconds" -}}
{{- $ctx := . -}}
{{- $deadline := 900 -}}
{{- with $ctx.Values.global -}}
{{- if hasKey . "progressDeadlineSeconds" -}}
{{- if not (kindIs "invalid" .progressDeadlineSeconds) -}}
{{- $deadline = int .progressDeadlineSeconds -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- with $ctx.service -}}
{{- $svc := index ($ctx.Values.services | default dict) . | default dict -}}
{{- if hasKey $svc "progressDeadlineSeconds" -}}
{{- if not (kindIs "invalid" $svc.progressDeadlineSeconds) -}}
{{- $deadline = int $svc.progressDeadlineSeconds -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- /* A deadline of 0 or less would make the Deployment fail
immediately — the very symptom this knob exists to remove. */ -}}
{{- if lt $deadline 1 -}}
{{- fail (printf "the progress deadline must be at least 1 second (got %d) — a Deployment with no progress window reports ProgressDeadlineExceeded before its pods can start" $deadline) -}}
{{- end -}}
{{- $deadline -}}
{{- end -}}
