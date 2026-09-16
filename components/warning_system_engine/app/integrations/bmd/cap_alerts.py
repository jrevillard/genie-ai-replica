"""
BMD weather warnings via the Common Alerting Protocol feed.

The Bangladesh Meteorological Department publishes every official warning
(heavy rainfall, maritime signals, cyclone, heat wave, landslide, lightning,
fog, ...) as CAP 1.2 XML through https://cap.bmd.gov.bd, with an English and a
Bengali <info> block, severity / urgency / certainty, an expiry, and the
affected areas as names plus polygons.

This watcher polls the RSS index, stores every alert once (keyed by the CAP
identifier), maps the areas to the 64 districts, and hands tier >= 2 alerts to
the notifier, which broadcasts them through the backend like any engine alert
(Android push + web banner notices). The stored alerts are also the "active BMD
warnings" resource the weather service serves to the chat and the banner.
"""

from __future__ import annotations

import logging
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import requests
from app.core.defaults import expand_default_parent
from app.core.storage import StorageLayer
from app.workflows.short_term.flood_ews import DISTRICT_COORDS

logger = logging.getLogger(__name__)

RSS_URL = os.getenv("BMD_CAP_RSS_URL", "https://cap.bmd.gov.bd/api/cap/rss.xml")
_MIN_TIER = int(os.getenv("BMD_CAP_MIN_TIER", "2"))
_UA = {"User-Agent": "MEWA-Bangladesh/1.0 (warning_system_engine)"}
_CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2"

SEVERITY_TIER = {"extreme": 4, "severe": 3, "moderate": 2, "minor": 1, "unknown": 1}
TIER_LABELS = {0: "Normal", 1: "Advisory", 2: "Warning", 3: "Severe", 4: "Emergency"}

DIVISIONS: dict[str, list[str]] = {
    "dhaka": [
        "Dhaka",
        "Gazipur",
        "Narayanganj",
        "Narsingdi",
        "Manikganj",
        "Munshiganj",
        "Tangail",
        "Kishoreganj",
        "Faridpur",
        "Gopalganj",
        "Madaripur",
        "Rajbari",
        "Shariatpur",
    ],
    "chittagong": [
        "Chittagong",
        "Cox's Bazar",
        "Comilla",
        "Feni",
        "Brahmanbaria",
        "Chandpur",
        "Lakshmipur",
        "Noakhali",
        "Rangamati",
        "Khagrachhari",
        "Bandarban",
    ],
    "rajshahi": [
        "Rajshahi",
        "Natore",
        "Naogaon",
        "Chapainawabganj",
        "Pabna",
        "Sirajganj",
        "Bogura",
        "Joypurhat",
    ],
    "khulna": [
        "Khulna",
        "Bagerhat",
        "Satkhira",
        "Jashore",
        "Jhenaidah",
        "Magura",
        "Narail",
        "Kushtia",
        "Chuadanga",
        "Meherpur",
    ],
    "barisal": ["Barisal", "Patuakhali", "Bhola", "Pirojpur", "Jhalokathi", "Barguna"],
    "sylhet": ["Sylhet", "Moulvibazar", "Habiganj", "Sunamganj"],
    "rangpur": [
        "Rangpur",
        "Dinajpur",
        "Thakurgaon",
        "Panchagarh",
        "Nilphamari",
        "Lalmonirhat",
        "Kurigram",
        "Gaibandha",
    ],
    "mymensingh": ["Mymensingh", "Jamalpur", "Sherpur", "Netrokona"],
}
ALIASES = {
    "chattogram": "Chittagong",
    "cumilla": "Comilla",
    "barishal": "Barisal",
    "bogra": "Bogura",
    "jessore": "Jashore",
    "coxs bazar": "Cox's Bazar",
    "cox s bazar": "Cox's Bazar",
    "nawabganj": "Chapainawabganj",
    "chapai nawabganj": "Chapainawabganj",
    "jhalokati": "Jhalokathi",
    "netrakona": "Netrokona",
    "maulvibazar": "Moulvibazar",
    "b baria": "Brahmanbaria",
    "brahmanbaria": "Brahmanbaria",
}
PORTS = {
    "mongla": "Bagerhat",
    "payra": "Patuakhali",
    "chattogram port": "Chittagong",
    "chittagong port": "Chittagong",
}
COASTAL = [
    "Cox's Bazar",
    "Chittagong",
    "Noakhali",
    "Lakshmipur",
    "Feni",
    "Bhola",
    "Patuakhali",
    "Barguna",
    "Pirojpur",
    "Jhalokathi",
    "Barisal",
    "Bagerhat",
    "Khulna",
    "Satkhira",
    "Chandpur",
]
_ALL_LOWER = {n.lower(): n for n in DISTRICT_COORDS}
_unknown = sorted(
    {d for ds in DIVISIONS.values() for d in ds if d not in DISTRICT_COORDS}
    | {d for d in COASTAL if d not in DISTRICT_COORDS}
)
if _unknown:
    logger.warning("[BMD_CAP] tables reference unknown districts: %s", _unknown)


