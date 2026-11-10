'use strict';

// #516 — a stray copy of a tracked file must never sit in the repository.
//
// The file that opened the issue
// ("genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy") was a
// duplicate of a live Dockerfile: a second, silently drifting copy of a file
// the build already had. Nothing failed when it drifted — it simply sat
// there, and the next reader could have edited the wrong one.
//
// Two layers keep it out:
//   - the .gitignore rules refuse to stage such a file at all, and
//   - this gate fails the pipeline when one is tracked anyway (force-added, or
//     added before the rules existed).
//
// The shapes are the ones the common tools produce:
//   Windows / VS Code : "name - Copy", "name - Copy (2)", "name - Copy.ext"
//   macOS Finder      : "name copy", "name copy 2", "name copy.ext"
//   GNOME Nautilus    : "name (copy)", "name (copy).ext"

const { execFileSync } = require('child_process');
const path = require('path');

const { parseGitlabCiJobChanges } = require('../validators/parse-compose');

const ROOT = path.resolve(__dirname, '../../..');

// One entry per tool convention: the marker that ends the name, the glob
// that makes the pipeline run when such a path changes, and the samples the
// ignore rules and the detector must both recognise.
const SHAPES = [
  {
    marker: ' - Copy',
    glob: '**/* - Copy*',
    samples: [
      'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy',
      'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy (2)',
      'components/gov-chat-frontend/src/main.js - Copy.js'
    ]
  },
  {
    marker: ' copy',
    glob: '**/* copy*',
    samples: ['docs/readme copy', 'docs/readme copy.md']
  },
  {
    marker: '(copy)',
    glob: '**/* (copy)*',
    samples: ['docs/readme (copy)', 'docs/readme (copy).md']
  }
];

// Names that carry no copy marker and must stay stageable — the two English
// words a copy marker could hide in ("copying", "COPYING") and the browser
// downloads that carry a number instead of a marker.
const NOT_COPIES = [
  'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai',
  'docs/readme.md',
  'LICENSE',
  'COPYING',
  'docs/copywriting.md',
  'components/gov-chat-frontend/public/icons/downloads/user-svgrepo-com (1).svg'
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A copy marker at the end of the basename, optionally followed by the
// disambiguating number a second duplicate gets and/or an extension.
const COPY_ARTIFACT = new RegExp(
  `(?:${SHAPES.map((shape) => escapeRegExp(shape.marker)).join('|')})(?: \\(\\d+\\)| \\d+)?(?:\\.\\w+)?$`
);

const findStrayCopies = (paths) => paths.filter((p) => COPY_ARTIFACT.test(path.basename(p)));

const trackedFiles = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

// `git check-ignore` exits 1 when it matches nothing — that is a gate
// failure, not a crash, so the output is read from the error too.
const ignoredPaths = (paths) => {
  try {
    return execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: ROOT,
      input: `${paths.join('\n')}\n`,
      encoding: 'utf8'
    })
      .split('\n')
      .filter(Boolean);
  } catch (err) {
    return String(err.stdout || '')
      .split('\n')
      .filter(Boolean);
  }
};

describe('stray copy artifacts (#516)', () => {
  it('tracks no copy artifact', () => {
    expect(findStrayCopies(trackedFiles())).toEqual([]);
  });

  it('enumerates the tracked tree', () => {
    // Anti-vacuity floor: an empty or truncated enumeration would make the
    // gate above pass without ever looking at a file.
    expect(trackedFiles().length).toBeGreaterThanOrEqual(1000);
  });

  it('recognises every copy shape, and only those', () => {
    const copies = [
      ...SHAPES.flatMap((shape) => shape.samples),
      'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy (3).txt',
      'docs/readme copy 2',
      'docs/readme (copy) (2)'
    ];
    expect(findStrayCopies(copies).sort()).toEqual([...copies].sort());
    expect(findStrayCopies(NOT_COPIES)).toEqual([]);
  });

  it('refuses to stage a copy artifact', () => {
    const samples = SHAPES.flatMap((shape) => shape.samples);
    expect(ignoredPaths(samples).sort()).toEqual([...samples].sort());
  });

  it('keeps staging the files that are not copies', () => {
    expect(ignoredPaths(NOT_COPIES)).toEqual([]);
  });

  it('runs the gate in the pipeline that adds a copy artifact', () => {
    // The gate reads the tracked tree, so the pipeline that adds a copy must
    // run the job that holds it — otherwise the failure only shows up on the
    // default branch, after the merge.
    const changes = parseGitlabCiJobChanges(path.join(ROOT, '.gitlab-ci.yml'), ['config:validate']);
    const entries = changes.get('config:validate');
    for (const shape of SHAPES) {
      expect(entries).toContain(shape.glob);
    }
  });
});
