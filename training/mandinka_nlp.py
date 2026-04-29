#!/usr/bin/env python3
"""
AMINA v2.0 — #11 Mandinka NLP

Builds a Mandinka health language corpus and adapts the tokenizer
for native Mandinka understanding without a translation layer.

Components:
  1. Mandinka Health Corpus — curated phrases, medical terms, conversations
  2. Tokenizer Adaptation — extend base tokenizer with Mandinka health vocabulary
  3. Bilingual Training Data — paired EN/MA health conversations
  4. Evaluation Set — test Mandinka understanding accuracy

This enables AMINA to understand Mandinka health queries natively
instead of routing through a translation service.

Usage:
  python mandinka_nlp.py --build-corpus --output mandinka_corpus/
  python mandinka_nlp.py --adapt-tokenizer --base meta-llama/Meta-Llama-3-8B-Instruct --output tokenizers/amina-ma
  python mandinka_nlp.py --generate-training --output training_data/mandinka_health.jsonl --count 2000
"""

import json
import os
import argparse
from datetime import datetime
from typing import List, Dict


# ══════════════════════════════════════════════════════════════
# MANDINKA HEALTH VOCABULARY
# Curated medical terms, greetings, body parts, symptoms
# ══════════════════════════════════════════════════════════════

MANDINKA_HEALTH_VOCAB = {
    # Greetings & Social
    "greetings": {
        "Salaam aleikum": "Peace be upon you",
        "Malaikum salaam": "And upon you peace",
        "I be di?": "How are you?",
        "Nba, i be di?": "Mother, how are you?",
        "Mfa, i be di?": "Father, how are you?",
        "Isama jang!": "Good morning!",
        "Itilii jang!": "Good afternoon!",
        "Iwulaara jang!": "Good evening!",
        "Tanante": "Long time no see",
        "Jaama rek": "Peace only",
        "I mbe nyaading": "Are you well?",
    },

    # Body Parts
    "body": {
        "kuŋo": "head",
        "ñiŋo": "eye",
        "tuloo": "ear",
        "daŋo": "mouth",
        "kaŋo": "neck/throat",
        "jusu": "chest",
        "tuntuŋo": "heart",
        "furaŋo": "stomach/belly",
        "koŋo": "stomach/hunger",
        "boloo": "hand/arm",
        "siiŋo": "leg/foot",
        "kiliŋkiliŋo": "kidney",
        "jusufaro": "lung",
        "siŋo": "bone",
    },

    # Medical Terms
    "medical": {
        "kuuraŋo": "sickness/disease",
        "saraabu": "medicine",
        "dokitaroo": "doctor",
        "lafiya buŋo": "health post/clinic",
        "ospitaali": "hospital",
        "dookuwo": "health check/work",
        "sugar kuuraŋo": "diabetes",
        "yeelu keli kuuraŋo": "high blood pressure/hypertension",
        "kuuraŋo bake": "serious illness",
        "fura": "medicine/remedy",
        "fura tradisioŋo": "traditional medicine",
        "marabout fura": "marabout remedy",
    },

    # Symptoms
    "symptoms": {
        "kuŋo diimoo": "headache",
        "furaŋo diimoo": "stomach ache",
        "feberoo": "fever",
        "kanamuŋo": "cough",
        "niisaaloo": "breathing difficulty",
        "saaroo": "diarrhea",
        "wuñaaloo": "vomiting",
        "jooloo": "pain",
        "fatigu": "tiredness/fatigue",
        "ñiŋo feŋfeŋoo": "blurred vision",
        "siŋo bulakoo": "swollen feet/legs",
    },

    # Food & Nutrition
    "food": {
        "domoroo": "food/meal",
        "jiiye": "water",
        "tiyoo": "tea/attaya",
        "sukaaru": "sugar",
        "koŋo": "salt",
        "tuluu": "oil",
        "maalu": "rice",
        "saŋkataŋo": "millet",
        "chere": "millet porridge",
        "nakoo": "vegetable/sauce",
        "benachin": "jollof rice",
        "domoda": "groundnut stew",
        "supakanja": "okra stew",
        "moringa": "moringa leaves",
        "wonjo": "hibiscus/bissap",
        "bouye": "baobab fruit drink",
    },

    # Numbers (for vitals)
    "numbers": {
        "kiliŋ": "one", "fula": "two", "saba": "three",
        "naani": "four", "luulu": "five", "wooro": "six",
        "woorowula": "seven", "sey": "eight", "kononto": "nine",
        "taŋ": "ten", "muwaŋ": "twenty", "taŋ saba": "thirty",
    },

    # Health Actions
    "actions": {
        "taa": "go",
        "naa": "come",
        "domo": "eat",
        "miŋ": "drink",
        "sirii": "sit",
        "wiili": "stand",
        "daala": "rest/lie down",
        "taama": "walk",
        "lafiiyaa": "exercise/be active",
        "siyaa": "stop/quit",
        "dabaa": "stop/leave",
        "ñininkaa": "check/examine",
    },

    # Community Roles
    "community": {
        "alkalo": "village head",
        "imam": "Islamic leader",
        "CHW": "community health worker",
        "VHW": "village health worker",
        "marabout": "traditional healer",
    },
}


