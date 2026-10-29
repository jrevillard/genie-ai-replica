# GENIE.AI — convenience targets for Python dependency management.
#
# The overlay modules adopt OPEA v1.5's compiled-lock layout: each module's
# requirements.in is a GENIE.AI fork of OPEA's, and `uv pip compile` produces
# the hash-pinned requirements-cpu.txt that the module Dockerfiles install
# with `pip install --require-hashes`. See genie-ai-overlay/<module>/requirements.in.
#
# Note: dataprep's requirements.in was retired on the v1.5 bump (issue-834 lock
# pipeline no longer needed — OPEA v1.5 ships a compiled requirements-cpu.txt
# that the dataprep Dockerfile consumes directly).

# uv pinned to CI's version (verify:overlay-locks uses uv==0.10.6) so a local
# regen produces a lock CI's pinned uv accepts. Override with `make UV=uv ...`.
UV ?= uvx --from uv==0.10.6 uv

.PHONY: lock-retriever lock-reranker keycloak-theme chart-dashboards

# Repack charts/genieai-assets/files/keycloak-themes.tgz from
# configs/keycloak/themes. Run after ANY theme edit; CI (chart:lint)
# fails the pipeline when the committed tarball drifts from the source
# tree.
keycloak-theme:
	./scripts/regen-keycloak-theme.sh

# Copy the Grafana dashboards and the alert rules from
# configs/grafana/provisioning into the chart, which inlines them into
# GrafanaDashboard / GrafanaAlertRule CRs. Run after ANY dashboard edit;
# CI (chart:lint) fails the pipeline when the committed copy drifts from
# the source tree, or when the template's dashboard list no longer
# matches the files on disk.
chart-dashboards:
	./scripts/sync-chart-dashboards.sh

lock-retriever:
	cd genie-ai-overlay/retriever && $(UV) pip compile requirements.in \
	  --generate-hashes \
	  --python-version 3.11 \
	  --python-platform x86_64-manylinux_2_31 \
	  --output-file requirements-cpu.txt
	@echo "Lock written to genie-ai-overlay/retriever/requirements-cpu.txt"
	@echo "Commit it alongside any requirements.in change."

lock-reranker:
	cd genie-ai-overlay/reranker && $(UV) pip compile requirements.in \
	  --generate-hashes \
	  --python-version 3.11 \
	  --python-platform x86_64-manylinux_2_31 \
	  --output-file requirements-cpu.txt
	@echo "Lock written to genie-ai-overlay/reranker/requirements-cpu.txt"
	@echo "Commit it alongside any requirements.in change."
