import asyncio
import base64
import hashlib
import hmac
import logging
import os
import time
import uuid
from datetime import datetime

import aiohttp
import feedparser
import redis.asyncio as redis
from aiohttp import web
from arango import ArangoClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("stream_ingestor")

# ArangoDB
ARANGO_URL = os.getenv("ARANGO_URL", "http://arangodb:8529")
ARANGO_DB = os.getenv("ARANGO_DB", "genie-ai")
ARANGO_USER = os.getenv("ARANGO_USER", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "root")

# Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://redis-cache:6379/0")
REDIS_STREAM_KEY = "feed-ingestion-events"
DLQ_STREAM_KEY = REDIS_STREAM_KEY + "-dlq"

# Dataprep
DATAPREP_INGEST_URL = os.getenv("DATAPREP_INGEST_URL", "http://dataprep-arango-service:5000/v1/dataprep/ingest_file")
DATAPREP_RETRACT_URL = os.getenv("DATAPREP_RETRACT_URL", "http://dataprep-arango-service:5000/v1/dataprep/retract_file")

POLL_INTERVAL_SEC = int(os.getenv("POLL_INTERVAL_SEC", "300"))
DEFAULT_FEED_POLL_MIN_INTERVAL_SEC = 60
RETRACT_INTERVAL_SEC = int(os.getenv("RETRACT_INTERVAL_SEC", "3600"))
GRAPH_NAME = os.getenv("ARANGO_GRAPH_NAME", "GRAPH")


