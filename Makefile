# GENIE.AI — convenience targets for Python dependency management.
# See genie-ai-overlay/dataprep/scripts/ and GitLab issue #834.
#
# NOTE: these targets exist only because OPEA v1.3 ships an unpinned
# requirements.txt. OPEA v1.4+ ships its own uv-compiled lock — on bumping
# OPEA past v1.3 these targets + requirements.in/.lock should be retired.
# See _bmad-output/implementation-artifacts/deferred-work.md (issue-834).

UV ?= uv

.PHONY: requirements-in-dataprep lock-dataprep

# Regenerate requirements.in from the pinned OPEA tag's requirements.txt.
# Run when bumping OPEA_VERSION in the Dockerfile. Accepts an optional tag arg:
#   make requirements-in-dataprep OPEA_TAG=v1.4
requirements-in-dataprep:
	bash genie-ai-overlay/dataprep/scripts/generate-requirements-in.sh $(OPEA_TAG)

# Compile the hash-pinned lock from requirements.in. Targets the same platform
# as the dataprep Docker image (Python 3.10 / manylinux_2_31 ≈ Ubuntu 22.04).
lock-dataprep:
	cd genie-ai-overlay/dataprep && $(UV) pip compile requirements.in \
	  --generate-hashes \
	  --python-platform x86_64-manylinux_2_31 \
	  --python-version 3.10 \
	  --output-file requirements.lock
	@echo "Lock written to genie-ai-overlay/dataprep/requirements.lock"
	@echo "Commit it alongside any requirements.in change."
