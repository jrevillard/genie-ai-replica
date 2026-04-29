"""
Sanity test -- TranslationCorrector v5.1
Run:  PYTHONUTF8=1 python _translation_corrector_test.py
"""
import sys, os, time

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

os.environ["PYTHONUTF8"] = "1"

PASS = 0
FAIL = 0

def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}  -- {detail}")


from src.nlp.translation_corrector import TranslationCorrector, get_corrector

tc = TranslationCorrector()


# ============================================================
# 1. SYSTEM ID CLEANUP
# ============================================================
print("\n=== 1. System ID cleanup ===")

r = tc.correct(
    "Salaam aleikum Admin Patient, i be di?",
    "Hello, how are you?",
    {"patient_name": "Fatou"},
)
check("Admin Patient replaced", "Fatou" in r["corrected_text"])
check("Admin Patient not in output", "Admin Patient" not in r["corrected_text"])

r2 = tc.correct(
    "P_ABC123 i ka furango dong",
    "Take your medicine",
    {},
)
check("P_ prefix removed", "P_ABC123" not in r2["corrected_text"])

r3 = tc.correct(
    "s_P_MAIN_SESSION i be di",
    "How are you",
    {},
)
check("s_P_ session prefix removed", "s_P_MAIN_SESSION" not in r3["corrected_text"])

r4 = tc.correct(
    "CG-ABC123 i ka kendeyaa",
    "Take care of your health",
    {},
)
check("CG- prefix removed", "CG-ABC123" not in r4["corrected_text"])

r5 = tc.correct(
    "Patient 42 i be di",
    "How are you",
    {"patient_name": "Mariama"},
)
check("Patient N replaced", "Mariama" in r5["corrected_text"])
check("Patient 42 not in output", "Patient 42" not in r5["corrected_text"])


# ============================================================
# 2. GREETING CORRECTIONS
# ============================================================
print("\n=== 2. Greeting corrections ===")

r = tc.correct("Sannu, i be di?", "Hello, how are you?")
check("Sannu -> Salaam aleikum", "Salaam aleikum" in r["corrected_text"])

r = tc.correct("Habari, munne naata i la?", "Hello, what brings you here?")
check("Habari -> I be di", "I be di" in r["corrected_text"])

r = tc.correct("Bonjour, n na lafita i demmaa", "Hello, I want to help you")
check("Bonjour -> Salaam aleikum", "Salaam aleikum" in r["corrected_text"])


# ============================================================
# 3. GREETING ENFORCEMENT (new in v4.4)
# ============================================================
print("\n=== 3. Greeting enforcement ===")

r = tc.correct(
    "N naaningo lang planoo la",
    "I want to talk about the plan",
    {},
)
check("Greeting prepended when missing", r["corrected_text"].startswith("Salaam aleikum") or "I be di" in r["corrected_text"][:50])
check("greeting_added flag set", r["greeting_added"] is True)

r2 = tc.correct(
    "Salaam aleikum, i be di?",
    "Hello, how are you?",
    {},
)
check("Valid greeting NOT re-prepended", r2["greeting_added"] is False)

r3 = tc.correct(
    "N naaningo",
    "I want to ask",
    {"time_of_day": "morning"},
)
check("Morning greeting used", "Isama" in r3["corrected_text"][:30])

r4 = tc.correct(
    "N naaningo",
    "I want to ask",
    {"age": 60, "patient_name": "Baba"},
)
check("Elder gets family inquiry", "surolu" in r4["corrected_text"])


# ============================================================
# 4. DAY NAME / MEAL TIME CORRECTIONS (via English replace)
# ============================================================
print("\n=== 4. Day name + meal time corrections ===")

r = tc.correct("Monday suba domoroo", "Monday breakfast")
check("Monday -> Teneŋo", "Teneŋo" in r["corrected_text"])

r = tc.correct("Sunday suuto domoroo", "Sunday dinner")
check("Sunday -> Aladoo", "Aladoo" in r["corrected_text"])

r = tc.correct("breakfast domoroo le ka nii", "breakfast food is good")
check("breakfast -> suba domoroo", "suba domoroo" in r["corrected_text"])

