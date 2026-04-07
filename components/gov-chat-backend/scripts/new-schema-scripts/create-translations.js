/**
 * create-translations.js
 * * This script creates translations for service categories and services in an ArangoDB database,
 * inserting them into the `serviceCategoryTranslations` and `serviceTranslations` collections,
 * along with edges in `serviceCategoryTranslationsEdge` and `serviceTranslationsEdge`.
 * * Translation Engines:
 * This script supports two translation engines:
 * 1. Google Cloud Translate API (original behavior)
 * 2. Internal Translation Service (node.js backend with vLLM guardrail)
 * * Usage:
 * node create-translations.js <lang> [--translation-engine=google|internal]
 * * Parameters:
 * - lang: Target language code (e.g., EN, FR, SW, ID, en, fr, sw, id). Case-insensitive.
 * Cannot be EN (English is the source language).
 * - --translation-engine: (Optional) Translation engine to use. Default: google.
 *   - google: Uses Google Cloud Translate API
 *   - internal: Uses the internal translation service (requires authentication)
 * * Configuration for Google Translate:
 * - Uses a Google Cloud service account for server-to-server authentication.
 * - Credentials are loaded from a JSON file (default: `google-credentials.json`).
 * - Environment variable: GOOGLE_CREDENTIALS_PATH (default: ./google-credentials.json)
 * * Configuration for Internal Translation Service:
 * - Connects to the backend API at http://localhost:3000/api/translate
 * - Prompts for username/password for authentication
 * - Obtains JWT token via /api/auth/login endpoint
 * - Environment variable: TRANSLATION_SERVICE_URL (default: http://localhost:3000)
 * * Environment Variables (in .env file):
 * - ARANGO_URL: ArangoDB URL (default: http://localhost:8529)
 * - ARANGO_DATABASE: Database name (default: genie)
 * - ARANGO_USERNAME: ArangoDB username (default: root)
 * - ARANGO_PASSWORD: ArangoDB password (default: test)
 * - GOOGLE_CREDENTIALS_PATH: Path to Google credentials JSON (default: ./google-credentials.json)
 * - TRANSLATION_SERVICE_URL: Internal translation service URL (default: http://localhost:3000)
 * * Prerequisites:
 * - Install dependencies: `npm install arangojs dotenv @google-cloud/translate`
 * - Ensure ArangoDB collections exist: `serviceCategories`, `services`
 * - The script will create `serviceCategoryTranslations`, `serviceTranslations`,
 * `serviceCategoryTranslationsEdge`, and `serviceTranslationsEdge` if they don’t exist
 * * Examples:
 * # Using Google Translate (default)
 * node create-translations.js ID
 * node create-translations.js FR --translation-engine=google
 * # Using Internal Translation Service
 * node create-translations.js FR --translation-engine=internal
 * * Output:
 * - Logs creation of translations and edges
 * - Skips existing translations
 * - Exits with status 0 on success, 1 on failure
 * * Notes:
 * - Assumes `nameEN` fields in `serviceCategories` and `services` are the source texts.
 * - Translation keys are formatted as `${categoryKey}_${lang}` and `${serviceKey}_${lang}`.
 * - Edges link translations to their respective categories/services.
 * - Handles translation API errors with a fallback placeholder translation.
 * - Schema aligns with import-service-categories.js, using `serviceCategoryId`, `languageCode`, and `translation`.
 */

const { Database, aql } = require('arangojs');
const { Translate } = require('@google-cloud/translate').v2;
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { getDbConfig } = require('./db-config');

const config = getDbConfig();

/**
 * Resolves the ArangoDB URL. If running on host but URL points to docker service, 
 * it falls back to localhost.
 */
// Removed: logic moved to db-config.js

// --- Internal Translation Service Client ---
/**
 * InternalTranslationClient
 * Handles translation via the internal translation service API
 */
class InternalTranslationClient {
  constructor() {
    // Backend URL from docker-compose.yaml - backend runs on port 3000
    // Routes are mounted at /api/ prefix based on index.js configuration
    this.baseUrl = process.env.TRANSLATION_SERVICE_URL || 'http://localhost:3000';
    this.translateEndpoint = `${this.baseUrl}/api/translate`;
    this.loginEndpoint = `${this.baseUrl}/api/auth/login`;
    this.token = null;
  }

