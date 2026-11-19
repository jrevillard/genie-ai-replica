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
#
# SLIM locks (issue #2000): each model-serving module ALSO ships a
# requirements-slim.txt — the same versions, minus the packages the service
# never imports, and with torch at its CPU build instead of the CUDA build
# PyPI ships (torch==2.13.0 IS the CUDA build; the CPU one is
# torch==2.13.0+cpu, published only on the PyTorch CPU index). The slim
# images are the ones a deployment without a GPU runs; the fat ones keep the
# GPU path alive for the deployments that attach a GPU.

# uv pinned to CI's version (verify:overlay-locks uses uv==0.10.6) so a local
# regen produces a lock CI's pinned uv accepts. Override with `make UV=uv ...`.
UV ?= uvx --from uv==0.10.6 uv

# The PyTorch CPU index, for the slim locks. `--index-strategy
# unsafe-best-match` is REQUIRED: uv's default `first-index` stops at the
# first index that has the package, and PyPI has torch — so it would never
# reach the CPU index's 2.13.0+cpu and the resolution would fail. The lock is
# hash-pinned, so a mirror cannot substitute a different build.
TORCH_CPU_INDEX="--index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match"

.PHONY: lock-retriever lock-reranker lock-retriever-slim lock-reranker-slim \
        lock-dataprep-slim keycloak-theme chart-dashboards

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

# Slim locks — the external-GPU (no-GPU) variant of each model-serving
# image. The reranker's slim lock has NO torch: the service is a pure
# TEI/OVMS client, so it has no local-model path to preserve.
lock-reranker-slim:
	cd genie-ai-overlay/reranker && $(UV) pip compile requirements-slim.in \
	  --generate-hashes \
	  --python-version 3.11 \
	  --python-platform x86_64-manylinux_2_31 \
	  --output-file requirements-slim.txt
	@echo "Lock written to genie-ai-overlay/reranker/requirements-slim.txt"
	@echo "Commit it alongside any requirements-slim.in change."

lock-retriever-slim:
	cd genie-ai-overlay/retriever && $(UV) pip compile requirements-slim.in \
	  --generate-hashes \
	  --python-version 3.11 \
	  --python-platform x86_64-manylinux_2_31 \
	  $(TORCH_CPU_INDEX) \
	  --output-file requirements-slim.txt
	@echo "Lock written to genie-ai-overlay/retriever/requirements-slim.txt"
	@echo "Commit it alongside any requirements-slim.in change."

lock-dataprep-slim:
	cd genie-ai-overlay/dataprep && $(UV) pip compile requirements-slim.in \
	  --generate-hashes \
	  --python-version 3.11 \
	  --python-platform x86_64-manylinux_2_31 \
	  $(TORCH_CPU_INDEX) \
	  --output-file requirements-slim.txt
	@echo "Lock written to genie-ai-overlay/dataprep/requirements-slim.txt"
	@echo "Commit it alongside any requirements-slim.in change."