class StreamIngestor:
    def __init__(self):
        self.arango_client = ArangoClient(hosts=ARANGO_URL)
        self.db = self.arango_client.db(ARANGO_DB, username=ARANGO_USER, password=ARANGO_PASSWORD)
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)

    async def init_db(self):
        if not self.db.has_collection("feeds"):
            self.db.create_collection("feeds")
            logger.info("Created feeds collection")
        self.feeds_col = self.db.collection("feeds")

    async def poll_feeds(self):
        cursor = self.feeds_col.find({"enabled": True})
        feeds = [doc for doc in cursor]

        if not feeds:
            logger.debug("No enabled feeds found.")
            return

        for feed in feeds:
            try:
                await self.process_feed(feed)
            except Exception as e:
                # One broken feed must not starve the others (NFR15)
                logger.error(f"Unhandled error processing feed {feed.get('_key')}: {e}")

    async def _mark_feed_success(self, feed):
        feed["last_polled"] = time.time()
        feed["failures"] = 0
        if feed.get("breaker_state") in ("open", "half_open"):
            # FR41: breaker auto-closes on a successful poll — recovered feeds
            # replay their DLQ entries (chronological) before new work
            feed["breaker_state"] = "closed"
            try:
                await self._replay_dlq(feed.get("_key"))
            except Exception as exc:
                # replay must never re-mark a successful poll as failed
                logger.error("DLQ replay failed (non-fatal): %s", exc)
        self.feeds_col.update(feed)

    def _mark_feed_failure(self, feed, poll_interval, error):
        failures = feed.get("failures", 0) + 1
        feed["failures"] = failures
        # FR41 breaker: 3 consecutive failures OPEN the breaker for this feed
        # only. OPEN feeds route subsequent early polls straight to the DLQ and
        # are probed (HALF_OPEN) once the backoff elapses.
        if feed.get("breaker_state") == "half_open":
            # probe failed -> re-open immediately (FR41)
            feed["breaker_state"] = "open"
        elif failures >= 3:
            feed["breaker_state"] = "open"
        # Exponential backoff max 24 hours
        backoff_sec = min(poll_interval * (2**failures), 86400)
        feed["next_poll_at"] = time.time() + backoff_sec
        feed["last_polled"] = time.time()
        self.feeds_col.update(feed)
        logger.warning(f"Feed {feed.get('_key')} failed {failures} times. Backing off for {backoff_sec}s ({error})")

    async def process_feed(self, feed):
        feed_id = feed["_key"]
        url = feed.get("url")
        last_polled = feed.get("last_polled", 0)
        poll_interval = feed.get("poll_interval_sec") or feed.get("polling_interval") or POLL_INTERVAL_SEC
        # D8 floor: an operator typo (poll_interval_sec: 0) must not hammer a source
        poll_floor = int(os.getenv("FEED_POLL_MIN_INTERVAL_SEC", DEFAULT_FEED_POLL_MIN_INTERVAL_SEC))
        poll_interval = max(poll_interval, poll_floor)

        next_poll_at = feed.get("next_poll_at", 0)
        breaker_state = feed.get("breaker_state", "closed")

        now = time.time()
        if now < next_poll_at:
            # OPEN breaker whose backoff hasn't elapsed: subsequent triggered
            # polls route to the DLQ instead of fetching (FR41) — recorded ONCE
            # per backoff window (a tight loop would flood it)
            if breaker_state == "open" and not feed.get("breaker_dlq_recorded"):
                feed["breaker_dlq_recorded"] = True
                self.feeds_col.update(feed)
                await self._write_dlq(feed_id, "breaker_open", "poll suppressed: breaker OPEN", url)
            return

        if breaker_state == "open":
            # Backoff elapsed on an OPEN breaker: this poll is the HALF_OPEN probe
            feed["breaker_state"] = "half_open"
            logger.info(f"Feed {feed_id} breaker HALF_OPEN — probing")
        elif now - last_polled < poll_interval:
            return

        logger.info(f"Polling feed {feed_id} at {url}")

        if (feed.get("type") or "rss").strip().lower() == "json_api":
            # JSON path owns its failure bookkeeping: a raise here would kill
            # the whole poll cycle and starve every other feed (review: the
            # dispatch sat outside process_feed's try)
            try:
                await self.process_json_api_feed(feed)
            except Exception as e:
                self._mark_feed_failure(feed, poll_interval, str(e))
            return

        try:
            parsed = feedparser.parse(url)

            if parsed.bozo:
                logger.warning(f"Feed {feed_id} parse error: {parsed.bozo_exception}")
                return

            last_entry_date = feed.get("last_entry_date", 0)
            new_last_entry_date = last_entry_date

            new_entries = []
            for entry in parsed.entries:
                # Convert pubDate to epoch
                dt = None
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    dt = time.mktime(entry.published_parsed)
                elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                    dt = time.mktime(entry.updated_parsed)

                entry_date = dt if dt else now

                if entry_date > last_entry_date:
                    new_entries.append(entry)
                    if entry_date > new_last_entry_date:
                        new_last_entry_date = entry_date

            if not new_entries:
                logger.info(f"No new entries for feed {feed_id}")
            else:
                logger.info(f"Found {len(new_entries)} new entries for feed {feed_id}")
                await self.ingest_entries(feed, new_entries)

            # Update feed status
            await self._mark_feed_success(feed)
            feed["last_entry_date"] = new_last_entry_date
            self.feeds_col.update(feed)

        except Exception as e:
            logger.error(f"Error processing feed {feed_id}: {e}")
            self._mark_feed_failure(feed, poll_interval, str(e))

    async def _replay_dlq(self, feed_id):
        """FR43: on source recovery, replay this feed's DLQ entries
        chronologically. Only webhook-origin entries are replayable — poll
        parse_errors recover by the next poll by design. Entries that succeed
        are removed; entries exceeding WEBHOOK_DLQ_MAX_RETRIES are PARKED on a
        per-feed review list (never destroyed). Replay failures are isolated —
        no exception escapes, so a Redis hiccup during replay can never corrupt
        the poll's success bookkeeping."""
        client = await self._auditRedis()
        try:
            raw = await client.xrange(DLQ_STREAM_KEY, "-", "+")
        except Exception as exc:
            logger.error("DLQ replay read failed for feed %s: %s", feed_id, exc)
            return
        max_retries = int(os.getenv("WEBHOOK_DLQ_MAX_RETRIES", "3"))
        replayed, dropped = 0, 0
        for entry_id, fields in raw:
            try:
                data = {fields[i]: fields[i + 1] for i in range(0, len(fields), 2)}
                if data.get("feed_id") != feed_id or data.get("entry_type") != "webhook":
                    continue
                try:
                    retries = int(data.get("retries", "0"))
                except (TypeError, ValueError):
                    retries = 0
                if retries >= max_retries:
                    # PARK for manual review (never destroy content): push the
                    # full entry to a per-feed review list, then drop from DLQ
                    await client.lpush(
                        f"feed-dlq-parking:{feed_id}",
                        str({**data, "dlq_entry_id": entry_id}),
                    )
                    await client.xdel(DLQ_STREAM_KEY, entry_id)
                    logger.error("DLQ entry %s exceeded %d retries — parked", entry_id, max_retries)
                    dropped += 1
                    continue
                ok = await self._replay_single(feed_id, data)
                if ok:
                    await client.xdel(DLQ_STREAM_KEY, entry_id)
                    replayed += 1
                else:
                    # increment retries so entries eventually reach the manual
                    # cap; failed entries move to the tail — strict
                    # chronological order holds within a pass (accepted)
                    await client.xadd(
                        DLQ_STREAM_KEY,
                        {**data, "retries": str(retries + 1)},
                        maxlen=10_000,
                    )
                    await client.xdel(DLQ_STREAM_KEY, entry_id)
                    dropped += 1
            except Exception as exc:
                # isolate per-entry failures — one bad entry must not abort the
                # pass mid-stream
                logger.error("DLQ replay entry %s failed: %s", entry_id, exc)
        if replayed or dropped:
            logger.info(f"DLQ replay for feed {feed_id}: {replayed} replayed, {dropped} dropped")

    async def _replay_single(self, feed_id, data):
        """Re-ingest one webhook-origin DLQ entry. Returns True on success."""
        try:
            feed = self.feeds_col.get(feed_id)
        except Exception:
            return False
        if not feed:
            return False
        try:
            original_ts = float(data.get("timestamp")) if data.get("timestamp") else time.time()
        except (TypeError, ValueError):
            original_ts = time.time()
        entry = [
            {
                "title": data.get("title", "Webhook Replay"),
                "link": data.get("link", ""),
                "summary": data.get("content", ""),
                "_date": original_ts,
            }
        ]
        try:
            await self.ingest_entries(feed, entry)
            return True
        except Exception as exc:
            logger.error("DLQ replay ingest failed for feed %s: %s", feed_id, exc)
            return False

    async def _write_dlq(self, feed_id, reason, error, payload_sample=None):
        """Dead-letter queue (story 3-4): malformed/config-error content is
        parked here for inspection — NEVER sent to the corpus. 3-9's resilience
        work consumes this same convention."""
        try:
            await self.redis.xadd(
                DLQ_STREAM_KEY,
                {
                    "feed_id": feed_id,
                    "entry_type": "poll",
                    "reason": reason,
                    "error": str(error)[:500],
                    "payload_sample": str(payload_sample)[:500] if payload_sample else "",
                    "timestamp": str(time.time()),
                },
                maxlen=10_000,
            )
        except Exception as exc:
            logger.error("DLQ write failed for feed %s: %s", feed_id, exc)

    @staticmethod
    def _resolve_path(obj, dotted_path):
        """Resolve a dot-separated path ('data.items') down a dict/list tree."""
        current = obj
        for part in dotted_path.split("."):
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, list) and part.isdigit():
                idx = int(part)
                current = current[idx] if idx < len(current) else None
            else:
                return None
            if current is None:
                return None
        return current

    @staticmethod
    def _item_date(value, now):
        """Accept epoch numbers (s or ms — JS-API default is ms) or ISO strings
        (Z-suffix tolerated); unparseable -> now (same as RSS missing pubDate)."""
        if value is None:
            return now
        try:
            if isinstance(value, (int, float)):
                seconds = float(value)
            else:
                text = str(value).strip()
                if text.endswith("Z"):
                    text = text[:-1] + "+00:00"
                seconds = datetime.fromisoformat(text).timestamp()
            if seconds > 1e11:  # ms epoch -> s
                seconds /= 1000.0
            return seconds
        except (ValueError, TypeError, OSError):
            return now

    async def process_json_api_feed(self, feed):
        """Story 3-4: json_api polling with content_mapping + parse_error DLQ gate."""
        feed_id = feed["_key"]
        url = feed.get("url")
        mapping = feed.get("content_mapping") or {}
        items_path = mapping.get("items_path")

        if not items_path:
            await self._write_dlq(feed_id, "config_error", "json_api feed missing content_mapping.items_path")
            # Count as a failure so a permanently misconfigured feed backs off
            # instead of polling at full frequency forever (parity with RSS)
            raise RuntimeError("json_api feed missing content_mapping.items_path")

        import httpx

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                body = response.json()
        except Exception as exc:
            await self._write_dlq(feed_id, "parse_error", f"fetch/JSON parse failed: {exc}", url)
            raise

        items = self._resolve_path(body, items_path)
        if not isinstance(items, list):
            await self._write_dlq(
                feed_id,
                "parse_error",
                f"items_path '{items_path}' did not resolve to a list (got {type(items).__name__})",
                str(body)[:300],
            )
            raise RuntimeError(f"json_api items_path '{items_path}' did not resolve to a list")

        seen = list(feed.get("last_entry_ids", []))
        now = time.time()
        new_entries = []
        dlq_errors = 0
        for item in items:
            if not isinstance(item, dict):
                await self._write_dlq(feed_id, "parse_error", "item is not an object", str(item)[:300])
                continue
            title = self._resolve_path(item, mapping.get("title_field", "title"))
            body_text = self._resolve_path(item, mapping.get("body_field", "body"))
            link = self._resolve_path(item, mapping.get("link_field", "")) or url
            date_value = self._resolve_path(item, mapping.get("date_field", ""))
            item_id = self._resolve_path(item, mapping.get("id_field", ""))
            if item_id is None:
                # STABLE hash: Python's built-in hash() is salted per process,
                # so persisted ids would break on every restart (re-ingestion)
                item_id = hashlib.sha256((str(title) + "\x00" + str(body_text)).encode("utf-8")).hexdigest()
            item_key = str(item_id)
            if item_key in seen:
                continue
            # REQUIRED fields: a usable item needs title AND body text
            if not title or not body_text:
                if item_key not in seen:
                    seen.append(item_key)  # remember so we don't re-DLQ every poll
                    dlq_errors += 1
                    await self._write_dlq(
                        feed_id,
                        "parse_error",
                        f"item missing required mapped fields: {item_key}",
                        str(item)[:300],
                    )
                continue
            if item_key not in seen:
                seen.append(item_key)
            new_entries.append(
                {
                    "title": str(title),
                    "link": str(link),
                    "summary": str(body_text),
                    "_date": self._item_date(date_value, now),
                }
            )

        # Cap the seen-set keeping the NEWEST ids (insertion order) —
        # unbounded growth on busy feeds is the failure mode
        last_entry_ids = seen[-500:]

        if new_entries:
            logger.info(f"Found {len(new_entries)} new JSON items for feed {feed_id}")
            await self.ingest_entries(feed, new_entries)
        else:
            logger.info(f"No new JSON items for feed {feed_id}")

        await self._mark_feed_success(feed)
        feed["last_entry_ids"] = last_entry_ids
        if dlq_errors:
            # A poll that DLQ'd items did NOT fully succeed — otherwise the
            # 4-7 health overview would show a green feed for a broken upstream
            feed["failures"] = dlq_errors
            self.feeds_col.update(feed)

    async def ingest_entries(self, feed, entries):
        feed_id = feed["_key"]
        expires_at = feed.get("expires_at", None)
        feed_labels = feed.get("labels", [])

        async with aiohttp.ClientSession() as session:
            for entry in entries:
                title = entry.get("title", "No Title")
                link = entry.get("link", feed.get("url"))
                summary = entry.get("summary", entry.get("description", ""))

                content = f"Title: {title}\nLink: {link}\n\n{summary}"
                filename = f"feed_{feed_id}_{uuid.uuid4().hex[:8]}.txt"
                content_b64 = base64.b64encode(content.encode("utf-8")).decode("utf-8")

                payload = {
                    "fileId": str(uuid.uuid4()),
                    "fileName": filename,
                    "fileBase64": content_b64,
                    "fileType": "text/plain",
                    "fileLabels": feed_labels,
                    "sourceType": "feed",
                    "feedId": feed_id,
                }
                if expires_at:
                    payload["expiresAt"] = expires_at

                try:
                    async with session.post(DATAPREP_INGEST_URL, json=payload) as response:
                        if response.status == 200:
                            logger.info(f"Successfully ingested entry '{title}' for feed {feed_id}")
                            await self.redis.xadd(
                                REDIS_STREAM_KEY,
                                {
                                    "feed_id": feed_id,
                                    "action": "ingest",
                                    "title": title,
                                    "link": link,
                                    "timestamp": str(time.time()),
                                },
                            )
                        else:
                            resp_text = await response.text()
                            logger.error(f"Failed to ingest entry '{title}': {response.status} - {resp_text}")
                except Exception as e:
                    logger.error(f"HTTP error ingesting entry '{title}': {e}")

    async def retract_expired_chunks(self):
        logger.info("Running retraction for expired feed chunks...")
        try:
            # Query ArangoDB directly for expired file_ids
            # Langchain ArangoGraph stores chunks in {GRAPH_NAME}_Chunk
            chunk_col = f"{GRAPH_NAME}_Chunk"

            if not self.db.has_collection(chunk_col):
                logger.debug(f"Collection {chunk_col} not found. Skipping retraction.")
                return

            now = time.time()
            aql = f"""
            FOR c IN {chunk_col}
                FILTER c.source_type == 'feed' AND c.expires_at != null AND c.expires_at < @now
                RETURN DISTINCT c.file_id
            """
            cursor = self.db.aql.execute(aql, bind_vars={"now": now})
            expired_file_ids = [doc for doc in cursor]

            if expired_file_ids:
                logger.info(f"Found {len(expired_file_ids)} expired feed entries. Retracting...")
                async with aiohttp.ClientSession() as session:
                    for fid in expired_file_ids:
                        payload = {"fileId": fid}
                        async with session.post(DATAPREP_RETRACT_URL, json=payload) as response:
                            if response.status == 200:
                                logger.info(f"Successfully retracted expired entry {fid}")
                            else:
                                logger.error(f"Failed to retract entry {fid}: {response.status}")
        except Exception as e:
            logger.error(f"Error during retraction: {e}")


