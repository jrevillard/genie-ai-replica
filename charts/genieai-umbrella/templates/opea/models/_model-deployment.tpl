{{/*
Shared skeleton for the in-cluster GPU model Deployments + Services
(vllm, vllm-translation, tei, tei-reranker). The four models differ in
image, args, port, model-cache mount path, probe thresholds, and the
occasional initContainer or extra env row; everything else — labels,
nodeSelector, security contexts, HF token, NVIDIA env, the shared
model-cache volume switch, probes, Service — is identical.

Context keys (all from a dict built by the caller with "root" set):
  root         the template dot (Values access)
  name         workload + Service name (also the `app:` label the
               orchestrator NetworkPolicies match)
  image        full image reference (upstream registries; NOT prefixed
               by the top-level imageRegistry — the images are not mirrored)
  port         container + Service port
  mountPath    model-cache volume mount path
  argsText     the args block body, verbatim, already indented for the
               container level (models keep their distinct arg styles:
               vLLM flag lists, TEI folded router invocations)
  commandText  optional full `command:` line, verbatim
  envText      optional extra env rows, verbatim (indented container level)
  initText     optional initContainers block, verbatim (spec level)
  readinessDelay / livenessDelay
               initialDelaySeconds for the shared /health probes
  startup      dict with failureThreshold + periodSeconds
*/}}
{{- define "genieai-umbrella.modelDeployment" -}}
{{- $root := .root -}}
{{- $res := $root.Values.opea.models.resources | default (dict "requests" (dict "nvidia.com/gpu" 1) "limits" (dict "nvidia.com/gpu" 1)) -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
    app.kubernetes.io/name: {{ .name }}
    app.kubernetes.io/component: {{ .name }}
    app.kubernetes.io/part-of: genieai
spec:
  replicas: 1
  selector:
    matchLabels:
      app: {{ .name }}
  template:
    metadata:
      labels:
        app: {{ .name }}
    spec:
      nodeSelector:
        gpu: "true"
      securityContext:
        seccompProfile:
          type: RuntimeDefault
      {{- with $root.Values.global.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .initText }}
{{ . }}
      {{- end }}
      containers:
        - name: {{ .name }}
          image: {{ .image }}
          imagePullPolicy: IfNotPresent
          {{- with .commandText }}
{{ . }}
          {{- end }}
          args:
{{ .argsText }}
          ports:
            - name: http
              containerPort: {{ .port }}
          env:
            - name: HUGGING_FACE_HUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: vllm-api-key
                  key: HF_TOKEN
            {{- with .envText }}
{{ . }}
            {{- end }}
            - name: NVIDIA_VISIBLE_DEVICES
              value: all
          resources:
            {{- toYaml $res | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: hf-cache
              mountPath: {{ .mountPath }}
          readinessProbe:
            httpGet:
              path: /health
              port: {{ .port }}
            initialDelaySeconds: {{ .readinessDelay }}
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: {{ .port }}
            initialDelaySeconds: {{ .livenessDelay }}
            periodSeconds: 30
          startupProbe:
            httpGet:
              path: /health
              port: {{ .port }}
            failureThreshold: {{ .startup.failureThreshold }}
            periodSeconds: {{ .startup.periodSeconds }}
      volumes:
        {{- if $root.Values.opea.models.cache.enabled }}
        # Shared model-weights cache (see templates/opea/models/model-cache-pvc.yaml).
        # ReadWriteOnce on the single gpu=true node; all four model pods
        # share the claim.
        - name: hf-cache
          persistentVolumeClaim:
            claimName: genieai-model-cache
        {{- else }}
        - name: hf-cache
          emptyDir: {}
        {{- end }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
spec:
  ports:
    - name: http
      port: {{ .port }}
      targetPort: {{ .port }}
  selector:
    app: {{ .name }}
{{- end -}}
