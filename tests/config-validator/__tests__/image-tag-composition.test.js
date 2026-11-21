const path = require('path');

const { findShadowedVariant } = require('../validators/check-image-tag-composition');

const ROOT = path.resolve(__dirname, '../../..');
const COMPOSE = path.join(ROOT, 'docker-compose.yaml');
const ENV_TEMPLATE = path.join(ROOT, 'env');

// The variant suffix must be composed where it cannot be shadowed.
//
// Docker Compose resolves an `.env` reference against the values DEFINED
// ABOVE it in the same file: a suffix composed INTO the `.env`'s own
// per-service lines only works if the suffix is declared above them. An
// operator who appends the line at the end of their `.env` — the natural
// thing to do — got the FAT image, with no warning: the 4.9 GB image whose
// disk pressure evicted a pod (issue #2000). The composition therefore
// lives in docker-compose.yaml, and the env template declares no
// per-service tag for those three (such a line would shadow it).

describe('image tag composition gate: the repository', () => {
  test('the variant suffix is composed where an .env cannot shadow it', () => {
    const findings = findShadowedVariant(COMPOSE, ENV_TEMPLATE);
    const report = findings.map((finding) => `  ${finding.where}: ${finding.problem}`).join('\n');
    expect(findings).toEqual([]);
    expect(report).toBe('');
  });
});

describe('image tag composition gate: the checks', () => {
  const { fallbackSpan, imageExpression, MODEL_SERVING } = require('../validators/check-image-tag-composition');

  test('the fallback span ends at the matching brace', () => {
    const text = '${A:-${B:-x}${C:-y}}';
    const span = fallbackSpan(text, 0);
    expect(span.fallback).toBe('${B:-x}${C:-y}');
    expect(text[span.end]).toBe('}');
  });

  test('the image expression of a service is found by its repository', () => {
    const images = [{ service: 'reranker', image: 'registry/genie-ai-reranker:tag' }];
    expect(imageExpression(images, 'genie-ai-reranker')).toContain('genie-ai-reranker');
    expect(imageExpression(images, 'genie-ai-other')).toBeNull();
  });

  test('the three model-serving images are the ones the gate watches', () => {
    expect(MODEL_SERVING.map((entry) => entry.repository)).toEqual([
      'genie-ai-reranker',
      'genie-ai-dataprep-arango',
      'genie-ai-retriever-arango'
    ]);
  });
});