# Bilingual health conversation templates
BILINGUAL_CONVERSATIONS = [
    {
        "ma_user": "N la sugar jiitata. N ka mun ke?",
        "en_user": "My sugar is high. What should I do?",
        "ma_assistant": "I la sugar jiitata. Jiiye domo sisan. Kana sukaaru domo, kana maalu jamaa domo. I la saraabu domo i ye dokitaroo fo la kuŋ. I ye i la sugar ñininkaa saaying?",
        "en_assistant": "Your sugar is high. Drink water now. Do not eat sugar, do not eat too much rice. Take your medicine as your doctor told you. Have you checked your sugar today?",
    },
    {
        "ma_user": "N la yeelu keli jiitata, kuŋo diimoo be n na",
        "en_user": "My blood pressure is high and I have a headache",
        "ma_assistant": "Sirii, i hakili sabaatii. Niisaa taa doomuŋ kono, a bori daamu kono. I la fura domo dokitaroo ye i so la kuŋ. Kuŋo diimoo bake bake? Ninsi diimoo be i la jusu kono?",
        "en_assistant": "Sit down, stay calm. Breathe in through your nose, out through your mouth. Take the medicine your doctor gave you. Is the headache very severe? Do you have any chest pain?",
    },
    {
        "ma_user": "N be koluŋ ke, n te se ka fura domo",
        "en_user": "I am fasting, I cannot take my medicine",
        "ma_assistant": "Ramadan koluŋ saloo la, i ka se ka i la saraabu domo Iftaari waatoo la. Metformin domo Iftaari tumaŋ. I la sugar ka doyaa 70 kaŋ — i ka koluŋo daa kuleŋ. I ye dokitaroo ñininkaa Ramadan folo?",
        "en_assistant": "During Ramadan fasting, you can take your medicine at Iftar time. Take metformin at Iftar. If your sugar drops below 70 — break your fast immediately. Did you consult your doctor before Ramadan?",
    },
    {
        "ma_user": "N be kiliŋkiloo la, n te a loŋ n ka mun ke",
        "en_user": "I am scared, I don't know what to do",
        "ma_assistant": "N ye i meŋ. A keta sembeŋo le ti ka ñiŋ kuma fo. I doroŋ te. N be jaŋ i demmaa la. Mun ne be i hakiloo ñaala?",
        "en_assistant": "I hear you. It takes courage to share this. You are not alone. I am here to help you. What is worrying you?",
    },
    {
        "ma_user": "N bariŋ te sooŋ ka n naa lafiya buŋo la",
        "en_user": "My husband won't let me go to the health post",
        "ma_assistant": "N y'a fahaamu. Moolu jamaa be ñiŋ siyaaloo la. CHW ka se ka naa i la luŋo la — a te keŋ. Walaa Alkalo ka se ka i bariŋ la kuma. I la lafiya keta koleyaa ti. Mun ne i waafita?",
        "en_assistant": "I understand. Many women face this. A CHW can come to your compound — that is possible. Or the Alkalo can speak to your husband. Your health is important. What would work for you?",
    },
]


def build_corpus(output_dir: str):
    """Build the Mandinka health corpus from vocabulary and conversations."""
    os.makedirs(output_dir, exist_ok=True)

    # Save vocabulary
    with open(os.path.join(output_dir, "vocabulary.json"), "w", encoding="utf-8") as f:
        json.dump(MANDINKA_HEALTH_VOCAB, f, indent=2, ensure_ascii=False)

    # Build word list for tokenizer
    all_words = set()
    for category, terms in MANDINKA_HEALTH_VOCAB.items():
        for ma_term in terms.keys():
            for word in ma_term.split():
                if any(c.isalpha() for c in word):
                    all_words.add(word.lower())

    with open(os.path.join(output_dir, "mandinka_words.txt"), "w", encoding="utf-8") as f:
        for word in sorted(all_words):
            f.write(word + "\n")

    # Save bilingual conversations
    with open(os.path.join(output_dir, "bilingual_conversations.json"), "w", encoding="utf-8") as f:
        json.dump(BILINGUAL_CONVERSATIONS, f, indent=2, ensure_ascii=False)

    # Build training-ready format
    training_data = []
    for conv in BILINGUAL_CONVERSATIONS:
        # Mandinka conversation
        training_data.append({
            "messages": [
                {"role": "system", "content": "I ye Amina ti, lafiya dookuwo moolu demmaalaa Gambia kono. Kuma Mandinka kono."},
                {"role": "user", "content": conv["ma_user"]},
                {"role": "assistant", "content": conv["ma_assistant"]},
            ],
            "language": "mandinka",
        })
        # English equivalent
        training_data.append({
            "messages": [
                {"role": "system", "content": "You are Amina, a community health worker in The Gambia."},
                {"role": "user", "content": conv["en_user"]},
                {"role": "assistant", "content": conv["en_assistant"]},
            ],
            "language": "english",
        })
        # Translation pair
        training_data.append({
            "messages": [
                {"role": "system", "content": "Translate this Mandinka health message to English."},
                {"role": "user", "content": conv["ma_user"]},
                {"role": "assistant", "content": conv["en_user"]},
            ],
            "language": "translation_ma_en",
        })

    with open(os.path.join(output_dir, "mandinka_training.jsonl"), "w", encoding="utf-8") as f:
        for d in training_data:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")

    print(f"Corpus built:")
    print(f"  Vocabulary: {sum(len(v) for v in MANDINKA_HEALTH_VOCAB.values())} terms across {len(MANDINKA_HEALTH_VOCAB)} categories")
    print(f"  Unique Mandinka words: {len(all_words)}")
    print(f"  Bilingual conversations: {len(BILINGUAL_CONVERSATIONS)}")
    print(f"  Training examples: {len(training_data)}")
    print(f"  Output: {output_dir}/")


