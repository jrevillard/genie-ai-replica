const fs = require('fs');
const path = require('path');
const { parseEnvTemplate } = require('./parse-env');

/**
 * The env var family owned by the retriever service.
 *
 * The deployment (docker-compose.yaml, deploy/ansible/templates/env.j2) and
 * the overlay code (genie-ai-overlay/**) must agree on the name of every knob
 * in this family. When the two drift apart, the deployment sets a variable
 * that no service reads: the operator changes it, the service ignores it, and
 * nothing reports the mismatch. The label-filter strategy knob was inert for
 * that reason.
 */
const RETRIEVER_ENV_PREFIX = 'RETRIEVER_ARANGO_';

/**
 * A knob name of the family. The look-behind keeps a longer prefixed name
 * out: GENIE_AI_RETRIEVER_ARANGO_IMAGE is an image reference, not a knob
 * the retriever reads at runtime.
 */
const RETRIEVER_ENV_NAME = /(?<![A-Z0-9_])(RETRIEVER_ARANGO_[A-Z0-9_]+)/g;

/**
 * Python environment reads: os.getenv("X"), os.environ.get("X"), and
 * os.environ["X"] when the statement is not an assignment.
 */
const PYTHON_ENV_READ =
  /os\.getenv\(\s*['"]([A-Z0-9_]+)['"]|os\.environ\.get\(\s*['"]([A-Z0-9_]+)['"]|os\.environ\[\s*['"]([A-Z0-9_]+)['"]\s*\](?!\s*=)/g;

/** Directories of the overlay that hold tests, not production code. */
const NON_PRODUCTION_DIRS = new Set(['tests', 'contracts', '__pycache__']);

/**
 * Read a file, dropping the lines that are only comments.
 *
 * @param {string} filePath - Path to the file
 * @returns {string} The content without its comment lines
 */
function readWithoutCommentLines(filePath) {
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
 * Collect the knob names of the family that a deployment file sets.
 *
 * @param {string[]} filePaths - Paths to the deployment files
 * @returns {Set<string>} The knob names
 */
function parseDeploymentEnvNames(filePaths) {
  const names = new Set();
  for (const filePath of filePaths) {
    for (const match of readWithoutCommentLines(filePath).matchAll(RETRIEVER_ENV_NAME)) {
      names.add(match[1]);
    }
  }
  return names;
}

/**
 * List the Python files of the overlay that hold production code.
 *
 * @param {string} dir - The overlay directory
 * @returns {string[]} The file paths
 */
function collectPythonFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (NON_PRODUCTION_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...collectPythonFiles(full));
    } else if (entry.name.endsWith('.py')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Collect the knob names of the family that the overlay code reads.
 *
 * @param {string} overlayDir - The genie-ai-overlay directory
 * @returns {Map<string, string[]>} The knob names, each with the files reading it
 */
function parseOverlayEnvReads(overlayDir) {
  const reads = new Map();
  for (const file of collectPythonFiles(overlayDir)) {
    const content = fs.readFileSync(file, 'utf-8');
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
 * Check that the deployment and the overlay code agree on the name of every
 * knob of the family.
 *
 * @param {{ composeFile: string, ansibleEnvFile: string, envTemplateFile: string, overlayDir: string }} input - The files to check
 * @returns {{ errors: string[], deploymentNames: Set<string>, codeNames: Set<string> }}
 */
function validateRetrieverEnvCoverage({ composeFile, ansibleEnvFile, envTemplateFile, overlayDir }) {
  const errors = [];

  const deploymentNames = parseDeploymentEnvNames([composeFile, ansibleEnvFile]);
  const envTemplateNames = new Set(parseEnvTemplate(envTemplateFile).variables.map((v) => v.name));
  for (const name of envTemplateNames) {
    if (name.startsWith(RETRIEVER_ENV_PREFIX)) {
      deploymentNames.add(name);
    }
  }

  const codeReads = parseOverlayEnvReads(overlayDir);

  for (const name of deploymentNames) {
    if (!codeReads.has(name)) {
      errors.push(`${name} is configured by the deployment but read by no overlay service (the knob is inert)`);
    }
  }

  for (const [name, files] of codeReads) {
    if (!deploymentNames.has(name)) {
      errors.push(`${name} is read by ${files[0]} but no deployment file sets it (the knob cannot be set)`);
    }
  }

  return {
    errors,
    deploymentNames,
    codeNames: new Set(codeReads.keys())
  };
}

module.exports = {
  validateRetrieverEnvCoverage,
  parseDeploymentEnvNames,
  parseOverlayEnvReads,
  RETRIEVER_ENV_PREFIX
};
