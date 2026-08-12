#!/bin/sh
# install_site_startup.sh — install the shared GENIE.AI site-startup hook.
#
# Copies genie_ssl_patch.py (and docarray_alias_shim.py, when present) into the
# running interpreter's site-packages and wires them via a ``zz_genie_startup.pth``
# ``import`` line, which Python executes during site initialization (before the
# service main script). This replaces the hardcoded ``sitecustomize.py`` COPY +
# ``rm`` steps in the overlay Dockerfiles: the target path is derived from the
# interpreter (``site.getsitepackages()[0]``), which is stable across Python
# 3.10/3.11/3.12 and across Ubuntu's dist-packages vs Debian's site-packages
# layouts. After installing, every hook is import-verified at build time so a
# broken hook can never ship silently.
#
# OVERRIDE build-patches.install_site_startup | disposition: re-graft-to-new-API | reason: .pth-based startup install replaces hardcoded sitecustomize.py overwrite | test: build-time import guard (install_site_startup.sh fails the build if a hook import errors)  # noqa: E501
set -eu

# Directory containing this script — the Dockerfiles COPY it (and the patch files)
# to /app, so this resolves to /app.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Build-derived site-packages path for the running interpreter.
SITE_PKGS="$(python3 -c 'import site; print(site.getsitepackages()[0])')"
[ -n "${SITE_PKGS}" ] || { echo "install_site_startup: no site-packages dir found" >&2; exit 1; }

cp "${SCRIPT_DIR}/genie_ssl_patch.py" "${SITE_PKGS}/genie_ssl_patch.py"

PTH_IMPORTS="import genie_ssl_patch"
HAS_SHIM=0
if [ -f "${SCRIPT_DIR}/docarray_alias_shim.py" ]; then
    cp "${SCRIPT_DIR}/docarray_alias_shim.py" "${SITE_PKGS}/docarray_alias_shim.py"
    PTH_IMPORTS="${PTH_IMPORTS}
import docarray_alias_shim"
    HAS_SHIM=1
fi

printf '%s\n' "${PTH_IMPORTS}" > "${SITE_PKGS}/zz_genie_startup.pth"

# Build-time verification — every hook must import cleanly or the build fails.
python3 -c 'import genie_ssl_patch'
if [ "${HAS_SHIM}" -eq 1 ]; then
    python3 -c 'import docarray_alias_shim'
fi

echo "installed site startup hook into ${SITE_PKGS}:"
echo "${PTH_IMPORTS}"
