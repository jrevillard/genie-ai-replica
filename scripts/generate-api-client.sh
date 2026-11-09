#!/usr/bin/env bash
# generate-api-client.sh — Generate Dart OpenAPI client from backend source
#
# Usage:
#   ./scripts/generate-api-client.sh              # default output
#   ./scripts/generate-api-client.sh --check      # exit 1 when the committed
#                                                 # client is stale against
#                                                 # the backend spec
#
# Prerequisites:
#   - openapi-generator-cli: npm install -g @openapitools/openapi-generator-cli
#     (the version is pinned in the repository-root openapitools.json — the
#     committed artifacts and the array-file patch below are version-sensitive)
#   - Node.js (for swagger-jsdoc spec extraction)
#   - Backend dependencies: cd components/gov-chat-backend && npm install

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/components/gov-chat-backend"
OUTPUT_DIR="$PROJECT_ROOT/mobile/genie_ai_mobile/openapi_client"
SPEC_FILE="$(mktemp /tmp/genie-openapi.XXXXXX)"
CHECK_DIR=""
trap 'rm -f "$SPEC_FILE"; if [ -n "$CHECK_DIR" ]; then rm -rf "$CHECK_DIR"; fi' EXIT
DIFF_EXCLUDES=(--exclude=.dart_tool --exclude=pubspec.lock --exclude=.openapi-generator-ignore --exclude=.DS_Store)
IGNORE_FILE="$OUTPUT_DIR/.openapi-generator-ignore"

# The openapitools.json version pin next to this script is resolved from the
# working directory by the @openapitools/openapi-generator-cli wrapper.
cd "$PROJECT_ROOT"

# The generate path wipes the output directory, so capture the tracked
# .openapi-generator-ignore up front; prepare_output_dir writes it into
# every fresh output directory (the generator reads it from there and
# honors its patterns).
IGNORE_CONTENT="$(cat "$IGNORE_FILE")"

echo "==> Generating OpenAPI spec from backend source..."
# The spec extraction runs under env -i: the node process sees only the pin
# list below plus PATH/HOME for tooling (the envelope reads neither), so no
# env read anywhere in the envelope, scripts/build-openapi-spec.js, or the
# transitive swagger-definition.js/swagger-schemas.js — present or future —
# can reach the committed artifacts from the invoking shell. Same backend
# sources always regenerate byte-identical artifacts.
# Linux/macOS only: env -i strips what node.exe needs on Windows.
(cd "$BACKEND_DIR" && env -i PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}" HOME="${HOME:-/tmp}" \
  API_URL=https://localhost \
  KEYCLOAK_URL=https://keycloak.example.com/auth KEYCLOAK_REALM=genie \
  node "$PROJECT_ROOT/scripts/build-openapi-spec.js" "$SPEC_FILE"
) || { echo "ERROR: Failed to generate the OpenAPI spec (see the node error above;"; echo "       for module-not-found errors, run 'npm install' in $BACKEND_DIR)"; exit 1; }

# generate_client <output-dir> — run the generator into the given directory.
# Single definition so the generate and --check paths cannot drift apart.
generate_client() {
  openapi-generator-cli generate \
    -i "$SPEC_FILE" \
    -g dart \
    -o "$1" \
    --skip-validate-spec \
    --additional-properties=usePathUri=true,nullableFields=true
}

# prepare_output_dir <dir> — the generator reads .openapi-generator-ignore
# from the output directory, so place the tracked file there BEFORE
# generation: its patterns are honored, and the file survives the run.
prepare_output_dir() {
  mkdir -p "$1"
  printf '%s\n' "$IGNORE_CONTENT" > "$1/.openapi-generator-ignore"
}

# assert_dart_output_layout <output-dir> — the patch functions read a fixed
# dart output layout (lib/api/, README.md, doc/); a generator that changes
# it must abort here with one explanatory message, not crash inside a patch
# block (or silently no-op where a missing path makes a guard falsy). Call
# ONCE after generate_client, before any patch runs.
assert_dart_output_layout() {
  for required in "$1/lib/api" "$1/README.md" "$1/doc"; do
    if [ ! -e "$required" ]; then
      echo "ERROR: the generator produced no $required — the dart output"
      echo "       layout changed; inspect the output and update this"
      echo "       script."
      exit 1
    fi
  done
}

# patch_client <output-dir> — the dart generator emits non-compiling Dart for
# an array-of-binary property in a multipart requestBody (verified on 7.22.0
# and 7.26.0): for `List<MultipartFile> files` it writes
#   mp.fields[r'files'] = files.field;   # List<MultipartFile> has no .field
#   mp.files.add(files);                 # adds the LIST, not its elements
# Patch the pair to what the generator itself emitted for years
# (mp.files.addAll(files)). No-op once upstream emits the correct form again.
patch_client() {
  node -e "
const fs = require('fs');
const path = require('path');
const dir = process.argv[1];
for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f);
  const src = fs.readFileSync(p, 'utf8');
  const fixed = src.replace(
    /(\s*)mp\.fields\[r'[^']+'\] = (\w+)\.field;\n\s*mp\.files\.add\(\2\);/g,
    (m, indent, variable) => indent + 'mp.files.addAll(' + variable + ');'
  );
  if (fixed !== src) {
    fs.writeFileSync(p, fixed);
    console.log('    patched ' + f);
  }
}
" "$1/lib/api"

  # The patch above matches an exact emission shape; if a future generator
  # version changes it, regeneration would silently produce a client that
  # does not compile again. Fail loudly instead.
  if grep -rn '\.field;' "$1/lib/api" > /dev/null 2>&1; then
    echo "ERROR: the generated client still contains a '.field' emission the"
    echo "       patch block did not recognize — the generator's output shape"
    echo "       changed; inspect lib/api and update patch_client."
    exit 1
  fi
}

