#!/usr/bin/env sh
# Sync curated repo-root docs/ into the Hugo site, sectioned + with front matter.
# Source of truth: <repo>/docs/*.md  ->  site/content/en/docs/<section>/<name>.md
# - Idempotent: rm + recopy each run.
# - Front-matter injection: prepend title/weight if the source has no TOML/YAML FM.
# - Relative-link rewrite: ](./foo.md) -> ](/docs/<section>/foo/);
#   bare ](foo.md) resolved via MAP to its real section (Task 8 fix).
# - Fail-loud: set -eu; missing source = cp error = red CI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DOCS="$(cd "$SITE_DIR/../docs" && pwd)"
DEST="$SITE_DIR/content/en/docs"

# section : weight : source-basename : target-name
MAP="
core:1:project-overview.md:project-overview
core:2:source-tree-analysis.md:source-tree-analysis
core:3:integration-architecture.md:integration-architecture
core:4:development-guide.md:development-guide
frontend:1:ui-component-inventory-gov-chat-frontend.md:ui-component-inventory-frontend
frontend:2:state-management-gov-chat-frontend.md:state-management-frontend
frontend:3:theme-system.md:theme-system
backend:1:api-contracts-gov-chat-backend.md:api-contracts-backend
mobile:1:ui-component-inventory-mobile.md:ui-component-inventory-mobile
mobile:2:mobile-architecture-genie-ai-mobile.md:mobile-architecture
architecture:1:architecture.md:architecture
architecture:2:LOGGING-ARCHITECTURE-EVALUATION.md:logging-architecture
deployment:1:docker-compose-setup.md:docker-compose-setup
deployment:2:docker-swarm-setup.md:docker-swarm-setup
deployment:3:mobile-deployment-guide.md:mobile-deployment-guide
configuration:1:keycloak-admin-guide.md:keycloak-admin-guide
configuration:2:external-idp-integration-guide.md:external-idp-integration-guide
"

inject_front_matter() {
  # $1 = source file, $2 = title, $3 = weight, $4 = section
  if head -1 "$1" | grep -q '^---\|^+++'; then
    cat "$1"   # already has front matter
  else
    printf -- '---\ntitle: "%s"\nweight: %s\nsection: "%s"\n---\n\n' "$2" "$3" "$4"
    cat "$1"
  fi
}

# Build a sed fragment once: for each MAP entry, rewrite bare ](srcname) -> ](/docs/section/tgt/).
# This resolves cross-section bare links (e.g. ](architecture.md) inside deployment docs)
# to the section where the target actually lives, not the source's section.
# Reads MAP without a pipe so the loop body updates survive (no subshell).
BARE_LINK_REWRITE=""
_bare_first=1
_bare_IFS_old="$IFS"
IFS='
'
for _bare_line in $MAP; do
  IFS=: read -r _bare_s _bare_w _bare_src _bare_tgt <<EOF
$_bare_line
EOF
  [ -z "$_bare_s" ] && { continue; }
  if [ "$_bare_first" -eq 1 ]; then
    _bare_src_ere=$(printf "%s" "${_bare_src}" | sed "s#\.#\\.#g")
    BARE_LINK_REWRITE="s#]\(${_bare_src_ere}\)#](/docs/${_bare_s}/${_bare_tgt}/)#g"
    _bare_first=0
  else
    _bare_src_ere=$(printf "%s" "${_bare_src}" | sed "s#\.#\\.#g")
    BARE_LINK_REWRITE="${BARE_LINK_REWRITE};s#]\(${_bare_src_ere}\)#](/docs/${_bare_s}/${_bare_tgt}/)#g"
  fi
done
IFS="$_bare_IFS_old"

rewrite_links() {
  # $1 = target section (for ./ and ../ same-section rewrite).
  # $2 = pre-built bare-link sed fragment (resolves ](foo.md) via the MAP).
  # Order matters: apply bare-link rewrite FIRST so explicit ./ or ../ prefixes
  # are not touched by the bare rule (bare rule requires no leading ./ ../).
  # Bare links: ](Name.md) with no ./ or ../ prefix.
  sed -E -e "$2" \
         -e 's#\]\(\./([a-zA-Z0-9_-]+)\.md\)#](/'"$1"'/\1/)#g' \
         -e 's#\]\(\.\./([a-zA-Z0-9_-]+)\.md\)#](/'"$1"'/\1/)#g'
}

# Remove stale copied docs (*.md except _index.md) but PRESERVE authored landings.
find "$DEST" -type f -name '*.md' ! -name '_index.md' -delete 2>/dev/null || true
echo "$MAP" | while IFS=: read -r section weight src tgt; do
  [ -z "$section" ] && continue
  mkdir -p "$DEST/$section"
  title=$(printf '%s' "$tgt" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++)$i=toupper(substr($i,1,1))substr($i,2)}1')
  inject_front_matter "$REPO_DOCS/$src" "$title" "$weight" "$section" | rewrite_links "$section" "$BARE_LINK_REWRITE" > "$DEST/$section/$tgt.md"
done

echo "Synced $(echo "$MAP" | grep -c ':') docs -> $DEST"
