#!/usr/bin/env python3
"""
WHO Public Health HTML Scraper — Maximum Coverage Edition
===========================================================
Discovers and scrapes ALL publicly accessible WHO HTML content from:

  Discovery methods (in order of yield):
    1. WHO Sitemaps       — who.int/sitemap.xml  (finds ALL pages at once)
    2. IRIS Sitemaps      — iris.who.int/sitemap.xml
    3. AFRO Sitemap       — afro.who.int sitemap
    4. EMRO Sitemap       — emro.who.int sitemap
    5. Manual seed URLs   — fact sheets, Q&A, topics, teams, bulletin,
                            WER, news releases, GHO, eLENA, ICD-11,
                            campaigns, country profiles, AFRO, EMRO

  Content types:
    - Fact sheets & Q&As
    - Health topics A-Z
    - NCD technical packages
    - WHO Bulletin open-access articles (bulletin.who.int)
    - Weekly Epidemiological Record (WER)
    - WHO News releases
    - Global Health Observatory data pages
    - eLENA nutrition evidence pages
    - ICD-11 disease descriptions
    - WHO Campaigns / World Health Days
    - Country profiles & cooperation strategies
    - AFRO regional content
    - EMRO regional content (Eastern Mediterranean / North Africa)
    - WHO training & e-learning pages
    - WHO medicines & vaccines pages
    - WHO patient safety pages

  Pair generation (20-30 pairs/page):
    - 15 question types per section
    - Health-worker scenario pairs
    - Multi-turn follow-up pairs
    - CHW counselling pairs

Estimated yield:
  ~5,000–10,000 HTML pages × ~22 pairs = 110,000–220,000 pairs

Usage:
  python scrape_who.py --output /root/amina-training/data/who/ --delay 1.2
  python scrape_who.py --output /root/amina-training/data/who/ --resume
"""

import requests
from bs4 import BeautifulSoup
import json, time, os, re, argparse, logging, random
from urllib.parse import urljoin, urlparse, urlencode
from datetime import datetime
import xml.etree.ElementTree as ET

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler("who_scrape.log")],
)
log = logging.getLogger(__name__)

WHO   = "https://www.who.int"
IRIS  = "https://iris.who.int"
AFRO  = "https://www.afro.who.int"
EMRO  = "https://www.emro.who.int"
BULL  = "https://www.who.int/bulletin"
WER   = "https://www.who.int/publications/journals/weekly-epidemiological-record"
GHO   = "https://www.who.int/data/gho"
ELENA = "https://www.who.int/tools/elena"
ICD   = "https://icd.who.int/browse/2024-01/mms/en"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AminaResearch/1.0; educational health AI; WHO public data only)",
    "Accept": "text/html,application/xhtml+xml,application/xml",
    "Accept-Language": "en-US,en;q=0.9",
}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)

# ── Sitemaps (auto-discovers ALL WHO pages) ───────────────────────────────────

SITEMAPS = [
    f"{WHO}/sitemap.xml",
    f"{WHO}/sitemap-news.xml",
    f"{IRIS}/sitemap.xml",
    f"{AFRO}/sitemap.xml",
    f"{EMRO}/sitemap.xml",
    f"https://www.who.int/sitemap-pages.xml",
]

# ── Manual seed URLs — comprehensive WHO coverage ────────────────────────────

