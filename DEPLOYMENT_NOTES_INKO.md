# GENIE.AI Deployment Notes

Public evaluation URL:

https://164.52.194.158/login

Architecture:

Browser -> NGINX HTTPS 443 -> Kong /api route -> backend port 3000 -> ArangoDB genie-ai

Important runtime details:

- Frontend API base URL should be `/api`, not a hardcoded IP.
- Backend runs on port 3000.
- Frontend runs on port 8090.
- NGINX exposes HTTPS on port 443.
- Kong proxies `/api` to `genieai_mvp-backend-1:3000`.
- ArangoDB database name is `genie-ai`.

Kong route setup:

```bash
curl -i -X POST http://localhost:8001/services \
  --data name=genie-backend \
  --data url=http://genieai_mvp-backend-1:3000

curl -i -X POST http://localhost:8001/services/genie-backend/routes \
  --data name=genie-backend-api \
  --data 'paths[]=/api' \
  --data strip_path=false

