const { Database } = require('arangojs');
const readline = require('readline');
const path = require('path');
const { getDbConfig } = require('./db-config');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const config = getDbConfig();
const jwtSecret = process.env.JWT_SECRET || 'default-jwt-secret';
const managerPasswordHash = crypto.createHash('sha256').update('manager').digest('hex');

// --- User Data ---
// The user object to be created.
const managerUser = {
  "loginName": "genie-ai-manager",
  "email": "genie.ai@atomicmail.io",
  "encPassword": managerPasswordHash,
  "emailVerified": true,
  "createdAt": new Date().toISOString(),
  "updatedAt": new Date().toISOString(),
  "personalIdentification": {
    "fullName": "genie-ai-manager",
    "dob": "",
    "gender": "",
    "nationality": "",
    "maritalStatus": ""
  },
  "addressResidency": {
    "currentAddress": ""
  },
  "accessToken": jwt.sign({ userId: "2162", loginName: "genie-ai-manager", email: "genie.ai@atomicmail.io" }, jwtSecret, { expiresIn: '1h' }),
  "refreshToken": jwt.sign({ userId: "2162", tokenVersion: 0 }, jwtSecret, { expiresIn: '7d' }),
  "role": "Admin"
};

/**
 * Asks a question in the console and returns the user's answer.
 * @param {string} query - The question to display to the user.
 * @returns {Promise<string>} The user's answer.
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}


/**
 * Main function to connect to ArangoDB and create the user.
 */
async function createArangoUser() {
    // Read configuration from centralized utility
    const dbConfig = {
        ...config,
        databaseName: config.database
    };

    // --- Confirmation Prompt ---
  if (!process.env.AUTO_BOOTSTRAP) {
    console.log('--- Manager User Creation Script ---');
    console.log('This script will create a genie-ai-manager user in the database.');
    console.log('\nDatabase configuration to be used:');
    console.log(`  URL:      ${dbConfig.url}`);
    console.log(`  Database: ${dbConfig.databaseName}`);
    console.log(`  User:     ${dbConfig.auth.username}`);
    
    const answer = await askQuestion('\nAre you sure you want to proceed with these settings? (Y/n) ');
  
    if (answer.toLowerCase() !== 'y') {
      console.log('Operation cancelled by user. Exiting.');
      process.exit(0);
    }
  }
  // --- End Confirmation Prompt ---

  console.log("\nConnecting to ArangoDB...");
  const db = new Database(dbConfig);

  try {
    // Verify that the database exists
    const dbExists = await db.exists();
    if (!dbExists) {
      console.error(`Error: Database "${dbConfig.databaseName}" does not exist.`);
      return;
    }
    console.log(`Successfully connected to database: "${dbConfig.databaseName}"`);

    const usersCollection = db.collection("users");

    // UPSERT: always enforce the correct password, create if missing
    console.log(`Upserting user "${managerUser.loginName}"...`);
    const cursor = await db.query({
      query: `
        UPSERT { loginName: @loginName }
        INSERT @user
        UPDATE { encPassword: @encPassword, emailVerified: true, updatedAt: @now }
        IN users
        RETURN { action: OLD ? 'updated' : 'inserted', loginName: NEW.loginName }
      `,
      bindVars: {
        loginName: managerUser.loginName,
        user: managerUser,
        encPassword: managerUser.encPassword,
        now: new Date().toISOString()
      }
    });
    const result = await cursor.next();
    console.log(`User "${managerUser.loginName}" ${result.action} successfully.`);

  } catch (err) {
    console.error("An error occurred:", err.message);
  }
}

// Run the script if executed directly
if (require.main === module) {
    createArangoUser();
}
