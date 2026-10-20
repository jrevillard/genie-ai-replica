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
# target is unusable without them — it rendered nothing but the error
# "ingress.host is required" while charts/README.md presented it as THE
# render gate. The values below are render-only (the placeholder guard is
# off for the same reason); nothing here reaches a cluster.
template-umbrella: deps
	helm template test genieai-umbrella -n genieai \
		--set data.keycloak.failOnPlaceholderSecrets=false \
		--set data.keycloak.adminEmail=ci-render@example.org \
		--set ingress.host=ci-render.local > /tmp/genieai-rendered.yaml

test: test-umbrella

test-umbrella: deps
	# The K8s version pin is the kind NODE IMAGE (kindest/node:v1.33.0),
	# created by CI or by hand BEFORE this target runs. ct has NO
	# --kube-version flag and NO kubeVersion config key (verified against
	# chart-testing v3.15.0 source — both were fabrications).
	ct install $(CT_FLAGS) --charts genieai-umbrella --set data.keycloak.failOnPlaceholderSecrets=false

# Advisory only: the chart READMEs are hand-written (curated usage docs,
# not helm-docs output). Running plain `helm-docs` would OVERWRITE them
# with generated stubs — this target only prints what regeneration WOULD
# change and never writes to the working tree.
docs-check:
	helm-docs --chart-search-root=. --dry-run
