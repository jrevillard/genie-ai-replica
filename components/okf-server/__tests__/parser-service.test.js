// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// PURE unit tests for the OKF parser. No db-connection-service mock, no
// keycloak-auth-service mock — the parser imports neither.

const fs = require('fs');
const path = require('path');
const { parseConcept, ParseError, deriveTrustTier, conceptIdFromPath } = require('../services/parser-service');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('parser-service — parseConcept', () => {
  describe('v0.2 concept', () => {
    let result;
    beforeAll(async () => {
      result = await parseConcept(fixture('concept-v02.md'), {
        repo_id: 'repo-1',
        path: '/concepts/test.md',
        bundle_version: '1.0.0'
      });
    });

    test('concept_id derived from path (strips .md + leading /)', () => {
      expect(result.concept_id).toBe('concepts/test');
      expect(result.repo_id).toBe('repo-1');
      expect(result.bundle_version).toBe('1.0.0');
    });

    test('full frontmatter preserved (incl. unknown keys)', () => {
      expect(result.frontmatter.type).toBe('Policy');
      expect(result.frontmatter.custom_unknown_field).toBe('preserved-value');
    });

    test('body stripped of frontmatter', () => {
      expect(result.body).not.toContain('custom_unknown_field');
      expect(result.body).toContain('# Test Concept');
    });

    test('v0.2 families extracted', () => {
      expect(result.generated).toEqual({ by: 'agent/llm', at: '2026-08-12T10:00:00.000Z' });
      expect(result.status).toBe('stable');
      expect(result.stale_after).toBe('2026-12-31');
      expect(result.sources).toEqual([{ resource: 'https://example.com/source-1', author: 'Example Org' }]);
    });

    test('trust_tier = human-reviewed (any human: actor)', () => {
      expect(result.trust_tier).toBe('human-reviewed');
    });

    test('links extracted with anchor text as label; images excluded', () => {
      const targets = result.links.map((l) => l.to_concept_id);
      expect(targets).toContain('concepts/related');
      expect(targets).toContain('nested/deep');
      const related = result.links.find((l) => l.to_concept_id === 'concepts/related');
      expect(related.label).toBe('related concept');
      expect(targets).not.toContain('img/diagram');
    });
  });

  describe('legacy concept (v0.1 fallback)', () => {
    let result;
    beforeAll(async () => {
      result = await parseConcept(fixture('concept-legacy.md'), { repo_id: 'repo-1', path: 'legacy.md' });
    });

    test('timestamp → generated.at (legacy fallback)', () => {
      expect(result.generated).toEqual({ at: '2025-01-15T08:00:00.000Z' });
    });

    test('body # Citations → sources (legacy fallback)', () => {
      expect(result.sources).toEqual([
        { resource: 'https://example.com/citation-1' },
        { resource: 'https://example.com/citation-2' }
      ]);
    });

    test('trust_tier = unverified (no verified field)', () => {
      expect(result.trust_tier).toBe('unverified');
    });
  });

  describe('broken links', () => {
    let result;
    beforeAll(async () => {
      result = await parseConcept(fixture('concept-broken-links.md'), { repo_id: 'repo-1', path: 'broken.md' });
    });

    test('broken links are emitted (tolerated, not fatal)', () => {
      expect(result.links).toHaveLength(2);
      expect(result.links[0].to_concept_id).toBe('does/not/exist');
      expect(result.links[1].to_concept_id).toBe('missing/target');
    });
  });

  describe('Attested Computation (opaque)', () => {
    let result;
    beforeAll(async () => {
      result = await parseConcept(fixture('concept-attested.md'), { repo_id: 'repo-1', path: 'attested.md' });
    });

    test('opaque fields preserved without interpretation', () => {
      expect(result.frontmatter.type).toBe('Attested Computation');
      expect(result.frontmatter.runtime).toBe('python:3.11');
      expect(result.frontmatter.parameters).toEqual({ model: 'granite-4.1' });
      expect(result.frontmatter.attester).toBe('sigstore');
    });
  });

  test('malformed frontmatter → ParseError', async () => {
    await expect(parseConcept(fixture('concept-malformed.md'), { repo_id: 'r', path: 'bad.md' })).rejects.toThrow(
      ParseError
    );
  });

  test('no frontmatter — plain concept, trust_tier unverified', async () => {
    const result = await parseConcept('Just a body, no frontmatter.', { repo_id: 'r', path: 'plain.md' });
    expect(result.body).toContain('Just a body');
    expect(result.trust_tier).toBe('unverified');
    expect(result.generated).toBeUndefined();
    expect(result.links).toEqual([]);
  });
});

describe('parser-service — deriveTrustTier', () => {
  test('unverified (no verified)', () => {
    expect(deriveTrustTier(undefined)).toBe('unverified');
    expect(deriveTrustTier([])).toBe('unverified');
  });
  test('machine-confirmed (all non-human actors)', () => {
    expect(deriveTrustTier([{ by: 'agent/x' }, { by: 'process:y' }])).toBe('machine-confirmed');
  });
  test('human-reviewed (any human: actor)', () => {
    expect(deriveTrustTier([{ by: 'agent/x' }, { by: 'human:alice' }])).toBe('human-reviewed');
  });
  test('bare object normalized to array', () => {
    expect(deriveTrustTier({ by: 'human:bob' })).toBe('human-reviewed');
  });
  test('malformed entry (no by) treated as non-human', () => {
    expect(deriveTrustTier([{ notBy: 'x' }])).toBe('machine-confirmed');
  });
  test('null verified → unverified', () => {
    expect(deriveTrustTier(null)).toBe('unverified');
  });
});

describe('parser-service — conceptIdFromPath', () => {
  test('strips leading slash + .md', () => {
    expect(conceptIdFromPath('/a/b/concept.md')).toBe('a/b/concept');
  });
  test('strips leading ./', () => {
    expect(conceptIdFromPath('./nested/deep.md')).toBe('nested/deep');
  });
  test('forces POSIX separators', () => {
    expect(conceptIdFromPath('a\\b\\c.md')).toBe('a/b/c');
  });
  test('no .md suffix left as-is', () => {
    expect(conceptIdFromPath('a/b')).toBe('a/b');
  });
  test('handles .// (leading slash after ./ strip)', () => {
    expect(conceptIdFromPath('.//foo.md')).toBe('foo');
  });
});
