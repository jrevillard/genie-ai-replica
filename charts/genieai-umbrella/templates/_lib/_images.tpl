{{/*
genieai-umbrella.imageTagBase — the tag WITHOUT the variant suffix.

The variant suffix ("-slim") rides on the VERSION tag, and the pull policy
decides Always-vs-IfNotPresent on MUTABILITY: "main" and "latest" move
with the branch's builds, a release tag (vX.Y.Z) does not. The suffix must
not change that verdict — "main-slim" is as mutable as "main", and
"v2.1.0-slim" as immutable as "v2.1.0" — so the policy judges the BASE
tag.

*/}}
{{- define "genieai-umbrella.imageTagBase" -}}
{{- $tag := .tag | default "" -}}
{{- $suffix := .suffix | default "" -}}
{{- if and $suffix $tag (hasSuffix $suffix $tag) -}}
{{- trimSuffix $suffix $tag -}}
{{- else -}}
{{- $tag -}}
{{- end -}}
{{- end -}}

{{/*
genieai-umbrella.imageTag — the version tag an image is pulled with.

Precedence: the per-service pin (services.<svc>.image.tag) wins, then the
global `imageTag` (ONE line to bump the whole stack), then "main".

The per-service values carry "" and not "main": a literal "main" there
would shadow the global forever, and the global is the point of the knob.
An empty per-service tag is not an error — it is how a service says "I
follow the global".

global.imageTag (the Helm `global.*` convention) wins over the top-level
imageTag, like global.imageRegistry does over imageRegistry.
*/}}
{{- define "genieai-umbrella.imageTag" -}}
{{- $root := .root -}}
{{- $serviceTag := .serviceTag | default "" -}}
{{- if $serviceTag -}}
{{- $serviceTag -}}
{{- else -}}
{{- $global := $root.Values.global | default dict -}}
{{- $global.imageTag | default $root.Values.imageTag | default "main" -}}
{{- end -}}
{{- end -}}

{{/*
genieai-umbrella.opeaImageTag — the tag an OPEA service image is pulled
with: the version tag, plus the VARIANT suffix for the images the CI
publishes a slim build of (issue #2000).

The slim-capable SET is a BUILD FACT — the CI's slim lanes exist for
exactly these three images — so it lives here and NOT in the values: a
value the operator could set wrong would break the pull of an image that
has no slim build. The operator's knob is the CHOICE (`opea.imageTagSuffix`),
not the membership.

The other OPEA images are excluded on purpose: chatqna, okf-server,
pii-service and ragas-service have no model stack, and embedding is an
upstream binary this project does not build (a slim build of it cannot
exist).

A per-service pin (opea.<svc>.image.tag) names the EXACT tag and is
therefore never given the suffix — the same rule the compose path follows.
*/}}
{{- define "genieai-umbrella.opeaImageTag" -}}
{{- $root := .root -}}
{{- $key := .key -}}
{{- $serviceTag := .serviceTag | default "" -}}
{{- $capable := dict "reranker" true "retriever" true "dataprep" true -}}
{{- if $serviceTag -}}
{{- $serviceTag -}}
{{- else -}}
{{- $tag := include "genieai-umbrella.imageTag" (dict "root" $root "serviceTag" "") -}}
{{- if hasKey $capable $key -}}
{{- /* Parent-first: a CLEARED `opea` (null) reads as an empty map, so the
suffix resolves to "" instead of crashing the template engine. */ -}}
{{- $opeaVals := $root.Values.opea | default dict -}}
{{- $suffix := $opeaVals.imageTagSuffix | default "" -}}
{{- printf "%s%s" $tag $suffix -}}
{{- else -}}
{{- $tag -}}
{{- end -}}
{{- end -}}
{{- end -}}