SEED_URLS = [
    # ── Fact sheet index (paginated) ──────────────────────────────────────────
    f"{WHO}/news-room/fact-sheets",

    # ── Q&A index ─────────────────────────────────────────────────────────────
    f"{WHO}/news-room/questions-and-answers",

    # ── Health topics index ───────────────────────────────────────────────────
    f"{WHO}/health-topics",

    # ── WHO Bulletin (open-access journal) ────────────────────────────────────
    *[f"{BULL}/volumes/{vol}" for vol in range(90, 103)],   # vol 90-102 (2012-2024)

    # ── Weekly Epidemiological Record ─────────────────────────────────────────
    f"{WER}",
    *[f"{WHO}/publications/journals/weekly-epidemiological-record/issues/{yr}"
      for yr in range(2018, 2025)],

    # ── News releases (thousands of articles) ─────────────────────────────────
    f"{WHO}/news-room/releases",
    *[f"{WHO}/news-room/releases?sf_cacheKey=&sf_culture=en&newsType=undefined&year={yr}"
      for yr in range(2015, 2025)],

    # ── Global Health Observatory data pages ──────────────────────────────────
    f"{GHO}",
    f"{GHO}/data/themes/topics",
    f"{GHO}/data/themes/noncommunicable-diseases",
    f"{GHO}/data/themes/infectious-diseases",
    f"{GHO}/data/themes/maternal-newborn-child-adolescent",
    f"{GHO}/data/themes/nutrition",
    f"{GHO}/data/themes/mental-health",
    f"{GHO}/data/themes/injuries",
    f"{GHO}/data/themes/tobacco",
    f"{GHO}/data/themes/alcohol",

    # ── eLENA nutrition evidence library ─────────────────────────────────────
    f"{ELENA}",
    f"{WHO}/tools/elena/en",

    # ── ICD-11 (disease classification descriptions) ──────────────────────────
    f"{ICD}",
    f"https://icd.who.int/browse/2024-01/mms/en#/",

    # ── NCD teams & programmes ────────────────────────────────────────────────
    f"{WHO}/teams/noncommunicable-diseases",
    f"{WHO}/teams/noncommunicable-diseases/cardiovascular-diseases",
    f"{WHO}/teams/noncommunicable-diseases/diabetes",
    f"{WHO}/teams/noncommunicable-diseases/cancer",
    f"{WHO}/teams/noncommunicable-diseases/respiratory-diseases",
    f"{WHO}/teams/noncommunicable-diseases/tobacco",
    f"{WHO}/teams/noncommunicable-diseases/nutrition-and-food-safety",
    f"{WHO}/teams/noncommunicable-diseases/hypertension/hearts",
    f"{WHO}/teams/noncommunicable-diseases/diabetes/pen-plus",
    f"{WHO}/teams/noncommunicable-diseases/surveillance-monitoring-reporting",
    f"{WHO}/teams/mental-health-and-substance-use",
    f"{WHO}/teams/mental-health-and-substance-use/treatment-care/mental-health-gap-action-programme",

    # ── Infectious disease teams ──────────────────────────────────────────────
    f"{WHO}/teams/global-malaria-programme",
    f"{WHO}/teams/global-tuberculosis-programme",
    f"{WHO}/teams/global-hiv-hepatitis-and-stis-programmes",
    f"{WHO}/teams/control-of-neglected-tropical-diseases",
    f"{WHO}/teams/immunization-vaccines-and-biologicals",

    # ── Maternal, child, nutrition ────────────────────────────────────────────
    f"{WHO}/teams/maternal-newborn-child-adolescent-ageing",
    f"{WHO}/teams/nutrition-and-food-safety",

    # ── Health emergencies & outbreaks ────────────────────────────────────────
    f"{WHO}/emergencies/disease-outbreak-news",
    *[f"{WHO}/emergencies/disease-outbreak-news?sf_paged={p}" for p in range(2, 30)],

    # ── Medicines & health products ───────────────────────────────────────────
    f"{WHO}/teams/health-product-policy-and-standards/medicines-policy",
    f"{WHO}/teams/health-product-policy-and-standards/essential-medicines-and-health-products",
    f"{WHO}/medicines",
    f"{WHO}/immunization",

    # ── Campaigns / World Health Days ─────────────────────────────────────────
    f"{WHO}/campaigns/world-health-day",
    f"{WHO}/campaigns/world-tb-day",
    f"{WHO}/campaigns/world-malaria-day",
    f"{WHO}/campaigns/world-diabetes-day",
    f"{WHO}/campaigns/world-heart-day",
    f"{WHO}/campaigns/world-no-tobacco-day",
    f"{WHO}/campaigns/world-mental-health-day",
    f"{WHO}/campaigns/world-aids-day",
    f"{WHO}/campaigns/world-cancer-day",
    f"{WHO}/campaigns/world-immunization-week",

    # ── Country profiles ──────────────────────────────────────────────────────
    *[f"{WHO}/countries/{cc}" for cc in [
        "gmb","sen","gha","nga","ken","uga","tza","eth","cmr","civ",
        "mli","bfa","ner","gin","sle","lbr","cod","moz","mdg","zwe",
        "zmb","rwa","bdi","ssd","som","eri","tcd","caf","ago","bdi",
    ]],

    # ── WHO AFRO (Africa region) ───────────────────────────────────────────────
    f"{AFRO}/en/health-topics",
    f"{AFRO}/en/health-topics/noncommunicable-diseases",
    f"{AFRO}/en/health-topics/maternal-health",
    f"{AFRO}/en/health-topics/child-health",
    f"{AFRO}/en/health-topics/nutrition",
    f"{AFRO}/en/health-topics/malaria",
    f"{AFRO}/en/health-topics/tuberculosis",
    f"{AFRO}/en/health-topics/hiv-aids",
    f"{AFRO}/en/health-topics/diabetes",
    f"{AFRO}/en/health-topics/hypertension",
    f"{AFRO}/en/health-topics/mental-health",
    f"{AFRO}/en/health-topics/immunization",
    f"{AFRO}/en/health-topics/water-sanitation-and-hygiene",
    f"{AFRO}/en/health-topics/antimicrobial-resistance",
    f"{AFRO}/en/health-topics/neglected-tropical-diseases",
    f"{AFRO}/en/news/news",
    f"{AFRO}/en/publications",
    *[f"{AFRO}/en/publications?page={p}" for p in range(1, 20)],

    # ── WHO EMRO (Eastern Mediterranean / North Africa) ───────────────────────
    f"{EMRO}/en/health-topics",
    f"{EMRO}/en/health-topics/noncommunicable-diseases",
    f"{EMRO}/en/health-topics/malaria",
    f"{EMRO}/en/health-topics/tuberculosis",
    f"{EMRO}/en/health-topics/mental-health",
    f"{EMRO}/en/health-topics/maternal-health",
    f"{EMRO}/en/health-topics/nutrition",
    f"{EMRO}/en/health-topics/immunization",
    f"{EMRO}/en/publications/factsheets",
    f"{EMRO}/en/media/news",

    # ── Patient safety ────────────────────────────────────────────────────────
    f"{WHO}/teams/integrated-health-services/patient-safety",

    # ── Traditional medicine ──────────────────────────────────────────────────
    f"{WHO}/news-room/fact-sheets/detail/traditional-complementary-and-integrative-medicine",
    f"{WHO}/teams/health-product-policy-and-standards/traditional-complementary-integrative-medicine",

    # ── Ageing & disability ───────────────────────────────────────────────────
    f"{WHO}/teams/maternal-newborn-child-adolescent-ageing/ageing-and-health",
    f"{WHO}/teams/noncommunicable-diseases/sensory-functions-disability-and-rehabilitation",

    # ── Detailed NCD fact sheets ──────────────────────────────────────────────
    *[f"{WHO}/news-room/fact-sheets/detail/{slug}" for slug in [
        "noncommunicable-diseases", "diabetes", "hypertension",
        "cardiovascular-diseases-(cvds)", "cancer", "chronic-obstructive-pulmonary-disease-(copd)",
        "asthma", "obesity-and-overweight", "mental-disorders", "depression", "dementia",
        "stroke-(cerebrovascular-accident)", "chronic-kidney-disease", "physical-activity",
        "healthy-diet", "tobacco", "alcohol", "raised-blood-pressure", "raised-cholesterol",
        "blood-glucose", "ambient-(outdoor)-air-quality-and-health",
        "household-air-pollution-and-health", "malaria", "tuberculosis", "hiv-aids",
        "malnutrition", "anaemia", "pneumonia", "diarrhoeal-disease", "cholera",
        "dengue-and-severe-dengue", "yellow-fever", "hepatitis-b", "hepatitis-c",
        "schistosomiasis", "soil-transmitted-helminth-infections", "lymphatic-filariasis",
        "onchocerciasis", "leprosy", "meningitis", "typhoid", "rabies", "tetanus",
        "measles", "poliomyelitis", "maternal-mortality", "infant-and-young-child-feeding",
        "immunization-coverage", "child-mortality-reducing-the-global-toll-of-child-deaths",
        "newborns-reducing-mortality", "preterm-birth", "stillbirths",
        "female-genital-mutilation", "family-planning-contraception", "adolescent-pregnancy",
        "micronutrients", "vitamin-a-deficiency", "iron-deficiency-anaemia", "salt-reduction",
        "sugars-and-dental-caries", "trans-fat", "food-safety", "iodine-deficiency-disorders",
        "mental-health-strengthening-our-response", "schizophrenia", "bipolar-disorder",
        "autism-spectrum-disorders", "epilepsy", "suicide",
        "substance-use-and-addictive-behaviours", "falls", "road-traffic-injuries",
        "burns", "drowning", "poisoning", "violence-against-women", "child-maltreatment",
        "ageing-and-health", "disability-and-health", "blindness-and-vision-impairment",
        "deafness-and-hearing-loss", "sickle-cell-disease", "snakebite-envenomation",
        "antimicrobial-resistance", "water-sanitation-hygiene-(wash)", "drinking-water",
        "sanitation", "traditional-complementary-and-integrative-medicine",
        "vaccines-and-immunization-what-is-vaccination",
    ]],
]

