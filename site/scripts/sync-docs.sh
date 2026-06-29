#!/usr/bin/env sh
# Sync curated repo-root docs/ into the Hugo site content.
# Source of truth: <repo>/docs/*.md  ->  site/content/en/docs/<name>.md
#
# This is an allowlist, not a blanket copy: only listed docs are published.
# A missing source file makes `cp` fail loudly (red CI), never a silent empty page.
# Add a line to publish a new doc; remove a line to unpublish.
set -eu

# Resolve repo root (parent of site/), independent of caller cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DOCS="$(cd "$SITE_DIR/../docs" && pwd)"
DEST="$SITE_DIR/content/en/docs"

mkdir -p "$DEST"

# <source>             <target-name>
cp "$REPO_DOCS/architecture.md"             "$DEST/architecture.md"
cp "$REPO_DOCS/docker-compose-setup.md"     "$DEST/deploy.md"
cp "$REPO_DOCS/docker-swarm-setup.md"       "$DEST/deploy-swarm.md"
cp "$REPO_DOCS/integration-architecture.md" "$DEST/integration.md"
cp "$REPO_DOCS/database-migrations.md"      "$DEST/database-migrations.md"

echo "Synced docs -> $DEST"
