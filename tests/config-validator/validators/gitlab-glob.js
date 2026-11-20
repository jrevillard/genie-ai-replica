// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { escapeRegExp } = require('./js-files');

/**
 * The semantics `rules:changes` matches with: Ruby's File.fnmatch with
 * FNM_PATHNAME | FNM_DOTMATCH | FNM_EXTGLOB.
 *
 * - `*` matches any run of characters inside ONE path segment, and FNM_DOTMATCH
 *   lets it match a leading dot.
 * - `?` matches exactly one character inside a segment.
 * - A `**` component followed by a slash matches ZERO or more directory
 *   segments.
 * - A `**` that is NOT followed by a slash (a trailing `**`) is an ordinary
 *   `*`: it matches exactly ONE segment. So the glob
 *   `components/agent-service/**` covers the files directly under the
 *   package, NOT its subdirectories; the form that covers the whole tree
 *   ends with a slash and a star (`**` then `*`).
 * - `{a,b}` expands into alternatives (FNM_EXTGLOB).
 *
 * A gate that pins its own pipeline trigger must know what a glob really
 * matches: a matcher that reads `**` as "zero or more segments" certifies a
 * trigger GitLab will not honour.
 */

/**
 * The alternatives a brace group stands for.
 *
 * @param {string} pattern - The glob
 * @returns {string[]} The expanded globs
 */
function expandBraces(pattern) {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (!match) {
    return [pattern];
  }
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return match[1].split(',').flatMap((option) => expandBraces(before + option + after));
}

/**
 * The pattern of one path segment.
 *
 * @param {string} segment - The segment pattern
 * @returns {RegExp} The segment matcher
 */
function globSegment(segment) {
  let source = '';
  for (const char of segment) {
    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

const matchesSegments = (pattern, pi, parts, pj) => {
  if (pi >= pattern.length) return pj >= parts.length;
  if (pattern[pi] === '**') {
    if (pi === pattern.length - 1) {
      // A trailing `**` is an ordinary `*`: exactly one segment.
      return pj === parts.length - 1;
    }
    // A `**` followed by more segments stands for zero or more directories.
    for (let skip = pj; skip <= parts.length; skip++) {
      if (matchesSegments(pattern, pi + 1, parts, skip)) return true;
    }
    return false;
  }
  return (
    pj < parts.length && globSegment(pattern[pi]).test(parts[pj]) && matchesSegments(pattern, pi + 1, parts, pj + 1)
  );
};

/**
 * Does a `rules:changes` glob match a repository path?
 *
 * @param {string} glob - The glob as written in the pipeline
 * @param {string} repoPath - The repository-relative path to test
 * @returns {boolean} True when the glob matches the path
 */
function gitlabGlobMatches(glob, repoPath) {
  const parts = repoPath.split('/');
  return expandBraces(glob).some((expanded) => matchesSegments(expanded.split('/'), 0, parts, 0));
}

module.exports = { gitlabGlobMatches };