# ── Question templates — 15 types × 5–6 variants ─────────────────────────────

TEMPLATES = {
    "overview": [
        "What is {topic}?",
        "Tell me about {topic}.",
        "What does WHO say about {topic}?",
        "Give me a complete overview of {topic}.",
        "I need to understand {topic}. Can you explain?",
        "What are the key facts about {topic} according to WHO?",
    ],
    "symptoms": [
        "What are the symptoms of {topic}?",
        "How do I know if I have {topic}?",
        "What signs should I watch for with {topic}?",
        "What does {topic} feel like in the body?",
        "My family member may have {topic}. What should I look for?",
        "What are the warning signs of {topic}?",
    ],
    "causes": [
        "What causes {topic}?",
        "Why do people get {topic}?",
        "What are the risk factors for {topic}?",
        "Who is most at risk of getting {topic}?",
        "How does {topic} develop in the body?",
        "Can {topic} be inherited or is it lifestyle-related?",
    ],
    "prevention": [
        "How can I prevent {topic}?",
        "What lifestyle changes help prevent {topic}?",
        "Is {topic} preventable?",
        "What can communities do to prevent {topic}?",
        "What does WHO recommend to reduce risk of {topic}?",
        "How do diet and exercise affect {topic}?",
    ],
    "treatment": [
        "How is {topic} treated?",
        "What medicines are used for {topic}?",
        "Can {topic} be cured?",
        "What happens if {topic} is left untreated?",
        "Are treatments for {topic} available in low-income countries?",
        "What is the first-line treatment for {topic}?",
    ],
    "emergency": [
        "When is {topic} an emergency?",
        "When should someone with {topic} go to hospital immediately?",
        "What are the danger signs of {topic}?",
        "How serious is {topic} if left untreated?",
        "What should I do if someone collapses due to {topic}?",
    ],
    "statistics": [
        "How many people worldwide have {topic}?",
        "How common is {topic} in Africa?",
        "How many deaths does {topic} cause each year globally?",
        "Is {topic} increasing or decreasing worldwide?",
        "What is the burden of {topic} in low-income countries?",
        "Which regions are most affected by {topic}?",
    ],
    "africa_context": [
        "How does {topic} affect people in sub-Saharan Africa?",
        "What are the challenges of managing {topic} in rural Africa?",
        "Why is {topic} especially common in West Africa?",
        "What are the biggest challenges for health workers dealing with {topic} in Africa?",
        "How does {topic} present differently in African populations?",
        "What progress has Africa made in fighting {topic}?",
    ],
    "children": [
        "How does {topic} affect children?",
        "Can children get {topic}?",
        "Is {topic} dangerous for babies and young children?",
        "What are the signs of {topic} in a child?",
        "How is {topic} treated differently in children versus adults?",
        "What should a parent do if they think their child has {topic}?",
    ],
    "pregnancy": [
        "Is {topic} dangerous during pregnancy?",
        "How does {topic} affect pregnant women?",
        "Can {topic} harm an unborn baby?",
        "What precautions should a pregnant woman take regarding {topic}?",
        "Should a pregnant woman continue her medication for {topic}?",
    ],
    "elderly": [
        "How does {topic} affect older people?",
        "Are elderly people more at risk of {topic}?",
        "How is {topic} managed differently in older patients?",
        "Does {topic} get worse with age?",
        "What special care do elderly patients with {topic} need?",
    ],
    "health_worker": [
        "As a community health worker, how should I screen for {topic}?",
        "What should a CHW do when they suspect a patient has {topic}?",
        "How should a health post manage a patient with {topic}?",
        "When should a CHW refer a patient with {topic} to a hospital?",
        "How can I counsel a patient about {topic} in simple language?",
        "What WHO tools help CHWs manage {topic} at community level?",
    ],
    "mechanism": [
        "How does {topic} damage the body over time?",
        "What happens inside the body during {topic}?",
        "Why does {topic} cause its symptoms?",
        "How does {topic} affect different organs?",
        "What is the biological process behind {topic}?",
    ],
    "community": [
        "How can a village or community reduce {topic}?",
        "What community programs help fight {topic}?",
        "How can traditional leaders help prevent {topic}?",
        "What role do community health workers play in controlling {topic}?",
        "How do we raise awareness about {topic} in rural communities?",
        "What community-level interventions does WHO recommend for {topic}?",
    ],
    "monitoring": [
        "How should patients with {topic} be monitored over time?",
        "What follow-up is needed for {topic}?",
        "What tests should be done regularly for {topic}?",
        "How do you know if treatment for {topic} is working?",
        "What complications of {topic} should health workers watch for?",
    ],
}

