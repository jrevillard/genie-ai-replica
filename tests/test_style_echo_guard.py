# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Tests for genie-ai-overlay/voice-bridge/style_echo_guard.py (no dependencies).

The style setting comes from the real _build_personality_prompt in
genieai_voice_bridge.py. Only that function is loaded (with ast), because the
module itself needs FastAPI, webrtcvad and Arango.

Run: python3 -m unittest -v tests.test_style_echo_guard
"""

import ast
import importlib.util
import os
import unittest
from typing import Optional

_VOICE_BRIDGE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "genie-ai-overlay", "voice-bridge"
)

_spec = importlib.util.spec_from_file_location(
    "style_echo_guard", os.path.join(_VOICE_BRIDGE_DIR, "style_echo_guard.py")
)
seg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seg)

_BRIDGE = os.path.join(_VOICE_BRIDGE_DIR, "genieai_voice_bridge.py")
with open(_BRIDGE, encoding="utf-8") as _f:
    _tree = ast.parse(_f.read())
_builder = next(n for n in _tree.body if isinstance(n, ast.FunctionDef) and n.name == "_build_personality_prompt")
_ns = {"Optional": Optional}
exec(compile(ast.Module(body=[_builder], type_ignores=[]), _BRIDGE, "exec"), _ns)
build_setting = _ns["_build_personality_prompt"]

PERSONALITIES = [
    {"languageStyle": style, "responseLength": length}
    for style in ("slang", "casual", "professional")
    for length in ("short", "medium", "long")
]
LABELS = seg.echo_labels(build_setting(None))

# What CareLink said in Andy's Audio test on 2026-10-21, after "Can you schedule
# an appointment for me?".
LIVE_ECHO = [
    "Style preferences for your reply:",
    "- Tone: use casual everyday language; contractions and short forms are fine; avoid formal jargon.",
    "- Length: keep replies moderately detailed, roughly 3-6 sentences.",
]
LIVE_ANSWER = [
    "You can contact your community health worker or clinic to arrange a visit.",
    "They will be able to provide you with the necessary care and monitoring.",
]


class Labels(unittest.TestCase):
    def test_one_label_per_line(self):
        self.assertEqual(len(LABELS), len(build_setting(None).splitlines()))

    def test_same_labels_for_every_personality(self):
        for personality in PERSONALITIES:
            self.assertEqual(seg.echo_labels(build_setting(personality)), LABELS, personality)

    def test_no_setting_no_labels(self):
        self.assertEqual(seg.echo_labels(""), ())
        self.assertEqual(seg.echo_labels(None), ())


class EchoesAreFound(unittest.TestCase):
    def test_live_lines(self):
        for line in LIVE_ECHO:
            self.assertTrue(seg.is_echo(line, LABELS), line)

    def test_every_line_of_every_setting(self):
        for personality in PERSONALITIES:
            for line in build_setting(personality).splitlines():
                self.assertTrue(seg.is_echo(line, LABELS), line)

    def test_other_markup(self):
        for line in [
            "**Tone:** use casual everyday language.",
            "1. Length: keep replies to 1-2 short sentences; no preamble.",
            "* style preferences for your reply",
            '"Style preferences for your reply:"',
        ]:
            self.assertTrue(seg.is_echo(line, LABELS), line)


class AnswersStay(unittest.TestCase):
    def test_answer_sentences(self):
        for sentence in LIVE_ANSWER + [
            "Certainly.",
            "Fine.",
            "A blood pressure reading of 140/90 mmHg is considered high.",
            "The tone of your voice can change when you are stressed.",
            "Length of treatment depends on what your doctor advises.",
            "Style is not important here.",
            "",
        ]:
            self.assertFalse(seg.is_echo(sentence, LABELS), sentence)

    def test_without_labels_nothing_is_an_echo(self):
        self.assertFalse(seg.is_echo(LIVE_ECHO[0], ()))


class StripEcho(unittest.TestCase):
    def test_live_reply(self):
        reply = "\n".join(LIVE_ECHO + LIVE_ANSWER)
        self.assertEqual(seg.strip_echo(reply, LABELS), "\n".join(LIVE_ANSWER))

    def test_header_on_the_line_before_the_answer(self):
        reply = "Style preferences for your reply:\n" + LIVE_ANSWER[0]
        self.assertEqual(seg.strip_echo(reply, LABELS), LIVE_ANSWER[0])

    def test_echo_inside_one_paragraph(self):
        reply = LIVE_ANSWER[0] + " - Length: keep replies moderately detailed. " + LIVE_ANSWER[1]
        self.assertEqual(seg.strip_echo(reply, LABELS), LIVE_ANSWER[0] + " " + LIVE_ANSWER[1])

    def test_reply_without_echo_is_unchanged(self):
        reply = "  " + "\n\n".join(LIVE_ANSWER) + "\n"
        self.assertIs(seg.strip_echo(reply, LABELS), reply)

    def test_only_echo(self):
        self.assertEqual(seg.strip_echo("\n".join(LIVE_ECHO), LABELS), "")

    def test_empty(self):
        self.assertEqual(seg.strip_echo("", LABELS), "")
        self.assertIsNone(seg.strip_echo(None, LABELS))
        self.assertEqual(seg.strip_echo(LIVE_ECHO[0], ()), LIVE_ECHO[0])


if __name__ == "__main__":
    unittest.main()
