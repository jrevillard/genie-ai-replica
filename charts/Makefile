.PHONY: lint lint-common lint-umbrella template template-umbrella deps test test-umbrella docs

# Short chart names — target suffixes must match the rules below.
CHARTS = common umbrella
CT_FLAGS = --config ci/ct.yaml --chart-yaml-schema ci/chart_schema.yaml --lint-conf ci/lintconf.yaml

deps:
	helm dependency update genieai-umbrella

lint: $(addprefix lint-,$(CHARTS))

lint-common:
	helm lint genieai-common --strict

lint-umbrella: lint-common
	helm lint genieai-umbrella --strict

template: template-umbrella

template-umbrella:
	helm template test genieai-umbrella -n genieai > /tmp/genieai-rendered.yaml

test: test-umbrella

test-umbrella:
	ct install $(CT_FLAGS) --charts genieai-umbrella --kube-version 1.33.0

docs:
	helm-docs --chart-search-root=.