async def health_check(request):
    return web.Response(text="OK")


def build_web_app(ingestor=None):
    """Build the aiohttp app. Story 3-5: the webhook route is registered here
    (ingestor injected so the handler can read feeds + publish)."""
    app = web.Application()
    app.add_routes([web.get("/health", health_check), web.get("/ready", health_check)])
    if ingestor is not None and _webhook_enabled():
        app.add_routes([web.post("/v1/tools/webhook/{feed_name}", _make_webhook_handler(ingestor))])
        logger.info("Webhook ingestion ENABLED (POST /v1/tools/webhook/{feed_name})")
    else:
        logger.info("Webhook ingestion disabled (WEBHOOK_INGESTION_ENABLED not true)")
    return app


async def start_web_server(ingestor=None):
    app = build_web_app(ingestor)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
    logger.info("Started health web server on port 8080")


async def retract_loop(ingestor):
    while True:
        try:
            await asyncio.sleep(RETRACT_INTERVAL_SEC)
            await ingestor.retract_expired_chunks()
        except Exception as e:
            logger.error(f"Error in retract loop: {e}")


# ---------------------------------------------------------------------------
# Webhook push ingestion (story 3-5, FR27/D8/NFR9)
# ---------------------------------------------------------------------------
_WEBHOOK_JWKS_CACHE = {"jwks": None, "fetched_at": 0.0}


