"""Subset the deck's fonts to the characters each language actually uses.

A full CJK face is several megabytes and an Arabic face over a hundred
kilobytes, so neither can be embedded wholesale. Each language that needs
another script gets a face cut down to the characters its translation
actually prints.

The cutting is done locally with fontTools, from the complete face Google
serves. Asking Google for a subset over the network does not work: the
request carries every character of the translation, and the URL grows past
what the service accepts — it answers with the whole face instead.

The generated files live under assets/fonts/ and are committed: the build
reads them and never reaches the network. Re-run this script with --force
whenever a translation changes: each face travels with the list of the
characters it was cut for, and the build refuses a face whose list no
longer covers what the translation prints.

Usage: python3 src/fetch_fonts.py [--force] [--code CODE ...]
"""

from argparse import ArgumentParser
from json import dumps, loads
from pathlib import Path
from subprocess import run
from urllib.parse import quote
from urllib.request import Request, urlopen

WORK = Path(__file__).parent
FONTS = WORK / 'assets' / 'fonts'
I18N = WORK / 'i18n'
SLIDES = WORK / 'slides'

# The face each language needs beyond the Latin one the deck already
# ships. The key is the language code, the value the family to fetch.
# Russian is not here: Carlito carries the Cyrillic range, and the deck
# embeds it.
FACES = {
    'ar': 'Noto Sans Arabic',
    'zh': 'Noto Sans SC',
}
WEIGHTS = (400, 700)

# The old user agent makes Google serve the complete face as a single
# file. A modern one splits a CJK face into a hundred ranged subsets,
# which cannot be cut down afterwards.
AGENT = 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/26.0.1410.63 Safari/537.36'


def characters(code):
    """Every character the deck prints in one language."""
    text = ''
    slides = SLIDES / f'{code}.txt'
    if slides.exists():
        text += slides.read_text(encoding='utf-8')
    interface = I18N / f'{code}.json'
    if interface.exists():
        text += ''.join(loads(interface.read_text(encoding='utf-8')).values())
    return sorted({character for character in text if not character.isspace()})


def fetch(url):
    request = Request(url, headers={'User-Agent': AGENT})
    with urlopen(request, timeout=120) as response:
        return response.read()


def face_url(family, weight):
    """The complete face of one family and weight, as a single file."""
    url = f'https://fonts.googleapis.com/css2?family={quote(family)}:wght@{weight}'
    css = fetch(url).decode('utf-8')
    for block in css.split('@font-face')[1:]:
        start = block.find('url(')
        if start == -1:
            continue
        start += 4
        return block[start:block.find(')', start)].strip('\'"')
    return None


def subset(source, target, glyphs):
    """Cut a face down to the characters the deck prints."""
    run(
        [
            'pyftsubset', str(source),
            f'--text={"".join(glyphs)}',
            f'--output-file={target}',
            '--flavor=woff2',
            '--layout-features=*',
            '--no-hinting',
            '--desubroutinize',
            '--name-IDs=*',
            '--drop-tables+=DSIG',
        ],
        check=True,
    )


def build(code, force):
    """Write the subset faces of one language, and its coverage note."""
    family = FACES[code]
    glyphs = ''.join(characters(code))
    if not glyphs:
        print(f'{code}: no text yet, skipped')
        return True
    note = FONTS / f'{code}.json'
    if not force and note.exists():
        cut_for = set(loads(note.read_text(encoding='utf-8')).get('characters', ''))
        if cut_for != set(glyphs):
            print(f'{code}: the translation changed since the face was cut; rerun with --force')
            return False
    written = []
    for weight in WEIGHTS:
        target = FONTS / f'{code}-{weight}.woff2'
        if target.exists() and not force:
            written.append(target)
            continue
        url = face_url(family, weight)
        if not url:
            print(f'{code}: Google Fonts returned no face for {family} {weight}')
            return False
        source = FONTS / f'.{code}-{weight}-source'
        source.write_bytes(fetch(url))
        subset(source, target, glyphs)
        source.unlink()
        written.append(target)
    coverage = {
        'family': family,
        'glyphs': len(glyphs),
        'files': [part.name for part in written],
        # The build compares this list with the characters the translation
        # prints, and refuses a face that fell behind it.
        'characters': glyphs,
    }
    (FONTS / f'{code}.json').write_text(dumps(coverage, indent=2) + '\n', encoding='utf-8')
    total = sum(part.stat().st_size for part in written)
    print(f'{code}: {len(glyphs)} characters, {len(written)} file(s), {total // 1024} KB')
    return True


if __name__ == '__main__':
    parser = ArgumentParser(description='Subset the deck fonts per language.')
    parser.add_argument('--force', action='store_true', help='rewrite faces that already exist')
    parser.add_argument('--code', action='append', help='limit to these languages')
    arguments = parser.parse_args()
    FONTS.mkdir(parents=True, exist_ok=True)
    codes = arguments.code or sorted(FACES)
    ok = all(build(code, arguments.force) for code in codes)
    raise SystemExit(0 if ok else 1)
