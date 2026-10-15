{{/*
In-cluster service URL builders. One place per URL the chart wires into
env rows — a Service rename or port change edits exactly one line.

genieai-umbrella.keycloakInternalURL — http://keycloak-service.<ns>.svc.cluster.local:8080/auth
(backchannel base: token endpoints, JWKS; Keycloak hostname v2
backchannelDynamic serves these on the request host).

genieai-umbrella.keycloakPublicIssuer — <scheme>://<ingress-host>/auth
(the pinned issuer on the Keycloak CR; token `iss` must match this).

genieai-umbrella.arangoURL — http://<arango-host>.<ns>.svc.cluster.local:8529

genieai-umbrella.serviceURL — http://<name>.<ns>.svc.cluster.local:<port>
for chart-internal peers (backend:80, document-repository:80, ...).
Context keys: root (the template dot), name, port.
*/}}
{{- define "genieai-umbrella.keycloakInternalURL" -}}
{{- printf "http://keycloak-service.%s.svc.cluster.local:8080/auth" .Values.namespace -}}
{{- end -}}

{{- define "genieai-umbrella.keycloakPublicIssuer" -}}
{{- printf "%s://%s/auth" (.Values.ingress.scheme | default "https") (.Values.ingress.host | default "genieai.local") -}}
{{- end -}}

{{- define "genieai-umbrella.arangoURL" -}}
{{- printf "http://%s.%s.svc.cluster.local:8529" (include "genieai-umbrella.arangoHost" .) .Values.namespace -}}
{{- end -}}

{{- define "genieai-umbrella.serviceURL" -}}
{{- printf "http://%s.%s.svc.cluster.local:%s" .name .root.Values.namespace (.port | toString) -}}
{{- end -}}
