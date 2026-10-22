#!/usr/bin/env sh
# Regenerate charts/genieai-umbrella/files/keycloak-themes.tgz from
# configs/keycloak/themes (the single theme source, shared with the
# compose/Ansible path since #998).
#
# The tarball is REPRODUCIBLE: name-sorted entries, mtime/owner pinned to
# zero, gzip without timestamp — two checkouts of the same tree produce
# the same member listing and the same member contents.
#
# Called by `make keycloak-theme` and by the CI chart:lint drift guard.
# Optional $1 overrides the output path (CI regenerates to a temp file
# and compares the member listing + concatenated contents by HASH, not
# by `cmp` on the .tgz — gzip output legitimately differs a few bytes
# between gzip versions).
# Requires GNU tar (alpine: `apk add tar`; busybox tar lacks --sort/--mtime).
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
src="${repo_root}/configs/keycloak"
out="${1:-${repo_root}/charts/genieai-umbrella/files/keycloak-themes.tgz}"

[ -d "${src}/themes/genie" ] || {
  echo "missing ${src}/themes/genie — run from a full checkout" >&2
  exit 1
}

mkdir -p "$(dirname -- "${out}")"
# LC_ALL=C pins the sort order regardless of runner locale (non-ASCII
# filenames would otherwise sort differently per environment).
LC_ALL=C tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -C "${src}" -cf - themes | gzip -n > "${out}"

echo "written ${out} ($(wc -c < "${out}") bytes)"
echo "commit it alongside any configs/keycloak/themes change."
