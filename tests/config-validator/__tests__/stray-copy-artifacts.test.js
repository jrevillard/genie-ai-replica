'use strict';

// A stray copy of a tracked file must never sit in the repository: a
// duplicate drifts silently from the file it duplicates, and the next reader
// can edit the wrong one. Two layers keep it out, and they must recognise
// the same set — a shape only the ignore rules know is silently
// un-committable, a shape only this gate knows can slip in with `git add -f`:
//   - the .gitignore rules refuse to stage a copy artifact at all, and
//   - this gate fails the pipeline when one is tracked anyway (force-added,
//     or added before the rules existed).
//
// The markers are the ones the file managers and editors leave behind:
//   Windows / VS Code : "name - Copy", "name - Copy (2)", "name - Copy.ext"
//   macOS Finder      : "name copy", "name copy 2", "name copy.ext"
//   GNOME Nautilus    : "name (copy)", "name (another copy)", "name (3rd copy)"
//   JetBrains IDEs    : "Copy of name", "Copy of name (1)"
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

// Every tail a duplicate can carry after the marker. The parity tests run
// both layers over the whole SHAPES × TAILS matrix, so a rule or a detector
// alternative that misses one cell fails here instead of eroding on a tail
// no hand-picked sample covered.
const TAILS = ['', '.txt', '.tar.gz', ' 2', ' 2.txt', ' (2)', ' (2).txt'];

// One entry per marker convention: the marker (suffix families end the name,
// the JetBrains prefix family starts it — or a duplicated directory counts as
// a component), the glob that makes the pipeline run when such a path
// changes, and how a sample name is built from a tail.
const SHAPES = [
  {
    marker: ' - Copy',
    glob: '**/* - Copy*',
    sampleName: (tail) => `docs/readme - Copy${tail}`
  },
  {
    marker: ' copy',
    glob: '**/* copy*',
    sampleName: (tail) => `docs/readme copy${tail}`
  },
  {
    marker: 'copy)',
    glob: '**/*copy)*',
    sampleName: (tail) => `docs/readme (copy)${tail}`
  },
  {
    marker: 'Copy of ',
    prefix: true,
    glob: '**/Copy of *',
    sampleName: (tail) => `docs/Copy of readme${tail}`
  }
];

const samplesOf = (shape) => TAILS.map((tail) => shape.sampleName(tail));

// Real-world shapes the matrix does not carry: the artifact that opened the
// issue (with its real stem) and a duplicated directory.
const EXTRA_COPIES = [
  'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai - Copy',
  'genie-ai-overlay/chatqna copy/Dockerfile-chatqna_genie-ai'
];

// Names that carry no copy marker and must stay stageable: the English words
// a marker could hide in ("copying", "copywriting"), the all-caps licence
// file, and the browser downloads that carry a number instead of a marker —
// each also in the numbered shapes a duplicate would take.
const NOT_COPIES = [
  'genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai',
  'docs/readme.md',
  'LICENSE',
  'COPYING',
  'docs/copying.md',
  'docs/copywriting.md',
  'components/gov-chat-frontend/public/icons/downloads/user-svgrepo-com (1).svg'
].flatMap((stem) => [stem, `${stem} 2`, `${stem} (2)`]);

// A glob that must match none of the copy shapes — it guards against a
// fnmatch implementation that matches everything.
const CONTROL_GLOB = '**/* - CopyX*';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A copy marker at the end of a path component; after it the component may
// carry the disambiguating number a second duplicate gets and/or an
// extension. The prefix family starts the component and accepts any tail.
// Both layers must accept the same tails.
const SUFFIX_ARTIFACT = new RegExp(
  `(?:${SHAPES.filter((shape) => !shape.prefix)
    .map((shape) => escapeRegExp(shape.marker))
    .join('|')})(?:(?: \\(\\d+| \\d+).*)?(?:\\..*)?$`
);
const isCopyArtifact = (part) =>
  SHAPES.some((shape) => (shape.prefix ? part.startsWith(shape.marker) : SUFFIX_ARTIFACT.test(part)));

const findStrayCopies = (paths) => paths.filter((p) => p.split('/').some(isCopyArtifact));

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

// The repository's own .gitignore layers (the root file and the nested ones —
// they are committed content) must be what matches: a machine-local rule
// (core.excludesFile, .git/info/exclude) outranks them and must not decide
// the test, so the `-v` output is filtered on the rule's source file.
const REPO_GITIGNORE = /(^|\/)\.gitignore$/;
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
    // Exit 1 = nothing matched, which is a gate result, not a crash. Any
    // other git failure must surface, not masquerade as an empty result.
    if (err.status !== 1) throw err;
    out = String(err.stdout || '');
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(.*)\t(.*)$/);
      return match ? { source: match[1], pattern: match[3], path: match[4] } : null;
    })
    .filter((entry) => entry && REPO_GITIGNORE.test(entry.source));
};

// The semantics `rules:changes` matches with: Ruby's File.fnmatch with
// FNM_PATHNAME — `*` never crosses a `/`, and a `**` segment (leading or
// trailing) matches zero or more directory segments.
const globSegment = (segment) =>
  new RegExp(
    `^${segment
      .split('*')
      .map((part) => escapeRegExp(part))
      .join('.*')}$`
  );
const matchesSegments = (pattern, pi, parts, pj) => {
  if (pi >= pattern.length) return pj >= parts.length;
  if (pattern[pi] === '**') {
    for (let skip = pj; skip <= parts.length; skip++) {
      if (matchesSegments(pattern, pi + 1, parts, skip)) return true;
    }
    return false;
  }
  return (
    pj < parts.length && globSegment(pattern[pi]).test(parts[pj]) && matchesSegments(pattern, pi + 1, parts, pj + 1)
  );
};
const gitlabGlobMatches = (glob, p) => matchesSegments(glob.split('/'), 0, p.split('/'), 0);

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
    const copies = [...SHAPES.flatMap(samplesOf), ...EXTRA_COPIES];
    expect(findStrayCopies(copies).sort()).toEqual([...copies].sort());
    expect(findStrayCopies(NOT_COPIES)).toEqual([]);
  });

  it('refuses to stage a copy artifact', () => {
    const samples = [...SHAPES.flatMap(samplesOf), ...EXTRA_COPIES];
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
    // members of the job's changes list and checked against every sample of
    // the matrix under the fnmatch dialect rules:changes uses, so a glob that
    // never matches fails here instead of silently never firing.
    const changes = parseGitlabCiJobChanges(path.join(ROOT, '.gitlab-ci.yml'), ['config:validate']);
    const entries = changes.get('config:validate');
    for (const shape of SHAPES) {
      expect(entries).toContain(shape.glob);
      for (const sample of samplesOf(shape)) {
        expect(gitlabGlobMatches(shape.glob, sample)).toBe(true);
      }
      // A root-level path pins the zero-directory skip of the `**` prefix:
      // without it, a helper that requires at least one directory stays green.
      expect(gitlabGlobMatches(shape.glob, path.basename(shape.sampleName('')))).toBe(true);
    }
    // The ignore layer itself is an input to the gate: an MR that weakens or
    // over-broadens the .gitignore rules must run the job too.
    expect(entries).toContain('.gitignore');
    expect(gitlabGlobMatches(CONTROL_GLOB, SHAPES[0].sampleName(''))).toBe(false);
    // The known, deferred gap (#1730): a marker on a directory component does
    // not match any glob, so the job only fires on the default branch. Pinned
    // here so the gap stays loud instead of silently widening.
    expect(gitlabGlobMatches(SHAPES[1].glob, EXTRA_COPIES[1])).toBe(false);
  });
});
