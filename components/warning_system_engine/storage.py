"""
StorageLayer — ArangoDB persistence for the early warning system.

Collections (created on first run if absent):
  weather_forecasts    — UnifiedForecast documents        (recommended TTL: 30 days)
  risk_assessments     — RiskAssessment documents         (recommended TTL: 90 days)
  alerts_sent          — Deduplication log                (recommended TTL: 7 days)
  seasonal_forecasts   — Copernicus SEAS5 monthly outlook (recommended TTL: 180 days)
  seasonal_assessments — Long-term potato risk per month  (recommended TTL: 180 days)

Upsert keys:
  weather_forecasts    : "{location}__{source}__{horizon}"
  risk_assessments     : "{location}__{horizon}"
  seasonal_forecasts   : "{location}__copernicus__long"
  seasonal_assessments : "{location}__{crop}__{YYYY_MM}"
  alerts_sent          : auto-generated
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from arango import ArangoClient
from arango.exceptions import DocumentInsertError, DocumentReplaceError

from models import RiskAssessment, UnifiedForecast

logger = logging.getLogger(__name__)

_COLLECTIONS = (
    "weather_forecasts",
    "risk_assessments",
    "alerts_sent",
    "seasonal_forecasts",
    "seasonal_assessments",
)


def _norm_key(s: str) -> str:
    """Produce a valid ArangoDB _key from an arbitrary string."""
    return (
        s.lower()
        .replace(" ", "_")
        .replace("'", "")
        .replace("-", "_")
        .replace("'", "")
    )


class StorageLayer:
    """
    Thread-safe (python-arango uses connection pools) ArangoDB client.

    All public methods are synchronous — call them from async code via
    asyncio.to_thread() if you need to avoid blocking the event loop on
    large batch operations. For single-document ops the latency is negligible.
    """

    def __init__(self) -> None:
        arango_url  = os.getenv("ARANGO_URL",      "http://arango-vector-db:8529")
        arango_db   = os.getenv("ARANGO_DB_NAME",  "genie-ai")
        arango_user = os.getenv("ARANGO_USER",     "root")
        arango_pass = os.getenv("ARANGO_PASSWORD", "test")

        client = ArangoClient(hosts=arango_url)
        self._db = client.db(arango_db, username=arango_user, password=arango_pass)
        self._ensure_collections()
        logger.info("[STORAGE] StorageLayer connected to ArangoDB at %s", arango_url)

    def _ensure_collections(self) -> None:
        for name in _COLLECTIONS:
            if not self._db.has_collection(name):
                self._db.create_collection(name)
                logger.info("[STORAGE] Created collection: %s", name)

    # ------------------------------------------------------------------
    # Forecast persistence
    # ------------------------------------------------------------------

    def upsert_forecast(self, forecast: UnifiedForecast) -> str:
        """
        Insert or replace a forecast document.
        Key: {location}__{source}__{horizon}
        Returns the document _key.
        """
        key = _norm_key(f"{forecast.location}__{forecast.source}__{forecast.horizon}")
        col = self._db.collection("weather_forecasts")
        doc = {"_key": key, **forecast.model_dump()}

        try:
            if col.has(key):
                col.replace(doc)
            else:
                col.insert(doc)
        except (DocumentInsertError, DocumentReplaceError) as exc:
            logger.error("[STORAGE] upsert_forecast failed for %s: %s", key, exc)
            raise

        return key

    def get_latest_forecast(
        self,
        location: str,
        horizon: str = "short",
        max_age_hours: int = 30,
    ) -> UnifiedForecast | None:
        """
        Return the most recent forecast for a location if it is fresher than
        max_age_hours. Returns None (triggers live fetch) if stale or absent.
        Default is 30 h — covers a full daily pipeline cycle (24 h) plus a 6 h buffer.
        """
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
        ).isoformat()

        aql = """
            FOR doc IN weather_forecasts
              FILTER doc.location == @location
                AND doc.horizon   == @horizon
                AND doc.ingested_at >= @cutoff
              SORT doc.ingested_at DESC
              LIMIT 1
              RETURN doc
        """
        cursor = self._db.aql.execute(
            aql,
            bind_vars={"location": location, "horizon": horizon, "cutoff": cutoff},
        )
        docs = list(cursor)
        if not docs:
            return None
        try:
            return UnifiedForecast.model_validate(docs[0])
        except Exception as exc:
            logger.warning("[STORAGE] Failed to parse stored forecast: %s", exc)
            return None

    # ------------------------------------------------------------------
    # Risk assessment persistence
    # ------------------------------------------------------------------

    def upsert_risk_assessment(self, assessment: RiskAssessment) -> str:
        key = _norm_key(f"{assessment.location}__{assessment.horizon}")
        col = self._db.collection("risk_assessments")
        doc = {"_key": key, **assessment.model_dump()}

        try:
            if col.has(key):
                col.replace(doc)
            else:
                col.insert(doc)
        except (DocumentInsertError, DocumentReplaceError) as exc:
            logger.error("[STORAGE] upsert_risk failed for %s: %s", key, exc)
            raise

        return key

    def get_latest_risk(
        self,
        location: str,
        horizon: str = "short",
    ) -> RiskAssessment | None:
        aql = """
            FOR doc IN risk_assessments
              FILTER doc.location == @location AND doc.horizon == @horizon
              SORT doc.assessed_at DESC
              LIMIT 1
              RETURN doc
        """
        cursor = self._db.aql.execute(
            aql, bind_vars={"location": location, "horizon": horizon}
        )
        docs = list(cursor)
        if not docs:
            return None
        try:
            return RiskAssessment.model_validate(docs[0])
        except Exception as exc:
            logger.warning("[STORAGE] Failed to parse stored risk assessment: %s", exc)
            return None

    def get_active_risks(self, min_tier: int = 1) -> list[RiskAssessment]:
        """
        Return the latest risk assessment for every district at or above min_tier.
        Uses a collect+sort to return only the most recent per location.
        """
        aql = """
            FOR doc IN risk_assessments
              FILTER doc.tier >= @min_tier
              COLLECT loc = doc.location INTO grp = doc
              LET latest = FIRST(
                FOR g IN grp SORT g.assessed_at DESC RETURN g
              )
              FILTER latest.tier >= @min_tier
              RETURN latest
        """
        cursor = self._db.aql.execute(aql, bind_vars={"min_tier": min_tier})
        results = []
        for d in cursor:
            try:
                results.append(RiskAssessment.model_validate(d))
            except Exception:
                pass
        return results

    # ------------------------------------------------------------------
    # Alert deduplication
    # ------------------------------------------------------------------

    def was_alert_sent(
        self,
        location: str,
        tier: int,
        within_hours: int = 12,
    ) -> bool:
        """
        True if an alert of this tier or higher was already sent for this
        location within the last within_hours. Prevents spam on each pipeline run.
        """
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=within_hours)
        ).isoformat()
        aql = """
            FOR doc IN alerts_sent
              FILTER doc.location == @location
                AND  doc.tier     >= @tier
                AND  doc.sent_at  >= @cutoff
              LIMIT 1
              RETURN 1
        """
        cursor = self._db.aql.execute(
            aql,
            bind_vars={"location": location, "tier": tier, "cutoff": cutoff},
        )
        return len(list(cursor)) > 0

    def record_alert_sent(self, location: str, tier: int, channel: str) -> None:
        col = self._db.collection("alerts_sent")
        col.insert({
            "location": location,
            "tier": tier,
            "channel": channel,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        })

    # ------------------------------------------------------------------
    # Forecast pair (for crop-specific EWS)
    # ------------------------------------------------------------------

    def get_latest_forecast_pair(
        self,
        location: str,
        horizon: str = "short",
        max_age_hours: int = 30,
    ) -> tuple[dict | None, dict | None]:
        """
        Return (open_meteo_doc, bmd_doc) raw dicts for a location.
        Either may be None if not found or stale.
        Docs are returned as plain dicts so callers can read any field.
        Default is 30 h — covers a full daily pipeline cycle (24 h) plus a 6 h buffer.
        """
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
        ).isoformat()

        aql = """
            FOR doc IN weather_forecasts
              FILTER doc.location == @location
                AND doc.horizon   == @horizon
                AND doc.ingested_at >= @cutoff
              SORT doc.ingested_at DESC
              RETURN doc
        """
        cursor = self._db.aql.execute(
            aql,
            bind_vars={"location": location, "horizon": horizon, "cutoff": cutoff},
        )
        docs = list(cursor)

        om_doc: dict | None = None
        bmd_doc: dict | None = None
        for doc in docs:
            src = doc.get("source", "")
            if src == "open_meteo" and om_doc is None:
                om_doc = doc
            elif src == "bmd" and bmd_doc is None:
                bmd_doc = doc

        return om_doc, bmd_doc

    # ------------------------------------------------------------------
    # Crop-aware risk assessments
    # ------------------------------------------------------------------

    def upsert_crop_assessment(self, assessment: dict, crop: str) -> str:
        """
        Upsert a crop-specific risk assessment.
        Key: {location}__short__{crop}  (e.g. dhaka__short__potato)
        """
        key = _norm_key(
            f"{assessment['location']}__{assessment.get('horizon', 'short')}__{crop}"
        )
        col = self._db.collection("risk_assessments")
        doc = {"_key": key, **assessment}

        try:
            if col.has(key):
                col.replace(doc)
            else:
                col.insert(doc)
        except (DocumentInsertError, DocumentReplaceError) as exc:
            logger.error("[STORAGE] upsert_crop_assessment failed for %s: %s", key, exc)
            raise

        return key

    def get_latest_crop_risk(
        self,
        location: str,
        crop: str,
        horizon: str = "short",
    ) -> dict | None:
        """Return the stored crop-specific risk assessment dict, or None."""
        key = _norm_key(f"{location}__{horizon}__{crop}")
        col = self._db.collection("risk_assessments")
        if not col.has(key):
            return None
        try:
            return dict(col.get(key))
        except Exception as exc:
            logger.warning("[STORAGE] get_latest_crop_risk failed for %s: %s", key, exc)
            return None

    # ------------------------------------------------------------------
    # Crop-aware alert deduplication
    # ------------------------------------------------------------------

    def was_crop_alert_sent(
        self,
        location: str,
        crop: str,
        tier: int,
        within_hours: int = 12,
    ) -> bool:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=within_hours)
        ).isoformat()
        aql = """
            FOR doc IN alerts_sent
              FILTER doc.location == @location
                AND  doc.crop     == @crop
                AND  doc.tier     >= @tier
                AND  doc.sent_at  >= @cutoff
              LIMIT 1
              RETURN 1
        """
        cursor = self._db.aql.execute(
            aql,
            bind_vars={
                "location": location,
                "crop": crop,
                "tier": tier,
                "cutoff": cutoff,
            },
        )
        return len(list(cursor)) > 0

    def record_crop_alert_sent(
        self,
        location: str,
        crop: str,
        tier: int,
        channel: str,
        forecast_date: str = "",
    ) -> None:
        col = self._db.collection("alerts_sent")
        col.insert({
            "location": location,
            "crop": crop,
            "tier": tier,
            "channel": channel,
            "forecast_date": forecast_date,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        })

    # ------------------------------------------------------------------
    # Seasonal forecasts  (Copernicus SEAS5)
    # ------------------------------------------------------------------

    def upsert_seasonal_forecast(self, doc: dict) -> str:
        """
        Upsert a Copernicus seasonal forecast document.
        Key: {location}__copernicus__long
        """
        key = _norm_key(f"{doc['location']}__copernicus__long")
        col = self._db.collection("seasonal_forecasts")
        full_doc = {"_key": key, **doc}
        try:
            if col.has(key):
                col.replace(full_doc)
            else:
                col.insert(full_doc)
        except (DocumentInsertError, DocumentReplaceError) as exc:
            logger.error("[STORAGE] upsert_seasonal_forecast failed for %s: %s", key, exc)
            raise
        return key

    def get_seasonal_forecast(self, location: str) -> dict | None:
        """Return the stored Copernicus outlook for a location, or None."""
        key = _norm_key(f"{location}__copernicus__long")
        col = self._db.collection("seasonal_forecasts")
        if not col.has(key):
            return None
        try:
            return dict(col.get(key))
        except Exception as exc:
            logger.warning("[STORAGE] get_seasonal_forecast failed for %s: %s", location, exc)
            return None

    # ------------------------------------------------------------------
    # Seasonal assessments  (long-term potato risk per month)
    # ------------------------------------------------------------------

    def upsert_seasonal_assessment(self, assessment: dict) -> str:
        """
        Upsert a long-term monthly potato risk assessment.
        Key: {location}__{crop}__{YYYY_MM}  e.g. dhaka__potato__2026_06
        """
        month_key = assessment["target_month"].replace("-", "_")
        key = _norm_key(f"{assessment['location']}__{assessment['crop']}__{month_key}")
        col = self._db.collection("seasonal_assessments")
        full_doc = {"_key": key, **assessment}
        try:
            if col.has(key):
                col.replace(full_doc)
            else:
                col.insert(full_doc)
        except (DocumentInsertError, DocumentReplaceError) as exc:
            logger.error("[STORAGE] upsert_seasonal_assessment failed for %s: %s", key, exc)
            raise
        return key

    def get_seasonal_assessment(
        self, location: str, crop: str, target_month: str
    ) -> dict | None:
        """Return a stored monthly seasonal assessment, or None."""
        month_key = target_month.replace("-", "_")
        key = _norm_key(f"{location}__{crop}__{month_key}")
        col = self._db.collection("seasonal_assessments")
        if not col.has(key):
            return None
        try:
            return dict(col.get(key))
        except Exception as exc:
            logger.warning("[STORAGE] get_seasonal_assessment failed for %s: %s", key, exc)
            return None

    def get_active_seasonal_assessments(
        self, location: str, crop: str, min_tier: int = 1
    ) -> list[dict]:
        """Return all seasonal assessments for a location+crop at or above min_tier."""
        aql = """
            FOR doc IN seasonal_assessments
              FILTER doc.location == @location
                AND  doc.crop     == @crop
                AND  doc.tier     >= @min_tier
              SORT doc.target_month ASC
              RETURN doc
        """
        cursor = self._db.aql.execute(
            aql,
            bind_vars={"location": location, "crop": crop, "min_tier": min_tier},
        )
        return [dict(d) for d in cursor]