r = tc.correct("dinner waxatoo", "dinner time")
check("dinner -> suuto domoroo", "suuto domoroo" in r["corrected_text"])


# ============================================================
# 5. CRITICAL MEDICAL TERM CORRECTIONS
# ============================================================
print("\n=== 5. Critical medical term corrections ===")

r = tc.correct(
    "I ka kung dimi baa le",
    "You have severe dizziness",
)
check("kung dimi -> saasaaringo (dizziness context)",
      "saasaaringo" in r["corrected_text"])

r2 = tc.correct(
    "I ka kung dimi baa le",
    "You have severe headache",
)
check("kung dimi kept for headache context",
      "kung dimi" in r2["corrected_text"].lower(),
      f"got: {r2['corrected_text']}")

r3 = tc.correct(
    "I yele sukkaroo levelolu be jaanjaana",
    "Your blood sugar levels are high",
)
check("yele sukkaroo levelolu -> i baloo kono sukkaroo",
      "i baloo kono sukkaroo" in r3["corrected_text"])

r4 = tc.correct(
    "I blood pressure be jaanjaana",
    "Your blood pressure is high",
)
check("blood pressure -> joloo buntango",
      "joloo buntango" in r4["corrected_text"])

r5 = tc.correct(
    "I diabetes be jaanjaana",
    "Your diabetes is severe",
)
check("diabetes -> sukari-kuurango",
      "sukari-kuurango" in r5["corrected_text"])


# ============================================================
# 6. FAKE MANDINKA DETECTION
# ============================================================
print("\n=== 6. Fake Mandinka detection ===")

r = tc.correct("weekendoo la taama", "Walk on the weekend")
check("weekendoo -> Sibiti ani Aladoo",
      "Sibiti ani Aladoo" in r["corrected_text"])
check("weekendoo in fake_mandinka list", "weekendoo" in r["fake_mandinka"])

r2 = tc.correct("I ka managoo i kendeyaa", "Manage your health")
check("managoo -> maakoyi", "maakoyi" in r2["corrected_text"])

r3 = tc.correct("regularoo taama", "Walk regularly")
check("regularoo -> lung bee", "lung bee" in r3["corrected_text"])

r4 = tc.correct("planoo la ke", "Make a plan")
check("planoo -> laahidu", "laahidu" in r4["corrected_text"])


# ============================================================
# 7. ENGLISH WORD AUTO-REPLACEMENT (new in v4.4)
# ============================================================
print("\n=== 7. English word auto-replacement ===")

r = tc.correct(
    "I ka exercise lung bee",
    "You should exercise regularly",
)
check("exercise -> taama-taama", "taama-taama" in r["corrected_text"])

r2 = tc.correct(
    "I ka water ming siyaa",
    "Drink a lot of water",
)
check("water -> jii", "jii" in r2["corrected_text"])

r3 = tc.correct(
    "I ka medicine dong suba ma",
    "Take medicine in the morning",
)
check("medicine -> furango", "furango" in r3["corrected_text"])


# ============================================================
# 8. ENGLISH LEAK DETECTION
# ============================================================
print("\n=== 8. English leak detection ===")

r = tc.correct(
    "I ka reduce sugar intake daily",
    "You should reduce sugar intake daily",
)
check("English leaks detected", len(r["english_leaks"]) > 0,
      f"leaks: {r['english_leaks']}")

r2 = tc.correct(
    "I ka metformin dong suba ma",
    "Take metformin in the morning",
)
check("metformin NOT flagged (allowlisted)",
      "metformin" not in r2["english_leaks"])


# ============================================================
# 9. ENGLISH BLOCK WORDS (nutrient terms)
# ============================================================
print("\n=== 9. English block words (nutrients) ===")

r = tc.correct(
    "protein ani fats be nafaa le",
    "Protein and fats are beneficial",
)
check("protein removed", "protein" not in r["corrected_text"].lower())
check("fats removed", " fats " not in r["corrected_text"].lower())


