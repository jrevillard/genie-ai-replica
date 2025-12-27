Write-Host "--- KILLING ZOMBIE PROCESSES ---" -ForegroundColor Red
taskkill /F /IM java.exe 2>$null
taskkill /F /IM dart.exe 2>$null
taskkill /F /IM flutter.bat 2>$null

Write-Host "--- CLEANING PROJECT ---" -ForegroundColor Yellow
flutter clean

Write-Host "--- BUILDING RELEASE APK ---" -ForegroundColor Green
# Added --no-tree-shake-icons to prevent the icon error
flutter build apk --no-tree-shake-icons

Write-Host "--- DONE ---" -ForegroundColor Cyan