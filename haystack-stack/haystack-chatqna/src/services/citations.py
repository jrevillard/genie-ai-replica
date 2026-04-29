"""
Source Citation Service — maps tools + topics to legitimate health references.

Every clinical response from AMINA should cite its source. This service
provides deterministic URL mappings (no LLM needed, <1ms).

Sources are WHO PEN protocols, WHO guidelines, and Gambian MoH resources.
"""

from typing import List, Dict, Any, Optional


# Tool → citation mapping. Each tool can cite multiple sources.
TOOL_CITATIONS: Dict[str, List[Dict[str, str]]] = {
    "manage_diabetes": [
        {
            "title": "WHO PEN — Diabetes Protocol",
            "url": "https://www.who.int/publications/i/item/who-pen-protocol-1",
            "org": "WHO",
        },
        {
            "title": "WHO — Diabetes Fact Sheet",
            "url": "https://www.who.int/news-room/fact-sheets/detail/diabetes",
            "org": "WHO",
        },
    ],
    "manage_hypertension": [
        {
            "title": "WHO PEN — Hypertension Protocol",
            "url": "https://www.who.int/publications/i/item/who-pen-protocol-2",
            "org": "WHO",
        },
        {
            "title": "WHO — Guideline for Pharmacological Treatment of Hypertension",
            "url": "https://www.who.int/publications/i/item/9789240033986",
            "org": "WHO",
        },
    ],
    "assess_cvd_risk": [
        {
            "title": "WHO PEN — CVD Risk Assessment Protocol",
            "url": "https://www.who.int/publications/i/item/who-pen-protocol-3",
            "org": "WHO",
        },
        {
            "title": "WHO CVD Risk Charts",
            "url": "https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)",
            "org": "WHO",
        },
    ],
    "assess_respiratory": [
        {
            "title": "WHO PEN — Asthma & COPD Protocol",
            "url": "https://www.who.int/publications/i/item/who-pen-protocol-4",
            "org": "WHO",
        },
    ],
    "screen_cancer": [
        {
            "title": "WHO — Cancer Early Diagnosis",
            "url": "https://www.who.int/publications/i/item/9789241511940",
            "org": "WHO",
        },
    ],
    "counsel_lifestyle": [
        {
            "title": "WHO — Healthy Diet Fact Sheet",
            "url": "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
            "org": "WHO",
        },
        {
            "title": "WHO — Physical Activity Guidelines",
            "url": "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
            "org": "WHO",
        },
    ],
    "get_diet_advice": [
        {
            "title": "WHO — Healthy Diet Fact Sheet",
            "url": "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
            "org": "WHO",
        },
    ],
    "get_medication_info": [
        {
            "title": "WHO Essential Medicines List",
            "url": "https://www.who.int/publications/i/item/WHO-MHP-HPS-EML-2023.02",
            "org": "WHO",
        },
    ],
    "record_vitals": [
        {
            "title": "WHO PEN — Cardiovascular Risk Management",
            "url": "https://www.who.int/publications/i/item/who-pen-protocol-2",
            "org": "WHO",
        },
    ],
    "assess_triage": [
        {
            "title": "WHO PEN — Package of Essential NCD Interventions",
            "url": "https://www.who.int/publications/i/item/9789240009226",
            "org": "WHO",
        },
    ],
    "check_emergency": [
        {
            "title": "WHO — Emergency Care",
            "url": "https://www.who.int/health-topics/emergency-care",
            "org": "WHO",
        },
    ],
    "check_ramadan": [
        {
            "title": "IDF — Diabetes and Ramadan Guidelines",
            "url": "https://www.idf.org/our-activities/education/diabetes-and-ramadan.html",
            "org": "IDF",
        },
    ],
    "analyze_prescription": [
        {
            "title": "WHO Essential Medicines List",
            "url": "https://www.who.int/publications/i/item/WHO-MHP-HPS-EML-2023.02",
            "org": "WHO",
        },
    ],
    "search_knowledge": [
        {
            "title": "WHO PEN — Package of Essential NCD Interventions",
            "url": "https://www.who.int/publications/i/item/9789240009226",
            "org": "WHO",
        },
    ],
    "suggest_community_support": [
        {
            "title": "The Gambia NCD Strategy 2022–2027",
            "url": "https://www.afro.who.int/countries/gambia",
            "org": "MoH Gambia / WHO AFRO",
        },
    ],
}