SCENARIO_TEMPLATES = [
    "A patient comes to the health post with symptoms of {topic}. Following WHO guidelines, what steps should the health worker take?",
    "A 50-year-old man with {topic} has stopped his medication because he feels better. As a CHW, how do you counsel him?",
    "A pregnant woman in her second trimester is found to have {topic}. What does WHO recommend in this situation?",
    "A mother brings her 3-year-old child who shows signs of {topic}. What should the CHW do at the health post?",
    "During a community outreach, you identify 5 people at high risk of {topic}. What is your action plan?",
    "A patient refuses conventional treatment for {topic}, preferring traditional medicine. How do you respond according to WHO guidance?",
    "A community health worker is training village volunteers about {topic}. What are the 3 most important messages to communicate?",
]

SYMPTOM_MAP = {
    "diabetes": "excessive thirst, frequent urination, and blurred vision",
    "hypertension": "severe headache, dizziness, and chest pain",
    "malaria": "fever, chills, sweating, and headache",
    "tuberculosis": "persistent cough for more than 2 weeks and night sweats",
    "anaemia": "extreme fatigue, pale skin, and shortness of breath",
    "pneumonia": "difficulty breathing, high fever, and productive cough",
    "diarrhoeal disease": "watery diarrhoea and signs of dehydration",
    "malnutrition": "severe weight loss and weakness",
    "depression": "persistent sadness and inability to perform daily activities",
    "epilepsy": "recurrent uncontrolled seizures",
    "sickle cell disease": "severe bone pain and fatigue crises",
    "cholera": "profuse watery diarrhoea like rice water and vomiting",
    "default": "worrying health symptoms",
}