# ============================================================
# 10. FOOD NAME CORRECTIONS (new in v4.4)
# ============================================================
print("\n=== 10. Food name corrections ===")

r = tc.correct(
    "tapalapa bread domo suba ma",
    "Eat tapalapa bread in the morning",
)
check("tapalapa bread -> tapalapa", "tapalapa" in r["corrected_text"] and "bread" not in r["corrected_text"].lower())

r2 = tc.correct(
    "sweet potato a be jamaa",
    "Sweet potato is good",
)
check("sweet potato -> kuukundingo", "kuukundingo" in r2["corrected_text"])

r3 = tc.correct(
    "moringa porridge domo suba",
    "Eat moringa porridge in the morning",
)
check("moringa porridge -> moringa moni", "moringa moni" in r3["corrected_text"])


# ============================================================
# 11. NON-GAMBIAN FOOD REPLACEMENT (new in v4.4)
# ============================================================
print("\n=== 11. Non-Gambian food replacement ===")

r = tc.correct(
    "I ka oatmeal domo suba ma",
    "Eat oatmeal in the morning",
)
check("oatmeal -> moringa moni", "moringa moni" in r["corrected_text"])

r2 = tc.correct(
    "I ka salmon domo",
    "Eat salmon",
)
check("salmon -> jewoo", "jewoo" in r2["corrected_text"])


# ============================================================
# 12. NEGATION SAFETY
# ============================================================
print("\n=== 12. Negation safety ===")

r = tc.correct(
    "sukkaroo domo lung bee",
    "Don't eat sugar every day",
)
check("Negation error blocked", r["recommendation"] == "BLOCK_USE_ENGLISH",
      f"rec: {r['recommendation']}")
check("negation_safe = False", r["negation_safe"] is False)
check("blocked_errors has negation", any(
    b["type"] == "negation_missing" for b in r["blocked_errors"]))

r2 = tc.correct(
    "kana sukkaroo domo lung bee",
    "Don't eat sugar every day",
)
check("Correct negation passes", r2["negation_safe"] is True)


# ============================================================
# 13. NUMBER / QUANTITY VALIDATION
# ============================================================
print("\n=== 13. Number / quantity validation ===")

r = tc.correct(
    "I sukkaroo be jangjang",
    "Your blood sugar is 250 mg/dL",
)
check("Missing 250 blocked", r["numbers_verified"] is False,
      f"verified: {r['numbers_verified']}")
check("blocked for missing number", any(
    b["type"] == "number_missing" for b in r["blocked_errors"]))

r2 = tc.correct(
    "I sukkaroo be 250 mg/dL",
    "Your blood sugar is 250 mg/dL",
)
check("250 present passes", r2["numbers_verified"] is True)


# ============================================================
# 14. ANTONYM CHECK
# ============================================================
print("\n=== 14. Antonym check ===")

r = tc.correct(
    "sukkaroo jangjang",
    "Reduce your sugar",
)
check("Reduce/jangjang antonym caught",
      r["antonyms_safe"] is False,
      f"safe: {r['antonyms_safe']}")
check("Blocked for antonym swap", any(
    b["type"] == "antonym_swap" for b in r["blocked_errors"]))

r2 = tc.correct(
    "sukkaroo doyaa",
    "Reduce your sugar",
)
check("Reduce/doyaa correct, passes", r2["antonyms_safe"] is True)


# ============================================================
# 15. REPETITION DETECTION
# ============================================================
print("\n=== 15. Repetition detection ===")

rep_text = " ".join(["a be nafaa le kendeyaa ye"] * 5)
r = tc.correct(rep_text, "It is beneficial for health")
check("Repetitions detected", len(r["repetitions"]) > 0,
      f"repetitions: {r['repetitions']}")


# ============================================================
# 16. CULTURAL CHECKS
# ============================================================
print("\n=== 16. Cultural checks ===")

r = tc.correct(
    "I ka pork domo",
    "You should eat pork",
)
check("Pork flagged", any("pork" in i.lower() for i in r["cultural_issues"]),
      f"issues: {r['cultural_issues']}")

