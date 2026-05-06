# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Smoke-test FastAPI app for the http-service auth client.

Boots a tiny FastAPI app that exposes `/get-token` — calling it logs in
against AUTH_SERVICE_URL with the configured service-account credentials
and returns the resulting access token. Used to verify that the service
account is provisioned and that the auth flow works end-to-end before
wiring this client into a real microservice.

Required env (no defaults — fails fast if any are missing):
    AUTH_SERVICE_URL       Base URL of the backend's /api/auth path
    AUTH_SERVICE_USERNAME  Service-account login name
    AUTH_SERVICE_PASSWORD  Service-account plaintext password
"""

import os

import uvicorn
from fastapi import FastAPI

from auth_service import AuthService

app = FastAPI()

# Required environment variables — no defaults for security.
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL")
AUTH_SERVICE_USERNAME = os.getenv("AUTH_SERVICE_USERNAME")
AUTH_SERVICE_PASSWORD = os.getenv("AUTH_SERVICE_PASSWORD")

if not all([AUTH_SERVICE_URL, AUTH_SERVICE_USERNAME, AUTH_SERVICE_PASSWORD]):
    raise ValueError(
        "Missing required environment variables: AUTH_SERVICE_URL, "
        "AUTH_SERVICE_USERNAME, AUTH_SERVICE_PASSWORD"
    )

auth = AuthService(
    AUTH_SERVICE_URL,
    AUTH_SERVICE_USERNAME,
    AUTH_SERVICE_PASSWORD,
)


@app.get("/get-token")
async def get_token():
    """Test route: log in and return access + refresh tokens."""
    try:
        data = await auth.login()
        access_token = data.get("accessToken")
        if access_token:
            return {"accessToken": access_token}
        return {"error": "No access token received"}
    except Exception as e:
        # Surface the trace in stdout so deploys can see what failed; the
        # response keeps the message terse.
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=6666)
