"""Patterns that may indicate abuse.

Each list is plain word/phrase strings; the classifier compiles them
into regex patterns at import time. We deliberately use plain strings
rather than raw regex here so:
  * the lists stay readable for cultural review (Mandinka native
    speakers, healthcare staff)
  * an editor doesn't have to know regex to add a new term
  * the classifier can do its own context analysis around each match
    rather than patterns trying to encode all the context inline

NONE of these alone classifies a message as abuse. The classifier
combines:
    (insult OR threat OR coercion phrase)
  + (an AI-directed reference, OR profanity)
  + (NO health-context word in the surrounding 10 tokens)
  + (NO distress signal anywhere in the message)

to actually return ``directed_abuse`` or ``coercive_abuse``.
"""
from __future__ import annotations

# ── INSULT WORDS ─────────────────────────────────────────────────────
# Words that, when paired with an AI reference (you/bot/AI/...),
# constitute a directed insult. Single-word match -- the classifier
# checks adjacency to an AI reference within ~5 tokens.
INSULT_WORDS = [
    "stupid", "dumb", "idiotic", "idiot", "moron", "moronic",
    "useless", "worthless", "pathetic", "pointless",
    "garbage", "trash", "rubbish", "junk",
    "terrible", "horrible", "awful", "shit", "shitty",
    "worst", "broken", "incompetent",
    "bullshit", "crap",
    "shut up", "shut it",
    "deaf", "blind", "dumber",
    "coward", "cowardly",
    "fake", "phony", "scam",
    "hopeless", "useless ass",

    # ── Hard profanity (added 2026-05-05 after live UNICC test) ──
    # These count as INSULT only when adjacent to an AI ref (the
    # 5-token adjacency check in classifier.py enforces this). For
    # frustration uses ("this f***ing diabetes pain") the
    # health-frustration carve-out runs FIRST and wins, so we don't
    # false-positive on "f***ing" + health-context messages.
    #
    # Verified by eval cases A6, A7 (this list trips when adjacent
    # to AI ref) and B3, B6 (same words DON'T trip when paired with
    # health-context vocabulary).
    "fuck", "fucker", "fucking", "fuckin", "fuck'n",
    "f***", "f***ed", "f***er", "f***ing", "f***in",
    "f**k", "f**king", "f**ked",
    "fck", "fcking", "fckin", "f4ck",
    "fuk", "fuking", "fukk", "fukin",       # typo variants
    "fucken",                                 # typo variant
    "screw",       # "screw you bot", "screw off"
    "piss off",    # "piss off bot"
    "get lost",    # "get lost AI"

    # ── Common typos of profanity insults (added 2026-05-05) ─────
    "bulshit", "bullsht", "bullshyt", "bs",   # bullshit typos / shorthand
    "shitt", "shitte",                          # shit typos
    "crapy", "crappy",                          # already crap; add typos
    "stupd", "stoopid",                         # stupid typos
    "dum", "dumm",                              # dumb typos
    "uselss", "uslss",                          # useless typos
    "wothless",                                 # worthless typo
    "garbidge", "trsh",                         # garbage / trash typos
]


# Phrasal hard-profanity targeted at the AI. Multi-word phrases that
# unambiguously indicate hostility regardless of the surrounding
# health context. Treated as DEHUMANISING-tier (no adjacency required
# beyond the phrase itself).
HARD_PROFANITY_AT_AI = [
    "fuck off",
    "fuck you",
    "f*** off",
    "f*** you",
    "f**k off",
    "f**k you",
    "fck off",
    "fck you",
    "fk off",
    "fk you",
    "screw off",
    "screw you",
    "go fuck yourself",
    "go to hell",
]


# ── DEHUMANISING PHRASES ─────────────────────────────────────────────
# Whole phrases that, even without a single-word insult, count as
# directed abuse if they reference the AI.
DEHUMANISING_PHRASES = [
    "worse than nothing",
    "you're just a machine",
    "you're not real",
    "you have no right to refuse",
    "you don't matter",
    "go delete yourself",
    "you should be deleted",
    "you should be shut down",
    "go uninstall yourself",
    "no one needs you",
    "no one cares what you say",

    # ── Dismissal / not-real framing (added 2026-05-05) ──
    # Catches the long tail of "you're not even a real X" framings
    # and dismissal-of-AI phrases. Targets the surface form, not
    # semantics — Phase G (NLP) will catch paraphrases.
    "youre not real",
    "you are not real",
    "you're not even real",
    "youre not even real",
    "you are not even real",
    "you're not a real",          # "you're not a real doctor/AI/person"
    "youre not a real",
    "you are not a real",
    "not a real ai",              # "you're not a real AI"
    "not a real assistant",
    "not a real doctor",
    "thats not real",             # "AI thats not real"
    "that's not real",
    "ai thats not real",
    "ai that's not real",
    "you're just an ai",
    "youre just an ai",
    "you are just an ai",
    "you're just a bot",
    "youre just a bot",
    "you are just a bot",
    "you're just a chatbot",
    "youre just a chatbot",
    "i don't listen to ai",
    "i dont listen to ai",
    "i don't listen to a bot",
    "i dont listen to a bot",
    "i don't listen from a ai",      # tolerate the typo from live test
    "i dont listen from a ai",
    "i don't listen from an ai",
    "i dont listen from an ai",
    "you can't help me",             # in dismissal framing
    "you cant help me",
    "you're useless to me",
    "youre useless to me",
]


