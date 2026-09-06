"""
BAMIS special bulletin watcher.

Checks https://www.bamis.gov.bd/bulletin/special/archive/ for new special
agro-weather bulletins. BAMIS publishes these bulletins for near-term hazards
such as heavy rain, flash flood, drought, cyclone, heat, or similar events.

This module is intentionally independent from weather-mcp-service: it belongs
to warning_system_engine because it classifies, deduplicates, and notifies.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from io import BytesIO
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import requests

if False:  # type-checking without runtime import cost
    from app.core.notifier import Notifier
    from app.core.storage import StorageLayer

logger = logging.getLogger(__name__)

ARCHIVE_URL = "https://www.bamis.gov.bd/bulletin/special/archive/"
BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
BN_MONTHS = {
    "জানুয়ারি": "01",
    "ফেব্রুয়ারি": "02",
    "মার্চ": "03",
    "এপ্রিল": "04",
    "মে": "05",
    "জুন": "06",
    "জুলাই": "07",
    "আগস্ট": "08",
    "সেপ্টেম্বর": "09",
    "অক্টোবর": "10",
    "নভেম্বর": "11",
    "ডিসেম্বর": "12",
}


@dataclass(frozen=True)
class SpecialBulletin:
    source_id: str
    title: str
    published_date: str
    url: str
    tier: int
    tier_label: str
    hazard_types: list[str]
    danger_terms: list[str]
    message: str
    detail_url: str = ""
    attachment_url: str = ""
    content_excerpt: str = ""
    date_parse_failed: bool = False

    def as_doc(self) -> dict:
        return {
            "source_id": self.source_id,
            "title": self.title,
            "published_date": self.published_date,
            "published_at": self.published_date,
            "url": self.url,
            "detail_url": self.detail_url,
            "attachment_url": self.attachment_url,
            "tier": self.tier,
            "tier_label": self.tier_label,
            "hazard_types": self.hazard_types,
            "danger_terms": self.danger_terms,
            "message": self.message,
            "content_excerpt": self.content_excerpt,
            "date_parse_failed": self.date_parse_failed,
            "source": "bamis_special_bulletin",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }


class _ArchiveTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[dict] = []
        self._in_tr = False
        self._in_td = False
        self._current_cells: list[str] = []
        self._cell_parts: list[str] = []
        self._current_href = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._in_tr = True
            self._current_cells = []
            self._current_href = ""
        elif self._in_tr and tag == "td":
            self._in_td = True
            self._cell_parts = []
        elif self._in_tr and tag == "a":
            attrs_dict = dict(attrs)
            href = attrs_dict.get("href") or ""
            if href:
                self._current_href = href

    def handle_data(self, data: str) -> None:
        if self._in_td:
            text = " ".join(data.split())
            if text:
                self._cell_parts.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._in_td:
            cell_content = " ".join(self._cell_parts).strip()
            self._current_cells.append(cell_content)
            self._in_td = False
            self._cell_parts = []
        elif tag == "tr" and self._in_tr:
            if len(self._current_cells) >= 2 and self._current_href:
                date_cell = self._current_cells[0]
                if any(char.isdigit() or char in "০১২৩৪৫৬৭৮৯" for char in date_cell):
                    self.rows.append({
                        "date": date_cell,
                        "title": self._current_cells[1],
                        "url": self._current_href,
                    })
            self._in_tr = False


class _DetailPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        for attr in ("href", "src"):
            value = attrs_dict.get(attr) or ""
            if value:
                self.links.append(value)

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if text:
            self.text_parts.append(text)


class BamisSpecialBulletinEWS:
    def __init__(
        self,
        storage: "StorageLayer",
        archive_url: str | None = None,
        max_new_per_run: int | None = None,
    ) -> None:
        self._storage = storage
        self._archive_url = archive_url or os.getenv("BAMIS_SPECIAL_BULLETIN_URL", ARCHIVE_URL)
        self._max_new_per_run = max_new_per_run or int(
            os.getenv("BAMIS_SPECIAL_BULLETIN_MAX_NEW_PER_RUN", "3")
        )
        self._enrich_max_rows = int(os.getenv("BAMIS_SPECIAL_BULLETIN_ENRICH_MAX_ROWS", "10"))
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "MEWA-warning-system/1.0"})

    def check_and_dispatch(self, notifier: "Notifier") -> dict:
        bulletins = self.fetch_archive()
        initial_sync = self._storage.count_special_bulletins() == 0
        stored = 0
        notified = 0
        suppressed = 0
        stale = 0
        errors = 0
        new_seen = 0

        if initial_sync:
            for bulletin in bulletins:
                try:
                    self._storage.upsert_special_bulletin(bulletin.as_doc())
                    self._storage.mark_special_bulletin_notified(bulletin.source_id)
                    stored += 1
                except Exception as exc:
                    errors += 1
                    logger.error(
                        "[BAMIS_SPECIAL] Failed to baseline bulletin %s: %s",
                        bulletin.url,
                        exc,
                    )

            result = {
                "status": "ok" if errors == 0 else "partial",
                "fetched": len(bulletins),
                "stored": stored,
                "new_seen": 0,
                "notified": 0,
                "suppressed": stored,
                "stale": 0,
                "errors": errors,
                "initial_sync": True,
            }
            logger.info(
                "[BAMIS_SPECIAL] Baseline sync stored %d existing bulletin(s); no notifications sent",
                stored,
            )
            return result

        for bulletin in bulletins:
            try:
                _, is_new = self._storage.upsert_special_bulletin(bulletin.as_doc())
                stored += 1

                if self._storage.was_special_bulletin_alert_sent(bulletin.source_id):
                    suppressed += 1
                    continue

                if _is_stale_bulletin(bulletin.published_date):
                    self._storage.mark_special_bulletin_notified(bulletin.source_id)
                    suppressed += 1
                    stale += 1
                    logger.info(
                        "[BAMIS_SPECIAL] Stale bulletin recorded without push — %s | %s",
                        bulletin.published_date,
                        bulletin.title,
                    )
                    continue

                if is_new:
                    new_seen += 1
                else:
                    logger.info(
                        "[BAMIS_SPECIAL] Retrying previously queued bulletin — %s",
                        bulletin.title,
                    )
                if notified >= self._max_new_per_run:
                    logger.warning(
                        "[BAMIS_SPECIAL] New bulletin queued for next run due to per-run cap — %s",
                        bulletin.title,
                    )
                    continue

                ok = notifier.dispatch_special_bulletin(bulletin.as_doc())
                if ok:
                    self._storage.mark_special_bulletin_notified(bulletin.source_id)
                    notified += 1
                    logger.warning(
                        "[BAMIS_SPECIAL] New special bulletin notified — %s | %s",
                        bulletin.published_date,
                        bulletin.title,
                    )
            except Exception as exc:
                errors += 1
                logger.error("[BAMIS_SPECIAL] Failed to process bulletin %s: %s", bulletin.url, exc)

        result = {
            "status": "ok" if errors == 0 else "partial",
            "fetched": len(bulletins),
            "stored": stored,
            "new_seen": new_seen,
            "notified": notified,
            "suppressed": suppressed,
            "stale": stale,
            "errors": errors,
            "initial_sync": False,
        }
        logger.info("[BAMIS_SPECIAL] check_and_dispatch done: %s", result)
        return result

    def fetch_archive(self) -> list[SpecialBulletin]:
        response = self._session.get(
            self._archive_url,
            timeout=20,
        )
        response.raise_for_status()
        response.encoding = response.encoding or "utf-8"

        parser = _ArchiveTableParser()
        parser.feed(response.text)

        bulletins = [
            self._to_bulletin(row, enrich_details=index < self._enrich_max_rows)
            for index, row in enumerate(parser.rows)
        ]
        return [b for b in bulletins if b is not None]

    def _to_bulletin(self, row: dict, enrich_details: bool = True) -> SpecialBulletin | None:
        title = row.get("title", "").strip()
        detail_url = urljoin(self._archive_url, row.get("url", "").strip())
        if not title or not detail_url:
            return None

        parsed_date = _parse_bangla_date(row.get("date", ""))
        date_parse_failed = parsed_date is None
        if date_parse_failed:
            logger.error(
                "[BAMIS_SPECIAL] Could not parse bulletin date %r for %s; row will not be pushed",
                row.get("date", ""),
                title,
            )
        published_date = parsed_date or ""

        attachment_url, content_text = ("", "")
        if enrich_details:
            attachment_url, content_text = self._fetch_bulletin_content(detail_url)
        hazards, tier, tier_label, danger_terms = _classify_bulletin(title, content_text)
        bulletin_url = attachment_url or detail_url
        source_id = _source_id(detail_url, title, published_date)
        hazard_text = ", ".join(hazards) if hazards else "special weather risk"
        danger_text = f" Danger level: {', '.join(danger_terms)}." if danger_terms else ""
        message = (
            f"BAMIS special bulletin ({tier_label}): {title}. "
            f"Potential 48-hour risk: {hazard_text}.{danger_text} Review advisory now."
        )

        return SpecialBulletin(
            source_id=source_id,
            title=title,
            published_date=published_date,
            url=bulletin_url,
            tier=tier,
            tier_label=tier_label,
            hazard_types=hazards,
            danger_terms=danger_terms,
            message=message,
            detail_url=detail_url,
            attachment_url=attachment_url,
            content_excerpt=_excerpt(content_text),
            date_parse_failed=date_parse_failed,
        )

    def _fetch_bulletin_content(self, detail_url: str) -> tuple[str, str]:
        """Return (attachment_url, extracted_text) from the detail page or direct PDF."""
        try:
            response = self._session.get(detail_url, timeout=25)
            response.raise_for_status()
        except Exception as exc:
            logger.warning("[BAMIS_SPECIAL] Detail fetch failed for %s: %s", detail_url, exc)
            return "", ""

        content_type = response.headers.get("Content-Type", "").lower()
        if _looks_like_pdf(detail_url, content_type, response.content):
            return detail_url, _extract_pdf_text(response.content, detail_url)

        response.encoding = response.encoding or "utf-8"
        parser = _DetailPageParser()
        parser.feed(response.text)
        page_text = " ".join(parser.text_parts)
        pdf_url = _find_pdf_url(detail_url, parser.links)
        if not pdf_url:
            return "", page_text

        try:
            pdf_response = self._session.get(pdf_url, timeout=30)
            pdf_response.raise_for_status()
        except Exception as exc:
            logger.warning("[BAMIS_SPECIAL] PDF fetch failed for %s: %s", pdf_url, exc)
            return pdf_url, page_text

        pdf_text = _extract_pdf_text(pdf_response.content, pdf_url)
        return pdf_url, " ".join(part for part in (page_text, pdf_text) if part)


def _parse_bangla_date(value: str) -> str | None:
    text = " ".join(value.replace("\xa0", " ").translate(BN_DIGITS).split())
    parts = text.split()
    if len(parts) >= 3:
        day = re.sub(r"\D", "", parts[0]).zfill(2)
        month_name = parts[1].strip()
        month = BN_MONTHS.get(month_name, "")
        year = re.sub(r"\D", "", parts[2])
        if day and month and len(year) == 4:
            return f"{year}-{month}-{day}"
    return None


def _is_stale_bulletin(published_date: str) -> bool:
    if not published_date:
        return True
    try:
        cutoff = datetime.now(ZoneInfo("Asia/Dhaka")).date() - timedelta(days=1)
    except Exception:
        cutoff = datetime.now(timezone.utc).date() - timedelta(days=1)
    try:
        published = datetime.strptime(published_date, "%Y-%m-%d").date()
    except ValueError:
        logger.error("[BAMIS_SPECIAL] Invalid parsed date %r; treating bulletin as stale", published_date)
        return True
    return published < cutoff


def _classify_bulletin(title: str, content_text: str = "") -> tuple[list[str], int, str, list[str]]:
    t = f"{title} {content_text}".lower()
    hazards: list[str] = []
    danger_terms: list[str] = []
    tier = 2

    def add(name: str) -> None:
        if name not in hazards:
            hazards.append(name)

    def add_danger(term: str) -> None:
        if term not in danger_terms:
            danger_terms.append(term)

    if any(word in t for word in ("বন্যা", "flood")):
        add("flood")
        tier = max(tier, 3)
    if any(word in t for word in ("ভারী বৃষ্টিপাত", "heavy rain", "rainfall")):
        add("heavy_rain")
        tier = max(tier, 3)
    if any(word in t for word in ("খরা", "drought")):
        add("drought")
        tier = max(tier, 3)
    if any(word in t for word in ("ঘূর্ণিঝড়", "ঘূর্ণিঝড়", "cyclone", "storm")):
        add("cyclone")
        tier = max(tier, 4)
    if any(word in t for word in ("তাপপ্রবাহ", "heatwave", "heat wave")):
        add("heatwave")
        tier = max(tier, 3)
    if any(word in t for word in ("শৈত্যপ্রবাহ", "cold wave")):
        add("cold_wave")
        tier = max(tier, 3)

    if any(word in t for word in ("মহাবিপদ", "great danger", "great-danger", "signal no. 10", "signal number 10")):
        add_danger("great_danger")
        tier = max(tier, 4)
    if any(word in t for word in ("বিপদ সংকেত", "danger signal", "danger level", "signal no. 7", "signal no. 8", "signal no. 9")):
        add_danger("danger")
        tier = max(tier, 3)
    if any(word in t for word in ("সতর্ক সংকেত", "warning signal", "cautionary signal", "সতর্কতা")):
        add_danger("warning")
        tier = max(tier, 2)
    if any(word in t for word in ("অতি ভারী", "very heavy", "extremely heavy", "severe", "জলোচ্ছ্বাস")):
        add_danger("severe_conditions")
        tier = max(tier, 3)

    if not hazards:
        add("special_weather_bulletin")

    labels = {2: "Warning", 3: "Severe", 4: "Emergency"}
    return hazards, tier, labels.get(tier, "Warning"), danger_terms


def _find_pdf_url(detail_url: str, links: list[str]) -> str:
    for link in links:
        absolute = urljoin(detail_url, link.strip())
        parsed = urlparse(absolute)
        if parsed.path.lower().endswith(".pdf") or ".pdf" in parsed.query.lower():
            return absolute
    return ""


def _looks_like_pdf(url: str, content_type: str, content: bytes) -> bool:
    return (
        urlparse(url).path.lower().endswith(".pdf")
        or "application/pdf" in content_type
        or content.startswith(b"%PDF")
    )


def _extract_pdf_text(content: bytes, url: str) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        logger.warning("[BAMIS_SPECIAL] pypdf is not installed; cannot parse PDF text from %s", url)
        return ""

    try:
        reader = PdfReader(BytesIO(content))
        text_parts = [(page.extract_text() or "") for page in reader.pages[:8]]
        return " ".join(" ".join(text_parts).split())
    except Exception as exc:
        logger.warning("[BAMIS_SPECIAL] PDF text extraction failed for %s: %s", url, exc)
        return ""


def _excerpt(text: str, limit: int = 800) -> str:
    clean = " ".join(text.split())
    if len(clean) <= limit:
        return clean
    return clean[:limit].rstrip()


def _source_id(url: str, title: str, published_date: str) -> str:
    path = urlparse(url).path.strip("/")
    if path:
        return f"bamis__{path.replace('/', '_')}"
    digest = hashlib.sha256(f"{published_date}:{title}:{url}".encode("utf-8")).hexdigest()[:16]
    return f"bamis__{digest}"
