# GENIE.AI — convenience targets for Python dependency management.
#
# The overlay modules adopt OPEA v1.5's compiled-lock layout: each module's
# requirements.in is a GENIE.AI fork of OPEA's, and `uv pip compile` produces
# the hash-pinned requirements-cpu.txt that the module Dockerfiles install
# with `pip install --require-hashes`. See genie-ai-overlay/<module>/requirements.in.

# uv pinned to CI's version (verify:dataprep-lock uses uv==0.10.6) so a local
# regen produces a lock CI's pinned uv accepts. Override with `make UV=uv ...`.
UV ?= uvx --from uv==0.10.6 uv

.PHONY: lock-dataprep lock-retriever lock-reranker

# Compile the hash-pinned lock from requirements.in, targeting Python 3.11
# (matches the python:3.11-slim base images). Run after editing requirements.in
# and commit the regenerated requirements-cpu.txt alongside it.
lock-dataprep:
	cd genie-ai-overlay/dataprep && $(UV) pip compile requirements.in \
	  --generate-hashes \
	  --python-version 3.11 \
	  --python-platform x86_64-manylinux_2_31 \
	  --output-file requirements-cpu.txt
	@echo "Lock written to genie-ai-overlay/dataprep/requirements-cpu.txt"
	@echo "Commit it alongside any requirements.in change."

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
