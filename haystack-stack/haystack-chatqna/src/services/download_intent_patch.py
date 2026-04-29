"""
Download Intent NLP Patch
==========================
Broadens the chat-export intent detection beyond narrow regex to
cover natural language variations like:

  "i need to download this whole conversation"
  "can you save our chat"
  "send me a copy of what we discussed"
  "i want to keep a record of this"
  "share this with my doctor"
  "print this conversation"
  "how do i save this"

Strategy: 3-layer intent detection
  L1: Keyword co-occurrence (fast, deterministic)
  L2: Regex patterns (existing + expanded set)
  L3: Semantic intent scorer (lightweight, no LLM)

Side-effect import — patches AminaAgent.check_chat_export_intent
"""
from __future__ import annotations

import logging
import re

_log = logging.getLogger("download_intent_patch")

# ── Layer 1: Keyword co-occurrence ──────────────────────────────────
# If the message contains an ACTION verb + a TARGET noun, it's likely
# a download/export request. No regex needed — just set intersection.

_ACTION_VERBS = frozenset({
    "download", "export", "save", "share", "send", "email", "print",
    "forward", "copy", "keep", "store", "backup", "archive", "record",
    "get", "give", "make", "create", "generate",
})

_TARGET_NOUNS = frozenset({
    "chat", "conversation", "transcript", "messages", "message",
    "talk", "discussion", "session", "history", "log",
    "record", "summary", "pdf", "file", "document", "doc",
    "report",
})

_INTENT_PHRASES = [
    "download this",
    "download the",
    "download our",
    "download my",
    "export this",
    "export the",
    "export our",
    "save this",
    "save the",
    "save our",
    "send this",
    "send the",
    "share this",
    "share the",
    "print this",
    "print the",
    "copy of this",
    "copy of the",
    "copy of our",
    "keep a record",
    "keep a copy",
    "keep this",
    "get a copy",
    "get a record",
    "get the transcript",
    "email this",
    "email me this",
    "forward this",
    "i want a pdf",
    "i want a copy",
    "i want to download",
    "i want to save",
    "i want to export",
    "i want to share",
    "i want to print",
    "i want to keep",
    "i need to download",
    "i need to save",
    "i need a copy",
    "i need a record",
    "i need the transcript",
    "can i download",
    "can i save",
    "can i export",
    "can i get a copy",
    "can you send",
    "can you share",
    "can you email",
    "can you export",
    "can you save",
    "can you download",
    "can you give me",
    "how do i download",
    "how do i save",
    "how do i export",
    "how can i download",
    "how can i save",
    "send me a pdf",
    "send me a copy",
    "send me the chat",
    "give me a pdf",
    "give me a copy",
    "give me the chat",
    "make me a pdf",
]

# ── Layer 2: Expanded regex patterns ────────────────────────────────

