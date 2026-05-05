# Mobile Deep Link Verification Files

## IMPORTANT: Customize Before Deployment!

The files in this directory contain **placeholder values** that MUST be replaced with your deployment-specific values before building the nginx Docker image.

### Files to Customize

#### `apple-app-site-association` (iOS Universal Links)

Replace these placeholders:
- `<TEAM_ID>` — Your Apple Developer Team ID (from Apple Developer Portal)
- `<BUNDLE_ID>` — Your app's bundle identifier per flavor (e.g., `com.example.genieAiMobile`)

#### `assetlinks.json` (Android App Links)

Replace these placeholders:
- `<APPLICATION_ID>` — Your Android application ID per flavor (e.g., `com.example.genie_ai_mobile`)
- `<SHA256_FINGERPRINT>` — SHA-256 fingerprint of your app's signing certificate

**Note:** Debug and release certificates have different fingerprints. If you support both, add both fingerprints to the array:

```json
"sha256_cert_fingerprints": [
  "<DEBUG_SHA256_FINGERPRINT>",
  "<RELEASE_SHA256_FINGERPRINT>"
]
```

### How to Get SHA256 Fingerprints

```bash
# Debug certificate (local development)
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA256

# Release certificate
keytool -list -v -keystore <path-to-keystore> -alias <alias> | grep SHA256
```

### After Customization

1. Verify JSON syntax: `cat apple-app-site-association | python3 -m json.tool`
2. Rebuild nginx image: `docker build -t custom-nginx api-gateway-solution/nginx/`
3. Test endpoints:
   ```bash
   curl -s https://<keycloak-domain>/.well-known/assetlinks.json | python3 -m json.tool
   curl -s https://<keycloak-domain>/.well-known/apple-app-site-association | python3 -m json.tool
   ```

### See Also

- [Deployment Guide: Universal Links & App Links](../../../docs/mobile-deployment-guide.md#universal-links--app-links)
- [Apple App Search Validation Tool](https://search.developer.apple.com/appsearch-validation-tool/)
- [Android Asset Links Tester](https://developers.google.com/digital-asset-links/tools/generator)
