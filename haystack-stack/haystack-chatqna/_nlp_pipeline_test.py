"""
Sanity test — Mandinka NLP 6-layer pipeline.
Run:  python _nlp_pipeline_test.py
"""
import sys, os, time

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

PASS = 0
FAIL = 0

def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}  — {detail}")


# ═══════════════════════════════════════════════════════════════════════════
# Layer 5: Spell normalizer
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Layer 5: MandinkaNormalizer ===")
try:
    from src.nlp.mandinka_spellcheck import MandinkaNormalizer
    norm = MandinkaNormalizer()

    r = norm.normalize("N dimii be baake")
    check("Import + instantiate", True)
    check("Returns dict", isinstance(r, dict))
    check("Has 'normalized' key", "normalized" in r)
    check("Has 'corrections' key", "corrections" in r)
    check("'dimii'->'dimi'", "dimi" in r["normalized"].lower(),
          f"got: {r['normalized']}")

    r2 = norm.normalize("hello world")
    check("English passthrough", r2["normalized"] == "hello world",
          f"got: {r2['normalized']}")

    t0 = time.perf_counter()
    for _ in range(100):
        norm.normalize("N dimii be baake dokotoro la")
    elapsed = (time.perf_counter() - t0) * 1000
    check(f"100 calls < 500ms", elapsed < 500, f"{elapsed:.1f}ms")