def _webhook_enabled():
    # Fail-closed allow-list: only explicit 1/true/yes enables push ingestion
    return str(os.getenv("WEBHOOK_INGESTION_ENABLED", "false")).strip().lower() in ("1", "true", "yes")


def _make_webhook_handler(ingestor):
    async def handle_webhook(request):
        feed_name = request.match_info["feed_name"]
        # 404 first: unknown feed reveals nothing about the feature state
        try:
            feed = ingestor.feeds_col.get(feed_name)
        except Exception:
            feed = None
        if not feed or feed.get("enabled") is False:
            return web.json_response({"error": "Not Found"}, status=404)

        ok, reason = await _authorize_webhook(request)
        if not ok:
            return web.json_response({"error": reason}, status=401)

        limited, retry_after = await _webhook_rate_limited(ingestor, feed_name)
        if limited:
            response = web.json_response({"error": "Rate limit exceeded"}, status=429)
            response.headers["Retry-After"] = str(int(retry_after) + 1)
            return response

        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Body must be valid JSON"}, status=400)

        title = str(body.get("title") or "Webhook Update")
        content = body.get("content")
        if not content or not str(content).strip():
            return web.json_response({"error": "content is required"}, status=400)

        entries = [
            {
                "title": title,
                "link": str(body.get("link") or ""),
                "summary": str(content),
                "_date": float(body["timestamp"]) if body.get("timestamp") else time.time(),
            }
        ]
        await ingestor.ingest_entries(feed, entries)
        await ingestor.redis.xadd(
            REDIS_STREAM_KEY,
            {
                "event_type": "webhook_received",
                "feed_id": feed_name,
                "title": title,
                "timestamp": str(time.time()),
            },
            maxlen=100_000,
        )
        return web.json_response({"accepted": True}, status=202)

    return handle_webhook