r2 = tc.correct(
    "I ka wine minkoo",
    "You should drink wine for health",
)
check("Alcohol flagged (non-cessation)", len(r2["cultural_issues"]) > 0,
      f"issues: {r2['cultural_issues']}")

r3 = tc.correct(
    "I ka dolo buloo tii",
    "You should stop drinking alcohol",
)
check("Alcohol cessation NOT flagged",
      not any("alcohol" in i.lower() for i in r3["cultural_issues"]),
      f"issues: {r3['cultural_issues']}")

r4 = tc.correct(
    "I ka quinoa domo",
    "You should eat quinoa",
)
check("Non-local food flagged", any("non-gambian" in i.lower()
      for i in r4["cultural_issues"]),
      f"issues: {r4['cultural_issues']}")

r5 = tc.correct(
    "Dindiyaalu naaningo kendeyaa",
    "Your health is important",
    {"age": 35},
)
check("dindiyaalu wrong context flagged",
      any("dindiyaalu" in i.lower() for i in r5["cultural_issues"]),
      f"issues: {r5['cultural_issues']}")


# ============================================================
# 17. PER-SENTENCE SCORING
# ============================================================
print("\n=== 17. Per-sentence scoring ===")

r = tc.correct(
    "Salaam aleikum. I ka kendeyaa maakoyi. sukkaroo doyaa.",
    "Hello. Take care of your health. Reduce sugar.",
)
check("Per-sentence scores exist", len(r["per_sentence_scores"]) >= 2,
      f"count: {len(r['per_sentence_scores'])}")
check("Each score has score field", all(
    "score" in s for s in r["per_sentence_scores"]))
check("Each score has issues field", all(
    "issues" in s for s in r["per_sentence_scores"]))


# ============================================================
# 18. OVERALL DECISION LOGIC
# ============================================================
print("\n=== 18. Overall decision logic ===")

r_good = tc.correct(
    "Salaam aleikum. I ka kendeyaa maakoyi. kana sukkaroo domo.",
    "Hello. Take care of your health. Don't eat sugar.",
)
check("Clean translation -> SERVE or SERVE_CORRECTED",
      r_good["recommendation"] in ("SERVE", "SERVE_CORRECTED"),
      f"rec: {r_good['recommendation']}")

r_bad = tc.correct(
    "sukkaroo domo lung bee",
    "Don't eat sugar every day",
)
check("Negation fail -> BLOCK_USE_ENGLISH",
      r_bad["recommendation"] == "BLOCK_USE_ENGLISH")
check("block_reason set", r_bad["block_reason"] is not None)


# ============================================================
# 19. RETURN STRUCTURE
# ============================================================
print("\n=== 19. Return structure ===")

r = tc.correct("Salaam aleikum", "Hello", {})
expected_keys = {
    "corrected_text", "original_text", "english_source",
    "corrections_applied", "blocked_errors",
    "english_leaks", "fake_mandinka", "repetitions",
    "numbers_verified", "negation_safe", "antonyms_safe",
    "cultural_issues", "grammar_flags",
    "per_sentence_scores", "overall_score",
    "recommendation", "block_reason", "stats",
    "hard_blockers_fired", "medical_corrections",
    "food_corrections", "repetitions_fixed",
    "tense_issues", "greeting_added", "truncated",
    "hallucinations_detected", "completeness_ratio",
}
actual_keys = set(r.keys())
missing = expected_keys - actual_keys
check("All required keys present", not missing,
      f"missing: {missing}")

stat_keys = {"total_words", "corrections_count", "english_leak_ratio",
             "repetition_ratio", "lowest_sentence_score", "processing_time_ms"}
actual_stat = set(r.get("stats", {}).keys())
missing_stat = stat_keys - actual_stat
check("All stat keys present", not missing_stat,
      f"missing: {missing_stat}")


# ============================================================
# 20. SINGLETON
# ============================================================
print("\n=== 20. Singleton ===")

s1 = get_corrector()
s2 = get_corrector()
check("get_corrector() returns same instance", s1 is s2)


# ============================================================
# 21. PERFORMANCE
# ============================================================
print("\n=== 21. Performance ===")