except Exception as e:
    FAIL += 1
    print(f"  [FAIL] Layer 5 crashed: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Layer 1: Code-switch detector
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Layer 1: CodeSwitchDetector ===")
try:
    from src.nlp.code_switch_detector import CodeSwitchDetector
    det = CodeSwitchDetector()

    r = det.detect("N domoroo be jee le")
    check("Import + instantiate", True)
    check("Returns dict", isinstance(r, dict))
    check("Has dominant_language", "dominant_language" in r)
    check("Mandinka text -> mandinka", r["dominant_language"] == "mandinka",
          f"got: {r['dominant_language']}")

    r2 = det.detect("I have a headache and fever")
    check("English text -> english", r2["dominant_language"] == "english",
          f"got: {r2['dominant_language']}")

    r3 = det.detect("N dimi be my head kuŋ la please help")
    check("Mixed text -> mixed", r3["dominant_language"] == "mixed",
          f"got: {r3['dominant_language']}")

    check("Has mandinka_ratio", "mandinka_ratio" in r)

except Exception as e:
    FAIL += 1
    print(f"  [FAIL] Layer 1 crashed: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Layer 2: Medical NER
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Layer 2: MedicalNERExtractor ===")
try:
    from src.nlp.medical_ner import MedicalNERExtractor
    ner = MedicalNERExtractor()

    r = ner.extract("N kuŋ dimi be baake, n faroo ye wuluu", {})
    check("Import + instantiate", True)
    check("Returns dict", isinstance(r, dict))
    check("Has entities_found", "entities_found" in r)
    check("Found entities > 0", r.get("entities_found", 0) > 0,
          f"found: {r.get('entities_found', 0)}")

    r2 = ner.extract("my blood sugar is 250 mg/dL", {})
    check("Vitals extraction", len(r2.get("vitals", [])) > 0,
          f"vitals: {r2.get('vitals', [])}")

    r3 = ner.extract("dimi ka n faa, n te se niinoo la", {})
    check("Emergency flags", len(r3.get("emergency_flags", [])) > 0,
          f"flags: {r3.get('emergency_flags', [])}")

except Exception as e:
    FAIL += 1
    print(f"  [FAIL] Layer 2 crashed: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Layer 3: Bambara Transfer Bridge
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Layer 3: MandingTransferBridge ===")
try:
    from src.nlp.manding_transfer import MandingTransferBridge
    bridge = MandingTransferBridge()
    check("Import + instantiate", True)

    r = bridge.translate_via_bambara("How are you feeling today?")
    check("Returns dict", isinstance(r, dict))
    check("Has mandinka_text", "mandinka_text" in r)
    check("Has quality_score", "quality_score" in r)
    check("Has method", "method" in r)
    check("Has recommendation", "recommendation" in r)
    check("quality_score is float", isinstance(r.get("quality_score"), (int, float)),
          f"type: {type(r.get('quality_score'))}")

    avail = bridge.is_available()
    check(f"is_available() returns bool ({avail})", isinstance(avail, bool))

    if not avail:
        print("    (NLLB model not installed — bridge falls back to English, this is expected locally)")

except Exception as e:
    FAIL += 1
    print(f"  [FAIL] Layer 3 crashed: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Layer 4: Sentiment analyzer
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Layer 4: MandinkaSentimentAnalyzer ===")
try:
    from src.nlp.mandinka_sentiment import MandinkaSentimentAnalyzer
    sent = MandinkaSentimentAnalyzer()

    r = sent.analyze("dimi ka n faa sisan, taa ospitaali", {}, {})
    check("Import + instantiate", True)
    check("Returns dict", isinstance(r, dict))
    check("Has urgency", "urgency" in r)
    check("Has emotional_state", "emotional_state" in r)
    check("Urgency > 0 for emergency pain text", r.get("urgency", 0) > 0,
          f"urgency: {r.get('urgency')}")

    r2 = sent.analyze("N kendeyaata, abaraka", {}, {})
    check("Low urgency for positive text", r2.get("urgency", 1) < 0.5,
          f"urgency: {r2.get('urgency')}")

    check("Has pain_level", "pain_level" in r)
    check("Has isolation_flag", "isolation_flag" in r)
    check("Has masking_flag", "masking_flag" in r)

except Exception as e:
    FAIL += 1
    print(f"  [FAIL] Layer 4 crashed: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Layer 6: Intent normalizer
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Layer 6: IntentNormalizer ===")
try:
    from src.nlp.intent_normalizer import IntentNormalizer
    inorm = IntentNormalizer()

    ner_input = {
        "entities_found": 2,
        "symptoms": [{"text": "kun dimi", "english": "headache", "severity": "moderate", "body_part": "head", "source_language": "mandinka"}],
        "vitals": [],
        "medications": [],
        "foods": [],
        "body_parts": [{"mandinka": "kun", "english": "head"}],
        "emergency_flags": [],
    }
    r = inorm.normalize_for_pipeline(
        "N kun dimi be baake",
        {"normalized": "N kun dimi be baake", "corrections": []},
        {"dominant_language": "mandinka", "mandinka_ratio": 0.9},
        ner_input,
        {"urgency": 0.4, "emotional_state": "pain"},
    )
    check("Import + instantiate", True)
    check("Returns dict", isinstance(r, dict))
    check("Has normalized_query", "normalized_query" in r)
    check("Has suggested_tools", "suggested_tools" in r)
    check("Normalized query is English", any(w in r.get("normalized_query", "").lower()
          for w in ["headache", "head", "pain"]),
          f"got: {r.get('normalized_query')}")
    check("Tools capped at 3", len(r.get("suggested_tools", [])) <= 3)

    ner_emergency = {
        "entities_found": 2,
        "symptoms": [{"text": "chest pain", "english": "chest pain", "severity": "high", "body_part": "chest", "source_language": "english"}],
        "vitals": [],
        "medications": [],
        "foods": [],
        "body_parts": [],
        "emergency_flags": [{"text": "dimi ka n faa", "language": "mandinka"}],
    }
    r2 = inorm.normalize_for_pipeline(
        "dimi ka n faa, chest pain",
        {}, {"dominant_language": "mixed", "mandinka_ratio": 0.4},
        ner_emergency,
        {"urgency": 0.9, "emotional_state": "pain"},
    )
    check("Emergency -> check_emergency tool",
          "check_emergency" in r2.get("suggested_tools", []),
          f"tools: {r2.get('suggested_tools')}")

except Exception as e:
    FAIL += 1
    print(f"  [FAIL] Layer 6 crashed: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Integration: Full pipeline
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Integration: run_nlp_pipeline ===")
try:
    from src.services.nlp_pipeline_integration import run_nlp_pipeline, build_nlp_context_block

    test_messages = [
        ("N kuŋ dimi be baake", "Mandinka headache"),
        ("my blood sugar is 180", "English vitals"),
        ("N dimi be, please help me dokitaroo", "Mixed code-switch"),
        ("I am feeling better today thank you", "Simple English"),
        ("N si faa, n te nii sotoo", "Mandinka emergency"),
    ]

    for msg, label in test_messages:
        t0 = time.perf_counter()
        r = run_nlp_pipeline(msg)
        elapsed = (time.perf_counter() - t0) * 1000
        check(f"[{label}] runs without crash", True)
        check(f"[{label}] active=True", r.get("active") is True)
        check(f"[{label}] has timings", "total" in r.get("timings_ms", {}))
        check(f"[{label}] < 50ms", elapsed < 50, f"{elapsed:.1f}ms")

        lang = (r.get("language") or {}).get("dominant_language", "?")
        ent = (r.get("ner") or {}).get("entities_found", 0)
        urg = (r.get("sentiment") or {}).get("urgency", 0)
        intent = (r.get("intent") or {}).get("normalized_query", "")
        tools = (r.get("intent") or {}).get("suggested_tools", [])
        print(f"         lang={lang} entities={ent} urgency={urg:.2f} "
              f"intent='{intent[:60]}' tools={tools}")

    ctx = build_nlp_context_block(run_nlp_pipeline("N kuŋ dimi be baake"))
    check("Context block non-empty for Mandinka", len(ctx) > 0, f"len={len(ctx)}")

    ctx2 = build_nlp_context_block(run_nlp_pipeline("I have been feeling much better today thank you"))
    check("Context block empty for English", ctx2 == "", f"got: {ctx2[:80]}")

except Exception as e:
    FAIL += 1
    import traceback
    traceback.print_exc()
    print(f"  [FAIL] Integration crashed: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════
print(f"\n{'='*60}")
print(f"  RESULTS:  {PASS} passed,  {FAIL} failed")
print(f"{'='*60}")
sys.exit(1 if FAIL > 0 else 0)