# patch_markdown <output-dir> — the dart generator's README and per-API doc
# templates (dart2/README.mustache, dart2/api_doc.mustache) emit an auth
# snippet for an OAuth2 scheme:
#   //defaultApiClient.getAuthentication<OAuth>('KeycloakOAuth2').accessToken = ...
# The generated ApiClient has NO getAuthentication method (7.22.0 and 7.26.0
# alike): its authentication is a final field, constructor-injected
# (`ApiClient(authentication: OAuth(...))`), and the API classes take that
# client (`AdminApi(api_client)`). A developer who follows the snippet gets a
# compile error and no working alternative in the artifact. Rewrite the pair
# into the form the generated API actually offers — the client the API class
# takes, with the token on it.
patch_markdown() {
  node -e "
const fs = require('fs');
const path = require('path');
const dir = process.argv[1];
const md = fs.readdirSync(dir, {recursive: true})
  .filter((f) => f.endsWith('.md'))
  .map((f) => path.join(dir, f));
for (const p of md) {
  const src = fs.readFileSync(p, 'utf8');
  const fixed = src.replace(
    /\/\/ TODO Configure OAuth2 access token for authorization: \w+\n\/\/defaultApiClient\.getAuthentication<OAuth>\('\w+'\)\.accessToken = 'YOUR_ACCESS_TOKEN';\n\nfinal api_instance = (\w+)\(\);/g,
    (m, apiClass) =>
      \"final api_client = ApiClient(authentication: OAuth(accessToken: 'YOUR_ACCESS_TOKEN'));\n\n\" +
      'final api_instance = ' + apiClass + '(api_client);'
  );
  if (fixed !== src) {
    fs.writeFileSync(p, fixed);
    console.log('    patched ' + path.relative(dir, p));
  }
}
" "$1" || {
    echo "ERROR: the markdown patch block failed (see the node error above;)"
    echo "       for module-not-found errors, check the node installation."
    exit 1
  }

  # The patch above matches an exact emission shape; if a future generator
  # version changes it, the broken snippet would ship again unnoticed. Fail
  # loudly instead. The grep covers the SAME set the patch walks (every
  # *.md under the output dir — --include='*.md' keeps a generated Dart
  # method legitimately named getAuthentication from tripping it).
  if grep -rn --include='*.md' 'getAuthentication' "$1" > /dev/null 2>&1; then
    echo "ERROR: the generated docs still contain a 'getAuthentication'"
    echo "       snippet the patch block did not recognize — the generator's"
    echo "       output shape changed; inspect the docs and update"
    echo "       patch_markdown."
    exit 1
  fi
}

if [ "${1:-}" = "--check" ]; then
  CHECK_DIR="$(mktemp -d)"
  prepare_output_dir "$CHECK_DIR"
  generate_client "$CHECK_DIR"
  assert_dart_output_layout "$CHECK_DIR"
  patch_client "$CHECK_DIR"
  patch_markdown "$CHECK_DIR"
  if diff -r "${DIFF_EXCLUDES[@]}" "$CHECK_DIR" "$OUTPUT_DIR" > /dev/null; then
    echo "==> Client is up to date with the backend spec"
    exit 0
  fi
  echo "ERROR: the committed client is stale against the backend spec."
  echo "       Run ./scripts/generate-api-client.sh and commit the result."
  echo "       (Local dartdoc or build output inside openapi_client/ (doc/api,"
  echo "       build/) also shows up as drift — it is gitignored, remove it.)"
  diff -rq "${DIFF_EXCLUDES[@]}" "$CHECK_DIR" "$OUTPUT_DIR" | head -20 || true
  exit 1
fi

echo "==> Generating Dart client..."
rm -rf "$OUTPUT_DIR"
prepare_output_dir "$OUTPUT_DIR"
generate_client "$OUTPUT_DIR"
assert_dart_output_layout "$OUTPUT_DIR"

echo "==> Patching the dart generator's array-file emission (upstream bug)..."
patch_client "$OUTPUT_DIR"

echo "==> Patching the dart generator's auth snippets (upstream bug)..."
patch_markdown "$OUTPUT_DIR"

echo "==> Done. Client generated in $OUTPUT_DIR"
echo "    Endpoints: $(grep -c "^  Future<Response>" "$OUTPUT_DIR"/lib/api/*.dart 2>/dev/null || echo '?')"
