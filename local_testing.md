# Local Testing Session — Startup Guide

Everything needed to test auth + notifications locally with **no AI components**
(never boot the full `index.js` on this machine — its translation service loads
a 600 MB model). Harness scripts live in `local-testing/` (untracked).

## 0. One-time prerequisites (already done on this machine)

- `npm install` in `components/gov-chat-backend`, `components/gov-chat-frontend`,
  `components/shared/lib`
- Symlink (recreate if a git reset removed it):
  `ln -sfn ../shared/lib components/gov-chat-backend/shared-lib`
- Firebase service account at `.secrets/firebase-service-account.json` (gitignored)
- Flutter JDK: `flutter config --jdk-dir ~/develop/jdk-21.0.12.1+1`
- Android AVD `genie_test` exists

## 1. Docker containers

```bash
docker start genie-test-arango genie-test-redis genie-keycloak
```

| Container | Port | Credentials / notes |
|---|---|---|
| `genie-test-arango` | 8529 | `root` / `test`, db `node-services` (web UI: http://localhost:8529) |
| `genie-test-redis` | 6379 | password `testredis` (BullMQ on db 1) |
| `genie-keycloak` | 8081 | admin console `admin` / `kcadmin123` — realm `genie`, client `genie-app` (ROPC on), 24 h access tokens |

**Test login for both apps: `admin` / `Admin@12345`** (lives in Keycloak; maps
to Arango user `1162`).

## 2. Backend harness (auth + users + notifications, port 3000)

```bash
cd ~/Documents/genie-ai-replica
FCM_TRANSPORT=real \
GOOGLE_APPLICATION_CREDENTIALS=$PWD/.secrets/firebase-service-account.json \
NODE_PATH=$PWD/components/gov-chat-backend/node_modules \
node local-testing/keycloak-harness.js
```

- Health: `curl http://localhost:3000/api/health` → `{"mode":"keycloak-same-branch"}`
- Notification health (secret `local-test-secret`):
  `curl -H "x-notification-secret: local-test-secret" http://localhost:3000/api/notifications/health`
- `FCM_TRANSPORT=mock` for load tests (no real pushes, no quota).
- `local-testing/demo-harness.js` = legacy-JWT variant (serves the pre-merge
  backend from the `~/Documents/genie-demo` worktree; only needed for
  old-auth demos).

## 3. Webapp (port 8090)

```bash
cd components/gov-chat-frontend
VUE_APP_CSP_CONNECT_SRC="'self' http://localhost:3000 http://localhost:8081 ws://localhost:8090" \
npm run serve
```

Open **http://localhost:8090** (hot reload; `/api` is proxied to `:3000`).
Login goes straight to Keycloak (ROPC).

## 4. Mobile app (Android emulator)

```bash
flutter emulators --launch genie_test
adb wait-for-device
adb reverse tcp:8081 tcp:8081        # REQUIRED after every emulator boot —
                                     # lets the app reach Keycloak as "localhost"
cd mobile/genie_ai_mobile
flutter run -d emulator-5554 --dart-define=API_BASE_URL=http://10.0.2.2:3000/api
# (or: flutter build apk --debug --dart-define=... && adb install -r build/app/outputs/flutter-apk/app-debug.apk)
```

Log in `admin` / `Admin@12345` → device auto-registers for notifications.
Debug builds allow cleartext HTTP (debug-manifest exception; release is unaffected).

## 5. Send a push notification

```bash
curl -X POST http://localhost:3000/api/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "x-notification-secret: local-test-secret" \
  -d '{
    "type": "weather_warning",
    "title": "আবহাওয়া সতর্কতা — ঢাকা",
    "body": "Severe thunderstorm expected in Dhaka within 3 hours",
    "districts": ["Dhaka"],
    "alertTypes": ["weather_warning"],
    "tier": 3,
    "idempotencyKey": "test-'$(date +%s)'"
  }'
```

- `idempotencyKey` **must be unique per send** (the `date +%s` handles it) —
  a repeated key is deliberately suppressed as a duplicate.
- Check the result: `curl -s -H "x-notification-secret: local-test-secret" \
  http://localhost:3000/api/notifications/broadcasts/<broadcastId> | python3 -m json.tool`
- Expect a heads-up banner with the app backgrounded (channel `weather_alerts`).
- Emulator quirk: right after a fresh boot the FCM socket can lag — toggle
  airplane mode once (`adb shell cmd connectivity airplane-mode enable`, then
  `disable`) and queued pushes arrive within seconds.
- 10k load test (mock transport only!):
  `node components/gov-chat-backend/scripts/notification-load-test.js seed|run|dedup|clean`
  (needs `ARANGO_URL=http://localhost:8529 ARANGO_DB=node-services ARANGO_USER=root
  ARANGO_PASSWORD=test API_BASE_URL=http://localhost:3000
  NOTIFICATION_BROADCAST_SECRET=local-test-secret NODE_PATH=<backend>/node_modules`)

## Known limits of this local setup

- No chat/RAG/translation (needs the OPEA/LLM stack).
- Keycloak users are managed in its admin console (http://localhost:8081),
  not in Arango — backend user docs auto-provision on first login.
- Webapp/mobile ROPC login is the pilot bridge; production path is main's
  OIDC screens (`oidc_login_screen.dart` on origin/main) + token refresh.
