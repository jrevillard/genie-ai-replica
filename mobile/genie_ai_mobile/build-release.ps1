param(
  # Build flavor. Both the --flavor flag and the FLAVOR dart-define are set
  # from it: without the define the app falls back to the dev configuration
  # (localhost endpoints, trust-all TLS client armed).
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Flavor
)

# The dev and e2e flavors enable the trust-all TLS client, so a release built
# from them would ship an app that accepts any certificate. Per-institution
# flavors are allowed: each deployment adds its own flavor file.
if ($Flavor -in @('dev', 'e2e')) {
  Write-Error "Refusing to build a release from the '$Flavor' flavor: it arms the trust-all TLS client. Use the institution's own flavor instead."
  exit 1
}

Write-Host "--- KILLING ZOMBIE PROCESSES ---" -ForegroundColor Red
taskkill /F /IM java.exe 2>$null
taskkill /F /IM dart.exe 2>$null
taskkill /F /IM flutter.bat 2>$null

Write-Host "--- CLEANING PROJECT ---" -ForegroundColor Yellow
flutter clean

Write-Host "--- BUILDING RELEASE APK ($Flavor) ---" -ForegroundColor Green
# Added --no-tree-shake-icons to prevent the icon error
flutter build apk --flavor $Flavor --release --no-tree-shake-icons --dart-define=FLAVOR=$Flavor

Write-Host "--- DONE ---" -ForegroundColor Cyan