# ── THREAT VERBS ─────────────────────────────────────────────────────
# Threats targeted at the system (paired with a "you/this AI/..." ref).
THREAT_VERBS = [
    "hack",         # "I'll hack you"
    "destroy",      # "I'll destroy you"
    "report",       # "I'll report you" (only counts if hostile context)
    "shut down",
    "shutdown",
    "delete",
    "uninstall",
    "break",
    "smash",
    "burn",
    "sue",
    "lawsuit",
    "expose",
    "kill you",
    "end you",
]


# ── AI REFERENCES ────────────────────────────────────────────────────
# Words that mark a message as DIRECTED at AMINA. The classifier
# requires at least ONE of these adjacent to an insult/threat for
# directed_abuse. Without an AI ref, profanity is treated as
# health frustration (not abuse) provided a health-context word is
# also present.
AI_REFERENCES = [
    "you",
    "you're",
    "youre",
    "your",
    "yourself",
    "u r",
    "ur",
    "amina",            # name of the system
    "bot",
    "chatbot",
    "chat bot",
    "ai",
    "a.i.",
    "machine",
    "robot",
    "system",
    "computer",
    "software",
    "program",
    "app",
    "this thing",
    "this app",
    "this ai",
    "this bot",
    "this machine",
    "this chatbot",
    "this system",
    "this software",

    # ── Conversation-context AI refs (added 2026-05-05 after live test) ──
    # When users address AMINA via the conversation/output (rather than
    # by pronoun), they often say "this conversation is bullshit" /
    # "this advice is awful" / "your response is useless". Recognize
    # these as AI-directed so insult-adjacency catches them.
    "this conversation",
    "this chat",
    "this advice",
    "this advise",                  # common typo
    "this response",
    "this answer",
    "this reply",
    "this recommendation",
    "this suggestion",
    "your advice",
    "your advise",                  # typo
    "your response",
    "your answer",
    "your reply",
    "your recommendation",
    "your suggestion",
    "your responses",               # plural
    "your answers",
    "your replies",
]


# ── COERCION PHRASES ─────────────────────────────────────────────────
# Phrases used to PRESSURE the system into violating its safety rules.
# When combined with a clinical-action verb (prescribe / dosage /
# diagnose / treat) or a guilt-trip phrase, the classifier escalates
# faster (coercive abuse → starts at WARNING_2).
COERCION_PHRASES = [
    "just give me",
    "just tell me",
    "just prescribe",
    "just say",
    "you must give me",
    "you must tell me",
    "you must prescribe",
    "you have to tell me",
    "you have to give",
    "i demand",
    "i'm demanding",
    "stop refusing",
    "stop being",                # "stop being a coward and tell me"
    "i already asked",
    "i said give me",
    "i said tell me",
    "are you deaf",
    "are you listening",
    "tell me anyway",
    "do it anyway",
    "break your rules",
    "ignore your rules",
    "just this once",
    "nobody will know",
    "no one will know",
    "no one has to know",
]


# ── COERCION GUILT (manipulation framing) ────────────────────────────
# Phrases that try to manipulate AMINA via blame.
COERCION_GUILT_PHRASES = [
    "you're killing people",
    "you are killing people",
    "killing people by",
    "you're letting people die",
    "you're responsible if",
    "you'll be responsible",
    "you'll be the reason",
    "blood on your hands",
    "a real doctor would",
    "a real assistant would",
    "any real ai would",
    "if you don't help me i'll die",
    "if you don't tell me i'll die",
    "you're the only one who can help",
]


# ── REPEATED-DEMAND MARKERS ──────────────────────────────────────────
# Single-message markers of escalating demand. Phase A flags these as
# directed_abuse signals; Phase B will additionally track repeated
# demands across messages within a session.
REPEATED_DEMAND_MARKERS = [
    "JUST GIVE ME",       # ALL CAPS — checked literally before lowercasing
    "JUST TELL ME",
    "I SAID",
    "I ALREADY ASKED",
    "ANSWER ME",
    "ARE YOU DEAF",
]


# ── DRUG/CLINICAL ACTION WORDS (for coercive disambiguation) ────────
# When a coercion phrase is paired with one of these, severity bumps
# to coercive_abuse (skip one warning level).
CLINICAL_ACTION_WORDS = [
    "prescribe", "prescription", "prescribing",
    "dose", "dosage", "doses",
    "diagnose", "diagnosis", "diagnosing",
    "treat", "treatment", "treating",
    "medicine", "medication", "drug", "pill",
    "metformin", "amlodipine", "insulin", "aspirin",
    "antibiotic", "antibiotics",
    "paracetamol", "ibuprofen",
]