# Keyword → citation for general health queries that don't hit a specific tool
KEYWORD_CITATIONS: List[Dict[str, Any]] = [
    {
        "keywords": ["diabetes", "sugar", "glucose", "metformin", "insulin"],
        "citation": {
            "title": "WHO — Diabetes",
            "url": "https://www.who.int/news-room/fact-sheets/detail/diabetes",
            "org": "WHO",
        },
    },
    {
        "keywords": ["blood pressure", "hypertension", "bp", "amlodipine", "lisinopril"],
        "citation": {
            "title": "WHO — Hypertension",
            "url": "https://www.who.int/news-room/fact-sheets/detail/hypertension",
            "org": "WHO",
        },
    },
    {
        "keywords": ["heart", "cardiovascular", "cvd", "stroke", "chest pain"],
        "citation": {
            "title": "WHO — Cardiovascular Diseases",
            "url": "https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)",
            "org": "WHO",
        },
    },
    {
        "keywords": ["smoking", "tobacco", "quit smoking"],
        "citation": {
            "title": "WHO — Tobacco Cessation Guidelines",
            "url": "https://www.who.int/publications/i/item/9789240044456",
            "org": "WHO",
        },
    },
    {
        "keywords": ["asthma", "copd", "inhaler", "breathing", "respiratory"],
        "citation": {
            "title": "WHO — Chronic Respiratory Diseases",
            "url": "https://www.who.int/health-topics/chronic-respiratory-diseases",
            "org": "WHO",
        },
    },
    {
        "keywords": ["cancer", "lump", "screening", "cervical"],
        "citation": {
            "title": "WHO — Cancer",
            "url": "https://www.who.int/news-room/fact-sheets/detail/cancer",
            "org": "WHO",
        },
    },
    {
        "keywords": ["diet", "food", "nutrition", "salt", "exercise", "weight"],
        "citation": {
            "title": "WHO — Healthy Diet",
            "url": "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
            "org": "WHO",
        },
    },
]

# The Gambia NCD Strategy (always relevant for NCD queries)
GAMBIA_NCD_CITATION = {
    "title": "The Gambia NCD Strategy 2022–2027",
    "url": "https://www.afro.who.int/countries/gambia",
    "org": "MoH Gambia / WHO AFRO",
}

# WHO PEN master reference (always relevant)
WHO_PEN_CITATION = {
    "title": "WHO PEN — Package of Essential NCD Interventions",
    "url": "https://www.who.int/publications/i/item/9789240009226",
    "org": "WHO",
}


def get_citations(
    tools_used: List[str],
    message: str = "",
    response: str = "",
    max_citations: int = 3,
) -> List[Dict[str, str]]:
    """Return source citations ONLY when Amina shares substantive health info.

    Citations should NOT appear when Amina is:
    - Just greeting
    - Just asking context questions ("has a doctor confirmed?")
    - Giving emotional support without clinical content

    Citations SHOULD appear when Amina:
    - Gives specific health advice (diet, exercise, warning signs)
    - Shares clinical information (BP targets, sugar ranges)
    - Provides triage assessment
    - References WHO protocols
    """
    # Skip citations if the response is just a question or greeting
    if response:
        resp_l = response.lower()
        # If the response is mostly questions and short acknowledgments, skip
        question_marks = resp_l.count("?")
        sentences = len([s for s in resp_l.split(".") if s.strip()])
        # If more than half the sentences are questions → context gathering, no citations
        if sentences > 0 and question_marks >= sentences * 0.5:
            return []
        # Context-gathering phrases — if these dominate, Amina is asking, not advising
        context_phrases = [
            "has a doctor confirmed", "what medicine did they give",
            "what medication", "did they give you", "can you tell me",
            "before i can help", "what is your", "do you know your",
            "have you been diagnosed", "when were you diagnosed",
            "how long have you", "what did the doctor say",
        ]
        context_count = sum(1 for p in context_phrases if p in resp_l)
        if context_count >= 1 and question_marks >= 1:
            # Response is primarily gathering context — no citations
            return []
        # If response has no substantive health content, skip
        health_content_markers = [
            "blood sugar", "blood pressure", "bp", "mg/dl", "mmhg",
            "salt", "maggi", "exercise", "walk", "diet", "eat",
            "vegetable", "benachin", "domoda", "okra", "fruit",
            "health post", "health centre", "efsth", "199",
            "target", "warning", "danger", "emergency", "triage",
            "fasting", "insulin", "cholesterol", "weight",
            "reduce", "increase", "avoid", "try", "swap",
        ]
        has_health_content = any(m in resp_l for m in health_content_markers)
        if not has_health_content:
            return []

    # No tools used → no citations
    if not tools_used:
        return []

    # Skip non-health tools
    health_tools = {t for t in tools_used if t in TOOL_CITATIONS}
    if not health_tools:
        return []

    seen_urls = set()
    result: List[Dict[str, str]] = []

    # 1. Tool-specific citations
    for tool in health_tools:
        for citation in TOOL_CITATIONS.get(tool, []):
            if citation["url"] not in seen_urls and len(result) < max_citations:
                result.append(citation)
                seen_urls.add(citation["url"])

    # 2. Keyword citations from the message (if we haven't hit max)
    if message and len(result) < max_citations:
        msg_l = message.lower()
        for entry in KEYWORD_CITATIONS:
            if any(kw in msg_l for kw in entry["keywords"]):
                c = entry["citation"]
                if c["url"] not in seen_urls and len(result) < max_citations:
                    result.append(c)
                    seen_urls.add(c["url"])

    # 3. WHO PEN as fallback if any health tool was used but we still have room
    if result and len(result) < max_citations:
        if WHO_PEN_CITATION["url"] not in seen_urls:
            result.append(WHO_PEN_CITATION)

    return result