  /**
   * Prompt user for credentials and perform login
   */
  async authenticate() {
    console.log('\n--- Internal Translation Service Authentication ---');
    console.log(`Connecting to: ${this.baseUrl}`);

    const username = await this.askQuestion('Enter username: ');
    const password = await this.askQuestion('Enter password: ', true);

    // Hash password using SHA-256 (same as frontend)
    const encPassword = this.hashPassword(password);

    try {
      const response = await fetch(this.loginEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          loginName: username,
          encPassword: encPassword, // Send hashed password
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Login failed: ${response.status} ${response.statusText}. ${errorData.message || ''}`);
      }

      const data = await response.json();

      // The login endpoint returns { accessToken, refreshToken, user }
      if (!data.accessToken) {
        throw new Error('No access token returned from login');
      }

      this.token = data.accessToken;
      console.log('✓ Authentication successful!');
      return true;
    } catch (error) {
      console.error(`✗ Authentication failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Hash a password using SHA-256
   * Note: This matches the frontend hashing for compatibility
   * @param {string} password The password to hash
   * @returns {string} The hashed password
   */
  hashPassword(password) {
    return crypto
      .createHash('sha256')
      .update(password)
      .digest('hex');
  }

  /**
   * Translate text using the internal translation service
   * @param {string} text - Text to translate
   * @param {string} sourceLang - Source language code (e.g., 'en')
   * @param {string} targetLang - Target language code (e.g., 'fr')
   * @returns {Promise<string>} Translated text
   */
  async translate(text, sourceLang, targetLang) {
    if (!this.token) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    try {
      const response = await fetch(this.translateEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          texts: [text],
          source_lang: sourceLang,
          target_lang: targetLang,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Translation request failed: ${response.status} ${response.statusText}. ${errorData.message || ''}`);
      }

      const data = await response.json();

      if (!data.translated_texts || data.translated_texts.length === 0) {
        throw new Error('No translated text returned from service');
      }

      return data.translated_texts[0];
    } catch (error) {
      console.error(`Translation failed for "${text}" to ${targetLang}:`, error.message);
      // Fallback to placeholder
      return `${text} (${targetLang})`;
    }
  }

  /**
   * Ask a question in the console and return the user's answer.
   * @param {string} query - The question to display to the user.
   * @param {boolean} hidden - Whether to hide the input (for passwords).
   * @returns {Promise<string>} The user's answer.
   */
  askQuestion(query, hidden = false) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise(resolve => {
      if (hidden) {
        // Hide input for password
        const stdin = process.stdin;
        stdin.on('data', (char) => {
          if (char === '\n' || char === '\r' || char === '\u0004') {
            rl.close();
          }
        });
      }

      rl.question(query, ans => {
        rl.close();
        resolve(ans);
      });
    });
  }
}

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

class TranslationCreator {
  constructor(dbConfig, translationEngine = 'google') {
    this.translationEngine = translationEngine;
    this.googleTranslate = null;
    this.internalTranslate = null;

    // Initialize the appropriate translation client
    if (translationEngine === 'google') {
      this.initGoogleTranslate();
    } else if (translationEngine === 'internal') {
      this.internalTranslate = new InternalTranslationClient();
    } else {
      throw new Error(`Invalid translation engine: ${translationEngine}. Must be 'google' or 'internal'.`);
    }

    // Initialize ArangoDB connection
    this.db = new Database(dbConfig);
  }

  /**
   * Initialize Google Cloud Translation client
   */
  initGoogleTranslate() {
    // Load Google Cloud credentials from JSON file
    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
    let credentials;
    try {
      const credentialsRaw = fs.readFileSync(path.resolve(credentialsPath), 'utf8');
      credentials = JSON.parse(credentialsRaw);
    } catch (error) {
      throw new Error(`Failed to read Google credentials from ${credentialsPath}: ${error.message}`);
    }

    // Map service account fields to expected names
    const projectId = credentials.project_id;
    const clientEmail = credentials.client_email;
    const privateKey = credentials.private_key;
    const apiKey = credentials.apiKey;

    if (!projectId || !clientEmail || !privateKey || !apiKey) {
      throw new Error('Google credentials JSON must contain project_id, client_email, private_key, and apiKey');
    }

    this.googleTranslate = new Translate({
      projectId,
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      },
      key: apiKey
    });

    console.log('✓ Google Cloud Translation client initialized');
  }

  /**
   * Authenticate internal translation client (if applicable)
   */
  async authenticate() {
    if (this.translationEngine === 'internal' && this.internalTranslate) {
      await this.internalTranslate.authenticate();
    }
  }

  /**
   * Ensure required collections exist, creating them if necessary
   */
  async ensureCollections() {
    try {
      console.log('Validating and creating collections if necessary...');

      // Document collections
      this.serviceCategories = this.db.collection('serviceCategories');
      this.services = this.db.collection('services');
      this.categoryTranslations = this.db.collection('serviceCategoryTranslations');
      this.serviceTranslations = this.db.collection('serviceTranslations');

      // Edge collections
      this.categoryTranslationsEdge = this.db.collection('serviceCategoryTranslationsEdge');
      this.serviceTranslationsEdge = this.db.collection('serviceTranslationsEdge');

      // Check existence and create if needed
      const collections = [
        { name: 'serviceCategories', type: 2, instance: this.serviceCategories },
        { name: 'services', type: 2, instance: this.services },
        { name: 'serviceCategoryTranslations', type: 2, instance: this.categoryTranslations },
        { name: 'serviceTranslations', type: 2, instance: this.serviceTranslations },
        { name: 'serviceCategoryTranslationsEdge', type: 3, instance: this.categoryTranslationsEdge },
        { name: 'serviceTranslationsEdge', type: 3, instance: this.serviceTranslationsEdge }
      ];

      for (const { name, type, instance } of collections) {
        const exists = await instance.exists();
        if (!exists) {
          console.log(`Creating ${name} collection...`);
          await this.db.createCollection(name, {
            type, // 2 for document, 3 for edge
            waitForSync: false,
            keyOptions: {}
          });
          console.log(`✓ ${name} collection created`);
        } else {
          console.log(`✓ ${name} collection already exists`);
        }
      }

      // Add indexes for serviceCategoryTranslations and serviceTranslations
      if (!(await this.categoryTranslations.indexes()).some(idx => idx.name === 'idx_category_language')) {
        await this.categoryTranslations.ensureIndex({
          type: 'hash',
          fields: ['serviceCategoryId', 'languageCode'],
          unique: true,
          name: 'idx_category_language'
        });
        console.log('✓ Created index idx_category_language on serviceCategoryTranslations');
      }

      if (!(await this.serviceTranslations.indexes()).some(idx => idx.name === 'idx_service_language')) {
        await this.serviceTranslations.ensureIndex({
          type: 'hash',
          fields: ['serviceId', 'languageCode'],
          unique: true,
          name: 'idx_service_language'
        });
        console.log('✓ Created index idx_service_language on serviceTranslations');
      }
    } catch (error) {
      console.error('Error ensuring collections:', error.message);
      throw error;
    }
  }

  /**
   * Validate language code
   * @param {string} lang - Language code
   * @returns {string} - Uppercase language code
   */
  validateLanguage(lang) {
    const validLang = lang.toUpperCase();
    if (!validLang || typeof validLang !== 'string' || validLang.trim() === '') {
      throw new Error('Language code must be a non-empty string');
    }
    if (validLang === 'EN') {
      throw new Error('Cannot create translations for EN; English is the source language');
    }
    return validLang;
  }

  /**
   * Generate translation using the selected translation engine
   * @param {string} text - Original English text
   * @param {string} lang - Target language code
   * @returns {string} - Translated text
   */
  async generateTranslation(text, lang) {
    if (this.translationEngine === 'google') {
      try {
        const [translation] = await this.googleTranslate.translate(text, {
          from: 'en',
          to: lang.toLowerCase()
        });
        return translation;
      } catch (error) {
        console.error(`Translation failed for "${text}" to ${lang}:`, error.message);
        // Fallback to placeholder
        return `${text} (${lang})`;
      }
    } else if (this.translationEngine === 'internal') {
      // Internal translation service expects lowercase language codes
      return await this.internalTranslate.translate(text, 'en', lang.toLowerCase());
    }
    throw new Error('No translation engine available');
  }

  /**
   * Create translations and edges for service categories
   * @param {string} lang - Language code
   */
  async createCategoryTranslations(lang) {
    try {
      console.log(`\nCreating category translations for ${lang}...`);

      // First, try to fetch English translations from serviceCategoryTranslations
      let categories = await this.db.query(aql`
        FOR trans IN ${this.categoryTranslations}
          FILTER LOWER(trans.languageCode) == "en" AND trans.translation != null
          RETURN { _key: trans.serviceCategoryId, nameEN: trans.translation }
      `).then(cursor => cursor.all());

      // If no translations found, fall back to nameEN in base collection
      if (categories.length === 0) {
        console.log('No English translations found in serviceCategoryTranslations, checking serviceCategories.nameEN...');
        categories = await this.db.query(aql`
          FOR cat IN ${this.serviceCategories}
            FILTER cat.nameEN != null
            RETURN { _key: cat._key, nameEN: cat.nameEN }
        `).then(cursor => cursor.all());
      }

      console.log(`Found ${categories.length} categories to translate.`);

      // Fetch existing translations for the language (case-insensitive)
      const existingTranslations = await this.db.query(aql`
        FOR trans IN ${this.categoryTranslations}
          FILTER LOWER(trans.languageCode) == ${lang.toLowerCase()}
          RETURN trans.serviceCategoryId
      `).then(cursor => cursor.all());

      // Check if there are existing translations
      if (existingTranslations.length > 0) {
        console.log(`\nFound ${existingTranslations.length} existing translations for ${lang}.`);
        const answer = await askQuestion(`Do you want to overwrite existing translations for ${lang}? (y/N) `);

        if (answer.toLowerCase() !== 'y') {
          console.log(`Skipping category translations for ${lang} as requested.`);
          return 0;
        }

        console.log(`Deleting existing translations for ${lang}...`);

        // Delete existing translations and edges
        for (const categoryId of existingTranslations) {
          // Delete the edge first (due to foreign key constraints)
          await this.db.query(aql`
            FOR edge IN ${this.categoryTranslationsEdge}
              FILTER edge._from == ${`serviceCategories/${categoryId}`}
              REMOVE edge IN ${this.categoryTranslationsEdge}
          `);

          // Delete the translation document (case-insensitive languageCode)
          await this.db.query(aql`
            FOR trans IN ${this.categoryTranslations}
              FILTER trans.serviceCategoryId == ${categoryId} AND LOWER(trans.languageCode) == ${lang.toLowerCase()}
              REMOVE trans IN ${this.categoryTranslations}
          `);
        }

        console.log(`✓ Deleted ${existingTranslations.length} existing category translations and edges for ${lang}.`);
      }

      let inserted = 0;
      const langLower = lang.toLowerCase(); // Use lowercase for languageCode
      for (const category of categories) {
        const translatedName = await this.generateTranslation(category.nameEN, lang);
        const translation = {
          _key: `${category._key}_${langLower}`,
          serviceCategoryId: category._key,
          languageCode: langLower, // Store lowercase
          translation: translatedName,
          isActive: true,
          createdAt: new Date().toISOString()
        };

        // Insert translation
        await this.categoryTranslations.save(translation);
        console.log(`  ✓ Translated category "${category.nameEN}" to "${translatedName}"`);

        // Create edge
        await this.categoryTranslationsEdge.save({
          _from: `serviceCategories/${category._key}`,
          _to: `serviceCategoryTranslations/${translation._key}`,
          createdAt: new Date().toISOString()
        });
        inserted++;
      }

      console.log(`\n✓ Inserted ${inserted} new category translations and edges for ${lang}.`);
    } catch (error) {
      console.error(`✗ Error creating category translations for ${lang}:`, error.message);
      throw error;
    }
  }

  /**
   * Create translations and edges for services
   * @param {string} lang - Language code
   */
  async createServiceTranslations(lang) {
    try {
      console.log(`\nCreating service translations for ${lang}...`);

      // First, try to fetch English translations from serviceTranslations
      let services = await this.db.query(aql`
        FOR trans IN ${this.serviceTranslations}
          FILTER LOWER(trans.languageCode) == "en" AND trans.translation != null
          RETURN { _key: trans.serviceId, nameEN: trans.translation }
      `).then(cursor => cursor.all());

      // If no translations found, fall back to nameEN in base collection
      if (services.length === 0) {
        console.log('No English translations found in serviceTranslations, checking services.nameEN...');
        services = await this.db.query(aql`
          FOR srv IN ${this.services}
            FILTER srv.nameEN != null
            RETURN { _key: srv._key, nameEN: srv.nameEN }
        `).then(cursor => cursor.all());
      }

      console.log(`Found ${services.length} services to translate.`);

      // Fetch existing translations for the language (case-insensitive)
      const existingTranslations = await this.db.query(aql`
        FOR trans IN ${this.serviceTranslations}
          FILTER LOWER(trans.languageCode) == ${lang.toLowerCase()}
          RETURN trans.serviceId
      `).then(cursor => cursor.all());

      // Check if there are existing translations
      if (existingTranslations.length > 0) {
        console.log(`\nFound ${existingTranslations.length} existing translations for ${lang}.`);
        const answer = await askQuestion(`Do you want to overwrite existing translations for ${lang}? (y/N) `);

        if (answer.toLowerCase() !== 'y') {
          console.log(`Skipping service translations for ${lang} as requested.`);
          return 0;
        }

        console.log(`Deleting existing translations for ${lang}...`);

        // Delete existing translations and edges
        for (const serviceId of existingTranslations) {
          // Delete the edge first (due to foreign key constraints)
          await this.db.query(aql`
            FOR edge IN ${this.serviceTranslationsEdge}
              FILTER edge._from == ${`services/${serviceId}`}
              REMOVE edge IN ${this.serviceTranslationsEdge}
          `);

          // Delete the translation document (case-insensitive languageCode)
          await this.db.query(aql`
            FOR trans IN ${this.serviceTranslations}
              FILTER trans.serviceId == ${serviceId} AND LOWER(trans.languageCode) == ${lang.toLowerCase()}
              REMOVE trans IN ${this.serviceTranslations}
          `);
        }

        console.log(`✓ Deleted ${existingTranslations.length} existing service translations and edges for ${lang}.`);
      }

      let inserted = 0;
      const langLower = lang.toLowerCase(); // Use lowercase for languageCode
      for (const service of services) {
        const translatedName = await this.generateTranslation(service.nameEN, lang);
        const translation = {
          _key: `${service._key}_${langLower}`,
          serviceId: service._key,
          languageCode: langLower, // Store lowercase
          translation: translatedName,
          isActive: true,
          createdAt: new Date().toISOString()
        };

        // Insert translation
        await this.serviceTranslations.save(translation);
        console.log(`  ✓ Translated service "${service.nameEN}" to "${translatedName}"`);

        // Create edge
        await this.serviceTranslationsEdge.save({
          _from: `services/${service._key}`,
          _to: `serviceTranslations/${translation._key}`,
          createdAt: new Date().toISOString()
        });
        inserted++;
      }

      console.log(`\n✓ Inserted ${inserted} new service translations and edges for ${lang}.`);
    } catch (error) {
      console.error(`✗ Error creating service translations for ${lang}:`, error.message);
      throw error;
    }
  }

  /**
   * Main method to run translation creation
   * @param {string} lang - Language code
   */
  async run(lang) {
    try {
      const validLang = this.validateLanguage(lang);
      await this.ensureCollections();
      await this.createCategoryTranslations(validLang);
      await this.createServiceTranslations(validLang);
      console.log(`\n✓ Translation creation completed for ${validLang}.`);
    } catch (error) {
      console.error('✗ Translation creation failed:', error.message);
      process.exit(1);
    }
  }
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let lang = null;
  let translationEngine = 'google'; // Default to Google Translate

  for (const arg of args) {
    if (arg.startsWith('--translation-engine=')) {
      translationEngine = arg.split('=')[1];
      if (translationEngine !== 'google' && translationEngine !== 'internal') {
        console.error('✗ Invalid translation engine. Must be "google" or "internal".');
        console.error('Usage: node create-translations.js <lang> [--translation-engine=google|internal]');
        process.exit(1);
      }
    } else if (!arg.startsWith('--')) {
      lang = arg;
    }
    }

    // Read configuration from centralized utility
    const dbConfig = {
        ...config,
        databaseName: config.database
    };

    // --- Confirmation Prompt ---
    console.log('--- Database Translation Creation Script ---');
    console.log(`Translation Engine: ${engine === 'google' ? 'Google Cloud Translate' : 'Internal Translation Service'}`);
    console.log(`This script will translate categories and services into '${lang.toUpperCase()}'.`);
    console.log('\nDatabase configuration to be used:');
    console.log(`  URL:      ${dbConfig.url}`);
    console.log(`  Database: ${dbConfig.databaseName}`);
    console.log(`  User:     ${dbConfig.auth.username}`);

    if (translationEngine === 'internal') {
      const serviceUrl = process.env.TRANSLATION_SERVICE_URL || 'http://localhost:3000';
      console.log(`\nTranslation Service: ${serviceUrl}`);
    }

    const answer = await askQuestion('\nAre you sure you want to proceed with these settings? (Y/n) ');

    if (answer.toLowerCase() !== 'y') {
        console.log('Operation cancelled by user. Exiting.');
        process.exit(0);
    }
    // --- End Confirmation Prompt ---

  try {
    const creator = new TranslationCreator(dbConfig, translationEngine);

    // Authenticate if using internal translation service
    if (translationEngine === 'internal') {
      await creator.authenticate();
    }

    await creator.run(lang);
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to initialize TranslationCreator:', error.message);
    process.exit(1);
  }
}

main();