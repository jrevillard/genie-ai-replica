#!/bin/sh
# Realm contract check (A2) — re-runnable, no framework: grep/awk + stub runs.
# Asserts:
#   (a) every $(env:VAR) referenced in genie-realm.yaml has a passthrough entry
#       in the keycloak-config environment block of docker-compose.yaml
#   (b) the 5 app clientIds are declared in genie-realm.yaml
#   (c) no banned strings (hardcoded hosts / IdP config) under configs/keycloak
#   (d) config-and-sleep.sh semantics: assert fires on unset/CHANGE_ME secrets;
#       failing java + no-op sleep stubs → exit 1 after exactly 10 attempt lines
# Exit 0 = all green.
set -u

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
realm="$here/genie-realm.yaml"
importer="$here/config-and-sleep.sh"
compose="$root/docker-compose.yaml"

fails=0
fail() { echo "FAIL: $1" >&2; fails=$((fails + 1)); }
pass() { echo "ok: $1"; }

# --- (a) yaml env-refs <-> compose passthrough --------------------------------
block=$(awk '/^  keycloak-config:/{f=1;next} /^  [A-Za-z0-9_-]+:/{f=0} f' "$compose")
if [ -n "$block" ]; then
  pass "keycloak-config service block found in docker-compose.yaml"
else
  fail "keycloak-config service block not found in docker-compose.yaml"
fi
for var in $(grep -oE '\$\(env:[A-Z0-9_]+\)' "$realm" | cut -d: -f2 | tr -d '()' | sort -u); do
  if printf '%s\n' "$block" | grep -qE "^[[:space:]]*- ${var}="; then
    pass "passthrough: $var"
  else
    fail "genie-realm.yaml references \$(env:$var) but keycloak-config has no '$var=' passthrough"
  fi
done

# --- (b) the 5 app clients ----------------------------------------------------
for pat in \
  'clientId: $(env:KC_CLIENT_ID)' \
  'clientId: genie-proxy-client' \
  'clientId: dataprep-service-client' \
  'clientId: $(env:KC_MOBILE_CLIENT_ID)' \
  'clientId: $(env:KC_GRAFANA_CLIENT_ID)'
do
  if grep -qF "$pat" "$realm"; then
    pass "client declared: $pat"
  else
    fail "genie-realm.yaml is missing client entry '$pat'"
  fi
done

# --- (c) no hardcoded hosts / IdP config under configs/keycloak ---------------
# Bracketed patterns so this script's own text never matches itself.
if grep -rn -e 'local[h]ost' -e 'itu[.]int' -e 'identityProvide[r]s' "$here" 2>/dev/null; then
  fail "banned string (hardcoded host / IdP config) found under configs/keycloak (see hits above)"
else
  pass "no hardcoded hosts / IdP config under configs/keycloak"
fi

# --- (d) config-and-sleep.sh: assert + retry semantics ------------------------
SECRETS="KEYCLOAK_PASSWORD=k KC_PROXY_CLIENT_SECRET=k KC_DATAPREP_CLIENT_SECRET=k KC_GRAFANA_CLIENT_SECRET=k GENIE_ADMIN_PASSWORD=k"

out=$(env -i sh "$importer" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -q 'Required environment variable'; then
  pass "assert fires on unset secrets (exit=$rc)"
else
  fail "assert did not fire on unset secrets (exit=$rc)"
fi

out=$(env -i KEYCLOAK_PASSWORD=CHANGE_ME KC_PROXY_CLIENT_SECRET=x KC_DATAPREP_CLIENT_SECRET=x \
  KC_GRAFANA_CLIENT_SECRET=x GENIE_ADMIN_PASSWORD=x sh "$importer" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -q 'Required environment variable'; then
  pass "assert fires on CHANGE_ME secrets (exit=$rc)"
else
  fail "CHANGE_ME secrets passed the assert (exit=$rc)"
fi

stub=$(mktemp -d)
trap 'rm -rf "$stub"' EXIT
printf '#!/bin/sh\nexit 1\n' > "$stub/java"
printf '#!/bin/sh\nexit 0\n' > "$stub/sleep"
chmod +x "$stub/java" "$stub/sleep"
# eval "$SECRETS" below expands the five non-empty secret assignments for the happy-path assert
out=$(eval "env -i PATH=\"$stub:/usr/bin:/bin\" $SECRETS timeout 120 sh \"$importer\"" 2>&1); rc=$?
attempts=$(printf '%s\n' "$out" | grep -c '^Attempt [0-9]*/10:')
if [ "$rc" -ne 0 ] && [ "$attempts" -eq 10 ]; then
  pass "retry loop: exit=$rc after exactly $attempts attempts"
else
  fail "retry loop wrong (exit=$rc, attempts=$attempts)"
fi

# --- (e) DEC-32c agrivisory login-theme contract --------------------------------
# loginTheme is pinned (not env-driven) and the theme actually ships; the
# mount must be the plain themes dir (--theme-dir is NOT a KC 26 option).
if grep -q '^loginTheme: agrivisory$' "$realm"; then
  pass "loginTheme pinned to agrivisory"
else
  fail "loginTheme not pinned to agrivisory in genie-realm.yaml"
fi
for f in login/theme.properties login/resources/css/agrivisory.css; do
  if [ -f "$here/themes/agrivisory/$f" ]; then
    pass "theme file ships: agrivisory/$f"
  else
    fail "theme file missing: agrivisory/$f"
  fi
done
if grep -q '^parent=keycloak.v2$' "$here/themes/agrivisory/login/theme.properties"; then
  pass "theme parents keycloak.v2 (no template override)"
else
  fail "agrivisory theme.properties parent is not keycloak.v2"
fi
if grep -q "configs/keycloak/themes:/opt/keycloak/themes:ro" docker-compose.yaml \
   && ! grep -q -- "--theme-dir " docker-compose.yaml; then
  pass "compose mounts themes at /opt/keycloak/themes (no dir flag)"
else
  fail "keycloak theme mount wrong or theme-dir flag present (KC 26 rejects it)"
fi
if grep -q "^displayNameHtml: ''$" "$realm" && grep -q '#kc-header {' "$here/themes/agrivisory/login/resources/css/agrivisory.css" && grep -A 1 '#kc-header {' "$here/themes/agrivisory/login/resources/css/agrivisory.css" | grep -q 'display: none'; then
  pass "login page = card only (header hidden; displayNameHtml pinned empty)"
else
  fail "brand header not fully removed (displayNameHtml or #kc-header CSS)"
fi

# --- verdict ------------------------------------------------------------------
if [ "$fails" -eq 0 ]; then
  echo "realm contract: ALL OK"
  exit 0
fi
echo "realm contract: $fails failure(s)" >&2
exit 1
