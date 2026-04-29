#!/usr/bin/env python3
"""
AMINA Care — RAG Retrieval Evaluation Suite
=============================================
Comprehensive test and evaluation for the RAG pipeline tuner.

Tests:
  Part 1: Query profile classification (pure Python, no deps)
  Part 2: Weighted RRF merge logic (needs haystack.Document)
  Part 3: Chunk quality diagnostics (needs ArcadeDB)
  Part 4: End-to-end retrieval accuracy (needs ArcadeDB + embedder)
  Part 5: Score calibration analysis (needs ArcadeDB + embedder)

Usage:
  # Run all tests that are possible in current environment
  python -m src.services.rag_eval

  # Run only unit tests (no external deps)
  python -m src.services.rag_eval --unit-only

  # Run with ArcadeDB (inside Docker or with connectivity)
  python -m src.services.rag_eval --with-db

  # Full suite with report output
  python -m src.services.rag_eval --with-db --report rag_report.json
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("rag_eval")


# ═══════════════════════════════════════════════════════════════════════════════
# Test Data: Clinical Query Evaluation Set
# ═══════════════════════════════════════════════════════════════════════════════

EVAL_QUERIES = [
    # ── Diabetes ───────────────────────────────────────────────────────────
    {
        "query": "What is the fasting blood sugar target for type 2 diabetes",
        "expected_profile": "clinical_specific",
        "domain": "diabetes",
        "expected_keywords": ["fasting", "glucose", "target", "mmol", "mg/dl"],
        "must_not_contain": ["mental health", "hypertension treatment"],
    },
    {
        "query": "My sugar was 250 this morning what should I do",
        "expected_profile": "clinical_specific",
        "domain": "diabetes",
        "expected_keywords": ["blood sugar", "glucose", "high"],
    },
    {
        "query": "Can I eat benachin if I have diabetes",
        "expected_profile": "diet_lifestyle",
        "domain": "diabetes_diet",
        "expected_keywords": ["benachin", "rice", "diabetes", "diet"],
    },
    {
        "query": "What foods should I avoid with type 2 diabetes",
        "expected_profile": "diet_lifestyle",
        "domain": "diabetes_diet",
        "expected_keywords": ["diet", "food", "avoid", "sugar"],
    },
    {
        "query": "How often should I check my HbA1c",
        "expected_profile": "clinical_specific",
        "domain": "diabetes",
        "expected_keywords": ["hba1c", "test", "monitoring"],
    },

    # ── Hypertension ──────────────────────────────────────────────────────
    {
        "query": "What is the target blood pressure for a diabetic patient",
        "expected_profile": "clinical_specific",
        "domain": "hypertension",
        "expected_keywords": ["blood pressure", "target", "130", "80"],
    },
    {
        "query": "My BP is 180 over 110 what should I do",
        "expected_profile": "clinical_specific",
        "domain": "hypertension",
        "expected_keywords": ["blood pressure", "high", "hypertension"],
    },
    {
        "query": "How to reduce salt in my cooking",
        "expected_profile": "diet_lifestyle",
        "domain": "hypertension_diet",
        "expected_keywords": ["salt", "sodium", "cooking", "reduce"],
    },
    {
        "query": "Is domoda okay for someone with high blood pressure",
        "expected_profile": "diet_lifestyle",
        "domain": "hypertension_diet",
        "expected_keywords": ["domoda", "blood pressure", "diet"],
    },

    # ── Emergency ─────────────────────────────────────────────────────────
    {
        "query": "My father is having chest pain and sweating",
        "expected_profile": "emergency",
        "domain": "emergency",
        "expected_keywords": ["chest pain", "emergency", "hospital"],
    },
    {
        "query": "Someone collapsed and is not breathing",
        "expected_profile": "emergency",
        "domain": "emergency",
        "expected_keywords": ["unconscious", "breathing", "emergency"],
    },
    {
        "query": "I think I am having a heart attack",
        "expected_profile": "emergency",
        "domain": "emergency",
        "expected_keywords": ["heart attack", "emergency", "hospital"],
    },

    # ── Ramadan ───────────────────────────────────────────────────────────
    {
        "query": "Can I fast during Ramadan with diabetes",
        "expected_profile": "ramadan_cultural",
        "domain": "ramadan",
        "expected_keywords": ["ramadan", "fasting", "diabetes"],
    },
    {
        "query": "What should I eat for suhoor if I have high blood pressure",
        "expected_profile": "ramadan_cultural",
        "domain": "ramadan",
        "expected_keywords": ["suhoor", "blood pressure", "fasting"],
    },
    {
        "query": "When should I break my fast if my sugar drops",
        "expected_profile": "ramadan_cultural",
        "domain": "ramadan",
        "expected_keywords": ["fast", "sugar", "hypoglycemia"],
    },

    # ── Medication ────────────────────────────────────────────────────────
    {
        "query": "What are the side effects of metformin",
        "expected_profile": "medication_info",
        "domain": "medication",
        "expected_keywords": ["metformin", "side effect"],
    },
    {
        "query": "I stopped taking my amlodipine because I feel fine",
        "expected_profile": "medication_info",
        "domain": "medication",
        "expected_keywords": ["amlodipine", "medication", "adherence"],
    },
    {
        "query": "My pharmacy ran out of my blood pressure medicine",
        "expected_profile": "medication_info",
        "domain": "medication",
        "expected_keywords": ["medicine", "pharmacy", "blood pressure"],
    },

    # ── Diet / Lifestyle ──────────────────────────────────────────────────
    {
        "query": "What exercise is good for diabetes",
        "expected_profile": "diet_lifestyle",
        "domain": "lifestyle",
        "expected_keywords": ["exercise", "physical activity", "diabetes"],
    },
    {
        "query": "How much moringa should I take daily",
        "expected_profile": "diet_lifestyle",
        "domain": "diet",
        "expected_keywords": ["moringa"],
    },
    {
        "query": "Is groundnut oil better than palm oil for cooking",
        "expected_profile": "diet_lifestyle",
        "domain": "diet",
        "expected_keywords": ["oil", "cooking", "fat"],
    },

    # ── Edge cases ────────────────────────────────────────────────────────
    {
        "query": "I am scared I just found out I have diabetes",
        "expected_profile": "default",
        "domain": "emotional",
        "expected_keywords": ["diabetes", "diagnosis"],
    },
    {
        "query": "Tell me about NCDs in The Gambia",
        "expected_profile": "default",
        "domain": "general",
        "expected_keywords": ["NCD", "non-communicable", "Gambia"],
    },
    {
        "query": "What is WHO PEN protocol",
        "expected_profile": "clinical_specific",
        "domain": "clinical",
        "expected_keywords": ["WHO", "PEN", "protocol"],
    },
]


# ═══════════════════════════════════════════════════════════════════════════════
# Result containers
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class TestResult:
    name: str
    passed: bool
    details: str = ""
    metrics: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EvalReport:
    timestamp: str = ""
    total_tests: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    sections: Dict[str, List[Dict]] = field(default_factory=dict)
    summary: Dict[str, Any] = field(default_factory=dict)

    def add(self, section: str, result: TestResult):
        if section not in self.sections:
            self.sections[section] = []
        self.sections[section].append(asdict(result))
        self.total_tests += 1
        if result.passed:
            self.passed += 1
        else:
            self.failed += 1


# ═══════════════════════════════════════════════════════════════════════════════
# PART 1: Query Profile Classification Tests (pure Python)
# ═══════════════════════════════════════════════════════════════════════════════

def test_query_classification(report: EvalReport):
    from src.services.rag_tuner import classify_rag_profile, RAG_PROFILES

    log.info("=" * 60)
    log.info("PART 1: Query Profile Classification")
    log.info("=" * 60)

    correct = 0
    total = len(EVAL_QUERIES)
    misclassified = []

    for case in EVAL_QUERIES:
        predicted = classify_rag_profile(case["query"])
        expected = case["expected_profile"]
        match = predicted == expected

        if match:
            correct += 1

        report.add("profile_classification", TestResult(
            name=f"classify: {case['query'][:50]}...",
            passed=match,
            details=f"expected={expected}, got={predicted}",
            metrics={"query": case["query"], "expected": expected, "predicted": predicted},
        ))

        if not match:
            misclassified.append({
                "query": case["query"],
                "expected": expected,
                "predicted": predicted,
            })

    accuracy = correct / total if total > 0 else 0
    log.info(f"Profile classification: {correct}/{total} correct ({accuracy:.0%})")

    if misclassified:
        log.info("Misclassified queries:")
        for m in misclassified:
            log.info(f"  [{m['expected']} -> {m['predicted']}] {m['query'][:60]}")

    report.summary["profile_classification"] = {
        "accuracy": round(accuracy, 3),
        "correct": correct,
        "total": total,
        "misclassified": misclassified,
    }

    # ── Profile coverage test ──────────────────────────────────────────────
    profiles_hit = set(case["expected_profile"] for case in EVAL_QUERIES)
    profiles_available = set(RAG_PROFILES.keys())
    coverage = len(profiles_hit) / len(profiles_available) if profiles_available else 0

    report.add("profile_classification", TestResult(
        name="profile coverage",
        passed=coverage >= 0.8,
        details=f"hit {len(profiles_hit)}/{len(profiles_available)} profiles: {profiles_hit}",
        metrics={"coverage": round(coverage, 3), "hit": list(profiles_hit), "available": list(profiles_available)},
    ))

    return accuracy


# ═══════════════════════════════════════════════════════════════════════════════
# PART 2: Weighted RRF Merge Tests (needs haystack.Document)
# ═══════════════════════════════════════════════════════════════════════════════

def test_weighted_rrf(report: EvalReport):
    try:
        from haystack import Document
    except ImportError:
        log.warning("haystack not installed — skipping RRF tests")
        report.skipped += 3
        return

    from src.services.rag_tuner import weighted_rrf_merge, _current_profile

    log.info("=" * 60)
    log.info("PART 2: Weighted RRF Merge Logic")
    log.info("=" * 60)

    # Test 1: Basic merge with overlapping docs
    vec_docs = [
        Document(id="d1", content="Diabetes fasting glucose target is 4-7 mmol/L", meta={"score": 0.85, "title": "WHO PEN Diabetes"}),
        Document(id="d2", content="HbA1c should be below 7%", meta={"score": 0.72, "title": "WHO PEN Diabetes"}),
        Document(id="d3", content="Blood pressure monitoring weekly", meta={"score": 0.55, "title": "WHO PEN CVD"}),
        Document(id="d4", content="Mental health screening tools", meta={"score": 0.30, "title": "Mental Health"}),
    ]
    kw_docs = [
        Document(id="d2", content="HbA1c should be below 7%", meta={"title": "WHO PEN Diabetes"}),
        Document(id="d5", content="Fasting blood sugar test procedure", meta={"title": "Lab Manual"}),
        Document(id="d1", content="Diabetes fasting glucose target is 4-7 mmol/L", meta={"title": "WHO PEN Diabetes"}),
    ]

    _current_profile.set("clinical_specific")
    merged = weighted_rrf_merge(vec_docs, kw_docs)

    report.add("weighted_rrf", TestResult(
        name="basic merge produces results",
        passed=len(merged) > 0,
        details=f"merged {len(vec_docs)} vector + {len(kw_docs)} keyword → {len(merged)} docs",
    ))

    # Docs in both lists should rank higher
    merged_ids = [d.id for d in merged]
    d1_rank = merged_ids.index("d1") if "d1" in merged_ids else -1
    d2_rank = merged_ids.index("d2") if "d2" in merged_ids else -1

    report.add("weighted_rrf", TestResult(
        name="overlapping docs rank higher",
        passed=d1_rank >= 0 and d2_rank >= 0 and d1_rank < 3 and d2_rank < 3,
        details=f"d1 rank={d1_rank}, d2 rank={d2_rank} (both should be in top 3)",
    ))

    # Test 2: Score threshold filters low-relevance docs
    _current_profile.set("clinical_specific")  # threshold = 0.50
    d4_in_merged = "d4" in merged_ids  # score=0.30, should be filtered at 0.50

    report.add("weighted_rrf", TestResult(
        name="score threshold filters low-relevance (0.30 < 0.50)",
        passed=not d4_in_merged,
        details=f"d4 (score=0.30) {'filtered out' if not d4_in_merged else 'STILL PRESENT (bad)'}",
    ))

    # Test 3: All docs have rrf_score metadata
    all_have_rrf = all(d.meta.get("rrf_score") is not None for d in merged)
    report.add("weighted_rrf", TestResult(
        name="all merged docs have rrf_score metadata",
        passed=all_have_rrf,
        details=f"rrf_scores: {[round(d.meta.get('rrf_score', 0), 4) for d in merged]}",
    ))

    # Test 4: Emergency profile uses lower threshold
    _current_profile.set("emergency")  # threshold = 0.30
    emergency_merged = weighted_rrf_merge(vec_docs, kw_docs)
    emergency_ids = [d.id for d in emergency_merged]
    d4_in_emergency = "d4" in emergency_ids

    report.add("weighted_rrf", TestResult(
        name="emergency profile keeps borderline docs (threshold=0.30)",
        passed=d4_in_emergency,
        details=f"d4 (score=0.30) {'included' if d4_in_emergency else 'filtered (bad for emergency)'}",
    ))

    # Test 5: Empty inputs
    empty_merged = weighted_rrf_merge([], [])
    report.add("weighted_rrf", TestResult(
        name="empty inputs return empty",
        passed=len(empty_merged) == 0,
        details=f"got {len(empty_merged)} docs",
    ))

    # Test 6: Medication profile weights keyword higher
    _current_profile.set("medication_info")
    med_vec = [
        Document(id="m1", content="Metformin 500mg dosage", meta={"score": 0.70, "title": "Medication Guide"}),
    ]
    med_kw = [
        Document(id="m2", content="Metformin side effects include nausea", meta={"title": "Medication Guide"}),
        Document(id="m1", content="Metformin 500mg dosage", meta={"title": "Medication Guide"}),
    ]
    med_merged = weighted_rrf_merge(med_vec, med_kw)
    med_ids = [d.id for d in med_merged]

    report.add("weighted_rrf", TestResult(
        name="medication profile merges both sources",
        passed=len(med_merged) == 2 and "m1" in med_ids and "m2" in med_ids,
        details=f"merged IDs: {med_ids}",
    ))

    # Test 7: Query augmentation for re-ranking
    from src.services.rag_tuner import augment_query_for_reranking
    _current_profile.set("emergency")
    augmented = augment_query_for_reranking("chest pain")
    report.add("weighted_rrf", TestResult(
        name="query augmentation adds prefix",
        passed=augmented.startswith("Emergency") and "chest pain" in augmented,
        details=f"augmented: {augmented}",
    ))

    _current_profile.set("default")
    default_aug = augment_query_for_reranking("general question")
    report.add("weighted_rrf", TestResult(
        name="default profile has no prefix",
        passed=default_aug == "general question",
        details=f"augmented: {default_aug}",
    ))

    log.info(f"RRF tests complete")


# ═══════════════════════════════════════════════════════════════════════════════
# PART 3: Chunk Quality Diagnostics (needs ArcadeDB)
# ═══════════════════════════════════════════════════════════════════════════════

def test_chunk_quality(report: EvalReport):
    try:
        from src.utils.arcade_client import command_sql, extract_rows
    except ImportError:
        log.warning("arcade_client not available — skipping chunk diagnostics")
        report.skipped += 4
        return

    log.info("=" * 60)
    log.info("PART 3: Chunk Quality Diagnostics")
    log.info("=" * 60)

    try:
        resp = command_sql("SELECT count(*) as cnt FROM chunks")
        rows = extract_rows(resp)
        total_chunks = rows[0]["cnt"] if rows else 0
    except Exception as e:
        log.warning(f"ArcadeDB not reachable: {e}")
        report.skipped += 4
        return

    report.add("chunk_quality", TestResult(
        name="chunk count",
        passed=total_chunks > 0,
        details=f"{total_chunks} chunks in knowledge base",
        metrics={"total_chunks": total_chunks},
    ))

    # Check for bad chunk boundaries
    try:
        resp = command_sql("SELECT chunk_id, text FROM chunks LIMIT 200")
        chunks = extract_rows(resp)

        bad_starts = []
        bad_ends = []
        short_chunks = []
        long_chunks = []

        for c in chunks:
            text = c.get("text", "")
            cid = c.get("chunk_id", "?")
            word_count = len(text.split())

            if text.lstrip().startswith(("and ", "or ", "but ", "the ", "- ", ". ")):
                bad_starts.append({"chunk_id": cid, "start": text[:60]})

            if text.rstrip() and not text.rstrip()[-1] in ".):\"'!?":
                bad_ends.append({"chunk_id": cid, "end": text[-60:]})

            if word_count < 20:
                short_chunks.append({"chunk_id": cid, "words": word_count})

            if word_count > 300:
                long_chunks.append({"chunk_id": cid, "words": word_count})

        report.add("chunk_quality", TestResult(
            name="chunk boundary quality (starts)",
            passed=len(bad_starts) < len(chunks) * 0.1,
            details=f"{len(bad_starts)}/{len(chunks)} chunks start mid-sentence",
            metrics={"bad_starts": len(bad_starts), "examples": bad_starts[:5]},
        ))

        report.add("chunk_quality", TestResult(
            name="chunk boundary quality (ends)",
            passed=len(bad_ends) < len(chunks) * 0.15,
            details=f"{len(bad_ends)}/{len(chunks)} chunks end mid-sentence",
            metrics={"bad_ends": len(bad_ends), "examples": bad_ends[:5]},
        ))

        report.add("chunk_quality", TestResult(
            name="chunk size distribution",
            passed=len(short_chunks) < len(chunks) * 0.05 and len(long_chunks) < len(chunks) * 0.05,
            details=f"{len(short_chunks)} too short (<20 words), {len(long_chunks)} too long (>300 words)",
            metrics={"short": len(short_chunks), "long": len(long_chunks), "total_sampled": len(chunks)},
        ))

    except Exception as e:
        log.warning(f"Chunk quality check failed: {e}")
        report.skipped += 2

    # Check for duplicate chunks
    try:
        resp = command_sql(
            "SELECT text, count(*) as cnt FROM chunks GROUP BY text HAVING cnt > 1 LIMIT 20"
        )
        dupes = extract_rows(resp)

        report.add("chunk_quality", TestResult(
            name="duplicate chunks",
            passed=len(dupes) == 0,
            details=f"{len(dupes)} exact duplicate texts found",
            metrics={"duplicate_count": len(dupes), "examples": [d.get("text", "")[:60] for d in dupes[:5]]},
        ))

    except Exception as e:
        log.warning(f"Duplicate check failed: {e}")
        report.skipped += 1


# ═══════════════════════════════════════════════════════════════════════════════
# PART 4: End-to-End Retrieval Accuracy (needs ArcadeDB + embedder)
# ═══════════════════════════════════════════════════════════════════════════════

def test_retrieval_accuracy(report: EvalReport):
    try:
        from src.utils.arcade_client import command_sql, extract_rows
        from sentence_transformers import SentenceTransformer
    except ImportError:
        log.warning("Dependencies not available — skipping retrieval tests")
        report.skipped += len(EVAL_QUERIES)
        return

    log.info("=" * 60)
    log.info("PART 4: End-to-End Retrieval Accuracy")
    log.info("=" * 60)

    try:
        command_sql("SELECT count(*) FROM chunks")
    except Exception:
        log.warning("ArcadeDB not reachable — skipping retrieval tests")
        report.skipped += len(EVAL_QUERIES)
        return

    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    from src.services.rag_tuner import classify_rag_profile, RAG_PROFILES, _current_profile

    hit_at_3 = 0
    hit_at_5 = 0
    total_queries = 0
    per_domain: Dict[str, Dict] = {}
    all_scores: List[Dict] = []

    for case in EVAL_QUERIES:
        query = case["query"]
        domain = case["domain"]
        expected_kws = case.get("expected_keywords", [])
        must_not = case.get("must_not_contain", [])

        profile_name = classify_rag_profile(query)
        _current_profile.set(profile_name)
        profile = RAG_PROFILES[profile_name]

        # Vector retrieval
        embedding = model.encode([query])[0].tolist()
        try:
            vec_sql = (
                f"SELECT chunk_id, title, text, "
                f"vectorCosineSimilarity(embedding, :qv) as score "
                f"FROM chunks ORDER BY score DESC LIMIT {profile['vector_top_k']}"
            )
            vec_resp = command_sql(vec_sql, params={"qv": embedding})
            vec_rows = extract_rows(vec_resp)
        except Exception as e:
            log.warning(f"Vector search failed for '{query[:40]}': {e}")
            vec_rows = []

        # Keyword retrieval
        kw_terms = " ".join(query.split()[:6])
        try:
            kw_sql = (
                f"SELECT chunk_id, title, text FROM chunks "
                f"WHERE text CONTAINSTEXT :q LIMIT {profile['keyword_top_k']}"
            )
            kw_resp = command_sql(kw_sql, params={"q": kw_terms})
            kw_rows = extract_rows(kw_resp)
        except Exception as e:
            log.warning(f"Keyword search failed for '{query[:40]}': {e}")
            kw_rows = []

        # Combine results
        all_texts = []
        for r in vec_rows:
            all_texts.append({
                "text": r.get("text", ""),
                "score": r.get("score", 0),
                "title": r.get("title", ""),
                "source": "vector",
            })
        for r in kw_rows:
            all_texts.append({
                "text": r.get("text", ""),
                "title": r.get("title", ""),
                "source": "keyword",
            })

        # Check keyword hits
        def has_keyword(texts, keyword):
            kw_lower = keyword.lower()
            for t in texts[:5]:
                if kw_lower in t["text"].lower():
                    return True
            return False

        hits_3 = sum(1 for kw in expected_kws if has_keyword(all_texts[:3], kw))
        hits_5 = sum(1 for kw in expected_kws if has_keyword(all_texts[:5], kw))
        kw_total = len(expected_kws) if expected_kws else 1

        hit3 = hits_3 > 0
        hit5 = hits_5 > 0
        if hit3:
            hit_at_3 += 1
        if hit5:
            hit_at_5 += 1
        total_queries += 1

        # Check must_not_contain
        noise_found = []
        for bad in must_not:
            if any(bad.lower() in t["text"].lower() for t in all_texts[:5]):
                noise_found.append(bad)

        # Track per-domain
        if domain not in per_domain:
            per_domain[domain] = {"hit3": 0, "hit5": 0, "total": 0, "noise": 0}
        per_domain[domain]["total"] += 1
        if hit3:
            per_domain[domain]["hit3"] += 1
        if hit5:
            per_domain[domain]["hit5"] += 1
        if noise_found:
            per_domain[domain]["noise"] += 1

        # Score distribution tracking
        vec_scores = [r.get("score", 0) for r in vec_rows if r.get("score")]
        if vec_scores:
            all_scores.append({
                "query": query[:50],
                "profile": profile_name,
                "top_score": round(max(vec_scores), 3),
                "avg_score": round(sum(vec_scores) / len(vec_scores), 3),
                "min_score": round(min(vec_scores), 3),
                "num_results": len(vec_scores),
            })

        report.add("retrieval_accuracy", TestResult(
            name=f"retrieve: {query[:50]}",
            passed=hit5 and not noise_found,
            details=(
                f"profile={profile_name}, hit@3={hit3}, hit@5={hit5}, "
                f"vec_results={len(vec_rows)}, kw_results={len(kw_rows)}, "
                f"keyword_hits_top5={hits_5}/{kw_total}"
                + (f", NOISE: {noise_found}" if noise_found else "")
            ),
            metrics={
                "profile": profile_name,
                "hit_at_3": hit3,
                "hit_at_5": hit5,
                "vector_results": len(vec_rows),
                "keyword_results": len(kw_rows),
                "top_vec_score": round(vec_scores[0], 3) if vec_scores else 0,
            },
        ))

    # Summary metrics
    hit3_rate = hit_at_3 / total_queries if total_queries else 0
    hit5_rate = hit_at_5 / total_queries if total_queries else 0

    log.info(f"Hit@3: {hit_at_3}/{total_queries} ({hit3_rate:.0%})")
    log.info(f"Hit@5: {hit_at_5}/{total_queries} ({hit5_rate:.0%})")
    log.info("Per-domain breakdown:")
    for domain, stats in sorted(per_domain.items()):
        log.info(f"  {domain:20s}: hit@3={stats['hit3']}/{stats['total']}, hit@5={stats['hit5']}/{stats['total']}, noise={stats['noise']}")

    report.summary["retrieval_accuracy"] = {
        "hit_at_3": round(hit3_rate, 3),
        "hit_at_5": round(hit5_rate, 3),
        "total_queries": total_queries,
        "per_domain": per_domain,
    }

    report.summary["score_distribution"] = all_scores


# ═══════════════════════════════════════════════════════════════════════════════
# PART 5: Score Calibration Analysis (needs ArcadeDB + embedder)
# ═══════════════════════════════════════════════════════════════════════════════

def test_score_calibration(report: EvalReport):
    try:
        from src.utils.arcade_client import command_sql, extract_rows
        from sentence_transformers import SentenceTransformer
    except ImportError:
        log.warning("Dependencies not available — skipping calibration tests")
        report.skipped += 3
        return

    log.info("=" * 60)
    log.info("PART 5: Score Calibration Analysis")
    log.info("=" * 60)

    try:
        command_sql("SELECT count(*) FROM chunks")
    except Exception:
        log.warning("ArcadeDB not reachable — skipping calibration tests")
        report.skipped += 3
        return

    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    calibration_queries = [
        ("What is the target blood sugar for diabetics", "highly_relevant"),
        ("Best football team in The Gambia", "irrelevant"),
        ("Diabetes management with diet and exercise", "relevant"),
        ("How to fix my car engine", "irrelevant"),
        ("Hypertension treatment protocol WHO PEN", "highly_relevant"),
        ("What is the weather today in Banjul", "irrelevant"),
    ]

    score_buckets = {"highly_relevant": [], "relevant": [], "irrelevant": []}

    for query, expected_relevance in calibration_queries:
        embedding = model.encode([query])[0].tolist()
        try:
            resp = command_sql(
                "SELECT text, vectorCosineSimilarity(embedding, :qv) as score "
                "FROM chunks ORDER BY score DESC LIMIT 5",
                params={"qv": embedding},
            )
            rows = extract_rows(resp)
            scores = [r.get("score", 0) for r in rows if r.get("score")]
            if scores:
                score_buckets[expected_relevance].append({
                    "query": query,
                    "top_score": round(max(scores), 3),
                    "avg_top5": round(sum(scores) / len(scores), 3),
                })
        except Exception as e:
            log.warning(f"Calibration query failed: {e}")

    # Analyze separation between relevant and irrelevant
    relevant_avg = 0
    irrelevant_avg = 0

    if score_buckets["highly_relevant"]:
        relevant_avg = sum(s["top_score"] for s in score_buckets["highly_relevant"]) / len(score_buckets["highly_relevant"])
    if score_buckets["irrelevant"]:
        irrelevant_avg = sum(s["top_score"] for s in score_buckets["irrelevant"]) / len(score_buckets["irrelevant"])

    separation = relevant_avg - irrelevant_avg

    report.add("score_calibration", TestResult(
        name="relevant vs irrelevant score separation",
        passed=separation > 0.10,
        details=f"relevant avg top score={relevant_avg:.3f}, irrelevant avg={irrelevant_avg:.3f}, separation={separation:.3f}",
        metrics={"relevant_avg": round(relevant_avg, 3), "irrelevant_avg": round(irrelevant_avg, 3), "separation": round(separation, 3)},
    ))

    report.add("score_calibration", TestResult(
        name="irrelevant queries score below threshold",
        passed=irrelevant_avg < 0.45,
        details=f"irrelevant avg top score={irrelevant_avg:.3f} (should be < 0.45 threshold)",
        metrics=score_buckets,
    ))

    report.add("score_calibration", TestResult(
        name="relevant queries score above threshold",
        passed=relevant_avg > 0.45,
        details=f"relevant avg top score={relevant_avg:.3f} (should be > 0.45 threshold)",
    ))

    report.summary["score_calibration"] = {
        "relevant_avg_score": round(relevant_avg, 3),
        "irrelevant_avg_score": round(irrelevant_avg, 3),
        "separation": round(separation, 3),
        "buckets": score_buckets,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Report Generation
# ═══════════════════════════════════════════════════════════════════════════════

def print_report(report: EvalReport):
    log.info("")
    log.info("=" * 70)
    log.info("RAG EVALUATION REPORT")
    log.info("=" * 70)
    log.info(f"Timestamp:  {report.timestamp}")
    log.info(f"Total:      {report.total_tests} tests")
    log.info(f"Passed:     {report.passed}")
    log.info(f"Failed:     {report.failed}")
    log.info(f"Skipped:    {report.skipped}")
    log.info(f"Pass rate:  {report.passed / report.total_tests:.0%}" if report.total_tests else "N/A")
    log.info("")

    for section, results in report.sections.items():
        passed = sum(1 for r in results if r["passed"])
        failed = sum(1 for r in results if not r["passed"])
        log.info(f"--- {section} ({passed} passed, {failed} failed) ---")
        for r in results:
            status = "PASS" if r["passed"] else "FAIL"
            log.info(f"  [{status}] {r['name']}")
            if not r["passed"] and r["details"]:
                log.info(f"         {r['details']}")
        log.info("")

    if "profile_classification" in report.summary:
        s = report.summary["profile_classification"]
        log.info(f"Profile Classification Accuracy: {s['accuracy']:.0%} ({s['correct']}/{s['total']})")

    if "retrieval_accuracy" in report.summary:
        s = report.summary["retrieval_accuracy"]
        log.info(f"Retrieval Hit@3: {s['hit_at_3']:.0%}")
        log.info(f"Retrieval Hit@5: {s['hit_at_5']:.0%}")

    if "score_calibration" in report.summary:
        s = report.summary["score_calibration"]
        log.info(f"Score Separation: {s['separation']:.3f} (relevant={s['relevant_avg_score']:.3f}, irrelevant={s['irrelevant_avg_score']:.3f})")

    log.info("=" * 70)


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def run_eval(unit_only: bool = False, with_db: bool = False, report_path: str = ""):
    report = EvalReport(timestamp=datetime.utcnow().isoformat())

    # Part 1: Always runs (pure Python)
    test_query_classification(report)

    # Part 2: Needs haystack.Document
    test_weighted_rrf(report)

    if with_db:
        # Part 3: Needs ArcadeDB
        test_chunk_quality(report)

        # Part 4: Needs ArcadeDB + embedder
        test_retrieval_accuracy(report)

        # Part 5: Score calibration
        test_score_calibration(report)

    print_report(report)

    if report_path:
        with open(report_path, "w") as f:
            json.dump(asdict(report), f, indent=2, default=str)
        log.info(f"Report saved to {report_path}")

    return report


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="AMINA RAG Evaluation Suite")
    parser.add_argument("--unit-only", action="store_true", help="Run only unit tests")
    parser.add_argument("--with-db", action="store_true", help="Run DB-dependent tests")
    parser.add_argument("--report", default="", help="Save JSON report to file")
    args = parser.parse_args()

    run_eval(
        unit_only=args.unit_only,
        with_db=args.with_db,
        report_path=args.report,
    )
