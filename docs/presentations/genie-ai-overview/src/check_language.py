"""Check one language against the English reference, without building the deck.

The build refuses to produce a deck whose languages disagree on the slide
structure or on the set of strings. This script runs the same two checks on
one language at a time, so a translator can validate their file alone.

Usage: python3 src/check_language.py <code> [<code> ...]
"""

from json import loads
from pathlib import Path
from sys import argv, exit

from build_deck import I18N, SLIDES, first_drift, parse, register_problems, structure

REFERENCE = 'en'


def check(code):
    """Return the problems of one language against English."""
    problems = []
    english = parse(REFERENCE)
    candidate = parse(code)

    if structure(candidate) != structure(english):
        problems.append(first_drift(structure(candidate), structure(english)))
        return problems
    problems += register_problems(code, candidate)

    english_keys = set(loads((I18N / f'{REFERENCE}.json').read_text(encoding='utf-8')))
    candidate_keys = set(loads((I18N / f'{code}.json').read_text(encoding='utf-8')))
    missing = english_keys - candidate_keys
    extra = candidate_keys - english_keys
    if missing:
        problems.append(
            f"i18n/{code}.json is missing {len(missing)} key(s): {', '.join(sorted(missing))}"
        )
    if extra:
        problems.append(
            f"i18n/{code}.json carries {len(extra)} unknown key(s): {', '.join(sorted(extra))}"
        )

    empty = [
        key for key in english_keys & candidate_keys
        if not loads((I18N / f'{code}.json').read_text(encoding='utf-8'))[key].strip()
    ]
    if empty:
        problems.append(
            f"i18n/{code}.json has {len(empty)} empty string(s): {', '.join(sorted(empty)[:8])}"
        )
    return problems


if __name__ == '__main__':
    codes = argv[1:] or ['fr', 'es', 'ru', 'ar', 'zh']
    failed = False
    for code in codes:
        if not (SLIDES / f'{code}.txt').exists():
            print(f'{code}: slides/{code}.txt is missing')
            failed = True
            continue
        if not (I18N / f'{code}.json').exists():
            print(f'{code}: i18n/{code}.json is missing')
            failed = True
            continue
        problems = check(code)
        if problems:
            failed = True
            print(f'{code}:')
            for problem in problems:
                print(f'  - {problem}')
        else:
            print(f'{code}: structure and strings match English')
    exit(1 if failed else 0)