long_text = "I ka moringa domo. " * 20 + "kana sukkaroo domo. sukkaroo doyaa."
t0 = time.perf_counter()
for _ in range(50):
    tc.correct(long_text, "Eat moringa. " * 20 + "Don't eat sugar. Reduce sugar.")
elapsed = (time.perf_counter() - t0) * 1000
avg = elapsed / 50
check(f"50 calls avg < 30ms (avg={avg:.1f}ms)", avg < 30, f"avg: {avg:.1f}ms")

total_elapsed = elapsed
check(f"Total 50 calls < 1500ms ({total_elapsed:.0f}ms)",
      total_elapsed < 1500, f"{total_elapsed:.0f}ms")


# ============================================================
# 22. EDGE CASES
# ============================================================
print("\n=== 22. Edge cases ===")

r = tc.correct("", "", {})
check("Empty input doesn't crash", r["recommendation"] in
      ("SERVE", "SERVE_CORRECTED", "BLOCK_USE_ENGLISH"))

r = tc.correct("a", "b", {})
check("Single char doesn't crash", isinstance(r, dict))

r = tc.correct("123 456 789", "123 456 789", {})
check("Numbers only doesn't crash", isinstance(r, dict))


# ============================================================
# 23. HARD BLOCKERS (new in v4.4)
# ============================================================
print("\n=== 23. Hard blockers ===")

r = tc.correct(
    "Kunung i na lumo kisikisi produce kendeyaa ani buy seasonal fruits ani vegetables",
    "Go to market and buy seasonal fruits and vegetables",
)
check("Garbled English corrected or blocked",
      len(r["corrections_applied"]) > 0 or r["recommendation"] == "BLOCK_USE_ENGLISH",
      f"corrections: {len(r['corrections_applied'])}, rec: {r['recommendation']}")
check("English words replaced (produce/buy/seasonal/fruits/vegetables)",
      "produce" not in r["corrected_text"].lower() or "nakoo-lu" in r["corrected_text"])

r2 = tc.correct(
    "a be kendeyaa protein niŋ fats le ye",
    "It is healthy with protein and fats",
)
check("protein in English BLOCK list removed",
      "protein" not in r2["corrected_text"].lower())


# ============================================================
# 24. ENGLISH REPLACE TABLE (new in v4.4)
# ============================================================
print("\n=== 24. English replace table ===")

r = tc.correct(
    "I ka hospital taa",
    "Go to the hospital",
)
check("hospital -> ospitaali", "ospitaali" in r["corrected_text"])

r2 = tc.correct(
    "I ka doctor ñininkaa",
    "Ask your doctor",
)
check("doctor -> dokitaroo", "dokitaroo" in r2["corrected_text"])

r3 = tc.correct(
    "I ka herbs dong",
    "Take herbs",
)
check("herbs -> tiibaalu", "tiibaalu" in r3["corrected_text"])


# ============================================================
# 25. FOOD NAME CORRECTIONS TABLE (new in v4.4)
# ============================================================
print("\n=== 25. Food name corrections ===")

r = tc.correct(
    "tapalapa koto domo",
    "Eat half tapalapa",
)
check("tapalapa koto -> tapalapa tilinyango",
      "tilinyango" in r["corrected_text"])

r2 = tc.correct(
    "groundnut stew domo",
    "Eat groundnut stew",
)
check("groundnut stew -> domoda", "domoda" in r2["corrected_text"])

r3 = tc.correct(
    "baobab juice ming",
    "Drink baobab juice",
)
check("baobab juice -> buyii jii", "buyii jii" in r3["corrected_text"])


# ============================================================
# 26. INTEGRATION SCENARIO -- diet plan
# ============================================================
print("\n=== 26. Integration scenario -- diet plan ===")

