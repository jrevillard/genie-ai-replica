const { parseComposeImages } = require('./parse-compose');
const { parseEnvTemplate } = require('./parse-env');

/**
 * The variant suffix must be composed where it cannot be shadowed.
 *
 * Why this exists
 * ---------------
 * The three model-serving images (the reranker, the retriever, the
 * dataprep) are the only ones that carry a VARIANT: the slim build, the
 * one without the CUDA stack. The suffix rides on the version tag, so the
 * tag of those three images is composed — version + suffix — while every
 * other image's tag is the version alone.
 *
 * Docker Compose resolves an `.env` reference against the values DEFINED
 * ABOVE it in the same file. A suffix composed INTO the `.env`'s own
 * per-service lines therefore only works if the suffix is declared above
 * them: an operator who appends the line at the end of their `.env` — the
 * natural thing to do, and what the docs invite — gets the FAT image, with
 * no warning and no error. That is the image whose 4.9 GB filled the
 * node's disk and evicted a pod (issue #2000): the knob that exists to
 * prevent the eviction silently pulling the very image that caused it.
 *
 * The composition therefore lives in docker-compose.yaml, where the order
 * of the `.env` does not matter, and the `.env` template declares NO
 * per-service tag line for those three: a line there would SHADOW the
 * composition and restore the trap.
 *
 * A per-image pin for one of the three is a line the OPERATOR adds to
 * their `.env` (`GENIE_AI_RERANKER_IMAGE_TAG=v2.1.0`): it names the exact
 * tag and never receives the suffix.
 *
 * What is checked
 * ---------------
 *  * the compose image expression of each of the three: the per-service
 *    pin is the OUTER fallback and the suffix sits INSIDE it (a pin
 *    wins outright and takes no suffix);
 *  * the env template: no per-service image-tag line for those three.
 */

const MODEL_SERVING = [
  { envName: 'GENIE_AI_RERANKER', repository: 'genie-ai-reranker' },
  { envName: 'GENIE_AI_DATAPREP_ARANGO', repository: 'genie-ai-dataprep-arango' },
  { envName: 'GENIE_AI_RETRIEVER_ARANGO', repository: 'genie-ai-retriever-arango' }
];

const SUFFIX_VARIABLE = 'GENIE_AI_OPEA_IMAGE_TAG_SUFFIX';

/**
 * The span of the `${NAME:-<fallback>}` expression that starts at `start`.
 *
 * @param {string} text - The expression's text
 * @param {number} start - The index of the opening `${`
 * @returns {{ fallback: string, end: number } | null}
 */
function fallbackSpan(text, start) {
  const open = text.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        // The span's content is `NAME:-<fallback>`; the fallback is what
        // follows the `:-`.
        const body = text.slice(open + 1, i);
        const separator = body.indexOf(':-');
        return {
          fallback: separator === -1 ? body : body.slice(separator + 2),
          end: i
        };
      }
    }
  }
  return null;
}

/**
 * The compose image expression of the service that pulls `repository`.
 *
 * @param {Array<{service: string, image: string}>} images - parseComposeImages' output
 * @param {string} repository - The image repository
 * @returns {string | null}
 */
function imageExpression(images, repository) {
  // The compose line wraps the repository in a variable default, so the
  // repository is followed by `}` (the default's closing brace), not by
  // the tag's colon.
  const found = images.find((entry) => entry.image.includes(`/${repository}`));
  return found ? found.image : null;
}

/**
 * The findings: places where the variant suffix can be shadowed.
 *
 * @param {string} composePath - Path to docker-compose.yaml
 * @param {string} envTemplatePath - Path to the `env` template
 * @returns {Array<{ where: string, problem: string }>}
 */
function findShadowedVariant(composePath, envTemplatePath) {
  const images = parseComposeImages(composePath);
  const assigned = new Set(parseEnvTemplate(envTemplatePath).variables.map((variable) => variable.name));

  const findings = [];
  for (const { envName, repository } of MODEL_SERVING) {
    const pin = `${envName}_IMAGE_TAG`;
    const expression = imageExpression(images, repository);
    if (!expression) {
      findings.push({
        where: `docker-compose.yaml (${repository})`,
        problem: 'the image is not rendered — the check would be vacuous for it'
      });
      continue;
    }

    // The pin must be the OUTER fallback of the tag, and the suffix must
    // sit inside it: a pin then wins outright and takes no suffix.
    const pinStart = expression.indexOf(`\${${pin}:-`);
    if (pinStart === -1) {
      findings.push({
        where: `docker-compose.yaml (${repository})`,
        problem: `the tag is not read from ${pin} — the per-image pin cannot win`
      });
      continue;
    }
    const span = fallbackSpan(expression, pinStart);
    if (!span) {
      findings.push({
        where: `docker-compose.yaml (${repository})`,
        problem: `the ${pin} fallback is malformed`
      });
      continue;
    }
    if (!span.fallback.includes(SUFFIX_VARIABLE)) {
      findings.push({
        where: `docker-compose.yaml (${repository})`,
        problem:
          `the ${SUFFIX_VARIABLE} is not composed inside the ${pin} fallback — ` +
          'a pin would then receive the suffix, and an operator appending the ' +
          'suffix to their .env would not get the slim build'
      });
    }

    // The env template must declare NO per-service tag for those three:
    // such a line shadows the composition and the fat build comes back.
    if (assigned.has(pin)) {
      findings.push({
        where: `env (${pin})`,
        problem:
          'the template declares a per-service image tag for a model-serving image — ' +
          'it shadows the version and the variant, so the fat build is pulled ' +
          'silently. A pin for these three is a line the OPERATOR adds.'
      });
    }
  }
  return findings;
}

module.exports = { findShadowedVariant, MODEL_SERVING, fallbackSpan, imageExpression };
