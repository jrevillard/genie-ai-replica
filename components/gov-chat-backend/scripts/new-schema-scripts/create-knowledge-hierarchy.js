/**
 * create-knowledge-hierarchy.js
 *
 * This script establishes the foundational knowledge hierarchy (service categories and services)
 * in an ArangoDB database. It populates the `serviceCategories`, `services`, and
 * `categoryServices` (edge) collections.
 *
 * This is the first step in setting up a new RAG use case for the GENIE.AI framework.
 * The script is designed to create the English (`nameEN`) labels only. After running
 * this script, use `create-translations.js` to add support for other languages.
 *
 * It operates in two modes:
 * 1. Interactive Mode: Prompts the user to enter categories and their associated services
 * via the command line. This is ideal for manual setup.
 * 2. File Mode: Imports the hierarchy from a user-provided JSON file. This is
 * suitable for automated deployments or predefined structures.
 *
 * The script ensures data integrity by using ArangoDB transactions and prevents
 * the creation of duplicate categories or services based on their `nameEN`.
 *
 * Usage:
 * - Interactive Mode: node create-knowledge-hierarchy.js
 * - File Mode:        node create-knowledge-hierarchy.js --file <path_to_json_file>
 *
 * JSON File Format for File Mode:
 * The file should be an array of category objects. Each object must have a `category`
 * (string) and a `services` property (array of strings).
 *
 * Example `hierarchy.json`:
 * [
 * {
 * "category": "Healthcare & Social Services",
 * "services": [
 * "Find a Doctor",
 * "Book a Hospital Appointment",
 * "Apply for Social Assistance"
 * ]
 * },
 * {
 * "category": "Education & Learning",
 * "services": [
 * "Enroll in Public School",
 * "Apply for Student Loans",
 * "Find a Public Library"
 * ]
 * }
 * ]
 *
 * Environment Variables (in .env file):
 * - ARANGO_URL: ArangoDB URL (default: http://localhost:8529)
 * - ARANGO_DATABASE: Database name (default: genie)
 * - ARANGO_USERNAME: ArangoDB username (default: root)
 * - ARANGO_PASSWORD: ArangoDB password (default: test)
 *
 * Prerequisites:
 * - Install dependencies: `npm install arangojs dotenv inquirer yargs`
 * - The script will create the `serviceCategories`, `services`, and `categoryServices`
 * collections if they don't exist.
 *
 * Output:
 * - Logs the creation of categories, services, and edges.
 * - Skips any duplicates found.
 * - Exits with status 0 on success, 1 on failure.
 */

