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

# ct install takes NONE of lint's schema flags (--chart-yaml-schema and
# --lint-conf are `ct lint` only), has no --set (values go through
# --helm-extra-set-args as ONE quoted string), and has no kube-version
# knob at all (verified against chart-testing v3.15.0 — both the flags
# and the kube-version were earlier fabrications). The K8s version pin
# is the kind NODE IMAGE (kindest/node:v1.33.0), created by CI or by
# hand BEFORE this target runs.
#
# The data-tier disable flags travel HERE, not only in ci/ct.yaml: a
# --helm-extra-set-args on the command line REPLACES the config value
# (viper — a bound flag set on the CLI wins over the config file), so
# repeating only RENDER_FLAGS left ct install rendering the Keycloak CR
# + CNPG Cluster + ArangoDeployment onto a bare kind cluster with none
# of their CRDs installed — `no matches for kind "Keycloak"` on every
# run of this target.
TIER_DISABLE = --set data.postgres.enabled=false --set data.arangodb.enabled=false --set data.keycloak.enabled=false
CT_INSTALL_FLAGS = --config ci/ct.yaml --helm-extra-set-args "$(TIER_DISABLE) $(RENDER_FLAGS)"

# KUBECONFIG isolation: ct install creates AND DELETES its own kind
# cluster, and kind rewrites the kubeconfig file named by KUBECONFIG —
# run bare, it clobbered ~/.kube/config (the minikube context vanished,
# current-context emptied). A throwaway file keeps kind's rewrite away
# from the operator's real kubeconfig; it is removed on every exit path.
test-umbrella: deps
	kcfg=$$(mktemp); \
	KUBECONFIG="$$kcfg" ct install $(CT_INSTALL_FLAGS) --charts genieai-umbrella; \
	status=$$?; rm -f "$$kcfg"; exit $$status

# Advisory only: the chart READMEs are hand-written (curated usage docs,
# not helm-docs output). Running plain `helm-docs` would OVERWRITE them
# with generated stubs — this target only prints what regeneration WOULD
# change and never writes to the working tree.
docs-check:
	helm-docs --chart-search-root=. --dry-run
