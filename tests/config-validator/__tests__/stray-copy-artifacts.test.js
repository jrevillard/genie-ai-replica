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
// The layers must recognise the same set: a shape only the ignore rules know
// is silently un-committable; a shape only this gate knows can slip in with
// `git add -f`.
//
// The markers are the ones the file managers and editors leave behind:
//   Windows / VS Code : "name - Copy", "name - Copy (2)", "name - Copy.ext"
//   macOS Finder      : "name copy", "name copy 2", "name copy.ext"
//   GNOME Nautilus    : "name (copy)", "name (another copy)", "name (3rd copy)"
// Beyond the second duplicate the tools keep the marker word before a closing
// paren or a number, and the same rules keep matching it.
//
// The marker is reserved: a file that legitimately carries one (a real source
// called "deep copy.js") must be renamed — `git add -f` gets it past the
// ignore layer and straight into this gate.

const { execFileSync } = require('child_process');
const path = require('path');

const { parseGitlabCiJobChanges } = require('../validators/parse-compose');

const ROOT = path.resolve(__dirname, '../../..');

// One entry per marker convention: the marker that ends the name (or a
// component of the path — a duplicated directory counts), the glob that makes
// the pipeline run when such a path changes, and the samples both layers must
// recognise.
const SHAPES = [
  {
    marker: ' - Copy',
    glob: '**/* - Copy*',
    samples: [
      'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy',
      'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy (2)',
      'components/gov-chat-frontend/src/main.js - Copy.js',
      'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy (3).tar.gz'
    ]
  },
  {
    marker: ' copy',
    glob: '**/* copy*',
    samples: [
      'docs/readme copy',
      'docs/readme copy.md',
      'docs/readme copy 2',
      'docs/readme copy 2.tar.gz',
      'docs/readme copy (2)',
      'docs/readme copy (3).tar.gz'
    ]
  },
  {
    marker: 'copy)',
    glob: '**/*copy)*',
    samples: [
      'docs/readme (copy)',
      'docs/readme (copy).md',
      'docs/readme (another copy)',
      'docs/readme (copy) (2)',
      'docs/readme (copy) 2'
    ]
  }
];

// Names that carry no copy marker and must stay stageable: the English words
// a marker could hide in ("copying", "copywriting"), the all-caps licence
// file, and the browser downloads that carry a number instead of a marker.
const NOT_COPIES = [
  'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai',
  'docs/readme.md',
  'LICENSE',
  'COPYING',
  'docs/copying.md',
  'docs/copywriting.md',
  'components/gov-chat-frontend/public/icons/downloads/user-svgrepo-com (1).svg'
];

// A glob that must match none of the copy shapes — it guards against a
// fnmatch implementation that matches everything.
const CONTROL_GLOB = '**/* - CopyX*';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A copy marker at the end of a path component; after it the component may
// carry the disambiguating number a second duplicate gets and/or an
// extension. Both layers must accept the same tails.
const COPY_ARTIFACT = new RegExp(
  `(?:${SHAPES.map((shape) => escapeRegExp(shape.marker)).join('|')})(?:(?: \\(\\d+| \\d+).*)?(?:\\..*)?$`
);

const findStrayCopies = (paths) => paths.filter((p) => p.split('/').some((part) => COPY_ARTIFACT.test(part)));

let tracked = null;
const trackedFiles = () => {
  if (!tracked) {
    tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
      .split('\0')
      .filter(Boolean);
  }
  return tracked;
};

// The repo's own .gitignore must be the layer that matches: a machine-local
// rule (core.excludesFile, .git/info/exclude) outranks it and must not decide
// the test, so the `-v` output is filtered on the rule's source file.
const GITIGNORE = '.gitignore';
const ignoredByRepoRules = (paths) => {
  let out;
  try {
    out = execFileSync('git', ['check-ignore', '--no-index', '-v', '--stdin'], {
      cwd: ROOT,
      input: `${paths.join('\n')}\n`,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
  } catch (err) {
    // Exit 1 = nothing matched, which is a gate result, not a crash.
    out = String(err.stdout || '');
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(.*)\t(.*)$/);
      return match ? { source: match[1], pattern: match[3], path: match[4] } : null;
    })
    .filter((entry) => entry && entry.source === GITIGNORE);
};

// The semantics `rules:changes` matches with: Ruby's File.fnmatch with
// FNM_PATHNAME — `*` never crosses a `/`, and a `**` segment matches zero or
// more directory segments. A trailing `**` (e.g. `a/**`) is not modeled; no
// shape uses one, and a shape that starts to must extend this helper with it.
const globSegment = (segment) =>
  new RegExp(
    `^${segment
      .split('*')
      .map((part) => escapeRegExp(part))
      .join('.*')}$`
  );
const gitlabGlobMatches = (glob, p) => {
  const pattern = glob.split('/');
  const parts = p.split('/');
  if (pattern[0] === '**') {
    for (let skip = 0; skip <= parts.length; skip++) {
      if (gitlabGlobMatches(pattern.slice(1).join('/'), parts.slice(skip).join('/'))) return true;
    }
    return false;
  }
  if (pattern.length > 1) {
    return (
      parts.length > 1 &&
      globSegment(pattern[0]).test(parts[0]) &&
      gitlabGlobMatches(pattern.slice(1).join('/'), parts.slice(1).join('/'))
    );
  }
  return parts.length === 1 && globSegment(pattern[0]).test(p);
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
      // A duplicated directory: the marker sits on the folder, not the file.
      'genie-ai-overlay/chatqna copy/Dockerfile-chatqna_genie-ai',
      'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy (3).txt',
      'docs/readme copy 2',
      'docs/readme (copy) (2)'
    ];
    expect(findStrayCopies(copies).sort()).toEqual([...copies].sort());
    expect(findStrayCopies(NOT_COPIES)).toEqual([]);
  });

  it('refuses to stage a copy artifact', () => {
    const samples = SHAPES.flatMap((shape) => shape.samples);
    const ignored = ignoredByRepoRules(samples).map((entry) => entry.path);
    expect(ignored.sort()).toEqual([...samples].sort());
  });

  it('keeps staging the files that are not copies', () => {
    const hits = ignoredByRepoRules(NOT_COPIES).map((entry) => entry.path);
    expect(hits).toEqual([]);
  });

  it('runs the gate in the pipeline that adds a copy artifact', () => {
    // The gate reads the tracked tree, so the pipeline that adds a copy must
    // run the job that holds it — otherwise the failure only shows up on the
    // default branch, after the merge. The globs are pinned as literal
    // members of the job's changes list and checked against the sample paths
    // under the fnmatch dialect rules:changes uses, so a glob that never
    // matches fails here instead of silently never firing.
    const changes = parseGitlabCiJobChanges(path.join(ROOT, '.gitlab-ci.yml'), ['config:validate']);
    const entries = changes.get('config:validate');
    for (const shape of SHAPES) {
      expect(entries).toContain(shape.glob);
      for (const sample of shape.samples) {
        expect(gitlabGlobMatches(shape.glob, sample)).toBe(true);
      }
    }
    // The ignore layer itself is an input to the gate: an MR that weakens or
    // over-broadens the .gitignore rules must run the job too.
    expect(entries).toContain('.gitignore');
    expect(gitlabGlobMatches(CONTROL_GLOB, SHAPES[0].samples[0])).toBe(false);
  });
});
