from typing import Any, Dict, List, Optional
import time
import asyncio
import requests
import httpx
from src.config import settings


# ============================================================
# ORIGINAL SYNC-ONLY CLIENT (preserved for reference)
# ============================================================
# The original command_sql() used requests.post synchronously.
# It is kept below as the SYNC CLIENT for startup/schema use.
# A new async_command_sql() has been added for use in async
# code paths (agent, memory manager) to avoid blocking the
# event loop under concurrent load.
# ============================================================


# ============================================================
# ASYNC CLIENT (for use in async/await code paths)
# Uses httpx with persistent connection pooling
# ============================================================

# Module-level async client — reused across all requests
_async_client: Optional[httpx.AsyncClient] = None


def _get_async_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        _async_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            limits=httpx.Limits(
                max_connections=50,       # Connection pool size
                max_keepalive_connections=20,
                keepalive_expiry=30.0,
            ),
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
        )
    return _async_client


async def async_command_sql(
    sql: str,
    params=None,
    retries: int = 3,
) -> Dict[str, Any]:
    """
    Non-blocking ArcadeDB SQL execution.
    Uses httpx.AsyncClient with connection pooling.

    params can be:
      - List[Any]: positional params for ? placeholders
      - Dict[str,Any]: named params for :name placeholders

    Auto-converts: if sql uses :named params but params is a list,
    extracts :names from sql and builds a dict.
    """
    base_url = settings.ARCADEDB_URL.rstrip("/")
    url = f"{base_url}/api/v1/command/{settings.ARCADEDB_DB}"
    payload: Dict[str, Any] = {"language": "sql", "command": sql}
    if params:
        # Auto-convert list params to dict if sql uses :named placeholders
        if isinstance(params, list) and ':' in sql:
            import re
            named = re.findall(r':(\w+)', sql)
            if len(named) == len(params):
                params = dict(zip(named, params))
        payload["params"] = params

    client = _get_async_client()
    last_error = None

    for attempt in range(retries):
        try:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError as e:
            last_error = e
            if e.response.status_code < 500:
                raise
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            last_error = e
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)
        except Exception as e:
            last_error = e
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)

    raise last_error


# ============================================================
# SYNC CLIENT (for startup, schema creation, and legacy code)
# Uses requests with retry + exponential backoff
# ============================================================

def command_sql(
    sql: str,
    params=None,
    timeout_s: int = 30,
    retries: int = 3,
) -> Dict[str, Any]:
    """
    Synchronous ArcadeDB SQL execution (for startup / non-async contexts).

    params: List (positional) or Dict (named). Auto-converts list→dict
    when sql uses :named placeholders.
    """
    base_url = settings.ARCADEDB_URL.rstrip("/")
    url = f"{base_url}/api/v1/command/{settings.ARCADEDB_DB}"
    payload: Dict[str, Any] = {"language": "sql", "command": sql}
    if params:
        if isinstance(params, list) and ':' in sql:
            import re
            named = re.findall(r':(\w+)', sql)
            if len(named) == len(params):
                params = dict(zip(named, params))
        payload["params"] = params

    last_error = None
    for attempt in range(retries):
        try:
            r = requests.post(
                url,
                json=payload,
                auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
                timeout=timeout_s,
            )
            r.raise_for_status()
            return r.json()
        except requests.HTTPError as e:
            error_msg = f"ArcadeDB Error: {e} | Body: {r.text[:500]}"
            last_error = requests.HTTPError(error_msg)
            if r.status_code < 500:
                print(error_msg)
                raise last_error from None
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"ArcadeDB retry {attempt + 1}/{retries} in {wait}s: {error_msg}")
                time.sleep(wait)
            else:
                print(error_msg)
        except requests.ConnectionError as e:
            last_error = e
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"ArcadeDB connection retry {attempt + 1}/{retries} in {wait}s: {e}")
                time.sleep(wait)
            else:
                print(f"Connection failed after {retries} attempts: {e}")
        except Exception as e:
            last_error = e
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"ArcadeDB retry {attempt + 1}/{retries} in {wait}s: {e}")
                time.sleep(wait)
            else:
                print(f"Failed after {retries} attempts: {e}")

    raise last_error


def extract_rows(resp: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Normalizes ArcadeDB response to a simple list of dicts."""
    if "result" in resp and isinstance(resp["result"], list):
        return resp["result"]
    if "results" in resp and isinstance(resp["results"], list):
        return resp["results"]
    return []
