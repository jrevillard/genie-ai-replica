// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-6 — the operator entry-regeneration tool's RULES, pinned.
//
// `scripts/okf-testing-lab/ragas-regenerate-entry.js` REGENERATES a suite
// entry: it re-synthesizes a question and its reference passages for a row
// the judge could not score, and it writes the result back to the live
// suite. Its gates decide what gets rewritten, so they belong in a test
// rather than in a human reading console output:
//   - the tokens a question's topic is made of (stopwords and short words
//     carry no topic, and the chunk RANKING depends on this set);
//   - the score of a chunk against those tokens;
//   - the normalized form two questions are compared by (duplicate gate);
//   - whether an expected passage is really in the corpus (the gate that
//     refuses a regeneration whose references the system could never
//     retrieve).
//
// The store-dependent half — the sidecar generation and the metric call —
// is NOT unit-tested: it needs the live sidecar, not a seam.

jest.mock('/app/shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }), { virtual: true });

const {
  topicTokens,
  topicScore,
  normalizeQuestion,
  passageInCorpus
} = require('../../../scripts/okf-testing-lab/ragas-regenerate-entry');

describe('the operator entry-regeneration tool', () => {
  describe('topicTokens', () => {
    it('keeps the words that carry a topic', () => {
      const t = topicTokens('corn stunt disease resistance maize');
      expect([...t].sort()).toEqual(['corn', 'disease', 'maize', 'resistance', 'stunt']);
    });

    it('drops stopwords and words shorter than four characters', () => {
      const t = topicTokens('what is the risk of an NVD outbreak');
      expect(t.has('what')).toBe(false);
      expect(t.has('the')).toBe(false);
      expect(t.has('is')).toBe(false);
      expect(t.has('nvd')).toBe(false); // three characters
      expect(t.has('risk')).toBe(true);
      expect(t.has('outbreak')).toBe(true);
    });

    it('keeps accented letters and folds case', () => {
      const t = topicTokens('Manejo del Intoxicación');
      expect(t.has('manejo')).toBe(true);
      expect(t.has('intoxicación')).toBe(true);
    });

    it('is empty for empty input', () => {
      expect(topicTokens('').size).toBe(0);
      expect(topicTokens(null).size).toBe(0);
    });
  });

  describe('topicScore', () => {
    it("is the FRACTION of the question's tokens the chunk carries", () => {
      const tokens = topicTokens('maize disease resistance');
      // the chunk carries 2 of the 3 tokens
      expect(topicScore('maize disease in the field', tokens)).toBeCloseTo(2 / 3);
    });

    it('is 1 when the chunk carries every token', () => {
      expect(topicScore('maize disease resistance', topicTokens('maize disease resistance'))).toBe(1);
    });

    it('is 0 when either side has no tokens', () => {
      expect(topicScore('anything', topicTokens('the of and'))).toBe(0);
      expect(topicScore('', topicTokens('maize disease'))).toBe(0);
    });
  });

  describe('normalizeQuestion', () => {
    it('folds case and punctuation so two spellings compare equal', () => {
      expect(normalizeQuestion('What is the risk?')).toBe('what is the risk');
      expect(normalizeQuestion('  What   is  the risk?  ')).toBe('what is the risk');
    });

    it('turns punctuation into spaces rather than joining words', () => {
      expect(normalizeQuestion('corn-stunt/disease')).toBe('corn stunt disease');
    });

    it('is empty for empty input', () => {
      expect(normalizeQuestion('')).toBe('');
      expect(normalizeQuestion(null)).toBe('');
    });
  });

  describe('passageInCorpus', () => {
    const docs = [
      { page_content: 'Corn stunt disease is a viral disease of maize in Mexico.' },
      { page_content: 'CIMMYT-Mexico supported maize research for more than fifty years.' }
    ];

    it('finds a passage that is in a chunk, across case and punctuation', () => {
      expect(passageInCorpus('corn stunt disease is a viral disease', docs)).toBe(true);
    });

    it('does not find a passage that is nowhere in the corpus', () => {
      expect(passageInCorpus('the expected output is not retrievable', docs)).toBe(false);
    });

    it('is false for an empty passage', () => {
      expect(passageInCorpus('', docs)).toBe(false);
      expect(passageInCorpus('!!!', docs)).toBe(false);
    });

    it('is false when the corpus is empty', () => {
      expect(passageInCorpus('corn stunt disease', [])).toBe(false);
    });
  });
});
