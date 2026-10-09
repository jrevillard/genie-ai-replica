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

template-umbrella: deps
	helm template test genieai-umbrella -n genieai > /tmp/genieai-rendered.yaml

test: test-umbrella

test-umbrella: deps
	# The K8s version pin is the kind NODE IMAGE (kindest/node:v1.33.0),
	# created by CI or by hand BEFORE this target runs. ct has NO
	# --kube-version flag and NO kubeVersion config key (verified against
	# chart-testing v3.15.0 source — both were fabrications).
	ct install $(CT_FLAGS) --charts genieai-umbrella

# Advisory only: the chart READMEs are hand-written (curated usage docs,
# not helm-docs output). Running plain `helm-docs` would OVERWRITE them
# with generated stubs — this target only prints what regeneration WOULD
# change and never writes to the working tree.
docs-check:
	helm-docs --chart-search-root=. --dry-run
