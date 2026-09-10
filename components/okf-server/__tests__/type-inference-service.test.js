// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// TYPE INFERENCE (David's categorization spec, 2026-09-05): heuristics rules,
// the authorial-type guard, and the coordinator contract (unknown/absent
// strategy coerces to heuristics — never a 400).

const typeInference = require('../services/type-inference-service');

describe('type-inference-service — heuristics (zero-LLM rules)', () => {
  test('org keywords + structural keys → entity', () => {
    const t = typeInference.inferTypeHeuristics({
      title: 'Google Services',
      body: 'Ticker GOOG. Headquarters in Mountain View. Founded as a subsidiary of Alphabet Inc.'
    });
    expect(t).toBe('entity');
  });

  test('event keywords + a date → event', () => {
    const t = typeInference.inferTypeHeuristics({
      title: '1883 eruption of Krakatoa',
      body: 'The eruption began on August 27, 1883 and was one of the deadliest volcanic events in history.'
    });
    expect(t).toBe('event');
  });

  test('how-to shapes → process', () => {
    const t = typeInference.inferTypeHeuristics({
      title: 'Registering a business',
      body: 'Step-by-step instructions for applying for a trade license at the ministry.'
    });
    expect(t).toBe('process');
  });

  test('list/category patterns → source', () => {
    const t = typeInference.inferTypeHeuristics({
      title: 'List of universities',
      body: 'This is a list of universities and colleges, sorted by founding year.',
      url: 'https://en.wikipedia.org/wiki/Category:Universities'
    });
    expect(t).toBe('source');
  });

  test('no signals → topic (the default)', () => {
    const t = typeInference.inferTypeHeuristics({
      title: 'Payment systems overview',
      body: 'A payment system is a network that transfers value between parties.'
    });
    expect(t).toBe('topic');
  });

  test('long bodies are truncated before scanning (4KB slice — bounded cost per page)', () => {
    const big = 'war '.repeat(100000);
    const t0 = Date.now();
    typeInference.inferTypeHeuristics({ title: 'X', body: big });
    expect(Date.now() - t0).toBeLessThan(100); // milliseconds, single pass
  });
});

describe('classifyConcept — the type TAXONOMY contract (David, 2026-09-08)', () => {
  test('an AUTHORIAL type is REPLACED by the taxonomy verdict — every concept carries topic/entity/process/event/source', () => {
    const v = typeInference.classifyConcept(
      { frontmatter: { type: 'entity', title: 'Some Event' }, body: 'The war of 1883 founding treaty.' },
      'heuristics'
    );
    expect(v.type).toBe('event'); // the content classifies — the old 'entity' label is replaced
    expect(v.classified).toBe(true);
    expect(v.resolved_by).not.toBe('author');
  });

  test("the structural 'index' root keeps its type (graph-root convention)", () => {
    const v = typeInference.classifyConcept(
      { frontmatter: { type: 'index', title: 'Contents' }, body: '# Contents' },
      'heuristics'
    );
    expect(v).toEqual({ type: 'index', classified: false, resolved_by: 'structural' });
  });

  test("only the 'topic' default is re-classified (the converter's placeholder)", () => {
    const v = typeInference.classifyConcept(
      { frontmatter: { type: 'topic', title: 'Battle of Waterloo' }, body: 'The battle ended the war in 1815.' },
      'heuristics'
    );
    expect(v.type).toBe('event');
    expect(v.classified).toBe(true);
  });

  test("the 'llm' strategy resolves to the heuristics fallback with an explicit marker (never a silent lie)", () => {
    const v = typeInference.classifyConcept(
      { frontmatter: { title: 'Battle of Waterloo' }, body: 'The battle ended the war in 1815.' },
      'llm'
    );
    expect(v.type).toBe('event');
    expect(v.resolved_by).toBe('heuristics-fallback');
  });

  test('unknown strategy coerces to heuristics (contract: coerced, never a 400)', () => {
    expect(typeInference.resolveStrategy('quantum').strategy).toBe('heuristics');
    expect(typeInference.resolveStrategy(undefined).strategy).toBe('heuristics');
  });
});
