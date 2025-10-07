// Import the ArangoDB driver
const { Database } = require('arangojs');
const dotenv = require('dotenv');

// Load environment variables from a .env file
dotenv.config();

// --- Database Configuration ---
// Set up your ArangoDB connection details.
// It's best to use environment variables for security.
const dbConfig = {
  url: process.env.ARANGO_URL || "http://127.0.0.1:8529",
  databaseName: process.env.ARANGO_DATABASE || "node-services", // From your schema file
  auth: {
    username: process.env.ARANGO_USER || "root",
    password: process.env.ARANGO_PASSWORD || "test" // CHANGE THIS or set in .env
  },
};

// --- User Data ---
// The user object to be created.
const managerUser = {
  "loginName": "genie-ai-manager",
  "email": "genie.ai@atomicmail.io",
  "encPassword": "$2b$10$6Lh/XglcywVVChMHeLEFB.9o140Rz6D652miTNWghLcisyUL6oroq",
  "emailVerified": true,
  "createdAt": "2025-08-26T13:39:27.730Z",
  "updatedAt": "2025-10-06T03:07:39.356Z",
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
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyMTYyIiwibG9naW5OYW1lIjoiZ2VuaWUtYWktbWFuYWdlciIsImVtYWlsIjoiZ2VuaWUuYWlAYXRvbWljbWFpbC5pbyIsImlhdCI6MTc1OTcyMDA1OSwiZXhwIjoxNzU5ODA2NDU5fQ.V93S6eBKkJpPj_wCbuVMdcdS6NhwGMMBKtGEFEHkn7E",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyMTYyIiwidG9rZW5WZXJzaW9uIjowLCJpYXQiOjE3NTk3MjAwNTksImV4cCI6MTc2MDMyNDg1OX0.wrG8l0e4z4AcY2FxBbfXcx9HfgWjFVD7ZRL80ygI4yQ",
  "role": "User"
};


/**
 * Main function to connect to ArangoDB and create the user.
 */
async function createArangoUser() {
  console.log("Connecting to ArangoDB...");
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

    // 1. Check if the user already exists
    console.log(`Checking for existing user with loginName: "${managerUser.loginName}"...`);
    const cursor = await db.query({
      query: `
        FOR user IN users
        FILTER user.loginName == @loginName
        LIMIT 1
        RETURN user
      `,
      bindVars: { loginName: managerUser.loginName }
    });

    const existingUser = await cursor.next();

    if (existingUser) {
      // 2a. If user exists, do nothing
      console.log(`User "${managerUser.loginName}" already exists. No action taken.`);
    } else {
      // 2b. If user does not exist, create it
      console.log(`User "${managerUser.loginName}" not found. Creating new user...`);
      const result = await usersCollection.save(managerUser, { returnNew: true });
      console.log("Successfully created new user:");
      console.log(result.new);
    }

  } catch (err) {
    console.error("An error occurred:", err.message);
  }
}

// Run the script
createArangoUser();