# ── Scraping utilities ────────────────────────────────────────────────────────

def fetch(url: str, delay: float = 1.2) -> BeautifulSoup | None:
    try:
        time.sleep(delay + random.uniform(0.0, 0.6))
        r = SESSION.get(url, timeout=25)
        if r.status_code == 200:
            return BeautifulSoup(r.text, "html.parser")
        if r.status_code == 429:
            log.warning("Rate limited — sleeping 45 s")
            time.sleep(45)
        elif r.status_code not in (404, 403):
            log.debug(f"HTTP {r.status_code}: {url}")
        return None
    except Exception as e:
        log.debug(f"Fetch error {url}: {e}")
        return None


def clean(text: str) -> str:
    text = re.sub(r"\s+",      " ",  text).strip()
    text = re.sub(r"\[\d+\]",  "",   text)
    text = re.sub(r"\(©[^)]*\)","",  text)
    text = re.sub(r"https?://\S+","",text)
    return text.strip()


WHO_DOMAINS = {"who.int", "iris.who.int", "afro.who.int", "emro.who.int",
               "icd.who.int", "bulletin.who.int"}

def is_who_content_url(url: str) -> bool:
    p = urlparse(url)
    if not any(d in p.netloc for d in WHO_DOMAINS):
        return False
    if any(ext in p.path.lower() for ext in [".pdf",".doc",".xls",".zip",".jpg",".png",".gif",".css",".js"]):
        return False
    # Skip very short paths (homepages/indexes only)
    depth = len([x for x in p.path.split("/") if x])
    return depth >= 2