const { Database, aql } = require('arangojs');
const fs = require('fs').promises;
const path = require('path');
const inquirer = require('inquirer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
require('dotenv').config();

class HierarchyCreator {
  constructor() {
    // Initialize ArangoDB connection
    this.db = new Database({
      url: process.env.ARANGO_URL || 'http://localhost:8529',
      databaseName: process.env.ARANGO_DATABASE || 'genie',
      auth: {
        username: process.env.ARANGO_USERNAME || 'root',
        password: process.env.ARANGO_PASSWORD || 'test'
      }
    });
  }

  /**
   * Ensure required collections exist, creating them if necessary.
   */
  async ensureCollections() {
    console.log('Validating and creating collections if necessary...');
    const collectionsToEnsure = [
      { name: 'serviceCategories', type: 2 }, // Document
      { name: 'services', type: 3 },          // Document - Mistake in original, should be 2
      { name: 'categoryServices', type: 3 }   // Edge
    ];
    // Correcting the type for 'services' collection
    collectionsToEnsure[1].type = 2;


    for (const { name, type } of collectionsToEnsure) {
      const collection = this.db.collection(name);
      const exists = await collection.exists();
      if (!exists) {
        console.log(`Creating ${name} collection...`);
        await this.db.createCollection(name, { type });
        console.log(`✓ ${name} collection created`);
      } else {
        console.log(`✓ ${name} collection already exists`);
      }
    }
    this.serviceCategories = this.db.collection('serviceCategories');
    this.services = this.db.collection('services');
    this.categoryServices = this.db.collection('categoryServices');
  }

  /**
   * Gathers hierarchy data from a JSON file.
   * @param {string} filePath - Path to the input JSON file.
   * @returns {Promise<Array>} - A promise that resolves to the hierarchy data.
   */
  async processFromFile(filePath) {
    console.log(`Reading hierarchy from file: ${filePath}`);
    try {
      const fileContent = await fs.readFile(path.resolve(filePath), 'utf8');
      const data = JSON.parse(fileContent);

      // Validate file structure
      if (!Array.isArray(data)) {
        throw new Error('Invalid file format: The root element must be an array.');
      }
      data.forEach((item, index) => {
        if (typeof item.category !== 'string' || !Array.isArray(item.services)) {
          throw new Error(`Invalid format for item at index ${index}: Must have a 'category' (string) and 'services' (array).`);
        }
        item.services.forEach(service => {
          if (typeof service !== 'string') {
            throw new Error(`Invalid service name in category "${item.category}". All services must be strings.`);
          }
        });
      });
      console.log(`✓ Successfully read and validated ${data.length} categories from file.`);
      return data;
    } catch (error) {
      console.error(`✗ Error reading or parsing file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gathers hierarchy data through interactive prompts.
   * @returns {Promise<Array>} - A promise that resolves to the hierarchy data.
   */
  async processInteractively() {
    console.log('Starting interactive mode to define knowledge hierarchy.');
    console.log('Please enter your service categories and the services within each.');
    const hierarchy = [];
    let addAnotherCategory = true;

    while (addAnotherCategory) {
      const { categoryName } = await inquirer.prompt([
        { type: 'input', name: 'categoryName', message: 'Enter the name of the service category (e.g., "Healthcare"):' }
      ]);

      const services = [];
      let addAnotherService = true;
      while (addAnotherService) {
        const { serviceName } = await inquirer.prompt([
          { type: 'input', name: 'serviceName', message: `Enter a service for "${categoryName}" (or press Enter to finish):` }
        ]);
        if (serviceName) {
          services.push(serviceName);
        } else {
          addAnotherService = false;
        }
      }

      hierarchy.push({ category: categoryName, services });

      const { continueCategory } = await inquirer.prompt([
        { type: 'confirm', name: 'continueCategory', message: 'Do you want to add another category?', default: true }
      ]);
      addAnotherCategory = continueCategory;
    }
    return hierarchy;
  }

  /**
   * Displays the planned insertions and asks for user confirmation.
   * @param {Array} data - The hierarchy data to be inserted.
   * @returns {Promise<boolean>} - A promise that resolves to true if confirmed, false otherwise.
   */
  async getConfirmation(data) {
    console.log('\n--- Review Proposed Hierarchy ---');
    data.forEach((cat, catIndex) => {
      console.log(`\nCategory ${catIndex + 1}: ${cat.category}`);
      if (cat.services.length > 0) {
        cat.services.forEach((svc, svcIndex) => {
          console.log(`  - Service ${svcIndex + 1}: ${svc}`);
        });
      } else {
        console.log('  (No services defined for this category)');
      }
    });
    console.log('\nThis script will write the above structure to the database.');

    const { confirm } = await inquirer.prompt([
      { type: 'confirm', name: 'confirm', message: 'Proceed with writing to the database?', default: false }
    ]);
    return confirm;
  }

  /**
   * Writes the hierarchy data to the ArangoDB database using a transaction.
   * @param {Array} data - The hierarchy data to insert.
   */
  async writeToDatabase(data) {
    console.log('\nAttempting to write data to the database...');

    const action = `
      function (params) {
        const { data } = params;
        const db = require('@arangodb').db;
        const serviceCategories = db.serviceCategories;
        const services = db.services;
        const categoryServices = db.categoryServices;
        
        let inserted = { categories: 0, services: 0, edges: 0 };
        let skipped = { categories: 0, services: 0 };
        let errors = [];

        // Determine starting keys and orders
        let lastCategory = serviceCategories.all().sort((a, b) => b.order - a.order).limit(1).toArray()[0];
        let lastService = services.all().sort((a,b) => parseInt(b._key) - parseInt(a._key)).limit(1).toArray()[0];

        let categoryOrder = lastCategory ? lastCategory.order + 1 : 1;
        let categoryKey = lastCategory ? parseInt(lastCategory._key) + 1 : 1;
        let serviceKey = lastService ? parseInt(lastService._key) + 1 : 101;

        data.forEach(catData => {
          // Check for existing category
          let existingCategory = serviceCategories.firstExample({ nameEN: catData.category });
          let currentCategoryKey;

          if (existingCategory) {
            skipped.categories++;
            currentCategoryKey = existingCategory._key;
          } else {
            const categoryDoc = {
              _key: String(categoryKey),
              nameEN: catData.category,
              order: categoryOrder,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            serviceCategories.save(categoryDoc);
            currentCategoryKey = categoryDoc._key;
            inserted.categories++;
            categoryKey++;
            categoryOrder++;
          }

          let serviceOrder = 1;
          catData.services.forEach(serviceName => {
            // Check for existing service
            let existingService = services.firstExample({ nameEN: serviceName, categoryId: currentCategoryKey });
            if (existingService) {
              skipped.services++;
            } else {
              const serviceDoc = {
                _key: String(serviceKey),
                categoryId: currentCategoryKey,
                nameEN: serviceName,
                order: serviceOrder,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };
              const newService = services.save(serviceDoc);
              inserted.services++;

              // Create edge
              const edgeDoc = {
                _from: 'serviceCategories/' + currentCategoryKey,
                _to: newService._id,
                createdAt: new Date().toISOString()
              };
              categoryServices.save(edgeDoc);
              inserted.edges++;
              
              serviceKey++;
              serviceOrder++;
            }
          });
        });

        return { inserted, skipped, errors };
      }
    `;

    try {
      const result = await this.db.transaction({
        collections: {
          write: ['serviceCategories', 'services', 'categoryServices']
        },
        action,
        params: { data }
      });

      console.log('\n--- Database Write Summary ---');
      console.log(`✓ Categories inserted: ${result.inserted.categories}`);
      console.log(`✓ Services inserted:   ${result.inserted.services}`);
      console.log(`✓ Edges created:       ${result.inserted.edges}`);
      console.log(`- Categories skipped (already exist): ${result.skipped.categories}`);
      console.log(`- Services skipped (already exist):   ${result.skipped.services}`);
      if (result.errors.length > 0) {
        console.error('✗ Errors encountered:', result.errors);
      }
      console.log('\n✓ Hierarchy creation completed successfully.');
    } catch (error) {
      console.error('✗ An error occurred during the database transaction:', error.message);
      throw error;
    }
  }

  /**
   * Main method to run the hierarchy creation process.
   */
  async run() {
    const argv = yargs(hideBin(process.argv)).option('file', {
      alias: 'f',
      type: 'string',
      description: 'Path to a JSON file with the hierarchy definition'
    }).argv;

    try {
      await this.ensureCollections();

      let hierarchyData;
      if (argv.file) {
        hierarchyData = await this.processFromFile(argv.file);
      } else {
        hierarchyData = await this.processInteractively();
      }

      if (!hierarchyData || hierarchyData.length === 0) {
        console.log('No hierarchy data provided. Exiting.');
        return;
      }

      const isConfirmed = await this.getConfirmation(hierarchyData);

      if (isConfirmed) {
        await this.writeToDatabase(hierarchyData);
      } else {
        console.log('Operation cancelled by user.');
      }
    } catch (error) {
      console.error('\n✗ Hierarchy creation failed:', error.message);
      process.exit(1);
    }
  }
}

async function main() {
  try {
    const creator = new HierarchyCreator();
    await creator.run();
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to initialize HierarchyCreator:', error.message);
    process.exit(1);
  }
}

main();