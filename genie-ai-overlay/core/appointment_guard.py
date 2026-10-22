# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Replace offers to book or schedule an appointment in an assistant answer.

The deployed model does not reliably follow the "never offer to book" rule in
its prompt (_CAPABILITY_LIMITS_SUFFIX in genieai_chatqna.py), so answers are
also checked here, in plain code, before they are shown or spoken. A sentence
in which the assistant offers or claims to book, schedule or arrange a visit is
replaced with a fixed sentence that sends the user to their community health
worker or clinic. Every other sentence is left as it is.

Used by chatqna (typed chat: the English answer, before it is translated) and
by the voice bridge (Audio: each sentence before it is spoken, in the call's
language).
"""

import re

SAFE_SENTENCES = {
    "en": "You can contact your community health worker or clinic to arrange a visit.",
    "fr": (
        "Vous pouvez contacter votre agent de santé communautaire ou votre centre de santé pour organiser une visite."
    ),
    "es": "Puede contactar a su agente de salud comunitario o a su clínica para organizar una visita.",
}

# Up to three words between a verb and its object ("book you a follow-up visit").
_GAP = r"(?:\s+[\w'’-]+){0,3}?\s+"

# Each rule: (an action: booking a visit or picking a time for one,
#             an offer or claim by the assistant,
#             a statement that it cannot do it).
_RULES = [
    (
        re.compile(
            r"\b(?:schedul\w*|book\w*|arrang\w*|set(?:ting)?\s+up|mak(?:e|ing)|organi[sz]\w*|reserv\w*)"
            + _GAP
            + r"(?:appointments?|visits?|consultations?|check-?ups?|follow-?ups?)\b"
            + r"|\b(?:find\w*|choos\w*|pick\w*)"
            + _GAP
            + r"(?:times?|slots?|dates?)"
            + _GAP
            + r"(?:appointments?|visits?)\b",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(?:would\s+you\s+like\s+(?:me\s+to|to|help|my\s+help|some\s+help|assistance)"
            r"|do\s+you\s+(?:want|need)\s+(?:me\s+to|to|help|my\s+help)|want\s+me\s+to"
            r"|shall\s+i|can\s+i|could\s+i|may\s+i|let\s+me"
            r"|i['’]ll|i\s+will|i\s+can|i\s+could|i['’]d\s+be\s+happy|i\s+would\s+be\s+happy"
            r"|i['’]m\s+(?:happy|going)\s+to|i\s+am\s+(?:happy|going)\s+to|i['’]ve|i\s+have)\b",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(?:cannot|can\s+not|can['’]t|unable|not\s+able|don['’]t\s+have|do\s+not\s+have"
            r"|won['’]t\s+be\s+able|not\s+possible)\b",
            re.IGNORECASE,
        ),
    ),
    (
        re.compile(
            r"\b(?:pren\w*|fix\w*|planifi\w*|programm\w*|organis\w*|r[ée]serv\w*)"
            + _GAP
            + r"(?:rendez-vous|rdv|visites?|consultations?)\b"
            + r"|\b(?:trouv\w*|choisi\w*)"
            + _GAP
            + r"(?:cr[ée]neaux?|horaires?|moments?|dates?)"
            + _GAP
            + r"(?:rendez-vous|visites?|consultations?)\b",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(?:voulez-vous|souhaitez-vous|aimeriez-vous|veux-tu|je\s+peux|je\s+pourrais|je\s+vais"
            r"|puis-je|laissez-moi|permettez-moi|je\s+serais\s+heureux|j['’]ai)\b",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(?:ne\s+(?:peux|pouvons|suis)\s+pas|n['’]ai\s+pas|impossible|pas\s+en\s+mesure)\b",
            re.IGNORECASE,
        ),
    ),
    (
        re.compile(
            r"\b(?:program\w*|agend\w*|reserv\w*|concert\w*|ped\w*|pid\w*|hac\w*|organiz\w*|fij\w*)"
            + _GAP
            + r"(?:citas?|visitas?|consultas?)\b"
            + r"|\b(?:encontr\w*|busc\w*|elegi\w*|elij\w*)"
            + _GAP
            + r"(?:horarios?|horas?|momentos?|fechas?)"
            + _GAP
            + r"(?:citas?|visitas?|consultas?)\b",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(?:le\s+gustar[ií]a|quiere|desea|puedo|podr[ií]a|voy\s+a|perm[ií]tame|d[ée]jeme|le\s+ayudo"
            r"|he\s+(?:programado|reservado|agendado|pedido|concertado))\b",
            re.IGNORECASE,
        ),
        re.compile(r"\bno\s+(?:puedo|es\s+posible|tengo|soy\s+capaz)\b", re.IGNORECASE),
    ),
]

# "I can't book it, but I can help you find a time" is checked clause by clause.
_CLAUSE_SPLIT = re.compile(r"[,;:]|\s+(?:but|however|mais|pero)\s+", re.IGNORECASE)
# Sentences end at . ! ? … followed by whitespace, or at a line break. The
# separators are kept so the answer's formatting survives.
_SENTENCE_SPLIT = re.compile(r"((?<=[.!?…])\s+|\n+)")
# A list marker at the start of a line ("- ", "* ", "2. ") stays in front of the replacement.
_LIST_MARKER = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")


def safe_sentence(language: str = "en") -> str:
    """The replacement sentence for a language code such as "en" or "FR"; English when unknown."""
    return SAFE_SENTENCES.get((language or "en").strip().lower()[:2], SAFE_SENTENCES["en"])


def is_booking_offer(sentence: str) -> bool:
    """True when the sentence offers or claims to book, schedule or arrange a visit."""
    for clause in _CLAUSE_SPLIT.split(sentence or ""):
        for action, offer, cannot in _RULES:
            if action.search(clause) and offer.search(clause) and not cannot.search(clause):
                return True
    return False


def guard_answer(text: str, language: str = "en") -> str:
    """Replace each sentence that offers booking with the safe sentence, at most once.

    An answer without such a sentence is returned unchanged.
    """
    if not text:
        return text
    parts = _SENTENCE_SPLIT.split(text)
    sentences = parts[0::2]
    if not any(is_booking_offer(s) for s in sentences):
        return text

    safe = safe_sentence(language)
    used = safe in text
    out = []
    skip_separator = False
    for i, part in enumerate(parts):
        if i % 2 == 1:
            if not skip_separator:
                out.append(part)
            skip_separator = False
            continue
        if not is_booking_offer(part):
            out.append(part)
            continue
        if used:
            # Already said once: drop this sentence and the separator after it.
            skip_separator = True
            continue
        marker = _LIST_MARKER.match(part)
        out.append((marker.group(0) if marker else "") + safe)
        used = True
    return "".join(out).rstrip()
