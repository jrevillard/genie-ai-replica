.PHONY: lint lint-common lint-umbrella template template-umbrella test test-umbrella docs

CHARTS = genieai-common genieai-umbrella

lint: $(addprefix lint-,$(CHARTS))

lint-common:
	helm lint charts/genieai-common

lint-umbrella: lint-common
	helm lint charts/genieai-umbrella

template: template-umbrella

template-umbrella:
	helm template test charts/genieai-umbrella -n genieai > /tmp/genieai-rendered.yaml

test: test-umbrella

test-umbrella:
	ct install --config charts/ci/ct.yaml --charts charts/genieai-umbrella

docs:
	helm-docs --chart-search-root=charts
