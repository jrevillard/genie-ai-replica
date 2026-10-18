#!/usr/bin/env sh
# Regenerate charts/genieai-umbrella/files/keycloak-themes.tgz from
# configs/keycloak/themes (the single theme source, shared with the
# compose/Ansible path since #998).
#
# The tarball is REPRODUCIBLE: name-sorted entries, mtime/owner pinned to
# zero, gzip without timestamp. Two checkouts of the same tree produce
# byte-identical output, so CI can guard drift with a plain `cmp` — same
# contract as the genie-realm.yaml copy in chart:lint.
#
# Called by `make keycloak-theme` and by the CI chart:lint drift guard.
# Requires GNU tar (alpine: `apk add tar`; busybox tar lacks --sort/--mtime).
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
src="${repo_root}/configs/keycloak"
out="${repo_root}/charts/genieai-umbrella/files/keycloak-themes.tgz"

[ -d "${src}/themes/genie" ] || {
  echo "missing ${src}/themes/genie — run from a full checkout" >&2
  exit 1
}

mkdir -p "$(dirname -- "${out}")"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -C "${src}" -cf - themes | gzip -n > "${out}"

echo "written ${out} ($(wc -c < "${out}") bytes)"
echo "commit it alongside any configs/keycloak/themes change."
