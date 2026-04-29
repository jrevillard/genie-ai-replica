#!/usr/bin/env python3
"""
Standalone RAG test runner — runs Parts 1 & 2 without the full pipeline.
Mocks the pipeline import so rag_tuner doesn't crash on missing components.
"""
import sys
import os
import json
import types
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

# Mock haystack and pipeline imports so rag_tuner can load
haystack_mod = types.ModuleType("haystack")
class MockDocument:
    def __init__(self, id=None, content="", meta=None):
        self.id = id
        self.content = content
        self.meta = meta or {}
haystack_mod.Document = MockDocument
sys.modules["haystack"] = haystack_mod

# Mock src.pipelines.chat so rag_tuner.apply_rag_tuning() gracefully skips
pipelines_mod = types.ModuleType("src.pipelines")
chat_mod = types.ModuleType("src.pipelines.chat")
sys.modules["src"] = types.ModuleType("src")
sys.modules["src.pipelines"] = pipelines_mod
sys.modules["src.pipelines.chat"] = chat_mod

# Now import the tuner (apply_rag_tuning will fail gracefully on missing pipeline)
from services.rag_tuner import (
    classify_rag_profile,
    RAG_PROFILES,
    weighted_rrf_merge,
    augment_query_for_reranking,
    _current_profile,
)


# ═══════════════════════════════════════════════════════════════════════════════
# Test Data
# ═══════════════════════════════════════════════════════════════════════════════

EVAL_QUERIES = [
    {"query": "What is the fasting blood sugar target for type 2 diabetes", "expected_profile": "clinical_specific"},
    {"query": "My sugar was 250 this morning what should I do", "expected_profile": "clinical_specific"},
    {"query": "Can I eat benachin if I have diabetes", "expected_profile": "diet_lifestyle"},
    {"query": "What foods should I avoid with type 2 diabetes", "expected_profile": "diet_lifestyle"},
    {"query": "How often should I check my HbA1c", "expected_profile": "clinical_specific"},
    {"query": "What is the target blood pressure for a diabetic patient", "expected_profile": "clinical_specific"},
    {"query": "My BP is 180 over 110 what should I do", "expected_profile": "clinical_specific"},
    {"query": "How to reduce salt in my cooking", "expected_profile": "diet_lifestyle"},
    {"query": "Is domoda okay for someone with high blood pressure", "expected_profile": "diet_lifestyle"},
    {"query": "My father is having chest pain and sweating", "expected_profile": "emergency"},
    {"query": "Someone collapsed and is not breathing", "expected_profile": "emergency"},
    {"query": "I think I am having a heart attack", "expected_profile": "emergency"},
    {"query": "Can I fast during Ramadan with diabetes", "expected_profile": "ramadan_cultural"},
    {"query": "What should I eat for suhoor if I have high blood pressure", "expected_profile": "ramadan_cultural"},
    {"query": "When should I break my fast if my sugar drops", "expected_profile": "ramadan_cultural"},
    {"query": "What are the side effects of metformin", "expected_profile": "medication_info"},
    {"query": "I stopped taking my amlodipine because I feel fine", "expected_profile": "medication_info"},
    {"query": "My pharmacy ran out of my blood pressure medicine", "expected_profile": "medication_info"},
    {"query": "What exercise is good for diabetes", "expected_profile": "diet_lifestyle"},
    {"query": "How much moringa should I take daily", "expected_profile": "diet_lifestyle"},
    {"query": "Is groundnut oil better than palm oil for cooking", "expected_profile": "diet_lifestyle"},
    {"query": "I am scared I just found out I have diabetes", "expected_profile": "default"},
    {"query": "Tell me about NCDs in The Gambia", "expected_profile": "default"},
    {"query": "What is WHO PEN protocol", "expected_profile": "clinical_specific"},
]


# ═══════════════════════════════════════════════════════════════════════════════
# PART 1: Profile Classification
# ═══════════════════════════════════════════════════════════════════════════════