# ── Sitemap parsing ───────────────────────────────────────────────────────────

def parse_sitemap(url: str, delay: float) -> list[str]:
    """Parse a sitemap XML and return all article URLs within WHO domain."""
    urls = []
    try:
        time.sleep(delay)
        r = SESSION.get(url, timeout=30)
        if not r.ok:
            return []
        root = ET.fromstring(r.content)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

        # Sitemap index — recurse into sub-sitemaps
        for loc in root.findall(".//sm:sitemap/sm:loc", ns):
            sub_urls = parse_sitemap(loc.text.strip(), delay)
            urls.extend(sub_urls)

        # Regular sitemap — collect URLs
        for loc in root.findall(".//sm:url/sm:loc", ns):
            u = loc.text.strip()
            if is_who_content_url(u):
                urls.append(u)

    except Exception as e:
        log.debug(f"Sitemap parse error {url}: {e}")
    return urls


# ── Page content extraction ───────────────────────────────────────────────────

def extract_page(soup: BeautifulSoup, url: str) -> dict | None:
    title_el = soup.find("h1") or soup.find("h2", class_=re.compile("title|heading"))
    if not title_el:
        return None
    title = clean(title_el.get_text())
    if not title or len(title) < 5:
        return None

    content = (
        soup.find("div", class_=re.compile(r"sf-content-block|content-block|article-body|detail-content|page-content")) or
        soup.find("div", id=re.compile(r"content|main|body")) or
        soup.find("main") or soup.find("article") or
        soup.find("div", class_=re.compile(r"content"))
    )
    if not content:
        return None

    sections, cur_heading, cur_paras = [], "Key Facts", []
    for el in content.find_all(["h2", "h3", "h4", "p", "li"]):
        text = clean(el.get_text())
        if not text or len(text) < 20:
            continue
        if el.name in ("h2", "h3", "h4"):
            if cur_paras:
                sections.append({"heading": cur_heading, "content": " ".join(cur_paras)})
            cur_heading, cur_paras = text, []
        elif el.name in ("p", "li") and len(text) > 30:
            cur_paras.append(text)

    if cur_paras:
        sections.append({"heading": cur_heading, "content": " ".join(cur_paras)})

    sections = [s for s in sections if len(s["content"]) > 60]
    if not sections:
        return None

    full_text = " ".join(s["content"] for s in sections)
    if len(full_text) < 150:
        return None

    return {
        "title": title, "url": url, "sections": sections,
        "full_text": full_text,
        "scraped_at": datetime.utcnow().isoformat(),
        "source": "WHO", "license": "CC-BY-NC-SA-3.0-IGO",
    }


def collect_links(soup: BeautifulSoup, base_url: str) -> list[str]:
    links = set()
    for a in soup.find_all("a", href=True):
        full = urljoin(base_url, a["href"]).split("?")[0].split("#")[0]
        if is_who_content_url(full):
            links.add(full)
    return list(links)


def crawl_index(url: str, delay: float, max_index_pages: int = 60) -> list[str]:
    all_links, seen, queue = [], set(), [url]
    while queue and len(seen) < max_index_pages:
        pg = queue.pop(0)
        if pg in seen:
            continue
        seen.add(pg)
        soup = fetch(pg, delay)
        if not soup:
            continue
        links = collect_links(soup, pg)
        all_links.extend(links)
        for a in soup.find_all("a", href=True):
            href = a["href"]
            full = urljoin(pg, href).split("#")[0]
            if any(p in full for p in ["sf_paged=", "page=", "/page/", "offset=", "&start="]):
                if full not in seen:
                    queue.append(full)
    return list(set(all_links))


# ── Pair generation ───────────────────────────────────────────────────────────