async def _authorize_webhook(request):
    """Two env-selected modes (both may be active; either passes):
    API key (X-API-Key vs WEBHOOK_API_KEY, constant-time) or JWT Bearer
    (Keycloak realm JWKS, PyJWT). Neither configured -> deny (fail-closed)."""
    api_key = os.getenv("WEBHOOK_API_KEY")
    if api_key:
        provided = request.headers.get("X-API-Key", "")
        if hmac.compare_digest(provided, api_key):
            return True, ""
        return False, "Invalid API key"

    if str(os.getenv("WEBHOOK_JWT_ENABLED", "")).strip().lower() in ("1", "true", "yes"):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return False, "Bearer token required"
        try:
            await _verify_webhook_jwt(auth.removeprefix("Bearer ").strip())
            return True, ""
        except Exception as exc:
            return False, f"Invalid token: {exc}"

    return False, "Webhook authentication not configured"


async def _verify_webhook_jwt(token):
    """Minimal RS256 JWT check against the realm JWKS (machine-to-machine push
    auth): signature + exp + iss. Uses PyJWT (pyjwt[crypto] in requirements)."""
    import jwt
    from jwt import PyJWKClient

    realm_url = f"{os.getenv('KEYCLOAK_URL')}/realms/{os.getenv('KEYCLOAK_REALM')}"
    jwks_client = PyJWKClient(f"{realm_url}/protocol/openid-connect/certs", cache_jwk_set=True, lifespan=3600)
    signing_key = jwks_client.get_signing_key_from_jwt(token)
    payload = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        issuer=realm_url,
        options={"require": ["exp", "iss"]},
    )
    return payload


