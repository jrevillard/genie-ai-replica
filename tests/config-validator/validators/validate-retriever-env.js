const fs = require('fs');
const path = require('path');
const { parseEnvTemplate } = require('./parse-env');
const { parseComposeServiceContracts } = require('./parse-compose');
const { parseEnvTemplateVarNames } = require('./parse-env-template');

/**
 * The namespace of the knobs the retriever reads from its environment.
 *
 * The deployment (docker-compose.yaml, deploy/ansible/templates/env.j2) and
 * the code that reads the knobs (genie-ai-overlay/retriever,
 * genie-ai-overlay/chatqna) must agree on the name of every knob. When the
 * two drift apart, the deployment sets a variable no service reads: the
 * operator changes it, the service ignores it, and nothing reports the
 * mismatch. The label-filter strategy knob was inert for that reason.
 */
const RETRIEVER_ENV_PREFIX = 'RETRIEVER_';

/** The compose service that runs the retriever. */
const RETRIEVER_COMPOSE_SERVICE = 'retriever-arango-service';

/**
 * The services on the retrieval path: the retriever itself and the
 * orchestrator that forwards the query parameters to it. A knob the
 * deployment offers the retriever is read by one of them.
 */
const RETRIEVER_SOURCE_DIRS = ['retriever', 'chatqna'];

/**
 * Variables the OPEA service sets in its own process, not the deployment:
 * the retriever reads RETRIEVER_TYPE to label its query type, and no
 * deployment file carries it.
 */
const FRAMEWORK_VARS = new Set(['RETRIEVER_TYPE']);

/**
 * Python environment reads: os.getenv("X"), os.environ.get("X"), and
 * os.environ["X"] when the statement is not an assignment.
 */
const PYTHON_ENV_READ =
  /os\.getenv\(\s*['"]([A-Z0-9_]+)['"]|os\.environ\.get\(\s*['"]([A-Z0-9_]+)['"]|os\.environ\[\s*['"]([A-Z0-9_]+)['"]\s*\](?!\s*=)/g;

/** Directories of the overlay that hold tests, not production code. */
const NON_PRODUCTION_DIRS = new Set(['tests', 'contracts', '__pycache__']);

/**
 * Read a Python file, dropping the comments it holds.
 *
 * A commented-out statement is not code: it reads nothing.
 *
 * @param {string} filePath - Path to the file
 * @returns {string} The content without its comments
 */
function readPythonWithoutComments(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read file: ${filePath}`, { cause: err });
  }
  return content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/**
 * List the Python files of the overlay directories that hold production code.
 *
 * @param {string} overlayDir - The genie-ai-overlay directory
 * @param {string[]} subdirs - The directories to read
 * @returns {string[]} The file paths
 */
function collectPythonFiles(overlayDir, subdirs) {
  const files = [];
  for (const subdir of subdirs) {
    const dir = path.join(overlayDir, subdir);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (NON_PRODUCTION_DIRS.has(entry.name)) {
          continue;
        }
        files.push(...collectPythonFiles(overlayDir, [path.join(subdir, entry.name)]));
      } else if (entry.name.endsWith('.py')) {
        files.push(full);
      }
    }
  }
  return files;
}

/**
 * Collect the knob names the retrieval path reads.
 *
 * @param {string} overlayDir - The genie-ai-overlay directory
 * @returns {Map<string, string[]>} The knob names, each with the files reading it
 */
function parseOverlayEnvReads(overlayDir) {
  const reads = new Map();
  for (const file of collectPythonFiles(overlayDir, RETRIEVER_SOURCE_DIRS)) {
    const content = readPythonWithoutComments(file);
    for (const match of content.matchAll(PYTHON_ENV_READ)) {
      const name = match[1] || match[2] || match[3];
      if (!name.startsWith(RETRIEVER_ENV_PREFIX)) {
        continue;
      }
      if (!reads.has(name)) {
        reads.set(name, []);
      }
      reads.get(name).push(path.relative(overlayDir, file));
    }
  }
  return reads;
}

/**
 * Check that the deployment and the retrieval path agree on every knob.
 *
 * @param {{ composeFile: string, ansibleEnvFile: string, envTemplateFile: string, overlayDir: string }} input - The files to check
 * @returns {{ errors: string[], deliveredToRetriever: Set<string>, configured: Set<string>, codeNames: Set<string> }}
 */
function validateRetrieverEnvCoverage({ composeFile, ansibleEnvFile, envTemplateFile, overlayDir }) {
  const errors = [];

  const contracts = parseComposeServiceContracts(composeFile);
  const retrieverContract = contracts.find((contract) => contract.service === RETRIEVER_COMPOSE_SERVICE);
  const deliveredToRetriever = new Set(retrieverContract ? retrieverContract.envVars : []);
  const deliveredAnywhere = new Set(contracts.flatMap((contract) => contract.envVars));

  // The Ansible template renders the variables it configures; the env
  // template names the variables an operator uncomments for a local
  // deployment.
  const configured = parseEnvTemplateVarNames(ansibleEnvFile, RETRIEVER_ENV_PREFIX);
  for (const variable of parseEnvTemplate(envTemplateFile).variables) {
    if (variable.name.startsWith(RETRIEVER_ENV_PREFIX)) {
      configured.add(variable.name);
    }
  }

  const reads = parseOverlayEnvReads(overlayDir);

  for (const name of deliveredToRetriever) {
    if (name.startsWith(RETRIEVER_ENV_PREFIX) && !reads.has(name)) {
      errors.push(
        `${name} reaches the ${RETRIEVER_COMPOSE_SERVICE} container but no service on the retrieval path reads it (the knob is inert)`
      );
    }
  }

  for (const name of configured) {
    if (reads.has(name) && !deliveredToRetriever.has(name)) {
      errors.push(
        `${name} is configured by the deployment but no compose service passes it to the ${RETRIEVER_COMPOSE_SERVICE} container (the knob is inert)`
      );
    }
  }

  for (const [name, files] of reads) {
    if (FRAMEWORK_VARS.has(name)) {
      continue;
    }
    if (!deliveredAnywhere.has(name) && !configured.has(name)) {
      errors.push(`${name} is read by ${files[0]} but set by no deployment file (the knob cannot be set)`);
    }
  }

  return {
    errors,
    deliveredToRetriever,
    configured,
    codeNames: new Set(reads.keys())
  };
}

module.exports = {
  validateRetrieverEnvCoverage
};
