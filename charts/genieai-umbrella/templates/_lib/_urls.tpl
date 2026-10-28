{{/*
In-cluster service URL builders. One place per URL the chart wires into
env rows — a Service rename or port change edits exactly one line.

genieai-umbrella.keycloakContextPath — data.keycloak.httpRelativePath
(the single source: the Keycloak CR's additionalOptions, both URL helpers
and the HTTPRoute /auth rules all read it, so the served context path and
every caller cannot drift apart).

genieai-umbrella.keycloakInternalURL — http://keycloak-service.<ns>.svc.cluster.local:8080<context-path>
(backchannel base: token endpoints, JWKS; Keycloak hostname v2
backchannelDynamic serves these on the request host).

genieai-umbrella.keycloakPublicIssuer — <scheme>://<ingress-host><context-path>
(the pinned issuer on the Keycloak CR; token `iss` must match this).

genieai-umbrella.arangoURL — http://<arango-host>.<ns>.svc.cluster.local:8529

genieai-umbrella.serviceURL — http://<name>.<ns>.svc.cluster.local:<port>
for chart-internal peers (backend:80, document-repository:80, ...).
Context keys: root (the template dot), name, port.
*/}}
{{- define "genieai-umbrella.keycloakContextPath" -}}
{{- /* Every block read is normalized on the way in: `| default` protects a
nil LEAF, never a nil PARENT, so reading `.Values.data.keycloak.x` while
`data.keycloak` is nil crashes the template engine with a message that
names no values key. The chain is bound parent-first so a cleared tier
degrades to the chart's documented default instead. */ -}}
{{- $data := .Values.data | default dict -}}
{{- $kc := $data.keycloak | default dict -}}
{{- $path := $kc.httpRelativePath | default "/auth" -}}
{{- /* The path is CONCATENATED into every URL the chart builds
(":8080<path>", "<host><path>") and into the HTTPRoute's path rules.
Without a leading slash the concatenation produced "…:8080auth" and
the route path "auth/" — a URL no client can dial, with the values key
nowhere in the error. The shape is checked HERE, the one place every
consumer reaches. */ -}}
{{- if not (hasPrefix "/" $path) -}}
{{- fail (printf "data.keycloak.httpRelativePath %q must start with a slash: it is concatenated into every Keycloak URL and into the HTTPRoute path rules" $path) -}}
{{- end -}}
{{- if regexMatch "\\s" $path -}}
{{- fail (printf "data.keycloak.httpRelativePath %q carries whitespace: it is part of a URL and of a route path" $path) -}}
{{- end -}}
{{- $path -}}
{{- end -}}

{{- define "genieai-umbrella.keycloakInternalURL" -}}
{{- printf "http://keycloak-service.%s.svc.cluster.local:8080%s" .Values.namespace (include "genieai-umbrella.keycloakContextPath" .) -}}
{{- end -}}

{{- define "genieai-umbrella.keycloakPublicIssuer" -}}
{{- $ingress := .Values.ingress | default dict -}}
{{- printf "%s://%s%s" ($ingress.scheme | default "https") (include "genieai-umbrella.ingressHost" .) (include "genieai-umbrella.keycloakContextPath" .) -}}
{{- end -}}

{{- define "genieai-umbrella.arangoURL" -}}
{{- printf "http://%s.%s.svc.cluster.local:8529" (include "genieai-umbrella.arangoHost" .) .Values.namespace -}}
{{- end -}}

{{- define "genieai-umbrella.serviceURL" -}}
{{- printf "http://%s.%s.svc.cluster.local:%s" .name .root.Values.namespace (.port | toString) -}}
{{- end -}}

{{/*
genieai-umbrella.cspConnectSrc — the DERIVED Content-Security-Policy
connect-src set: 'self', the public origin, and the WebSocket source on
the public host.

One derivation for the backend's CSP header and the SPA's: the two
policies answer the same question ("which origins may this client talk
to?"), and two derivations drift — the SPA's policy was missing 'self'
and the WebSocket source, so a browser on a non-default PORT (the laptop
port-forward, https://genieai.local:4443) had its own same-origin /api
calls blocked: the explicit origin "https://genieai.local" does not
match the page origin "https://genieai.local:4443", and 'self' is the
only source that matches whatever origin the page was served from.

The WebSocket source follows the PUBLIC scheme: a browser on an https
origin opens wss://, and a ws:// entry names a source it cannot use.
*/}}
{{- define "genieai-umbrella.cspConnectSrc" -}}
{{- $ingress := .Values.ingress | default dict -}}
{{- $scheme := $ingress.scheme | default "https" -}}
{{- $host := include "genieai-umbrella.ingressHost" . -}}
{{- $wsScheme := ternary "wss" "ws" (eq $scheme "https") -}}
{{- printf "'self' %s://%s %s://%s" $scheme $host $wsScheme $host -}}
{{- end -}}