async def _webhook_rate_limited(ingestor, feed_name):
    """Per-feed sliding window (FR27/D8). Local reimplementation of
    redis_primitives.SlidingWindowRateLimiter — the stream-ingestor image does
    NOT ship the workflows package (single-file Dockerfile)."""
    max_requests = int(os.getenv("WEBHOOK_RATE_LIMIT_MAX", "10"))
    window_seconds = 60
    key = f"webhook-rl:{feed_name}"
    now = time.time()
    window_start = now - window_seconds
    pipeline = ingestor.redis.pipeline()
    pipeline.zremrangebyscore(key, 0, window_start)
    pipeline.zcard(key)
    counts = await pipeline.execute()
    current = counts[1] if isinstance(counts, (list, tuple)) else 0
    if current >= max_requests:
        oldest = await ingestor.redis.zrange(key, 0, 0)
        retry_after = 1
        if oldest:
            oldest_score = float(oldest[0] if not isinstance(oldest[0], (list, tuple)) else oldest[0][1])
            retry_after = max(1, int(oldest_score + window_seconds - now))
        return True, retry_after
    await ingestor.redis.zadd(key, {str(now): now})
    await ingestor.redis.expire(key, window_seconds * 2)
    return False, 0


async def main():
    logger.info("Starting Stream Ingestor")

    ingestor = StreamIngestor()
    await ingestor.init_db()
    await start_web_server(ingestor)

    # Start background retraction task
    asyncio.create_task(retract_loop(ingestor))

    while True:
        try:
            await ingestor.poll_feeds()
        except Exception as e:
            logger.error(f"Error in poll loop: {e}")
        await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