def is_ncd(title: str) -> bool:
    NCD = ["diabetes","hypertension","cancer","cardiovascular","heart","stroke",
           "obesity","copd","asthma","mental","depression","dementia","kidney",
           "noncommunicable","cholesterol","respiratory","epilepsy","schizophrenia"]
    return any(w in title.lower() for w in NCD)


def heading_to_types(heading: str) -> list[str]:
    h = heading.lower()
    if any(w in h for w in ["overview","key fact","what is","about","introduction","background"]):
        return ["overview","health_worker","community","africa_context"]
    if any(w in h for w in ["symptom","sign","presentation","feature","manifestation"]):
        return ["symptoms","children","elderly","health_worker"]
    if any(w in h for w in ["cause","risk","etiology","transmission","pathogen"]):
        return ["causes","africa_context","mechanism"]
    if any(w in h for w in ["prevent","protect","avoid","reduc","control"]):
        return ["prevention","community","health_worker","africa_context"]
    if any(w in h for w in ["treatment","therapy","management","medicine","drug","cure"]):
        return ["treatment","children","pregnancy","elderly","health_worker"]
    if any(w in h for w in ["emergency","urgent","danger","severe","complication"]):
        return ["emergency","health_worker"]
    if any(w in h for w in ["statistic","burden","prevalence","global","death","mortality","epidemiology"]):
        return ["statistics","africa_context"]
    if any(w in h for w in ["diagnos","test","screen","assess","criteria"]):
        return ["health_worker","symptoms"]
    if any(w in h for w in ["monitor","follow","surveil","track"]):
        return ["monitoring","health_worker"]
    if any(w in h for w in ["who response","programme","initiative","strategy","response"]):
        return ["health_worker","community"]
    if any(w in h for w in ["africa","low-income","resource","rural","community","developing"]):
        return ["africa_context","community","health_worker"]
    return ["overview","health_worker","community"]


