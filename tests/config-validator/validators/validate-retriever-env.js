const fs = require('fs');
const path = require('path');
const { parseEnvTemplate } = require('./parse-env');
const { parseComposeServiceContracts } = require('./parse-compose');
const { parseEnvTemplateVarNames, readFileOrThrow } = require('./parse-env-template');

/**
 * The namespace of the knobs the retrieval services read from their
 * environment.
 *
 * The deployment (docker-compose.yaml, deploy/ansible/templates/env.j2) and
 * the code that reads the knobs (genie-ai-overlay/retriever,
 * genie-ai-overlay/chatqna) must agree on the name of every knob. When the
 * two drift apart, the deployment sets a variable no service reads: the
 * operator changes it, the service ignores it, and nothing reports the
 * mismatch. The label-filter strategy knob was inert for that reason.
 */
const RETRIEVER_ENV_PREFIX = 'RETRIEVER_';

/**
 * The services on the retrieval path, each with the compose service that
 * runs it: the retriever itself and the orchestrator that forwards the
 * query parameters to it. A knob a service reads from its environment must
 * reach that service's container.
 */
const RETRIEVAL_PATH = [
  { composeService: 'retriever-arango-service', sourceDir: 'retriever' },
  { composeService: 'chatqna-xeon-backend-server', sourceDir: 'chatqna' }
];

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
 * A commented-out statement is not code: it reads nothing. The reads are
 * found textually, so an env-var name inside a docstring still counts.
 *
 * @param {string} filePath - Path to the file
 * @returns {string} The content without its comment lines
 */
function readPythonWithoutComments(filePath) {
  const content = readFileOrThrow(filePath, 'overlay source file');
  return content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/**
 * List the Python files of a directory that hold production code.
 *
 * @param {string} dir - The directory to walk
 * @returns {string[]} The file paths
 */
function collectPythonFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!NON_PRODUCTION_DIRS.has(entry.name)) {
        files.push(...collectPythonFiles(full));
      }
    } else if (entry.name.endsWith('.py')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Collect the knob names the retrieval services read, with the service each
 * name is read by.
 *
 * @param {string} overlayDir - The genie-ai-overlay directory
 * @returns {Map<string, {file: string, readers: Set<string>}>} Each knob name, with a file reading it and the compose services whose sources read it
 */
function parseOverlayEnvReads(overlayDir) {
  const reads = new Map();
  for (const { composeService, sourceDir } of RETRIEVAL_PATH) {
    const dir = path.join(overlayDir, sourceDir);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const file of collectPythonFiles(dir)) {
      const content = readPythonWithoutComments(file);
      for (const match of content.matchAll(PYTHON_ENV_READ)) {
        const name = match[1] || match[2] || match[3];
        if (!name.startsWith(RETRIEVER_ENV_PREFIX)) {
          continue;
        }
        if (!reads.has(name)) {
          reads.set(name, { file: path.relative(overlayDir, file), readers: new Set() });
        }
        reads.get(name).readers.add(composeService);
      }
    }
  }
  return reads;
}

/**
 * Check that the deployment and the retrieval services agree on every knob.
 *
 * @param {{ composeFile: string, ansibleEnvFile: string, envTemplateFile: string, overlayDir: string }} input - The files to check
 * @returns {{ errors: string[], deliveredToRetriever: Set<string>, codeNames: Set<string> }}
 */
function validateRetrieverEnvCoverage({ composeFile, ansibleEnvFile, envTemplateFile, overlayDir }) {
  const errors = [];

  const contracts = parseComposeServiceContracts(composeFile);
  const delivered = new Map();
  for (const contract of contracts) {
    delivered.set(contract.service, new Set(contract.envVars));
  }
  const retrieverEntry = RETRIEVAL_PATH.find((entry) => entry.sourceDir === 'retriever');
  const retrieverDelivery = delivered.get(retrieverEntry.composeService) || new Set();
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

  for (const name of retrieverDelivery) {
    if (name.startsWith(RETRIEVER_ENV_PREFIX) && !reads.has(name)) {
      errors.push(
        `${name} reaches the ${retrieverEntry.composeService} container but no service on the retrieval path reads it (the knob is inert)`
      );
    }
  }

  for (const name of configured) {
    const read = reads.get(name);
    if (!read) {
      continue;
    }
    for (const composeService of read.readers) {
      if (!delivered.get(composeService)?.has(name)) {
        errors.push(
          `${name} is configured by the deployment and read by the ${composeService} sources, but no compose service passes it to the ${composeService} container (the knob is inert)`
        );
      }
    }
  }

  for (const [name, read] of reads) {
    if (FRAMEWORK_VARS.has(name)) {
      continue;
    }
    if (!deliveredAnywhere.has(name) && !configured.has(name)) {
      errors.push(`${name} is read by ${read.file} but set by no deployment file (the knob cannot be set)`);
    }
  }

  return {
    errors,
    deliveredToRetriever: retrieverDelivery,
    codeNames: new Set(reads.keys())
  };
}

module.exports = {
  validateRetrieverEnvCoverage
};
