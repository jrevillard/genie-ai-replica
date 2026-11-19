// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { escapeRegExp } = require('./js-files');

/**
 * The semantics `rules:changes` matches with: Ruby's File.fnmatch with
 * FNM_PATHNAME — `*` never crosses a `/`, and a `**` segment (leading or
 * trailing) matches zero or more directory segments.
 *
 * A gate that pins its own pipeline trigger must know what a glob really
 * matches: `components/agent-service/*` looks like it covers the package and
 * matches only its top-level files, so a violation in `tests/` would land
 * un-policed.
 */
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

/**
 * Does a `rules:changes` glob match a repository path?
 *
 * @param {string} glob - The glob as written in the pipeline
 * @param {string} repoPath - The repository-relative path to test
 * @returns {boolean} True when the glob matches the path
 */
function gitlabGlobMatches(glob, repoPath) {
  return matchesSegments(glob.split('/'), 0, repoPath.split('/'), 0);
}

module.exports = { gitlabGlobMatches };
