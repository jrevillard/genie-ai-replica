# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Tests for strict grounding ("containment") mode in the ChatQnA orchestrator.

Strict mode backs a specific claim: every informational answer comes from the
operator-curated document repository, and anything else is refused. These tests
exercise the three ways an ungrounded answer could otherwise reach the user:

  1. the abstention instruction telling the model to answer anyway
  2. the system prompt telling the model to extend beyond the documents
  3. short or greeting-prefixed questions skipping retrieval entirely

The heavy OPEA / FastAPI / transformers dependencies are stubbed so this runs
against the real module with no installed dependencies:

    python3 -m unittest tests.test_strict_grounding -v
"""

import os
import subprocess
import sys
import types
import unittest
from contextlib import contextmanager

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CHATQNA_DIR = os.path.join(_REPO_ROOT, "genie-ai-overlay", "chatqna")
# The chatqna image copies core/appointment_guard.py next to genieai_chatqna.py.
_CORE_DIR = os.path.join(_REPO_ROOT, "genie-ai-overlay", "core")

# Re-imports this module (and through it the orchestrator) in a fresh process so
# module-level env parsing can be exercised with different values.
_IMPORT_AND_PRINT_MIN_SCORE = (
    "import importlib.util;"
    "spec=importlib.util.spec_from_file_location('t','tests/test_strict_grounding.py');"
    "m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);"
    "print(m.gc.CHATQNA_STRICT_MIN_SCORE)"
)


class _Params:
    """Stand-in for the OPEA docarray parameter models."""

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)

    def model_dump(self, **_kwargs):
        return dict(self.__dict__)

    def dict(self, **_kwargs):
        return dict(self.__dict__)


class _Logger:
    def __getattr__(self, _name):
        return lambda *a, **k: None


class _Enum:
    def __getattr__(self, name):
        return f"<{name}>"


def _stub_module(name, **attrs):
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


def _install_import_stubs():
    """Register stubs for dependencies the orchestrator imports at module load."""
    _stub_module(
        "comps",
        MegaServiceEndpoint=_Enum(),
        MicroService=object,
        ServiceOrchestrator=object,
        ServiceRoleType=_Enum(),
        ServiceType=_Enum(),
        CustomLogger=lambda *a, **k: _Logger(),
    )
    _stub_module("comps.cores")
    _stub_module("comps.cores.mega")
    _stub_module("comps.cores.mega.utils", handle_message=lambda *a, **k: "")
    _stub_module("comps.cores.proto")
    _stub_module(
        "comps.cores.proto.genieai_api_protocol",
        ChatCompletionRequest=_Params,
        ChatCompletionResponse=_Params,
        ChatCompletionResponseChoice=_Params,
        ChatMessage=_Params,
        UsageInfo=_Params,
        RequestContext=_Params,
    )
    _stub_module(
        "comps.cores.proto.docarray",
        LLMParams=_Params,
        RerankerParms=_Params,
        RetrieverParms=_Params,
    )
    _stub_module("httpx", AsyncClient=object)
    _stub_module("aiohttp", ClientSession=object)
    _stub_module("requests", get=None, post=None)
    _stub_module("fastapi", Request=object)
    _stub_module("fastapi.responses", StreamingResponse=object)
    _stub_module("langchain_core")
    _stub_module("langchain_core.prompts", PromptTemplate=_Params)
    _stub_module("langdetect", detect=lambda *a, **k: "en")
    _stub_module("transformers", AutoTokenizer=_Params)


_install_import_stubs()
for _dir in (_CORE_DIR, _CHATQNA_DIR):
    if _dir not in sys.path:
        sys.path.insert(0, _dir)

import genieai_chatqna as gc


@contextmanager
def strict_mode(enabled=True):
    """
    Toggle strict grounding for the duration of a test.

    The flag is read from the environment at import time, but every consumer
    reads the module global at call time, so flipping it here is equivalent to
    running the service with CHATQNA_STRICT_GROUNDING set.
    """
    previous = gc.CHATQNA_STRICT_GROUNDING
    gc.CHATQNA_STRICT_GROUNDING = enabled
    try:
        yield
    finally:
        gc.CHATQNA_STRICT_GROUNDING = previous


@contextmanager
def capability_limits(enabled=True):
    """Toggle the "what you cannot do" prompt block for the duration of a test."""
    previous = gc.CHATQNA_NO_CAPABILITY_CLAIMS
    gc.CHATQNA_NO_CAPABILITY_CLAIMS = enabled
    try:
        yield
    finally:
        gc.CHATQNA_NO_CAPABILITY_CLAIMS = previous


class ClinicalQuestionsReachRetrieval(unittest.TestCase):
    """Channel 3: short questions must not skip the repository in strict mode."""

    SHORT_CLINICAL_QUERIES = (
        "what is diabetes",
        "high blood pressure?",
        "is salt bad?",
        "treat hypertension",
    )

    GREETING_PREFIXED_QUERIES = (
        "hi what is diabetes",
        "hello is amlodipine safe",
        "good morning what causes stroke",
        "thanks, is salt bad for me",
    )

    def test_default_mode_lets_short_questions_skip_retrieval(self):
        # Documents today's behaviour, which strict mode exists to change.
        with strict_mode(False):
            for query in self.SHORT_CLINICAL_QUERIES:
                self.assertTrue(
                    gc.is_small_talk_query(query),
                    f"expected {query!r} to be treated as small talk in default mode",
                )

    def test_strict_mode_routes_short_questions_to_retrieval(self):
        with strict_mode():
            for query in self.SHORT_CLINICAL_QUERIES:
                self.assertFalse(
                    gc.is_small_talk_query(query),
                    f"{query!r} would skip retrieval and answer from the model alone",
                )

    def test_strict_mode_ignores_greeting_prefixes(self):
        with strict_mode():
            for query in self.GREETING_PREFIXED_QUERIES:
                self.assertFalse(
                    gc.is_small_talk_query(query),
                    f"greeting prefix let {query!r} bypass retrieval",
                )

    def test_strict_mode_still_answers_real_small_talk(self):
        # Containment is about information, not politeness: greetings must not
        # be answered with the canned refusal.
        with strict_mode():
            for query in [
                "hello",
                "hi there",
                "good morning",
                "how are you?",
                "thanks for the help",
                "thank you so much",
                "bye",
            ]:
                self.assertTrue(
                    gc.is_small_talk_query(query),
                    f"{query!r} would be refused instead of answered",
                )


class RedFlagsBypassContainment(unittest.TestCase):
    """Safety overrides containment: emergencies are never refused."""

    def test_symptom_red_flags_detected(self):
        for query in [
            # Cardiac — both word orders, since the system prompt's own example
            # uses the reversed form ("heavy pressure on my chest").
            "I feel heavy pressure on my chest",
            "my chest hurts",
            "I have pain in my chest and jaw",
            "chest feels very tight",
            "my left arm is numb and I have chest tightness",
            # Stroke
            "my face is drooping and my speech is slurred",
            "half my body feels weak",
            "sudden weakness on one side",
            "I think I am having a stroke",
            # Vision
            "my vision went blurry suddenly",
            "I cannot see properly all of a sudden",
            # Breathing
            "I am short of breath",
            "shortness of breath since morning",
            "I can't breathe properly",
            # Collapse / neurological
            "I fainted this morning",
            "I blacked out",
            "I had a seizure",
            "my husband is unconscious",
            "I have the worst headache of my life",
            "my head hurts so badly, worst ever",
            # Metabolic crisis
            "I am vomiting and confused",
            # Self-harm
            "I have been thinking about suicide",
            "I want to end my life",
            "thinking of hurting myself",
        ]:
            self.assertTrue(gc.is_red_flag_query(query), f"missed red flag: {query!r}")

    def test_urgent_blood_pressure_readings_detected(self):
        for query in [
            "my pressure is 190 over 115",
            "I measured 180/110 today",
            "BP was 200/95 this morning",  # systolic alone is enough
            "reading was 150/112",  # diastolic alone is enough
        ]:
            self.assertTrue(gc.is_red_flag_query(query), f"missed urgent BP: {query!r}")

    def test_ordinary_questions_are_not_red_flags(self):
        # A false positive is a containment hole, not a harmless extra check: the
        # exempted turn is answered by the normal path, which may be ungrounded.
        for query in [
            "what is diabetes",
            "my pressure is 120/80",
            "how much salt should I eat",
            "I want to stop smoking",
            "how do I lower my salt",
            "I feel fine today",
            "I have mild headache sometimes",
            "I am confused about my medication schedule",
        ]:
            self.assertFalse(gc.is_red_flag_query(query), f"false red flag: {query!r}")

    def test_condition_names_alone_are_not_red_flags(self):
        # Stroke, heart attack and seizure are core knowledge-base topics. If the
        # bare noun matched, the questions the repository exists to answer would
        # be the ones exempted from containment.
        for query in [
            "what causes stroke",
            "how do I prevent a heart attack",
            "what is a seizure",
            "is stroke common in the Gambia",
            "I don't want to have a stroke",
        ]:
            self.assertFalse(gc.is_red_flag_query(query), f"condition name exempted: {query!r}")

    def test_numeric_ranges_are_not_blood_pressure(self):
        # A hyphen is not a blood-pressure separator; these are dose/volume ranges.
        for query in [
            "drink 200-300 ml of water each day",
            "take 100-250 mg as advised",
            "walk 30-45 minutes daily",
        ]:
            self.assertFalse(gc.is_red_flag_query(query), f"range read as BP: {query!r}")

    def test_non_medical_phrasing_is_not_a_red_flag(self):
        for query in [
            "I can't see my chat history",
            "I cannot see my results",
            "worst thing that ever happened to my diet",
        ]:
            self.assertFalse(gc.is_red_flag_query(query), f"false red flag: {query!r}")


class AbstentionInstructions(unittest.TestCase):
    """Channel 1: the no-documents instruction must demand refusal in strict mode."""

    def test_default_mode_asks_the_model_to_keep_answering(self):
        with strict_mode(False):
            text = gc.abstention_instructions()
        self.assertIn("conversational", text)
        self.assertNotIn(gc.CHATQNA_STRICT_REFUSAL, text)

    def test_strict_mode_demands_the_canned_refusal(self):
        with strict_mode():
            text = gc.abstention_instructions()
        self.assertIn(gc.CHATQNA_STRICT_REFUSAL, text)
        self.assertIn("MUST NOT answer from your own knowledge", text)

    def test_explicit_env_override_still_wins(self):
        previous = gc.CHATQNA_ABSTENTION_INSTRUCTIONS
        gc.CHATQNA_ABSTENTION_INSTRUCTIONS = "custom operator instructions"
        try:
            with strict_mode():
                self.assertEqual(gc.abstention_instructions(), "custom operator instructions")
        finally:
            gc.CHATQNA_ABSTENTION_INSTRUCTIONS = previous


class SystemPromptPolicy(unittest.TestCase):
    """Channel 2: the containment block must override the prompt above it."""

    TWIN_PROMPT = (
        "You are a health companion.\n"
        "6. When documents ARE retrieved: extend with general knowledge if needed.\n"
        "BANNED PHRASES\n"
        '- "I couldn\'t find anything about this in the knowledge base"\n'
    )

    def test_both_blocks_off_leaves_the_prompt_untouched(self):
        with strict_mode(False), capability_limits(False):
            self.assertEqual(gc.apply_system_prompt_policy(self.TWIN_PROMPT), self.TWIN_PROMPT)

    def test_strict_mode_appends_the_containment_block_last(self):
        # Appended last so it also overrides per-twin prompts stored in ArangoDB,
        # which this service cannot rewrite.
        with strict_mode(), capability_limits(False):
            result = gc.apply_system_prompt_policy(self.TWIN_PROMPT)
        self.assertTrue(result.startswith(self.TWIN_PROMPT))
        self.assertIn("STRICT GROUNDING MODE", result)
        self.assertIn("OVERRIDE EVERY INSTRUCTION ABOVE", result)
        self.assertIn(gc.CHATQNA_STRICT_REFUSAL, result)

    def test_containment_block_preserves_the_safety_carve_out(self):
        with strict_mode():
            result = gc.apply_system_prompt_policy(self.TWIN_PROMPT)
        self.assertIn("Safety overrides containment", result)


class CapabilityLimits(unittest.TestCase):
    """The assistant must not offer actions the product cannot perform."""

    TWIN_PROMPT = "You are a health companion.\n"

    def test_enabled_by_default(self):
        # Offering to book an appointment is a promise the product cannot keep,
        # so the honest framing is the default rather than opt-in.
        self.assertTrue(gc.CHATQNA_NO_CAPABILITY_CLAIMS)

    def test_block_forbids_the_actions_the_product_lacks(self):
        with capability_limits():
            result = gc.apply_system_prompt_policy(self.TWIN_PROMPT)
        self.assertTrue(result.startswith(self.TWIN_PROMPT))
        self.assertIn("WHAT YOU CANNOT DO", result)
        for forbidden in ["appointment", "reminder", "SMS", "referral", "records"]:
            self.assertIn(forbidden, result, f"capability block does not cover {forbidden!r}")

    def test_block_does_not_disown_the_injected_user_profile(self):
        # The prompt injects USER INFORMATION (age, conditions) and the base
        # prompt tells the model to personalise with it. A blanket "you have no
        # access to records" would make it deny knowing data it was handed.
        with capability_limits():
            result = gc.apply_system_prompt_policy(self.TWIN_PROMPT)
        self.assertIn("freely use any USER", result)
        self.assertNotIn("no access to calendars, records", result)

    def test_block_offers_a_replacement_behaviour(self):
        # A bare prohibition tends to produce "I can't help with that"; the block
        # has to say what to do instead.
        with capability_limits():
            result = gc.apply_system_prompt_policy(self.TWIN_PROMPT)
        self.assertIn(gc.SAFE_SENTENCES["en"], result)

    def test_can_be_disabled_for_aspirational_demos(self):
        with capability_limits(False), strict_mode(False):
            self.assertNotIn("WHAT YOU CANNOT DO", gc.apply_system_prompt_policy(self.TWIN_PROMPT))

    def test_composes_with_strict_grounding(self):
        with capability_limits(), strict_mode():
            result = gc.apply_system_prompt_policy(self.TWIN_PROMPT)
        self.assertIn("WHAT YOU CANNOT DO", result)
        self.assertIn("STRICT GROUNDING MODE", result)


class GroundingBar(unittest.TestCase):
    """The grounding bar must not sit below the reranker's threshold."""

    def test_min_score_defaults_to_the_reranking_threshold(self):
        # The reranker's min_n floor can return near-miss chunks below its
        # threshold once one chunk clears it, so a bar of 0.0 would count those
        # topped-up chunks as grounding. Matching the threshold means the best
        # chunk must have cleared the bar on its own.
        self.assertEqual(gc.CHATQNA_STRICT_MIN_SCORE, gc.RERANKING_THRESHOLD)

    def test_min_score_is_above_zero(self):
        self.assertGreater(gc.CHATQNA_STRICT_MIN_SCORE, 0.0)

    def test_blank_min_score_does_not_crash_at_import(self):
        # docker-compose passes `${CHATQNA_STRICT_MIN_SCORE:-}` through as an
        # empty string when unset, so a bare float() here would take the service
        # down on startup. Run in a subprocess: the value is module-level.
        for raw in ["", "   "]:
            env = dict(os.environ, CHATQNA_STRICT_MIN_SCORE=raw)
            proc = subprocess.run(
                [sys.executable, "-c", _IMPORT_AND_PRINT_MIN_SCORE],
                capture_output=True, text=True, env=env, cwd=_REPO_ROOT, check=False,
            )
            self.assertEqual(proc.returncode, 0, f"import crashed for {raw!r}: {proc.stderr[-400:]}")
            self.assertEqual(proc.stdout.strip(), str(gc.RERANKING_THRESHOLD))

    def test_explicit_min_score_is_honoured(self):
        env = dict(os.environ, CHATQNA_STRICT_MIN_SCORE="0.6")
        proc = subprocess.run(
            [sys.executable, "-c", _IMPORT_AND_PRINT_MIN_SCORE],
            capture_output=True, text=True, env=env, cwd=_REPO_ROOT, check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr[-400:])
        self.assertEqual(proc.stdout.strip(), "0.6")


if __name__ == "__main__":
    unittest.main(verbosity=2)
