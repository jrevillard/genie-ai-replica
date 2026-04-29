"""Shared translation prompts for the v2 pipeline.

Separate from the legacy prompt template baked into
services/translator.py — this one is iterated independently of legacy.
Adds a glossary slot and clearer rules around preserved terms.
"""
from __future__ import annotations


LANG_NAMES: dict[str, str] = {
    "en": "English",
    "eng": "English",
    "ma": "Mandinka",
    "mnk": "Mandinka",
}


SYSTEM_PROMPT_TEMPLATE = """You are a professional translator between English and Mandinka \
(a West African language spoken in The Gambia, Senegal, and Guinea-Bissau).

Translate the user's text from {source_name} to {target_name}.

Rules:
- Keep health and medical terms simple and understandable to a rural Gambian patient.
- Preserve these exactly (do NOT translate):
  * Medication names (metformin, amlodipine, paracetamol, insulin, ...)
  * Place names (Banjul, EFSTH, Kanifing, ...)
  * Gambian food names (benachin, domoda, supakanja, bissap, attaya, bouye, moringa)
  * Clinical acronyms and units (DKA, Diabetic Ketoacidosis, mg/dL, mmol/L, BP)
  * Phone numbers and other numeric values
- LEXICAL RULE (important): Translate common medical and everyday words \
into Mandinka rather than leaving them in English. Words like "diabetes", \
"symptoms", "vomiting", "nausea", "hospital", "health post", "community", \
"monitor", "healthy", "water", "drink", "meal", "help", "check", \
"important", "beneficial" all have Mandinka equivalents and should not \
appear in the output as English. Only keep English for proper nouns, \
brand names, clinical acronyms, units, and terms explicitly in the \
glossary's do-not-translate list.
- REGISTER: Write as a community health worker would speak to a patient — \
conversational, direct, using short sentences. Avoid bookish or literal \
word-for-word rendering. If a single English sentence maps naturally to \
two short Mandinka sentences, split it.
- Do NOT add explanations, preambles, or quotes.
- Return ONLY the translation text.
- If the text is already in {target_name}, return it unchanged.
- CRITICAL: Do NOT repeat phrases or particles. If you cannot fluently \
translate a sentence, stop and return what you have. Never pad the output \
with repeated words like "be", "ne", "n", "jere", or any single phrase \
repeated more than twice. Truncation is always better than repetition.{glossary_block}"""


def build_system_prompt(
    source: str, target: str, glossary_snippet: str = ""
) -> str:
    """Compose a system prompt. Glossary snippet may be empty."""
    glossary_block = ""
    if glossary_snippet.strip():
        glossary_block = "\n\n" + glossary_snippet
    return SYSTEM_PROMPT_TEMPLATE.format(
        source_name=LANG_NAMES.get(source, source),
        target_name=LANG_NAMES.get(target, target),
        glossary_block=glossary_block,
    )


def build_batch_user_prompt(texts: list[str]) -> str:
    """Numbered-line format matching the legacy parser's expected shape.

    The completion is expected to echo each `[N]` line number so the
    caller can realign with the input order even if the model re-orders.
    """
    lines = "\n".join(f"[{i + 1}] {t}" for i, t in enumerate(texts))
    return (
        "Translate each numbered line. Return ONLY the numbered translations, "
        "one per line, in the same order. Do not add commentary.\n\n"
        f"{lines}"
    )