def test_classification():
    print("=" * 70)
    print("PART 1: Query Profile Classification")
    print("=" * 70)

    correct = 0
    total = len(EVAL_QUERIES)
    results = []

    for case in EVAL_QUERIES:
        predicted = classify_rag_profile(case["query"])
        expected = case["expected_profile"]
        match = predicted == expected
        if match:
            correct += 1
        status = "PASS" if match else "FAIL"
        results.append({"status": status, "query": case["query"], "expected": expected, "predicted": predicted})
        print(f"  [{status}] {case['query'][:55]:55s} expected={expected:20s} got={predicted}")

    accuracy = correct / total
    print(f"\n  Accuracy: {correct}/{total} ({accuracy:.0%})")

    # Profile coverage
    profiles_hit = set(case["expected_profile"] for case in EVAL_QUERIES)
    all_profiles = set(RAG_PROFILES.keys())
    print(f"  Profile coverage: {len(profiles_hit)}/{len(all_profiles)} ({profiles_hit})")

    # Profile parameter table
    print(f"\n  {'Profile':<20} {'vec_k':>6} {'kw_k':>5} {'rank_k':>6} {'thresh':>7} {'v_wt':>5} {'k_wt':>5}")
    print(f"  {'-'*20} {'-'*6} {'-'*5} {'-'*6} {'-'*7} {'-'*5} {'-'*5}")
    for name, p in RAG_PROFILES.items():
        print(f"  {name:<20} {p['vector_top_k']:>6} {p['keyword_top_k']:>5} {p['ranker_top_k']:>6} {p['score_threshold']:>7.2f} {p['vector_weight']:>5.2f} {p['keyword_weight']:>5.2f}")

    return accuracy, results


# ═══════════════════════════════════════════════════════════════════════════════
# PART 2: Weighted RRF Logic
# ═══════════════════════════════════════════════════════════════════════════════

def test_rrf():
    print("\n" + "=" * 70)
    print("PART 2: Weighted RRF Merge Logic")
    print("=" * 70)

    passed = 0
    failed = 0
    results = []

    def check(name, condition, detail=""):
        nonlocal passed, failed
        status = "PASS" if condition else "FAIL"
        if condition:
            passed += 1
        else:
            failed += 1
        print(f"  [{status}] {name}")
        if not condition and detail:
            print(f"         {detail}")
        results.append({"name": name, "passed": condition, "detail": detail})

    # Setup test docs
    vec_docs = [
        MockDocument(id="d1", content="Diabetes fasting glucose target is 4-7 mmol/L", meta={"score": 0.85, "title": "WHO PEN Diabetes"}),
        MockDocument(id="d2", content="HbA1c should be below 7%", meta={"score": 0.72, "title": "WHO PEN Diabetes"}),
        MockDocument(id="d3", content="Blood pressure monitoring weekly", meta={"score": 0.55, "title": "WHO PEN CVD"}),
        MockDocument(id="d4", content="Mental health screening tools", meta={"score": 0.30, "title": "Mental Health"}),
    ]
    kw_docs = [
        MockDocument(id="d2", content="HbA1c should be below 7%", meta={"title": "WHO PEN Diabetes"}),
        MockDocument(id="d5", content="Fasting blood sugar test procedure", meta={"title": "Lab Manual"}),
        MockDocument(id="d1", content="Diabetes fasting glucose target is 4-7 mmol/L", meta={"title": "WHO PEN Diabetes"}),
    ]

    # Test 1: Basic merge
    _current_profile.set("clinical_specific")
    merged = weighted_rrf_merge(vec_docs, kw_docs)
    check("basic merge produces results", len(merged) > 0, f"got {len(merged)} docs")

    # Test 2: Overlapping docs rank higher
    merged_ids = [d.id for d in merged]
    d1_rank = merged_ids.index("d1") if "d1" in merged_ids else 99
    d2_rank = merged_ids.index("d2") if "d2" in merged_ids else 99
    check("overlapping docs rank higher (d1, d2 in top 3)", d1_rank < 3 and d2_rank < 3,
          f"d1 rank={d1_rank}, d2 rank={d2_rank}")

    # Test 3: Score threshold filters low docs (clinical_specific threshold=0.50)
    d4_present = "d4" in merged_ids
    check("score threshold filters d4 (score=0.30 < threshold=0.50)", not d4_present,
          f"d4 {'filtered' if not d4_present else 'still present'}")

    # Test 4: d3 passes threshold (score=0.55 > 0.50)
    d3_present = "d3" in merged_ids
    check("d3 passes threshold (score=0.55 > 0.50)", d3_present,
          f"d3 {'present' if d3_present else 'filtered (should not be)'}")

    # Test 5: RRF scores assigned
    all_have_rrf = all(d.meta.get("rrf_score") is not None for d in merged)
    check("all merged docs have rrf_score metadata", all_have_rrf)

    # Test 6: RRF scores are descending
    rrf_scores = [d.meta.get("rrf_score", 0) for d in merged]
    is_descending = all(rrf_scores[i] >= rrf_scores[i + 1] for i in range(len(rrf_scores) - 1))
    check("rrf_scores in descending order", is_descending,
          f"scores: {[round(s, 4) for s in rrf_scores]}")

    # Test 7: Emergency profile has lower threshold
    _current_profile.set("emergency")
    emergency_merged = weighted_rrf_merge(vec_docs, kw_docs)
    emergency_ids = [d.id for d in emergency_merged]
    d4_in_emergency = "d4" in emergency_ids
    check("emergency profile keeps d4 (threshold=0.30, score=0.30)", d4_in_emergency,
          f"d4 {'included' if d4_in_emergency else 'filtered (bad for emergency)'}")

    # Test 8: Empty inputs
    empty = weighted_rrf_merge([], [])
    check("empty inputs return empty list", len(empty) == 0)

    # Test 9: Single source (vector only)
    _current_profile.set("default")
    vec_only = weighted_rrf_merge(vec_docs, [])
    check("vector-only merge works", len(vec_only) > 0, f"got {len(vec_only)} docs")

    # Test 10: Single source (keyword only)
    kw_only = weighted_rrf_merge([], kw_docs)
    check("keyword-only merge works", len(kw_only) > 0, f"got {len(kw_only)} docs")

    # Test 11: Query augmentation
    _current_profile.set("emergency")
    aug = augment_query_for_reranking("chest pain")
    check("emergency query augmentation adds prefix",
          aug.startswith("Emergency") and "chest pain" in aug, f"got: {aug}")

    _current_profile.set("medication_info")
    aug2 = augment_query_for_reranking("metformin side effects")
    check("medication query augmentation adds prefix",
          "Medication" in aug2 and "metformin" in aug2, f"got: {aug2}")

    _current_profile.set("default")
    aug3 = augment_query_for_reranking("general question")
    check("default profile has no prefix", aug3 == "general question", f"got: {aug3}")

    # Test 12: Medication profile weights keyword higher
    _current_profile.set("medication_info")
    med_vec = [MockDocument(id="m1", content="Metformin 500mg", meta={"score": 0.70, "title": "Med Guide"})]
    med_kw = [
        MockDocument(id="m2", content="Metformin side effects nausea", meta={"title": "Med Guide"}),
        MockDocument(id="m1", content="Metformin 500mg", meta={"title": "Med Guide"}),
    ]
    med_merged = weighted_rrf_merge(med_vec, med_kw)
    med_ids = [d.id for d in med_merged]
    check("medication profile: keyword-only doc (m2) included", "m2" in med_ids)

    # Test 13: Diet profile weights vector higher
    _current_profile.set("diet_lifestyle")
    diet_vec = [
        MockDocument(id="diet1", content="Healthy eating with moringa", meta={"score": 0.60, "title": "Diet Guide"}),
        MockDocument(id="diet2", content="Benachin nutrition facts", meta={"score": 0.55, "title": "Diet Guide"}),
    ]
    diet_kw = [MockDocument(id="diet3", content="Exercise walking 30 min", meta={"title": "Exercise Guide"})]
    diet_merged = weighted_rrf_merge(diet_vec, diet_kw)
    diet_ids = [d.id for d in diet_merged]
    check("diet profile: vector docs rank above keyword-only",
          diet_ids.index("diet1") < diet_ids.index("diet3") if "diet3" in diet_ids else True)

    print(f"\n  Results: {passed} passed, {failed} failed")
    return passed, failed, results


