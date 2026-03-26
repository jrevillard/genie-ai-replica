from fastapi import FastAPI, Depends
from auth_service import AuthService
import uvicorn
import os

app = FastAPI()

# Required environment variables - no defaults for security
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
    AUTH_SERVICE_PASSWORD
)

@app.get("/get-token")
async def get_token():
    """Test route: log in and return access + refresh tokens"""
    try:
        data = await auth.login()
        accessToken = data.get("accessToken")
        if accessToken:
            return {"accessToken": accessToken}
        else:
            return {"error": "No access token received"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=6666)