diet_mandinka = """Salaam aleikum!

Monday suba domoroo: Mono ani moringa. a be nafaa le kendeyaa ye.
Monday tiloo domoroo: Supakanja ani jewoo. a be nafaa le kendeyaa ye.
Monday suuto domoroo: Domoda ani nakoo. a be nafaa le kendeyaa ye.

Tuesday suba domoroo: Laaciiri ani buyii. a be nafaa le kendeyaa ye.
protein ani carbohydrates ka nii i kendeyaa ye.

I blood sugar levels be 180 mg/dL. weekendoo la taama.
I ka managoo i sukkaroo."""

diet_english = """Hello!

Monday breakfast: Millet porridge with moringa. It is beneficial for health.
Monday lunch: Supakanja with fish. It is beneficial for health.
Monday dinner: Domoda with vegetables. It is beneficial for health.

Tuesday breakfast: Laaciiri with baobab juice. It is beneficial for health.
Protein and carbohydrates are good for your health.

Your blood sugar levels are 180 mg/dL. Walk on the weekend.
Manage your blood sugar."""

r = tc.correct(diet_mandinka, diet_english)

check("Monday -> Teneŋo", "Teneŋo" in r["corrected_text"])
check("Tuesday -> Talaato", "Talaato" in r["corrected_text"])
check("weekendoo -> Sibiti ani Aladoo", "Sibiti ani Aladoo" in r["corrected_text"])
check("managoo -> maakoyi", "maakoyi" in r["corrected_text"])
check("protein removed", "protein" not in r["corrected_text"].lower())
check("carbohydrates removed", "carbohydrates" not in r["corrected_text"].lower())
check("blood sugar levels corrected",
      "i baloo kono sukkaroo" in r["corrected_text"])
check("Corrections applied > 0", len(r["corrections_applied"]) > 0,
      f"count: {len(r['corrections_applied'])}")
check("180 preserved", "180" in r["corrected_text"])
check("mg/dL preserved", "mg/dL" in r["corrected_text"])
check("overall_score is float", isinstance(r["overall_score"], float))
check("processing_time_ms recorded", r["stats"]["processing_time_ms"] > 0)

print(f"\n         Diet plan corrections: {len(r['corrections_applied'])}")
for c in r["corrections_applied"][:8]:
    print(f"           {c['original']!r} -> {c['corrected']!r} [{c['severity']}]")
print(f"         Fake Mandinka caught: {r['fake_mandinka']}")
print(f"         English leaks: {r['english_leaks'][:5]}")
print(f"         Score: {r['overall_score']}")
print(f"         Recommendation: {r['recommendation']}")
print(f"         Time: {r['stats']['processing_time_ms']:.1f}ms")


# ============================================================
# 27. REGRESSION TEST CASES FROM SPEC
# ============================================================
print("\n=== 27. Regression test cases ===")

r = tc.correct(
    "Salaam aleikum, Fatou. I be di? I baloo kono sukkaroo kuo la. Moringa moni ke suba ma.",
    "Hello Fatou. How are you? About your blood sugar. Make moringa porridge for breakfast.",
)
check("Clean Mandinka -> SERVE or SERVE_CORRECTED",
      r["recommendation"] in ("SERVE", "SERVE_CORRECTED"),
      f"rec: {r['recommendation']}, score: {r['overall_score']}")

r2 = tc.correct(
    "weekendoo planoo la",
    "Plan for the weekend",
    {},
)
check("weekendoo planoo -> Sibiti ani Aladoo laahidu",
      "Sibiti ani Aladoo" in r2["corrected_text"] and "laahidu" in r2["corrected_text"],
      f"got: {r2['corrected_text']}")

r3 = tc.correct(
    "I ka reduce i ka sugar intake daily",
    "Reduce your sugar intake daily",
)
check("English-heavy sentence detected",
      len(r3["english_leaks"]) > 0 or r3["recommendation"] != "SERVE",
      f"leaks: {r3['english_leaks']}, rec: {r3['recommendation']}")


# ============================================================
# 28. TEMPORAL NLP (v5.1)
# ============================================================
print("\n=== 28. Temporal NLP (v5.1) ===")

from src.nlp.mandinka_temporal import MandinkaTemporal, NgHandler, get_temporal

mt = get_temporal()