def _norm(name: str) -> str:
    n = name.lower().replace("’", "'").replace("'", " ").replace("-", " ")
    n = re.sub(r"\b(division|district|port|ports|area|areas|and|the|of)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def _point_in_polygon(lat: float, lon: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (
            (yj - yi) or 1e-12
        ) + xi:
            inside = not inside
        j = i
    return inside


def _parse_polygon(text: str) -> list[tuple[float, float]]:
    pts = []
    for pair in (text or "").split():
        try:
            a, b = pair.split(",")
            pts.append((float(a), float(b)))
        except ValueError:
            continue
    return pts if len(pts) >= 3 else []


def map_areas_to_districts(areas: list[dict]) -> tuple[list[str], bool]:
    """Return (districts, nationwide). Names first, then division/port/coastal words, then polygons."""
    found: set[str] = set()
    nationwide = False
    for area in areas:
        desc = area.get("areaDesc") or ""
        n = _norm(desc)
        matched = False
        if n in (
            "bangladesh",
            "whole country",
            "all over country",
            "entire country",
            "country",
        ):
            nationwide = True
            matched = True
        if n in _ALL_LOWER:
            found.add(_ALL_LOWER[n])
            matched = True
        if n in ALIASES:
            found.add(ALIASES[n])
            matched = True
        if n in PORTS:
            found.add(PORTS[n])
            matched = True
        if n in DIVISIONS:
            found.update(DIVISIONS[n])
            matched = True
        if not matched:
            for word in ("coastal", "maritime", "north bay", "bay of bengal", "sea"):
                if word in n:
                    found.update(COASTAL)
                    matched = True
                    break
        if not matched:
            for key, canon in {**_ALL_LOWER, **ALIASES, **PORTS}.items():
                if re.search(rf"\b{re.escape(key)}\b", n):
                    found.add(canon)
                    matched = True
        if not matched:
            for poly_text in area.get("polygons") or []:
                poly = _parse_polygon(poly_text)
                for name, (lat, lon) in DISTRICT_COORDS.items():
                    if poly and _point_in_polygon(lat, lon, poly):
                        found.add(name)
                        matched = True
    # A sub-district fallback location (Sapahar) inherits its district's warnings.
    return expand_default_parent(sorted(found)), nationwide


