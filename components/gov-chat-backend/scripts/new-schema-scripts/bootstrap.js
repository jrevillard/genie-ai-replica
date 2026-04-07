const { execSync } = require('child_process');
const path = require('path');

console.log("=== GENIE CORE BOOTSTRAP ===");

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
    console.error(`Exit code: ${error.status}`);
    process.exit(1);
  }
}

console.log("\n=== BOOTSTRAP COMPLETE ===");
