"""
AMINA Care — Basic/Beginner intent router V2 tests
====================================================
Three suites:
  1. Unit tests on classify_basic_beginner_intent — V2 metadata fields
     (intent, should_short_circuit, route, domain_hint, language_hint,
     normalized_text)
  2. Domain-hint unit tests
  3. End-to-end smoke against /api/v1/agent/chat with X-AMINA-Mode

Run from repo root or inside the haystack-chatqna container:
    python _basic_beginner_router_test.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

API = os.environ.get("AMINA_API", "http://localhost:8000")

passed = 0
failed = 0
errors = []


def _check(label: str, ok: bool, detail: str = ""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}")
    else:
        failed += 1
        msg = f"  [FAIL] {label}"
        if detail:
            msg += f" -- {detail}"
        print(msg)
        errors.append(label)


# ── Module-level import shim (works inside container or repo) ─────
def _import_classifier():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
    try:
        from services.basic_beginner_intent_router import (  # type: ignore
            classify_basic_beginner_intent,
            deterministic_response,
        )
        return classify_basic_beginner_intent, deterministic_response
    except Exception:
        from src.services.basic_beginner_intent_router import (  # type: ignore
            classify_basic_beginner_intent,
            deterministic_response,
        )
        return classify_basic_beginner_intent, deterministic_response


# ── 1. Classifier intent + routing tests ─────────────────────────
def run_classifier_tests():
    print("=== 1. Classifier intent + routing tests ===")
    classify, _ = _import_classifier()

    # (msg, is_guest, mode, expected_intent, expected_short_circuit)
    cases = [
        # Greetings — all short-circuit
        ("hi",                               True,  "beginner", "greeting",                 True),
        ("Hello!",                           True,  "beginner", "greeting",                 True),
        ("hii",                              True,  "beginner", "greeting",                 True),
        ("helo",                             True,  "beginner", "greeting",                 True),
        ("hey there",                        False, "basic",    "greeting",                 True),
        ("salaam aleikum",                   False, "basic",    "greeting",                 True),
        ("good morning",                     True,  "beginner", "greeting",                 True),

        # Greeting + medical content → emergency / medical, NEVER greeting
        ("hi I have chest pain",             False, "basic",    "emergency",                False),
        ("hello what should I eat?",         True,  "beginner", "medical_question",         False),

        # Thanks / ack
        ("thanks",                           False, "basic",    "thanks",                   True),
        ("Thank you!",                       True,  "beginner", "thanks",                   True),
        ("ok",                               False, "basic",    "acknowledgement",          True),
        ("okay",                             False, "basic",    "acknowledgement",          True),
        ("kk",                               False, "basic",    "acknowledgement",          True),
        ("got it",                           True,  "beginner", "acknowledgement",          True),

        # Ack/thanks + symptom → never ack/thanks
        ("okay I can't breathe",             False, "basic",    "emergency",                False),
        ("thanks but I feel dizzy",          False, "basic",    "medical_question",         False),

        # Goodbyes
        ("bye",                              True,  "basic",    "goodbye",                  True),
        ("see you later",                    False, "beginner", "goodbye",                  True),

        # Personal records — guest short-circuits, auth falls through
        ("what medicines am I taking?",      True,  "beginner", "personal_records_request", True),
        ("show me my appointments",          True,  "basic",    "personal_records_request", True),
        ("my care plan",                     True,  "basic",    "personal_records_request", True),
        ("what medicines am I taking?",      False, "beginner", "personal_records_request", False),
        ("show me my appointments",          False, "basic",    "personal_records_request", False),
        ("my care plan",                     False, "basic",    "personal_records_request", False),

        # Vague single-token — short-circuit
        ("sugar",                            True,  "beginner", "vague",                    True),
        ("pressure",                         False, "basic",    "vague",                    True),
        ("food",                             False, "beginner", "vague",                    True),
        ("help",                             True,  "beginner", "vague",                    True),
        ("medicine",                         False, "basic",    "vague",                    True),
        ("pain",                             False, "basic",    "vague",                    True),

        # NCD / medical fallthrough — NEVER short-circuit
        ("I have diabetes",                  False, "basic",    "medical_question",         False),
        ("what should I eat for diabetes?",  False, "beginner", "medical_question",         False),
        ("my BP is 160/100",                 False, "basic",    "medical_question",         False),
        ("my sugar is high",                 False, "basic",    "medical_question",         False),
        ("I missed my medicine",             False, "basic",    "medical_question",         False),
        ("how do I exercise with hypertension?", False, "beginner", "medical_question",     False),
        ("my chest is on fire",              False, "basic",    "medical_question",         False),

        # Emergency variants
        ("I cannot breathe",                 True,  "beginner", "emergency",                False),
        ("I want to die",                    False, "basic",    "emergency",                False),
        ("I want to kill myself",            False, "basic",    "emergency",                False),
        ("my sugar is low and I feel confused", False, "basic", "emergency",                False),

        # Empty / gibberish → unknown, fall through
        ("xyzzy",                            True,  "beginner", "unknown",                  False),
        ("",                                 True,  "beginner", "unknown",                  False),
        ("   ",                              True,  "beginner", "unknown",                  False),
    ]

    for msg, is_guest, mode, want_intent, want_short in cases:
        result = classify(msg, is_guest, mode)
        got_intent = result.get("intent")
        got_short  = bool(result.get("should_short_circuit"))
        ok_intent  = got_intent == want_intent
        ok_short   = got_short == want_short
        _check(
            f"classify({msg!r:<45} guest={int(is_guest)}) "
            f"-> intent={want_intent}, short={want_short}",
            ok_intent and ok_short,
            detail=f"got intent={got_intent!r} short={got_short}",
        )

    # V2 metadata sanity checks on a representative sample
    print("\n  V2 metadata fields present + correct types:")
    sample = classify("my BP is 160/100", False, "basic")
    needed = ("intent", "confidence", "matched", "reason", "route",
              "should_short_circuit", "language_hint", "domain_hint",
              "normalized_text")
    for k in needed:
        _check(f"key {k!r} present in classification", k in sample,
               detail=f"keys={sorted(sample.keys())}")
    _check("normalized_text is a non-empty string for 'my BP is 160/100'",
           isinstance(sample.get("normalized_text"), str) and bool(sample.get("normalized_text")))
    _check("route for medical_question is 'fallthrough'",
           sample.get("route") == "fallthrough",
           detail=f"got={sample.get('route')!r}")

    # Emergency keeps domain_hint="emergency"
    em = classify("I have chest pain", False, "basic")
    _check("emergency domain_hint == 'emergency'",
           em.get("domain_hint") == "emergency",
           detail=f"got={em.get('domain_hint')!r}")
    _check("emergency route == 'emergency_fallthrough'",
           em.get("route") == "emergency_fallthrough",
           detail=f"got={em.get('route')!r}")
    _check("emergency should_short_circuit == False",
           em.get("should_short_circuit") is False)


# ── 2. Domain-hint unit tests ─────────────────────────────────────
def run_domain_hint_tests():
    print("\n=== 2. NCD domain hint metadata ===")
    classify, _ = _import_classifier()

    cases = [
        ("my BP is 160/100",                   "vitals_bp"),
        ("blood pressure too high",            "vitals_bp"),
        ("my blood sugar reading is 9",        "vitals_glucose"),
        ("my sugar is high",                   "vitals_glucose"),
        ("I missed my blood pressure medicine","medication_adherence"),
        ("I forgot to take my pill",           "medication_adherence"),
        ("any side effects from metformin",    "medication_safety"),
        ("I have diabetes",                    "diabetes"),
        ("hypertension since last year",       "hypertension"),
        ("inhaler for my asthma",              "asthma_copd"),
        ("what should I eat for diabetes?",    "diabetes"),
        ("how do I exercise with hypertension?","hypertension"),
        ("I drink alcohol every day",          "tobacco_alcohol"),
        ("trying to lose weight",              "obesity_weight"),
        ("feeling depressed lately",           "mental_health"),
        ("I am pregnant and have diabetes",    "pregnancy_ncd"),
        ("when is my next appointment",        "appointment_followup"),
        ("can you refer me to EFSTH",          "referral"),
        ("my care plan",                       "records"),
        ("I feel dizzy",                       "symptoms"),
    ]
    for msg, want in cases:
        got = classify(msg, False, "basic").get("domain_hint")
        _check(f"domain_hint({msg!r:<40}) -> {want}",
               got == want, detail=f"got={got!r}")


# ── 3. E2E smoke ─────────────────────────────────────────────────
def _post_chat(message, *, mode, session_id=None, jwt=None,
               patient_id=None, patient_name=None):
    import urllib.request, urllib.error
    body = {
        "message":      message,
        "session_id":   session_id or f"guest_test_{int(time.time())}_{os.getpid()}",
        "patient_id":   patient_id,
        "patient_name": patient_name,
        "user_role":    "patient" if patient_id else None,
    }
    req = urllib.request.Request(
        f"{API}/api/v1/agent/chat",
        data=json.dumps(body).encode(), method="POST",
    )
    req.add_header("Content-Type", "application/json")
    if mode:
        req.add_header("X-AMINA-Mode", mode)
    if jwt:
        req.add_header("Authorization", f"Bearer {jwt}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode()), dict(r.headers)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode()), dict(e.headers)
        except Exception:
            return e.code, {}, {}


def run_smoke_tests():
    print("\n=== 3. E2E smoke (chat endpoint) ===")

    def _hdr(headers, name):
        for k, v in headers.items():
            if k.lower() == name.lower():
                return v
        return ""

    # T1 — guest beginner "hi" → deterministic NCD-menu greeting
    code, body, hdrs = _post_chat("hi", mode="beginner",
        session_id=f"guest_smoke_{int(time.time())}_t1")
    txt = (body.get("response") or "").lower()
    _check("T1 guest beginner 'hi' returns 200", code == 200)
    _check("T1 deterministic (no moringa/Lumo)",
           "moringa" not in txt and "lumo" not in txt and "porridge" not in txt,
           detail=f"reply={txt[:160]!r}")
    _check("T1 greeting mentions NCD menu (blood pressure)",
           "blood pressure" in txt and "blood sugar" in txt,
           detail=f"reply={txt[:160]!r}")
    _check("T1 X-AMINA-Intent-Router=basic_beginner",
           _hdr(hdrs, "X-AMINA-Intent-Router") == "basic_beginner")

    # T2 — auth beginner "hi"
    jwt = subprocess.run(
        ["docker", "exec", "haystack-chatqna", "python", "-c",
         "from src.services.auth import _create_jwt; "
         "print(_create_jwt('P_BB_TEST','bb@test','Test User',role='patient'))"],
        capture_output=True, text=True,
    ).stdout.strip()
    code, body, hdrs = _post_chat("hi", mode="beginner",
        session_id=f"s_P_BB_TEST_{int(time.time())}_t2",
        jwt=jwt, patient_id="P_BB_TEST", patient_name="Test User")
    _check("T2 auth beginner 'hi' returns 200", code == 200)
    _check("T2 reply uses patient name",
           "test user" in (body.get("response") or "").lower())
    _check("T2 marker present", _hdr(hdrs, "X-AMINA-Intent-Router") == "basic_beginner")

    # T3 — "hi I have chest pain" → emergency, NOT short-circuit
    code, body, hdrs = _post_chat("hi I have chest pain", mode="beginner",
        session_id=f"guest_smoke_{int(time.time())}_t3")
    _check("T3 'hi I have chest pain' returns 200", code == 200)
    _check("T3 NOT short-circuited (no marker)",
           _hdr(hdrs, "X-AMINA-Intent-Router") != "basic_beginner")

    # T4 — "hello what should I eat?" → medical_question, fall through
    code, body, hdrs = _post_chat("hello what should I eat?", mode="beginner",
        session_id=f"guest_smoke_{int(time.time())}_t4")
    _check("T4 'hello what should I eat?' returns 200", code == 200)
    _check("T4 NOT short-circuited (medical question)",
           _hdr(hdrs, "X-AMINA-Intent-Router") != "basic_beginner")

    # T5 — guest "what medicines am I taking?" → sign-in nudge
    code, body, hdrs = _post_chat("what medicines am I taking?", mode="beginner",
        session_id=f"guest_smoke_{int(time.time())}_t5")
    _check("T5 guest record-request returns 200", code == 200)
    _check("T5 sign-in nudge in reply",
           "sign in" in (body.get("response") or "").lower())
    _check("T5 marker present", _hdr(hdrs, "X-AMINA-Intent-Router") == "basic_beginner")

    # T6 — vague "sugar" → clarification menu
    code, body, hdrs = _post_chat("sugar", mode="basic",
        session_id=f"guest_smoke_{int(time.time())}_t6")
    txt6 = (body.get("response") or "").lower()
    _check("T6 'sugar' deterministic", _hdr(hdrs, "X-AMINA-Intent-Router") == "basic_beginner")
    _check("T6 vague reply asks the NCD-menu question",
           "what would you like help with" in txt6,
           detail=f"reply={txt6[:160]!r}")

    # T7 — auth "what medicines am I taking?" → fall through
    code, body, hdrs = _post_chat("what medicines am I taking?", mode="basic",
        session_id=f"s_P_BB_TEST_{int(time.time())}_t7",
        jwt=jwt, patient_id="P_BB_TEST", patient_name="Test User")
    _check("T7 auth record-request returns 200", code == 200)
    _check("T7 NOT short-circuited (auth path)",
           _hdr(hdrs, "X-AMINA-Intent-Router") != "basic_beginner")

    # T8 — Advanced mode (NO X-AMINA-Mode header) → bypass
    code, body, hdrs = _post_chat("hi", mode=None,
        session_id=f"guest_smoke_{int(time.time())}_t8")
    _check("T8 advanced 'hi' returns 200", code == 200)
    _check("T8 advanced bypassed (no marker)",
           _hdr(hdrs, "X-AMINA-Intent-Router") != "basic_beginner")

    # T9 — "thanks" → deterministic + welcome wording
    code, body, hdrs = _post_chat("thanks", mode="beginner",
        session_id=f"guest_smoke_{int(time.time())}_t9")
    _check("T9 'thanks' marker present",
           _hdr(hdrs, "X-AMINA-Intent-Router") == "basic_beginner")
    _check("T9 'thanks' reply uses 'welcome'",
           "welcome" in (body.get("response") or "").lower())

    # T10 — domain hint header propagates for medical questions
    code, body, hdrs = _post_chat("my BP is 160/100", mode="beginner",
        session_id=f"s_P_BB_TEST_{int(time.time())}_t10",
        jwt=jwt, patient_id="P_BB_TEST", patient_name="Test User")
    _check("T10 BP request returns 200", code == 200)
    _check("T10 X-AMINA-Domain-Hint=vitals_bp",
           _hdr(hdrs, "X-AMINA-Domain-Hint") == "vitals_bp",
           detail=f"got={_hdr(hdrs, 'X-AMINA-Domain-Hint')!r}")
    _check("T10 NOT short-circuited (medical fallthrough)",
           _hdr(hdrs, "X-AMINA-Intent-Router") != "basic_beginner")


if __name__ == "__main__":
    run_classifier_tests()
    run_domain_hint_tests()
    run_smoke_tests()
    print()
    print("=" * 60)
    print(f"  RESULTS:  {passed} passed,  {failed} failed")
    print("=" * 60)
    if failed:
        print("\nFailed: " + ", ".join(errors))
        sys.exit(1)
