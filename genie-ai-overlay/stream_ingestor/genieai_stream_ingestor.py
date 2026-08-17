import asyncio
import base64
import logging
import os
import time
import uuid

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

# Dataprep
DATAPREP_INGEST_URL = os.getenv("DATAPREP_INGEST_URL", "http://dataprep-arango-service:5000/v1/dataprep/ingest_file")
DATAPREP_RETRACT_URL = os.getenv("DATAPREP_RETRACT_URL", "http://dataprep-arango-service:5000/v1/dataprep/retract_file")

POLL_INTERVAL_SEC = int(os.getenv("POLL_INTERVAL_SEC", "300"))
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
            await self.process_feed(feed)

    async def process_feed(self, feed):
        feed_id = feed["_key"]
        url = feed.get("url")
        last_polled = feed.get("last_polled", 0)
        poll_interval = feed.get("poll_interval_sec", POLL_INTERVAL_SEC)

        next_poll_at = feed.get("next_poll_at", 0)

        now = time.time()
        if now < next_poll_at or now - last_polled < poll_interval:
            return

        logger.info(f"Polling feed {feed_id} at {url}")

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
            feed["last_polled"] = now
            feed["last_entry_date"] = new_last_entry_date
            feed["failures"] = 0
            self.feeds_col.update(feed)

        except Exception as e:
            logger.error(f"Error processing feed {feed_id}: {e}")
            failures = feed.get("failures", 0) + 1
            feed["failures"] = failures
            # Exponential backoff max 24 hours
            backoff_sec = min(poll_interval * (2**failures), 86400)
            feed["next_poll_at"] = now + backoff_sec
            feed["last_polled"] = now
            self.feeds_col.update(feed)
            logger.warning(f"Feed {feed_id} failed {failures} times. Backing off for {backoff_sec}s")

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


async def start_web_server():
    app = web.Application()
    app.add_routes([web.get("/health", health_check), web.get("/ready", health_check)])
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


async def main():
    logger.info("Starting Stream Ingestor")

    await start_web_server()

    ingestor = StreamIngestor()
    await ingestor.init_db()

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
