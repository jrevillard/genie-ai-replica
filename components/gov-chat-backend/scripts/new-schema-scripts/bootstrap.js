const { execSync } = require('child_process');
const path = require('path');
const { Database } = require('arangojs');
const { getDbConfig } = require('./db-config');

console.log("=== GENIE CORE BOOTSTRAP ===");

const config = getDbConfig();

async function runBootstrap() {
  // Pre-flight check: Verify ArangoDB connectivity
  console.log(`\n>> Pre-flight check: Connecting to ArangoDB at ${config.url}...`);
  const db = new Database({ url: config.url, auth: config.auth });
  
  try {
    await db.version();
    console.log(">> Connected to ArangoDB successfully.");
  } catch (error) {
    console.error(`\n[ERROR] Cannot connect to ArangoDB at ${config.url}`);
    console.error("Please ensure ArangoDB is running and accessible.");
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  const scripts = [
    'arango-schema-creator.js',
    'create-genie-ai-admin-account.js',
    'create-genie-ai-manager-account.js'
  ];

  // Set AUTO_BOOTSTRAP to bypass interactive prompts in the seeders
  process.env.AUTO_BOOTSTRAP = 'true';

  for (const script of scripts) {
    const scriptPath = path.join(__dirname, script);
    console.log(`\n>> Executing ${script}...`);
    try {
      execSync(`node "${scriptPath}"`, { stdio: 'inherit', env: process.env });
      console.log(`>> Successfully executed ${script}.`);
    } catch (error) {
      console.error(`\n[ERROR] Bootstrap failed during ${script}`);
      process.exit(1);
    }
  }

  console.log("\n=== BOOTSTRAP COMPLETE ===");
}

runBootstrap().catch(error => {
  console.error("\n[FATAL] Bootstrap process crashed:");
  console.error(error);
  process.exit(1);
});
