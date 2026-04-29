from typing import Any, Dict, List, Optional
import time  # for retry backoff
import requests
from src.config import settings


# Original function 
# def command_sql(sql: str, params: Optional[List[Any]] = None, timeout_s: int = 30) -> Dict[str, Any]:
#     """
#     Execute a SQL command against ArcadeDB.
#     Handles Auth, URL construction, and Error Checking.
#     """
#     base_url = settings.ARCADEDB_URL.rstrip("/")
#     url = f"{base_url}/api/v1/command/{settings.ARCADEDB_DB}"
#     payload: Dict[str, Any] = {"language": "sql", "command": sql}
#     if params:
#         payload["params"] = params
#     try:
#         r = requests.post(
#             url,
#             json=payload,
#             auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
#             timeout=timeout_s,
#         )
#         r.raise_for_status()
#         return r.json()
#     except requests.HTTPError as e:
#         error_msg = f"ArcadeDB Error: {e} | Body: {r.text[:500]}"
#         print(error_msg)
#         raise requests.HTTPError(error_msg) from None
#     except Exception as e:
#         print(f"Connection failed: {e}")
#         raise e


# retry logic + exponential backoff 
def command_sql(sql: str, params: Optional[List[Any]] = None, timeout_s: int = 30, retries: int = 3) -> Dict[str, Any]:
    """
    Execute a SQL command against ArcadeDB.
    Handles Auth, URL construction, Error Checking, and Automatic Retries.
    Retries with exponential backoff: 1s, 2s, 4s
    """
    base_url = settings.ARCADEDB_URL.rstrip("/")
    url = f"{base_url}/api/v1/command/{settings.ARCADEDB_DB}"
    payload: Dict[str, Any] = {"language": "sql", "command": sql}
    if params:
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
            # Don't retry on 4xx client errors (bad SQL, schema issues)
            if r.status_code < 500:
                print(error_msg)
                raise last_error from None
            # Retry on 5xx server errors (overloaded, temporary failure)
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
# END


def extract_rows(resp: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Normalizes ArcadeDB response to a simple list of dicts.
    """
    if "result" in resp and isinstance(resp["result"], list):
        return resp["result"]
    if "results" in resp and isinstance(resp["results"], list):
        return resp["results"]
    return []