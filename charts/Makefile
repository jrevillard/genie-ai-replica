.PHONY: lint lint-common lint-umbrella template template-umbrella deps test test-umbrella docs-check

# Short chart names — target suffixes must match the rules below.
CHARTS = common umbrella
CT_FLAGS = --config ci/ct.yaml --chart-yaml-schema ci/chart_schema.yaml --lint-conf ci/lintconf.yaml

deps:
	helm dependency update genieai-umbrella

lint: $(addprefix lint-,$(CHARTS))

lint-common:
	helm lint genieai-common --strict

lint-umbrella: lint-common deps
	helm lint genieai-umbrella --strict

template: template-umbrella

# ingress.host and data.keycloak.adminEmail are `required`, so this
# target is unusable without them — it once rendered nothing but the
# error "ingress.host is required" while charts/README.md presented it
# as THE render gate; the mail flags broke the same way later.
# Same fixture CI's chart:* jobs expand (charts/ci/render-base-flags —
# restated here because a make recipe cannot portably $(cat) it):
# required deployment data, the placeholder guard off, an smtp that
# answers nothing. Render-only values; nothing here reaches a cluster.
RENDER_FLAGS = --set data.keycloak.failOnPlaceholderSecrets=false \
	--set data.keycloak.adminEmail=ci-render@example.org \
	--set data.keycloak.smtp.from=no-reply@ci.invalid \
	--set data.keycloak.smtp.host=smtp.invalid \
	--set data.keycloak.smtp.port=587 \
	--set data.keycloak.smtp.starttls=true \
	--set ingress.host=ci-render.local

template-umbrella: deps
	helm template test genieai-umbrella -n genieai $(RENDER_FLAGS) > /tmp/genieai-rendered.yaml

test: test-umbrella

test-umbrella: deps
	# The K8s version pin is the kind NODE IMAGE (kindest/node:v1.33.0),
	# created by CI or by hand BEFORE this target runs. ct has NO
	# --kube-version flag and NO kubeVersion config key (verified against
	# chart-testing v3.15.0 source — both were fabrications).
	ct install $(CT_FLAGS) --charts genieai-umbrella $(RENDER_FLAGS)

# Advisory only: the chart READMEs are hand-written (curated usage docs,
# not helm-docs output). Running plain `helm-docs` would OVERWRITE them
# with generated stubs — this target only prints what regeneration WOULD
# change and never writes to the working tree.
docs-check:
	helm-docs --chart-search-root=. --dry-run