# Day names with ŋ
tr = mt.process_temporal("Monday and Tuesday plan")
check("Monday -> Teneŋo (temporal)", "Teneŋo" in tr["processed_text"])
check("Tuesday -> Talaato (temporal)", "Talaato" in tr["processed_text"])
check("replacements tracked", len(tr["replacements"]) >= 2)

# Day name normalization (misspelled Mandinka)
tr2 = mt.process_temporal("teneng ani dimasoo")
check("teneng -> Teneŋo (normalize)", "Teneŋo" in tr2["processed_text"])
check("dimasoo -> Aladoo (normalize)", "Aladoo" in tr2["processed_text"])

# Month names (Saŋ system)
tr3 = mt.process_temporal("January to March plan")
check("January -> Saŋ-kiliŋ", "Saŋ-kiliŋ" in tr3["processed_text"])
check("March -> Saŋ-saba", "Saŋ-saba" in tr3["processed_text"])

# Relative time
tr4 = mt.process_temporal("take medicine tomorrow and every day")
check("tomorrow -> siniŋ", "siniŋ" in tr4["processed_text"])
check("every day -> luŋ bee", "luŋ bee" in tr4["processed_text"])

# Numeric time
tr5 = mt.process_temporal("walk for 30 minutes")
check("30 minutes -> miniti muwaŋ-ni-taŋ",
      "miniti" in tr5["processed_text"] and "muwaŋ-ni-taŋ" in tr5["processed_text"])

# Compound temporal
tr6 = mt.process_temporal("rest on weekends")
check("weekends -> Sibiti ani Aladoo", "Sibiti ani Aladoo" in tr6["processed_text"])

# Seasons
tr7 = mt.process_temporal("be careful in rainy season")
check("rainy season -> saŋ-waxtoo", "saŋ-waxtoo" in tr7["processed_text"])

# Religious events
tr8 = mt.process_temporal("during ramadan fasting")
check("ramadan -> Sunkaroo-karoo", "Sunkaroo-karoo" in tr8["processed_text"])
check("fasting -> sunkaroo", "sunkaroo" in tr8["processed_text"].lower())

# NgHandler truncation fixes
ng = NgHandler()
fixed, count = ng.fix_truncated_mandinka_words("Teneng ani furango")
check("Teneng -> Teneŋo (NgHandler)", "Teneŋo" in fixed)

# Markdown-aware day replacement
tr9 = mt.process_temporal("**Monday** and *Tuesday*")
check("**Monday** -> **Teneŋo**", "**Teneŋo**" in tr9["processed_text"])
check("*Tuesday* -> *Talaato*", "*Talaato*" in tr9["processed_text"])

# Time of day
tr10 = mt.process_temporal("take medicine after fajr")
check("after fajr -> subaa-saliioo kooma",
      "subaa-saliioo kooma" in tr10["processed_text"])

# Performance
t0 = time.perf_counter()
for _ in range(100):
    mt.process_temporal("Monday Tuesday Wednesday January 30 minutes rainy season")
temporal_elapsed = (time.perf_counter() - t0) * 1000
avg_temporal = temporal_elapsed / 100
check(f"Temporal avg < 15ms (avg={avg_temporal:.1f}ms)", avg_temporal < 15)

# Full pipeline integration (corrector + temporal)
r_full = tc.correct(
    "Monday suba: moringa moni. Tuesday tiloo: domoda. Wednesday suuto: supakanja.",
    "Monday breakfast: moringa porridge. Tuesday lunch: domoda. Wednesday dinner: supakanja.",
)
check("Full pipeline: Monday -> Teneŋo", "Teneŋo" in r_full["corrected_text"])
check("Full pipeline: Tuesday -> Talaato", "Talaato" in r_full["corrected_text"])
check("Full pipeline: Wednesday -> Araba", "Araba" in r_full["corrected_text"])
check("Full pipeline: temporal corrections logged",
      any(c.get("reason", "").startswith("temporal_") for c in r_full["corrections_applied"]))


# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'='*60}")
print(f"  RESULTS:  {PASS} passed,  {FAIL} failed")
print(f"{'='*60}")
sys.exit(1 if FAIL > 0 else 0)