# ═══════════════════════════════════════════════════════════════════════════════
# Report
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("\n" + "=" * 70)
    print("AMINA RAG EVALUATION — Unit Tests")
    print(f"Timestamp: {datetime.utcnow().isoformat()}")
    print("=" * 70 + "\n")

    accuracy, class_results = test_classification()
    rrf_passed, rrf_failed, rrf_results = test_rrf()

    # Final summary
    total_tests = len(class_results) + rrf_passed + rrf_failed
    total_passed = sum(1 for r in class_results if r["status"] == "PASS") + rrf_passed
    total_failed = sum(1 for r in class_results if r["status"] == "FAIL") + rrf_failed

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"  Total tests:              {total_tests}")
    print(f"  Passed:                   {total_passed}")
    print(f"  Failed:                   {total_failed}")
    print(f"  Pass rate:                {total_passed/total_tests:.0%}")
    print(f"  Profile accuracy:         {accuracy:.0%}")
    print(f"  RRF logic:                {rrf_passed}/{rrf_passed+rrf_failed}")
    print(f"")
    print(f"  Parts 3-5 (chunk quality, retrieval accuracy, score calibration)")
    print(f"  require ArcadeDB. Run inside Docker with:")
    print(f"    docker exec -it haystack-chatqna python -m src.services.rag_eval --with-db")
    print("=" * 70)

    # Save report
    report = {
        "timestamp": datetime.utcnow().isoformat(),
        "total_tests": total_tests,
        "passed": total_passed,
        "failed": total_failed,
        "pass_rate": round(total_passed / total_tests, 3),
        "profile_classification": {
            "accuracy": round(accuracy, 3),
            "results": class_results,
        },
        "weighted_rrf": {
            "passed": rrf_passed,
            "failed": rrf_failed,
            "results": rrf_results,
        },
    }

    report_path = os.path.join(os.path.dirname(__file__), "rag_eval_report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved to: {report_path}")

    return total_failed == 0


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