class BmdCapWatcher:
    def __init__(
        self, storage: StorageLayer, session: requests.Session | None = None
    ) -> None:
        self._storage = storage
        self._session = session or requests.Session()

    # ---------------------------------------------------------------- fetch
    def _rss_items(self) -> list[dict]:
        resp = self._session.get(RSS_URL, headers=_UA, timeout=20)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        items = []
        for it in root.iter("item"):
            link = (it.findtext("link") or "").strip()
            if not link:
                continue
            items.append(
                {
                    "link": link,
                    "title": (it.findtext("title") or "").strip(),
                    "pubDate": it.findtext("pubDate"),
                }
            )
        return items

    def _fetch_cap(self, url: str) -> dict | None:
        resp = self._session.get(url, headers=_UA, timeout=20)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        ns = {"c": _CAP_NS} if root.tag.startswith("{") else {}
        p = "c:" if ns else ""
        g = lambda el, path: (
            (el.findtext(path, namespaces=ns) if ns else el.findtext(path)) or ""
        ).strip()
        doc = {
            "identifier": g(root, f"{p}identifier"),
            "sent": g(root, f"{p}sent"),
            "status": g(root, f"{p}status"),
            "msgType": g(root, f"{p}msgType"),
            "source_url": url,
            "info": {},
            "areas": [],
        }
        for info in root.findall(f"{p}info", ns) if ns else root.findall("info"):
            lang = g(info, f"{p}language").lower()[:2] or "en"
            block = {
                "event": g(info, f"{p}event"),
                "category": g(info, f"{p}category"),
                "severity": g(info, f"{p}severity"),
                "urgency": g(info, f"{p}urgency"),
                "certainty": g(info, f"{p}certainty"),
                "headline": g(info, f"{p}headline"),
                "description": g(info, f"{p}description"),
                "instruction": g(info, f"{p}instruction"),
                "onset": g(info, f"{p}onset"),
                "expires": g(info, f"{p}expires"),
            }
            doc["info"][lang] = block
            if not doc["areas"]:
                for a in info.findall(f"{p}area", ns) if ns else info.findall("area"):
                    doc["areas"].append(
                        {
                            "areaDesc": g(a, f"{p}areaDesc"),
                            "polygons": [
                                (x.text or "").strip()
                                for x in (
                                    a.findall(f"{p}polygon", ns)
                                    if ns
                                    else a.findall("polygon")
                                )
                            ],
                        }
                    )
        en = doc["info"].get("en") or next(iter(doc["info"].values()), {})
        doc["event"] = en.get("event", "")
        doc["severity"] = en.get("severity", "Unknown")
        doc["urgency"] = en.get("urgency", "")
        doc["certainty"] = en.get("certainty", "")
        doc["expires"] = en.get("expires", "")
        doc["onset"] = en.get("onset", "")
        doc["tier"] = SEVERITY_TIER.get(doc["severity"].lower(), 1)
        doc["tier_label"] = TIER_LABELS[doc["tier"]]
        doc["districts"], doc["nationwide"] = map_areas_to_districts(doc["areas"])
        doc["area_names"] = [a["areaDesc"] for a in doc["areas"]]
        doc["fetched_at"] = datetime.now(timezone.utc).isoformat()
        return doc

    # ------------------------------------------------------------ pipeline
    @staticmethod
    def is_active(doc: dict, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        if doc.get("status") != "Actual" or doc.get("msgType") == "Cancel":
            return False
        exp = doc.get("expires") or ""
        try:
            return datetime.fromisoformat(exp) > now if exp else True
        except ValueError:
            return True

    def check_and_dispatch(self, notifier) -> dict:
        result = {"fetched": 0, "new": 0, "notified": 0, "active": 0, "errors": 0}
        try:
            items = self._rss_items()
        except Exception as exc:
            logger.error("[BMD_CAP] RSS fetch failed: %s", exc)
            return {**result, "error": str(exc)}
        result["fetched"] = len(items)
        for item in items:
            ident = item["link"].rsplit("/", 1)[-1].replace(".xml", "")
            try:
                existing = self._storage.get_bmd_alert(ident)
                if existing is None:
                    doc = self._fetch_cap(item["link"])
                    if not doc or not doc.get("identifier"):
                        continue
                    doc["rss_title"] = item["title"]
                    self._storage.upsert_bmd_alert(doc)
                    existing = doc
                    result["new"] += 1
                    logger.info(
                        "[BMD_CAP] new alert %s tier=%d districts=%s",
                        doc.get("event"),
                        doc["tier"],
                        doc["districts"]
                        or ("nationwide" if doc["nationwide"] else "none"),
                    )
                if self.is_active(existing):
                    result["active"] += 1
                    if existing.get("tier", 0) >= _MIN_TIER and not existing.get(
                        "notified_at"
                    ):
                        if notifier.dispatch_bmd_alert(existing):
                            self._storage.mark_bmd_alert_notified(
                                existing["identifier"]
                            )
                            result["notified"] += 1
            except Exception as exc:
                logger.error("[BMD_CAP] alert %s failed: %s", ident, exc)
                result["errors"] += 1
        logger.info("[BMD_CAP] check done: %s", result)
        return result