def make_pairs(page: dict) -> list[dict]:
    pairs   = []
    title   = page["title"]
    cat     = "ncd_who" if is_ncd(title) else "general_health_who"
    t_lower = title.lower().strip()
    symptom = SYMPTOM_MAP.get(t_lower, SYMPTOM_MAP["default"])

    for section in page["sections"]:
        content = section["content"]
        if len(content) < 80:
            continue
        heading  = section["heading"]
        qtypes   = heading_to_types(heading)

        for qtype in qtypes:
            tmpls  = TEMPLATES.get(qtype, TEMPLATES["overview"])
            chosen = random.sample(tmpls, min(2, len(tmpls)))
            for tmpl in chosen:
                q = tmpl.format(topic=title)
                if heading.lower() not in (t_lower, "key facts", "overview", "introduction"):
                    q = f"Regarding {heading.lower()} of {title}: {q}"
                pairs.append({
                    "instruction": q, "input": "",
                    "output": content[:1800],
                    "category": cat, "source": "who_public",
                    "source_url": page["url"], "source_title": title,
                    "section": heading, "license": "CC-BY-NC-SA-3.0-IGO",
                })

    # Full summary
    if len(page["full_text"]) > 400:
        pairs.append({
            "instruction": f"Give me a complete WHO overview of {title}.",
            "input": "", "output": page["full_text"][:2000],
            "category": cat, "source": "who_public",
            "source_url": page["url"], "source_title": title,
            "section": "full_summary", "license": "CC-BY-NC-SA-3.0-IGO",
        })

    # Scenario pairs (2 per page)
    best = max(page["sections"], key=lambda s: len(s["content"]), default=None)
    if best and len(best["content"]) > 100:
        for tmpl in random.sample(SCENARIO_TEMPLATES, min(2, len(SCENARIO_TEMPLATES))):
            pairs.append({
                "instruction": tmpl.format(topic=title, symptom=symptom),
                "input": "",
                "output": f"According to WHO on {title}: {best['content'][:1300]}",
                "category": f"{cat}_scenario", "source": "who_public_scenario",
                "source_url": page["url"], "source_title": title,
                "section": "scenario", "license": "CC-BY-NC-SA-3.0-IGO",
            })

    # Multi-turn follow-up
    if len(page["sections"]) >= 3:
        intro    = page["sections"][0]["content"][:200]
        followup = page["sections"][2]
        pairs.append({
            "instruction": f"You told me that {intro[:100]}... Can you tell me more about {followup['heading'].lower()}?",
            "input": "", "output": followup["content"][:1500],
            "category": f"{cat}_followup", "source": "who_public_multiturn",
            "source_url": page["url"], "source_title": title,
            "section": followup["heading"], "license": "CC-BY-NC-SA-3.0-IGO",
        })

    return pairs


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output",    default="/root/amina-training/data/who/")
    parser.add_argument("--delay",     type=float, default=1.2)
    parser.add_argument("--max_pages", type=int,   default=20000)
    parser.add_argument("--resume",    action="store_true")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)
    corpus_path = os.path.join(args.output, "who_raw_corpus.jsonl")
    pairs_path  = os.path.join(args.output, "who_training_pairs.jsonl")

    # ── Step 1: Sitemaps (fastest way to find ALL WHO URLs) ───────────────────
    log.info("=== Step 1: Parsing WHO sitemaps ===")
    article_urls = set()
    for sm in SITEMAPS:
        log.info(f"Parsing sitemap: {sm}")
        sm_urls = parse_sitemap(sm, args.delay)
        article_urls.update(sm_urls)
        log.info(f"  +{len(sm_urls)} URLs | total: {len(article_urls)}")

    # ── Step 2: Crawl index pages for more links ──────────────────────────────
    log.info(f"=== Step 2: Crawling index pages (have {len(article_urls)} from sitemaps) ===")
    index_seeds = [
        f"{WHO}/news-room/fact-sheets",
        f"{WHO}/news-room/questions-and-answers",
        f"{WHO}/health-topics",
        f"{AFRO}/en/publications",
        f"{EMRO}/en/publications/factsheets",
        f"{WHO}/news-room/releases",
        f"{WHO}/emergencies/disease-outbreak-news",
        f"{WHO}/bulletin",
        f"{IRIS}/browse",
    ]
    for seed in index_seeds:
        log.info(f"Crawling index: {seed}")
        links = crawl_index(seed, args.delay)
        article_urls.update(links)
        log.info(f"  +{len(links)} | total: {len(article_urls)}")

    # ── Step 3: Add all manual seed URLs ─────────────────────────────────────
    article_urls.update(SEED_URLS)
    log.info(f"Total unique URLs after all discovery: {len(article_urls)}")

    # ── Load already-scraped if resuming ──────────────────────────────────────
    scraped_urls = set()
    if args.resume and os.path.exists(corpus_path):
        with open(corpus_path, encoding="utf-8") as f:
            for line in f:
                try:
                    scraped_urls.add(json.loads(line)["url"])
                except Exception:
                    pass
        log.info(f"Resume: {len(scraped_urls)} pages already done")

    to_scrape = [u for u in list(article_urls)[:args.max_pages] if u not in scraped_urls]
    log.info(f"Pages to scrape this run: {len(to_scrape)}")

    corpus_f = open(corpus_path, "a", encoding="utf-8")
    pairs_f  = open(pairs_path,  "a", encoding="utf-8")

    total_pages = len(scraped_urls)
    total_pairs = 0
    failed      = 0

    try:
        for i, url in enumerate(to_scrape):
            soup = fetch(url, args.delay)
            if not soup:
                failed += 1
                continue
            page = extract_page(soup, url)
            if not page:
                failed += 1
                continue

            corpus_f.write(json.dumps(page, ensure_ascii=False) + "\n")
            corpus_f.flush()

            pairs = make_pairs(page)
            for p in pairs:
                pairs_f.write(json.dumps(p, ensure_ascii=False) + "\n")
            pairs_f.flush()

            total_pages += 1
            total_pairs += len(pairs)

            if (i + 1) % 25 == 0:
                log.info(
                    f"[{i+1}/{len(to_scrape)}] pages={total_pages} | "
                    f"pairs={total_pairs:,} | failed={failed} | last: {page['title'][:55]}"
                )

    finally:
        corpus_f.close()
        pairs_f.close()

    log.info("=== HTML Scraping Complete ===")
    with open(pairs_path, encoding="utf-8") as f:
        final = sum(1 for _ in f)
    log.info(f"Final pair count: {final:,}")
    print(f"\n✓ {final:,} training pairs → {pairs_path}")


if __name__ == "__main__":
    main()
