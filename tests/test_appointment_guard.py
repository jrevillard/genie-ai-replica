# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Tests for genie-ai-overlay/core/appointment_guard.py (no dependencies).

Run: python3 -m unittest -v tests.test_appointment_guard
"""

import importlib.util
import os
import unittest

_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "genie-ai-overlay", "core", "appointment_guard.py"
)
_spec = importlib.util.spec_from_file_location("appointment_guard", _PATH)
ag = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ag)

SAFE = ag.SAFE_SENTENCES["en"]


class OffersAreReplaced(unittest.TestCase):
    # The first group are answers CareLink gave in live tests on 2026-10-17/18.
    OFFERS = [
        "Would you like to schedule an appointment with them?",
        "Would you like to schedule an appointment with a community health worker to discuss these options?",
        "I’ll help you schedule an appointment with your community health worker or clinic.",
        "Would you like me to assist you in finding a convenient time for your visit?",
        "However, I can help you find a convenient time to visit your community health worker or clinic.",
        "Shall I book a visit for you?",
        "I have booked an appointment for you.",
        "Let me set up a visit with the clinic.",
        "Do you want me to arrange a check-up?",
        "Would you like help scheduling a follow-up visit?",
        "I can't book appointments, but I can help you find a time for your visit.",
    ]

    def test_each_offer_is_detected(self):
        for sentence in self.OFFERS:
            with self.subTest(sentence=sentence):
                self.assertTrue(ag.is_booking_offer(sentence))

    def test_answer_from_live_test(self):
        answer = (
            "Your blood pressure of 160/100 mmHg falls into the grade 2 hypertension (moderate) range. "
            "Since your blood pressure is on the higher end, it’s important to consult with your community "
            "health worker or clinic. Would you like to schedule an appointment with them?"
        )
        guarded = ag.guard_answer(answer)
        self.assertTrue(guarded.startswith("Your blood pressure of 160/100 mmHg"))
        self.assertTrue(guarded.endswith(SAFE))
        self.assertNotIn("Would you like to schedule", guarded)

    def test_reply_after_yes(self):
        answer = (
            "Great! I’ll help you schedule an appointment with your community health worker or clinic. "
            "They can provide personalized advice based on your blood pressure reading. "
            "Would you like me to assist you in finding a convenient time for your visit?"
        )
        guarded = ag.guard_answer(answer)
        self.assertEqual(guarded.count(SAFE), 1)
        self.assertIn("Great! " + SAFE, guarded)
        self.assertIn("They can provide personalized advice", guarded)
        self.assertNotIn("convenient time", guarded)


class OtherSentencesStay(unittest.TestCase):
    KEPT = [
        SAFE,
        "Your community health worker can arrange this for you.",
        "I'm sorry, but I can't assist with scheduling an appointment.",
        "As an AI, I don't have the ability to book or arrange appointments.",
        "Would you like some tips on how to find a good time to visit them?",
        "Would you like more suggestions?",
        "Would you like to learn more about how to check your blood pressure?",
        "It's important to schedule regular check-ups with your doctor.",
        "Would you like me to help you find time to exercise?",
        "They might recommend lifestyle changes, medication, or both to help manage your blood pressure.",
    ]

    def test_each_is_kept(self):
        for sentence in self.KEPT:
            with self.subTest(sentence=sentence):
                self.assertFalse(ag.is_booking_offer(sentence))

    def test_answer_without_offer_is_returned_unchanged(self):
        answer = "Line one.\n\n- Reduce salt.\n- Walk daily.\nWould you like more suggestions?  "
        self.assertIs(ag.guard_answer(answer), answer)

    def test_empty(self):
        self.assertEqual(ag.guard_answer(""), "")
        self.assertIsNone(ag.guard_answer(None))


class Formatting(unittest.TestCase):
    def test_safe_sentence_appears_once(self):
        answer = f"Shall I book a visit for you? {SAFE} Would you like me to arrange a check-up?"
        self.assertEqual(ag.guard_answer(answer), SAFE)

    def test_list_marker_is_kept(self):
        answer = "Next steps:\n- Reduce salt.\n- Would you like me to book a visit?\n- Walk daily."
        self.assertEqual(ag.guard_answer(answer), f"Next steps:\n- Reduce salt.\n- {SAFE}\n- Walk daily.")

    def test_dropped_duplicate_takes_its_separator(self):
        answer = "Shall I book a visit? Let me set up a visit. Walk daily."
        self.assertEqual(ag.guard_answer(answer), f"{SAFE} Walk daily.")


class OtherLanguages(unittest.TestCase):
    def test_french(self):
        self.assertTrue(ag.is_booking_offer("Voulez-vous que je prenne rendez-vous avec votre agent de santé ?"))
        self.assertTrue(ag.is_booking_offer("Je peux vous aider à trouver un créneau pour votre visite."))
        self.assertFalse(ag.is_booking_offer("Je ne peux pas prendre de rendez-vous pour vous."))
        self.assertFalse(ag.is_booking_offer(ag.SAFE_SENTENCES["fr"]))
        self.assertEqual(
            ag.guard_answer("Votre tension est élevée. Souhaitez-vous que je vous aide à prendre rendez-vous ?", "fr"),
            "Votre tension est élevée. " + ag.SAFE_SENTENCES["fr"],
        )

    def test_spanish(self):
        self.assertTrue(ag.is_booking_offer("¿Le gustaría que programe una cita con su clínica?"))
        self.assertFalse(ag.is_booking_offer("No puedo programar citas."))
        self.assertFalse(ag.is_booking_offer(ag.SAFE_SENTENCES["es"]))

    def test_safe_sentence_language(self):
        self.assertEqual(ag.safe_sentence("FR"), ag.SAFE_SENTENCES["fr"])
        self.assertEqual(ag.safe_sentence("es-ES"), ag.SAFE_SENTENCES["es"])
        self.assertEqual(ag.safe_sentence("sw"), SAFE)
        self.assertEqual(ag.safe_sentence(None), SAFE)


if __name__ == "__main__":
    unittest.main()
