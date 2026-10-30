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
#   - Node.js (for swagger-jsdoc spec extraction)
#   - Backend dependencies: cd components/gov-chat-backend && npm install

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/components/gov-chat-backend"
OUTPUT_DIR="$PROJECT_ROOT/mobile/genie_ai_mobile/openapi_client"
SPEC_FILE="/tmp/genie-openapi.json"
DIFF_EXCLUDES=(--exclude=.dart_tool --exclude=pubspec.lock)

echo "==> Generating OpenAPI spec from backend source..."
(cd "$BACKEND_DIR" && node -e "
const swaggerJsdoc = require('swagger-jsdoc');
const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Government Services API',
      version: '1.0.0',
      description: 'API documentation for Government Services microservices'
    },
    servers: [{ url: 'https://localhost', description: 'Default' }],
    components: { schemas: require('./swagger-schemas') }
  },
  apis: ['./routes/*.js']
});
require('fs').writeFileSync('$SPEC_FILE', JSON.stringify(spec, null, 2));
const count = Object.keys(spec.paths).length;
console.log('Generated ' + count + ' endpoints');
") || { echo "ERROR: Failed to generate spec. Run 'npm install' in $BACKEND_DIR"; exit 1; }

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

if [ "${1:-}" = "--check" ]; then
  CHECK_DIR="$(mktemp -d)"
  generate_client "$CHECK_DIR"
  patch_client "$CHECK_DIR"
  if diff -r "${DIFF_EXCLUDES[@]}" "$CHECK_DIR" "$OUTPUT_DIR" > /dev/null; then
    echo "==> Client is up to date with the backend spec"
    rm -rf "$CHECK_DIR"
    exit 0
  fi
  echo "ERROR: the committed client is stale against the backend spec."
  echo "       Run ./scripts/generate-api-client.sh and commit the result."
  diff -rq "${DIFF_EXCLUDES[@]}" "$CHECK_DIR" "$OUTPUT_DIR" | head -20 || true
  rm -rf "$CHECK_DIR"
  exit 1
fi

echo "==> Generating Dart client..."
# The generator wipes the output directory; .openapi-generator-ignore is
# tracked in git and must survive the regeneration.
IGNORE_FILE="$OUTPUT_DIR/.openapi-generator-ignore"
IGNORE_CONTENT="$(cat "$IGNORE_FILE")"
rm -rf "$OUTPUT_DIR"

generate_client "$OUTPUT_DIR"
printf '%s\n' "$IGNORE_CONTENT" > "$IGNORE_FILE"

echo "==> Patching the dart generator's array-file emission (upstream bug)..."
patch_client "$OUTPUT_DIR"

echo "==> Done. Client generated in $OUTPUT_DIR"
echo "    Endpoints: $(grep -c "^  Future<Response>" "$OUTPUT_DIR"/lib/api/*.dart 2>/dev/null || echo '?')"