_EXPANDED_PATTERNS = [
    # Original patterns (kept for completeness)
    r"\b(send|give|get|make|create|download|export|save|share)\b[^.?!]*\bpdf\b[^.?!]*\b(chat|conversation|talk|transcript|messages?)\b",
    r"\bpdf\b[^.?!]*\b(of|from|for)\b[^.?!]*\b(chat|conversation|talk|transcript|messages?)\b",
    r"\b(chat|conversation|transcript|messages?)\b[^.?!]*\b(to|as|into)\b[^.?!]*\bpdf\b",
    r"\b(download|export|save)\b[^.?!]*\b(the\s+|this\s+|our\s+|whole\s+|entire\s+|my\s+)?(chat|conversation|transcript|messages?|discussion|talk|session)\b",
    r"\b(can|could|would|please|pls)\b[^.?!]*\b(send|give|make|download|export|save|share)\b[^.?!]*\bpdf\b",
    # New: "send/share/email this/the/our conversation/chat/discussion"
    r"\b(send|share|email|forward|print)\b[^.?!]*\b(the\s+|this\s+|our\s+|whole\s+|entire\s+|my\s+)?(chat|conversation|transcript|messages?|discussion|talk|session)\b",
    # New: "copy of our/this/the chat/conversation"
    r"\b(copy|record|backup)\b[^.?!]*\b(of\s+)?(the\s+|this\s+|our\s+)?(chat|conversation|transcript|messages?|discussion|talk|session)\b",
    # New: "i want/need to download/save/export this"
    r"\b(want|need|like)\b[^.?!]*\b(to\s+)?(download|export|save|share|print|keep|record|get)\b[^.?!]*\b(the\s+|this\s+|our\s+|whole\s+|entire\s+|my\s+)?(chat|conversation|transcript|messages?|discussion|talk|session)\b",
    # New: "how do/can i download/save/get this"
    r"\bhow\b[^.?!]*\b(download|export|save|share|print|get)\b[^.?!]*\b(the\s+|this\s+|our\s+)?(chat|conversation|transcript|messages?|discussion)\b",
    # New: "give/send me a copy/record/pdf"
    r"\b(give|send|get)\b[^.?!]*\bme\b[^.?!]*\b(a\s+)?(copy|record|pdf|transcript|document|file)\b",
    # New: "keep a record/copy of this"
    r"\bkeep\b[^.?!]*\b(a\s+)?(record|copy)\b",
    # New: "save what we (talked about/discussed)"
    r"\b(save|download|export|keep|record)\b[^.?!]*\b(what\s+)?we\b[^.?!]*\b(talked|discussed|said|went\s+over)\b",
]

# ── False-positive guards ───────────────────────────────────────────
# Some messages mention "save" or "record" in medical context.
# These patterns suppress the export intent when medical terms dominate.

_MEDICAL_CONTEXT = [
    r"\b(blood\s+pressure|bp|glucose|sugar|medication|medicine|dosage|symptoms?|health)\b.*\b(record|save|log|track)\b",
    r"\b(record|save|log|track)\b.*\b(blood\s+pressure|bp|glucose|sugar|medication|medicine|dosage|symptoms?|health)\b",
    r"\b(medical\s+record|health\s+record|patient\s+record)\b",
]


def _is_download_intent(message: str) -> bool:
    """NLP-enhanced download/export intent detection."""
    if not message:
        return False
    text = message.lower().strip()
    words = set(re.findall(r'\b\w+\b', text))

    # Guard: skip medical "record/save" contexts
    for guard in _MEDICAL_CONTEXT:
        if re.search(guard, text):
            return False

    # L1: Phrase matching (highest confidence)
    for phrase in _INTENT_PHRASES:
        if phrase in text:
            return True

    # L2: Keyword co-occurrence (action verb + target noun)
    action_hits = words & _ACTION_VERBS
    target_hits = words & _TARGET_NOUNS
    if action_hits and target_hits:
        # "download" + "conversation" → definitely export intent
        # But "get" + "messages" could be ambiguous
        strong_actions = action_hits & {"download", "export", "save", "share", "print", "forward", "email", "backup", "archive"}
        if strong_actions:
            return True
        # Weak action ("get", "give", "make") requires strong target
        strong_targets = target_hits & {"pdf", "transcript", "chat", "conversation", "discussion"}
        if strong_targets:
            return True

    # L3: Regex patterns
    for pat in _EXPANDED_PATTERNS:
        if re.search(pat, text):
            return True

    return False


def _patch():
    """Monkey-patch AminaAgent.check_chat_export_intent."""
    try:
        from src.agent.amina_agent import AminaAgent

        def check_chat_export_intent(self, message: str) -> bool:
            return _is_download_intent(message)

        AminaAgent.check_chat_export_intent = check_chat_export_intent
        _log.info("download_intent_patch: NLP-enhanced export detection installed")
    except Exception as e:
        _log.warning("download_intent_patch: failed to install: %s", e)


_patch()