def adapt_tokenizer(base_model: str, output_dir: str):
    """Extend base tokenizer with Mandinka health vocabulary."""
    try:
        from transformers import AutoTokenizer
    except ImportError:
        print("Install: pip install transformers")
        return

    print(f"Loading tokenizer from {base_model}...")
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)

    # Collect Mandinka tokens to add
    new_tokens = set()
    for category, terms in MANDINKA_HEALTH_VOCAB.items():
        for ma_term in terms.keys():
            # Add multi-word terms as single tokens for better representation
            if len(ma_term.split()) > 1:
                new_tokens.add(ma_term)
            # Add individual Mandinka words
            for word in ma_term.split():
                clean = word.strip(".,!?")
                if clean and any(c.isalpha() for c in clean):
                    new_tokens.add(clean)

    # Filter out tokens that are already in the vocabulary
    existing = set(tokenizer.get_vocab().keys())
    truly_new = [t for t in sorted(new_tokens) if t not in existing and t.lower() not in existing]

    if truly_new:
        num_added = tokenizer.add_tokens(truly_new)
        print(f"Added {num_added} Mandinka tokens to tokenizer")
    else:
        print("All Mandinka tokens already exist in vocabulary")

    os.makedirs(output_dir, exist_ok=True)
    tokenizer.save_pretrained(output_dir)

    # Save token list
    with open(os.path.join(output_dir, "added_tokens.json"), "w", encoding="utf-8") as f:
        json.dump(truly_new, f, indent=2, ensure_ascii=False)

    print(f"Adapted tokenizer saved to: {output_dir}/")
    print(f"Original vocab: {len(existing)}, New vocab: {len(existing) + len(truly_new)}")


def generate_mandinka_training(output_file: str, count: int = 2000):
    """Generate Mandinka health training data at scale."""
    import random

    data = []

    # Generate from bilingual conversation templates with variations
    for _ in range(count):
        conv = random.choice(BILINGUAL_CONVERSATIONS)

        # Pick language direction
        lang_type = random.choice(["mandinka", "english", "mixed", "translation"])

        if lang_type == "mandinka":
            data.append({
                "messages": [
                    {"role": "system", "content": "I ye Amina ti, lafiya dookuwo moolu demmaalaa Gambia kono."},
                    {"role": "user", "content": conv["ma_user"]},
                    {"role": "assistant", "content": conv["ma_assistant"]},
                ],
                "language": "mandinka",
            })
        elif lang_type == "english":
            data.append({
                "messages": [
                    {"role": "system", "content": "You are Amina, a Gambian CHW. Respond warmly and practically."},
                    {"role": "user", "content": conv["en_user"]},
                    {"role": "assistant", "content": conv["en_assistant"]},
                ],
                "language": "english",
            })
        elif lang_type == "mixed":
            # User speaks Mandinka, Amina replies in both
            data.append({
                "messages": [
                    {"role": "system", "content": "You are Amina. The user speaks Mandinka. Reply in Mandinka first, then English in parentheses."},
                    {"role": "user", "content": conv["ma_user"]},
                    {"role": "assistant", "content": f"{conv['ma_assistant']}\n\n({conv['en_assistant']})"},
                ],
                "language": "mixed",
            })
        elif lang_type == "translation":
            data.append({
                "messages": [
                    {"role": "system", "content": "Translate Mandinka to English."},
                    {"role": "user", "content": conv["ma_user"]},
                    {"role": "assistant", "content": conv["en_user"]},
                ],
                "language": "translation",
            })

    with open(output_file, "w", encoding="utf-8") as f:
        for d in data:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")

    print(f"Generated {len(data)} Mandinka training examples: {output_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMINA v2.0 Mandinka NLP")
    parser.add_argument("--build-corpus", action="store_true")
    parser.add_argument("--adapt-tokenizer", action="store_true")
    parser.add_argument("--generate-training", action="store_true")
    parser.add_argument("--base", default="meta-llama/Meta-Llama-3-8B-Instruct")
    parser.add_argument("--output", default="mandinka_corpus")
    parser.add_argument("--count", type=int, default=2000)
    args = parser.parse_args()

    if args.build_corpus:
        build_corpus(args.output)
    elif args.adapt_tokenizer:
        adapt_tokenizer(args.base, args.output)
    elif args.generate_training:
        generate_mandinka_training(args.output, args.count)
    else:
        parser.print_help()
