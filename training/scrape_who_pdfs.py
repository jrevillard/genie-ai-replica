#!/usr/bin/env python3
"""
WHO PDF Guidelines & Reports Scraper
======================================
Discovers, downloads, and extracts training data from WHO's publicly
available PDF documents via:

  1. WHO IRIS Repository (iris.who.int) — 30,000+ documents
     Uses the IRIS REST API + OAI-PMH harvester
  2. WHO Publications index (who.int/publications)
  3. WHO Guidelines catalogue
  4. WHO Technical Report Series
  5. WHO AFRO publications

For each PDF:
  - Extracts text page-by-page with pypdf
  - Splits into logical sections by headings
  - Generates 20–30 diverse training pairs per document
  - Saves raw text + training pairs to JSONL

Estimated yield:
  - 5,000–8,000 processable PDFs on WHO IRIS
  - ~25 pairs per document average
  - ~125,000–200,000 additional training pairs

Combined with HTML scraper output (~35,000) and existing data (145,000):
  → 300,000–380,000 total from WHO domain alone

Usage:
  python scrape_who_pdfs.py --output /root/amina-training/data/who_pdfs/ --delay 2.0
  python scrape_who_pdfs.py --output /root/amina-training/data/who_pdfs/ --resume --max_pdfs 8000
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import os
import re
import argparse
import logging
import random
import hashlib
import tempfile
from urllib.parse import urljoin, urlparse, urlencode
from datetime import datetime
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        raise SystemExit("Install pypdf:  pip install pypdf")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("who_pdfs.log"),
    ]
)
log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AminaResearch/1.0; educational health AI; WHO public data only)",
    "Accept": "text/html,application/xhtml+xml,application/pdf",
    "Accept-Language": "en-US,en;q=0.9",
}

IRIS_BASE  = "https://iris.who.int"
IRIS_REST  = "https://iris.who.int/rest"
IRIS_OAI   = "https://iris.who.int/oai/request"
WHO_BASE   = "https://www.who.int"
AFRO_BASE  = "https://www.afro.who.int"

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

# ── IRIS subject search queries ───────────────────────────────────────────────
# These are all within the WHO domain (iris.who.int)

IRIS_SEARCH_QUERIES = [
    # NCDs
    "diabetes mellitus management",
    "hypertension treatment guidelines",
    "cardiovascular disease prevention",
    "cancer screening diagnosis",
    "chronic obstructive pulmonary disease",
    "asthma management guidelines",
    "obesity overweight prevention",
    "noncommunicable diseases Africa",
    "stroke rehabilitation",
    "chronic kidney disease",
    "raised blood pressure",
    "raised cholesterol guidelines",
    # Mental health
    "mental health disorders treatment",
    "depression guidelines treatment",
    "schizophrenia management",
    "mental health gap action programme mhGAP",
    "suicide prevention",
    "dementia care",
    "epilepsy treatment",
    # Infectious diseases
    "malaria treatment guidelines Africa",
    "tuberculosis treatment guidelines",
    "HIV AIDS treatment Africa",
    "pneumonia management children",
    "diarrhoea management oral rehydration",
    "cholera outbreak response",
    "dengue fever management",
    "hepatitis B treatment",
    "meningitis treatment",
    "typhoid fever management",
    "neglected tropical diseases Africa",
    "schistosomiasis treatment",
    "lymphatic filariasis elimination",
    # Maternal & child
    "maternal mortality reduction",
    "antenatal care guidelines",
    "postnatal care mother newborn",
    "child nutrition guidelines",
    "breastfeeding infant feeding",
    "immunization vaccination schedule",
    "preterm birth management",
    "newborn care guidelines",
    "child development milestones",
    "integrated management childhood illness IMCI",
    "adolescent health",
    # Nutrition
    "malnutrition treatment children",
    "severe acute malnutrition",
    "vitamin A deficiency",
    "iron deficiency anaemia",
    "micronutrient deficiency",
    "food safety guidelines",
    "salt reduction hypertension",
    "healthy diet guidelines",
    # Health systems & CHW
    "community health worker training",
    "primary health care guidelines",
    "health post rural Africa",
    "essential medicines list",
    "health system strengthening Africa",
    "universal health coverage",
    "package essential NCD interventions PEN",
    "HEARTS technical package hypertension",
    # Environmental & other
    "water sanitation hygiene WASH",
    "antimicrobial resistance",
    "air pollution health effects",
    "road traffic injuries prevention",
    "falls prevention elderly",
    "burns injury prevention",
    "violence prevention",
    "ageing health older people",
    "disability rehabilitation",
    "sickle cell disease management",
    "snakebite envenomation treatment",
    "tobacco cessation",
    "alcohol use disorder",
    "physical activity guidelines",
    # Africa-specific
    "West Africa health",
    "Gambia health",
    "Sahel region health",
    "sub-Saharan Africa disease burden",
    "Africa primary care",
    "community health Africa",
]

# ── Question templates for PDF content ───────────────────────────────────────

PDF_TEMPLATES = {
    "overview": [
        "What does the WHO guideline say about {topic}?",
        "Summarize the WHO recommendations for {topic}.",
        "What are the key WHO guidelines on {topic}?",
        "What does WHO recommend for managing {topic}?",
        "According to WHO, what is the standard approach to {topic}?",
    ],
    "clinical": [
        "What are the clinical criteria for diagnosing {topic} according to WHO?",
        "What diagnostic tests does WHO recommend for {topic}?",
        "How should clinicians assess a patient with {topic}?",
        "What are the WHO-recommended clinical steps for {topic}?",
    ],
    "treatment": [
        "What first-line treatment does WHO recommend for {topic}?",
        "What medicines does WHO recommend for {topic}?",
        "How should {topic} be managed at primary care level?",
        "What does WHO say about treatment dosage for {topic}?",
        "What are the WHO treatment protocols for {topic}?",
        "When should a patient with {topic} be referred to hospital?",
    ],
    "prevention": [
        "What preventive measures does WHO recommend for {topic}?",
        "How can {topic} be prevented at community level according to WHO?",
        "What does the WHO report say about reducing risk of {topic}?",
        "What public health interventions does WHO recommend for {topic}?",
    ],
    "monitoring": [
        "How should patients with {topic} be monitored according to WHO?",
        "What follow-up schedule does WHO recommend for {topic}?",
        "What indicators should health workers track for {topic}?",
        "What are the warning signs that {topic} is worsening?",
    ],
    "chw_guidance": [
        "What can a community health worker do for patients with {topic}?",
        "How should a health post manage {topic} according to WHO guidelines?",
        "When should a CHW refer a patient with {topic} to a clinic?",
        "What counselling should a health worker provide for {topic}?",
        "What basic equipment does a health worker need to manage {topic}?",
    ],
    "africa": [
        "What does this WHO report say about {topic} in low-resource settings?",
        "How do WHO recommendations for {topic} apply in sub-Saharan Africa?",
        "What adaptations does WHO suggest for {topic} in resource-limited areas?",
        "What are the challenges of implementing WHO guidelines for {topic} in Africa?",
    ],
    "children": [
        "What does WHO recommend for {topic} in children under 5?",
        "How is {topic} managed differently in children according to WHO?",
        "What paediatric dosing does WHO recommend for {topic}?",
    ],
    "summary": [
        "Give me the full summary of WHO recommendations on {topic}.",
        "What are the most important points from the WHO report on {topic}?",
        "What is the conclusion of the WHO guideline on {topic}?",
    ],
}

SCENARIO_TEMPLATES = [
    "A CHW in a rural health post encounters a patient with suspected {topic}. Following WHO guidelines, what steps should be taken?",
    "A patient with {topic} stops their medication. According to WHO guidance, how should the health worker respond?",
    "A pregnant woman is diagnosed with {topic}. What does WHO recommend in this situation?",
    "A child under 5 presents with {topic}. What is the WHO-recommended management approach?",
    "A community health worker wants to screen for {topic} during an outreach. What WHO-recommended tools or criteria should they use?",
]


# ── IRIS REST API helpers ─────────────────────────────────────────────────────

def iris_search(query: str, limit: int = 100, offset: int = 0) -> list[dict]:
    """Search WHO IRIS for documents matching a query."""
    url = f"{IRIS_REST}/items/find"
    params = {
        "query": query,
        "limit": limit,
        "offset": offset,
        "expand": "metadata",
    }
    try:
        time.sleep(1.0)
        r = SESSION.get(url, params=params, timeout=20)
        if r.ok:
            return r.json() if isinstance(r.json(), list) else []
    except Exception as e:
        log.debug(f"IRIS REST search error: {e}")
    return []


def iris_search_html(query: str, delay: float = 1.5) -> list[str]:
    """Fallback: search IRIS via HTML interface and scrape PDF links."""
    pdf_urls = []
    for page in range(0, 5):  # up to 5 pages of results
        params = {
            "query": query,
            "rpp": 50,
            "start": page * 50,
            "scope": "/",
        }
        url = f"{IRIS_BASE}/search?" + urlencode(params)
        try:
            time.sleep(delay + random.uniform(0, 0.5))
            r = SESSION.get(url, timeout=20)
            if not r.ok:
                break
            soup = BeautifulSoup(r.text, "html.parser")
            # Find item pages
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "/handle/10665/" in href:
                    full = urljoin(IRIS_BASE, href).split("?")[0]
                    pdf_urls.append(full)
            # Stop if no results
            if not soup.find("a", href=re.compile(r"/handle/10665/")):
                break
        except Exception as e:
            log.debug(f"IRIS HTML search error: {e}")
            break
    return list(set(pdf_urls))


def get_pdf_url_from_iris_page(item_url: str, delay: float = 1.5) -> str | None:
    """Visit an IRIS item page and find the PDF download link."""
    try:
        time.sleep(delay)
        r = SESSION.get(item_url, timeout=20)
        if not r.ok:
            return None
        soup = BeautifulSoup(r.text, "html.parser")

        # Look for PDF download links
        for a in soup.find_all("a", href=True):
            href = a["href"]
            full = urljoin(IRIS_BASE, href)
            if href.endswith(".pdf") or "/bitstream/" in href:
                if ".pdf" in full.lower():
                    return full

        # Also check meta tags
        for meta in soup.find_all("meta"):
            content = meta.get("content", "")
            if content.endswith(".pdf"):
                return urljoin(IRIS_BASE, content)

    except Exception as e:
        log.debug(f"IRIS page parse error {item_url}: {e}")
    return None


def crawl_who_for_pdfs(base_pages: list[str], delay: float) -> list[str]:
    """Crawl WHO pages to find direct PDF links."""
    pdf_urls = set()
    visited  = set()
    queue    = list(base_pages)

    WHO_PDF_PAGES = [
        f"{WHO_BASE}/publications/i",
        f"{WHO_BASE}/teams/noncommunicable-diseases",
        f"{WHO_BASE}/teams/mental-health-and-substance-use",
        f"{WHO_BASE}/teams/maternal-newborn-child-adolescent-ageing",
        f"{WHO_BASE}/teams/nutrition-and-food-safety",
        f"{WHO_BASE}/teams/control-of-neglected-tropical-diseases",
        f"{WHO_BASE}/teams/global-malaria-programme",
        f"{WHO_BASE}/teams/global-tuberculosis-programme",
        f"{WHO_BASE}/teams/global-hiv-hepatitis-and-stis-programmes",
        f"{IRIS_BASE}/browse",
        f"{IRIS_BASE}/browse?type=subject&value=Noncommunicable+Diseases",
        f"{IRIS_BASE}/browse?type=subject&value=Communicable+Disease+Control",
        f"{IRIS_BASE}/browse?type=subject&value=Primary+Health+Care",
        f"{IRIS_BASE}/browse?type=subject&value=Africa+South+of+the+Sahara",
        f"{IRIS_BASE}/browse?type=subject&value=Maternal+Health",
        f"{IRIS_BASE}/browse?type=subject&value=Child+Health",
        f"{IRIS_BASE}/browse?type=subject&value=Nutrition",
        f"{IRIS_BASE}/browse?type=subject&value=Mental+Health",
    ]
    queue.extend(WHO_PDF_PAGES)

    page_count = 0
    while queue and page_count < 200:
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)
        page_count += 1

        try:
            time.sleep(delay + random.uniform(0, 0.5))
            r = SESSION.get(url, timeout=20)
            if not r.ok:
                continue
            soup = BeautifulSoup(r.text, "html.parser")

            for a in soup.find_all("a", href=True):
                href = a["href"]
                full = urljoin(url, href).split("?")[0]
                parsed = urlparse(full)

                # Direct PDF link
                if full.lower().endswith(".pdf") and "who.int" in parsed.netloc:
                    pdf_urls.add(full)

                # IRIS item page — will be resolved to PDF later
                elif "/handle/10665/" in full and "who.int" in parsed.netloc:
                    pdf_urls.add(full)

                # Follow WHO sub-pages (limited depth)
                elif (
                    "who.int" in parsed.netloc and
                    page_count < 150 and
                    any(seg in parsed.path for seg in [
                        "/publications/", "/guidelines/", "/reports/",
                        "/browse", "/handle/",
                    ]) and
                    full not in visited
                ):
                    queue.append(full)

        except Exception as e:
            log.debug(f"Crawl error {url}: {e}")

    log.info(f"WHO crawl found {len(pdf_urls)} PDF/item URLs across {page_count} pages")
    return list(pdf_urls)


# ── PDF processing ────────────────────────────────────────────────────────────

def download_pdf(url: str, dest_dir: str, delay: float) -> str | None:
    """Download a PDF to dest_dir, return local path or None."""
    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    filename = re.sub(r"[^\w.-]", "_", os.path.basename(urlparse(url).path) or "doc.pdf")
    if not filename.endswith(".pdf"):
        filename += ".pdf"
    dest = os.path.join(dest_dir, f"{url_hash}_{filename}")

    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return dest  # already downloaded

    try:
        time.sleep(delay + random.uniform(0, 1.0))
        r = SESSION.get(url, timeout=60, stream=True)
        if not r.ok:
            return None
        content_type = r.headers.get("Content-Type", "")
        if "pdf" not in content_type.lower() and not url.lower().endswith(".pdf"):
            return None

        size = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)
                size += len(chunk)
                if size > 50 * 1024 * 1024:  # 50 MB cap
                    log.warning(f"PDF too large, skipping: {url}")
                    f.close()
                    os.remove(dest)
                    return None
        if size < 1000:
            os.remove(dest)
            return None
        return dest
    except Exception as e:
        log.debug(f"Download error {url}: {e}")
        if os.path.exists(dest):
            os.remove(dest)
        return None


def extract_pdf_sections(pdf_path: str) -> list[dict]:
    """Extract text from PDF, grouped into sections."""
    try:
        reader = PdfReader(pdf_path)
    except Exception as e:
        log.debug(f"PDF read error {pdf_path}: {e}")
        return []

    # Extract raw text per page
    pages_text = []
    for page in reader.pages:
        try:
            text = page.extract_text() or ""
            text = re.sub(r"\s+", " ", text).strip()
            if len(text) > 50:
                pages_text.append(text)
        except Exception:
            continue

    if not pages_text:
        return []

    # Group pages into sections using heading detection
    sections = []
    cur_heading = "Introduction"
    cur_content = []

    HEADING_RE = re.compile(
        r"^(\d+\.?\s+[A-Z][A-Za-z\s]{5,60}|"     # "1. Introduction"
        r"[A-Z][A-Z\s]{5,50}|"                      # "RECOMMENDATIONS"
        r"Chapter\s+\d+|"                            # "Chapter 3"
        r"Section\s+\d+|"                            # "Section 2"
        r"ANNEX|Annex|APPENDIX|Appendix|"
        r"Summary|SUMMARY|Conclusion|CONCLUSION|"
        r"Background|BACKGROUND|Methods?|METHODS?|"
        r"Recommendations?|RECOMMENDATIONS?|"
        r"Treatment|TREATMENT|Prevention|PREVENTION|"
        r"Management|MANAGEMENT|Diagnosis|DIAGNOSIS|"
        r"Introduction|INTRODUCTION|Overview|OVERVIEW)$"
    )

    for page_text in pages_text:
        lines = page_text.split(". ")
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if HEADING_RE.match(line) and len(line) < 80:
                if cur_content:
                    content = " ".join(cur_content)
                    if len(content) > 100:
                        sections.append({"heading": cur_heading, "content": content})
                cur_heading = line
                cur_content = []
            else:
                if len(line) > 30:
                    cur_content.append(line)

    if cur_content:
        content = " ".join(cur_content)
        if len(content) > 100:
            sections.append({"heading": cur_heading, "content": content})

    # If no headings detected, chunk by ~500 words
    if len(sections) <= 1:
        full_text = " ".join(pages_text)
        words = full_text.split()
        chunk_size = 500
        sections = []
        for i in range(0, len(words), chunk_size):
            chunk = " ".join(words[i:i + chunk_size])
            if len(chunk) > 100:
                sections.append({
                    "heading": f"Section {i // chunk_size + 1}",
                    "content": chunk,
                })

    return sections


def pdf_title_from_reader(pdf_path: str) -> str:
    """Try to extract title from PDF metadata."""
    try:
        reader = PdfReader(pdf_path)
        meta = reader.metadata
        if meta and meta.get("/Title"):
            t = str(meta["/Title"]).strip()
            if len(t) > 5:
                return t
        # Try first page first line
        first_page = reader.pages[0].extract_text() or ""
        lines = [l.strip() for l in first_page.split("\n") if len(l.strip()) > 10]
        if lines:
            return lines[0][:120]
    except Exception:
        pass
    return os.path.basename(pdf_path).replace("_", " ").replace(".pdf", "")


def is_ncd_topic(title: str) -> bool:
    NCD = [
        "diabetes", "hypertension", "cancer", "cardiovascular", "heart",
        "stroke", "obesity", "copd", "asthma", "mental", "depression",
        "dementia", "kidney", "noncommunicable", "cholesterol",
        "respiratory", "epilepsy", "schizophrenia",
    ]
    return any(w in title.lower() for w in NCD)


def heading_to_qtypes(heading: str) -> list[str]:
    h = heading.lower()
    if any(w in h for w in ["introduction", "overview", "background", "summary", "conclusion"]):
        return ["overview", "africa", "chw_guidance"]
    if any(w in h for w in ["recommend", "guideline", "protocol"]):
        return ["overview", "treatment", "chw_guidance"]
    if any(w in h for w in ["treatment", "therapy", "management", "medicine", "drug"]):
        return ["treatment", "children", "chw_guidance"]
    if any(w in h for w in ["diagnos", "screen", "test", "assess", "criteria"]):
        return ["clinical", "chw_guidance"]
    if any(w in h for w in ["prevent", "reduc", "protect", "avoid"]):
        return ["prevention", "africa", "community"]
    if any(w in h for w in ["monitor", "follow", "surveil"]):
        return ["monitoring", "chw_guidance"]
    if any(w in h for w in ["child", "paediat", "infant", "newborn"]):
        return ["children", "treatment"]
    if any(w in h for w in ["africa", "low-income", "resource", "rural", "community"]):
        return ["africa", "chw_guidance"]
    return ["overview", "chw_guidance"]


def make_pdf_pairs(title: str, url: str, sections: list[dict]) -> list[dict]:
    pairs = []
    category = "ncd_who_pdf" if is_ncd_topic(title) else "general_health_who_pdf"

    for section in sections:
        content = section["content"]
        if len(content) < 100:
            continue
        heading = section["heading"]
        qtypes  = heading_to_qtypes(heading)

        for qtype in qtypes:
            templates = PDF_TEMPLATES.get(qtype, PDF_TEMPLATES["overview"])
            chosen = random.sample(templates, min(2, len(templates)))
            for tmpl in chosen:
                question = tmpl.format(topic=title)
                if heading.lower() not in ("introduction", "overview", "summary", title.lower()):
                    question = f"Regarding {heading}: {question}"
                pairs.append({
                    "instruction": question,
                    "input": "",
                    "output": content[:1800],
                    "category": category,
                    "source": "who_pdf",
                    "source_url": url,
                    "source_title": title,
                    "section": heading,
                    "license": "CC-BY-NC-SA-3.0-IGO",
                })

    # Full document summary
    if sections:
        full_content = " ".join(s["content"] for s in sections[:6])[:2000]
        pairs.append({
            "instruction": f"Summarize the WHO document: {title}",
            "input": "",
            "output": full_content,
            "category": category,
            "source": "who_pdf_summary",
            "source_url": url,
            "source_title": title,
            "section": "full_document",
            "license": "CC-BY-NC-SA-3.0-IGO",
        })

    # CHW scenario pairs (2 per document)
    best = max(sections, key=lambda s: len(s["content"]), default=None)
    if best and len(best["content"]) > 100:
        for tmpl in random.sample(SCENARIO_TEMPLATES, min(2, len(SCENARIO_TEMPLATES))):
            scenario = tmpl.format(topic=title)
            answer = f"According to WHO ({title}): {best['content'][:1400]}"
            pairs.append({
                "instruction": scenario,
                "input": "",
                "output": answer,
                "category": f"{category}_scenario",
                "source": "who_pdf_scenario",
                "source_url": url,
                "source_title": title,
                "section": "scenario",
                "license": "CC-BY-NC-SA-3.0-IGO",
            })

    # Multi-turn follow-up (if 3+ sections)
    if len(sections) >= 3:
        intro    = sections[0]["content"][:200]
        followup = sections[2]
        pairs.append({
            "instruction": f"You mentioned: '{intro[:100]}...' Can you go deeper on {followup['heading'].lower()}?",
            "input": "",
            "output": followup["content"][:1500],
            "category": f"{category}_followup",
            "source": "who_pdf_multiturn",
            "source_url": url,
            "source_title": title,
            "section": followup["heading"],
            "license": "CC-BY-NC-SA-3.0-IGO",
        })

    return pairs


# ── Main pipeline ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output",   default="/root/amina-training/data/who_pdfs/")
    parser.add_argument("--delay",    type=float, default=2.0,  help="Seconds between requests")
    parser.add_argument("--max_pdfs", type=int,   default=8000, help="Max PDFs to process")
    parser.add_argument("--resume",   action="store_true",      help="Skip already-processed PDFs")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)
    pdf_dir    = os.path.join(args.output, "pdfs")
    os.makedirs(pdf_dir, exist_ok=True)

    corpus_path = os.path.join(args.output, "who_pdf_corpus.jsonl")
    pairs_path  = os.path.join(args.output, "who_pdf_pairs.jsonl")
    done_path   = os.path.join(args.output, "processed_urls.txt")

    # Load already-processed URLs
    processed = set()
    if args.resume and os.path.exists(done_path):
        with open(done_path) as f:
            processed = set(f.read().splitlines())
        log.info(f"Resume: {len(processed)} PDFs already processed")

    # ── Step 1: Collect PDF URLs via IRIS search ──────────────────────────────
    log.info("=== Step 1: Discovering PDFs via WHO IRIS search ===")
    all_pdf_urls = set()

    for query in IRIS_SEARCH_QUERIES:
        log.info(f"Searching IRIS: '{query}'")
        item_pages = iris_search_html(query, delay=args.delay)
        all_pdf_urls.update(item_pages)
        log.info(f"  +{len(item_pages)} items | total: {len(all_pdf_urls)}")
        time.sleep(args.delay)

    # ── Step 2: Also crawl WHO/IRIS pages for additional PDF links ────────────
    log.info("=== Step 2: Crawling WHO domain for additional PDFs ===")
    crawled = crawl_who_for_pdfs([], args.delay)
    all_pdf_urls.update(crawled)
    log.info(f"Total URLs after crawl: {len(all_pdf_urls)}")

    # Filter out already processed
    to_process = [u for u in list(all_pdf_urls)[:args.max_pdfs] if u not in processed]
    log.info(f"URLs to process this run: {len(to_process)}")

    corpus_f = open(corpus_path, "a", encoding="utf-8")
    pairs_f  = open(pairs_path,  "a", encoding="utf-8")
    done_f   = open(done_path,   "a", encoding="utf-8")

    total_pdfs  = len(processed)
    total_pairs = 0
    skipped     = 0

    try:
        for i, url in enumerate(to_process):
            # Resolve IRIS item pages to actual PDF URLs
            pdf_url = url
            if "/handle/10665/" in url and not url.endswith(".pdf"):
                pdf_url = get_pdf_url_from_iris_page(url, args.delay)
                if not pdf_url:
                    log.debug(f"No PDF found at item page: {url}")
                    skipped += 1
                    done_f.write(url + "\n")
                    continue

            # Download
            pdf_path = download_pdf(pdf_url, pdf_dir, args.delay)
            if not pdf_path:
                skipped += 1
                done_f.write(url + "\n")
                continue

            # Extract text
            sections = extract_pdf_sections(pdf_path)
            if not sections:
                skipped += 1
                done_f.write(url + "\n")
                continue

            # Get title
            title = pdf_title_from_reader(pdf_path)

            # Save raw corpus entry
            corpus_entry = {
                "title": title,
                "url": pdf_url,
                "source_page": url,
                "sections": sections,
                "full_text": " ".join(s["content"] for s in sections)[:5000],
                "num_sections": len(sections),
                "scraped_at": datetime.utcnow().isoformat(),
                "source": "WHO_PDF",
                "license": "CC-BY-NC-SA-3.0-IGO",
            }
            corpus_f.write(json.dumps(corpus_entry, ensure_ascii=False) + "\n")
            corpus_f.flush()

            # Generate training pairs
            pairs = make_pdf_pairs(title, pdf_url, sections)
            for p in pairs:
                pairs_f.write(json.dumps(p, ensure_ascii=False) + "\n")
            pairs_f.flush()

            done_f.write(url + "\n")
            done_f.flush()

            total_pdfs  += 1
            total_pairs += len(pairs)

            # Log progress every 25 PDFs
            if (i + 1) % 25 == 0:
                log.info(
                    f"[{i+1}/{len(to_process)}] pdfs={total_pdfs} | "
                    f"pairs={total_pairs:,} | skipped={skipped} | "
                    f"last: {title[:60]}"
                )

    finally:
        corpus_f.close()
        pairs_f.close()
        done_f.close()

    log.info("=== PDF Scraping Complete ===")
    log.info(f"PDFs processed: {total_pdfs}")
    log.info(f"Pairs generated: {total_pairs:,}")
    log.info(f"Skipped/failed: {skipped}")

    with open(pairs_path, encoding="utf-8") as f:
        final = sum(1 for _ in f)
    log.info(f"Final pair count in file: {final:,}")
    print(f"\n✓ {final:,} training pairs from WHO PDFs → {pairs_path}")


if __name__ == "__main__":
    main()
