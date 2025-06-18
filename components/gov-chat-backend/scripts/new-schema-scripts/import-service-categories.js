// ArangoDB ServiceCategories, Services & CategoryServices Edge Data Import Script
// This script imports serviceCategories, services, and categoryServices edge collections from JSON file

const { Database } = require('arangojs');
const fs = require('fs').promises;
const path = require('path');

// =============================================================================
// DATABASE CONNECTION CONFIGURATION
// =============================================================================

const DB_CONFIG = {
  url: process.env.ARANGO_URL || 'http://localhost:8529',
  databaseName: process.env.ARANGO_DATABASE || 'test-node-services',
  auth: {
    username: process.env.ARANGO_USERNAME || 'root',
    password: process.env.ARANGO_PASSWORD || 'test'
  }
};

// Import configuration
const IMPORT_CONFIG = {
  inputFile: process.env.IMPORT_FILE || './exports/serviceCategoriesAndServices_export_2025-06-18T15-09-58.json',
  createDatabase: process.env.CREATE_DATABASE !== 'false', // default true
  createCollection: process.env.CREATE_COLLECTION !== 'false', // default true
  overwriteExisting: process.env.OVERWRITE_EXISTING === 'true' || false,
  batchSize: parseInt(process.env.BATCH_SIZE) || 100,
  validateBeforeImport: process.env.VALIDATE_BEFORE_IMPORT !== 'false', // default true
  schemaStrict: process.env.SCHEMA_STRICT === 'true' || true // only include original fields
};

let db;

// Initialize database connection
async function initializeDatabase() {
  try {
    console.log(`Connecting to ArangoDB at ${DB_CONFIG.url}...`);
    
    // First connect to system database to check/create target database
    db = new Database({
      url: DB_CONFIG.url,
      auth: DB_CONFIG.auth
    });
    
    // Test connection to system database first
    const systemInfo = await db.get();
    console.log(`✓ Connected to ArangoDB (version: ${systemInfo.version})`);
    
    return db;
  } catch (error) {
    console.error('✗ Failed to connect to database:', error.message);
    throw error;
  }
}

// Create target database if it doesn't exist
async function ensureTargetDatabase() {
  try {
    if (!IMPORT_CONFIG.createDatabase) {
      console.log('Skipping database creation (CREATE_DATABASE=false)');
      // Switch to target database
      db = new Database({
        url: DB_CONFIG.url,
        databaseName: DB_CONFIG.databaseName,
        auth: DB_CONFIG.auth
      });
      return;
    }
    
    console.log(`Checking if database '${DB_CONFIG.databaseName}' exists...`);
    
    const databases = await db.listDatabases();
    const databaseExists = databases.includes(DB_CONFIG.databaseName);
    
    if (!databaseExists) {
      console.log(`Creating database '${DB_CONFIG.databaseName}'...`);
      await db.createDatabase(DB_CONFIG.databaseName);
      console.log(`✓ Database '${DB_CONFIG.databaseName}' created successfully`);
    } else {
      console.log(`✓ Database '${DB_CONFIG.databaseName}' already exists`);
    }
    
    // Switch to target database by creating new connection
    db = new Database({
      url: DB_CONFIG.url,
      databaseName: DB_CONFIG.databaseName,
      auth: DB_CONFIG.auth
    });
    
    const info = await db.get();
    console.log(`✓ Using database: ${info.name}`);
    
  } catch (error) {
    console.error('✗ Error with target database:', error.message);
    throw error;
  }
}

// Create serviceCategories collection
async function createServiceCategoriesCollection() {
  try {
    const collection = db.collection('serviceCategories');
    const exists = await collection.exists();
    
    if (exists) {
      console.log('✓ serviceCategories collection already exists - using existing collection');
      return collection;
    }
    
    if (!IMPORT_CONFIG.createCollection) {
      throw new Error('serviceCategories collection does not exist and CREATE_COLLECTION=false');
    }
    
    console.log('Creating serviceCategories collection...');
    
    const newCollection = await db.createCollection('serviceCategories', {
      waitForSync: false,
      keyOptions: {}
    });
    
    console.log('✓ serviceCategories collection created');
    return newCollection;
    
  } catch (error) {
    console.error('✗ Error with serviceCategories collection:', error.message);
    throw error;
  }
}

// Create services collection
async function createServicesCollection() {
  try {
    const collection = db.collection('services');
    const exists = await collection.exists();
    
    if (exists) {
      console.log('✓ services collection already exists - using existing collection');
      return collection;
    }
    
    if (!IMPORT_CONFIG.createCollection) {
      throw new Error('services collection does not exist and CREATE_COLLECTION=false');
    }
    
    console.log('Creating services collection...');
    
    const newCollection = await db.createCollection('services', {
      waitForSync: false,
      keyOptions: {}
    });
    
    // Create indexes for services
    await newCollection.ensureIndex({
      type: "hash",
      fields: ["categoryId", "order"],
      unique: false,
      name: "idx_categoryId_order"
    });
    
    console.log('✓ services collection created with indexes');
    return newCollection;
    
  } catch (error) {
    console.error('✗ Error with services collection:', error.message);
    throw error;
  }
}

// Create categoryServices edge collection
async function createCategoryServicesCollection() {
  try {
    const collection = db.collection('categoryServices');
    const exists = await collection.exists();
    
    if (exists) {
      console.log('✓ categoryServices edge collection already exists - using existing collection');
      return collection;
    }
    
    if (!IMPORT_CONFIG.createCollection) {
      throw new Error('categoryServices edge collection does not exist and CREATE_COLLECTION=false');
    }
    
    console.log('Creating categoryServices edge collection...');
    
    const newCollection = await db.createCollection('categoryServices', {
      type: 3, // Edge collection type
      waitForSync: false,
      keyOptions: {}
    });
    
    // Create index for better performance
    await newCollection.ensureIndex({
      type: "skiplist",
      fields: ["createdAt"],
      name: "idx_createdAt"
    });
    
    console.log('✓ categoryServices edge collection created');
    return newCollection;
    
  } catch (error) {
    console.error('✗ Error with categoryServices edge collection:', error.message);
    throw error;
  }
}

// Read and validate import file
async function readImportFile() {
  try {
    console.log(`Reading import file: ${IMPORT_CONFIG.inputFile}`);
    
    // Check if file exists
    try {
      await fs.access(IMPORT_CONFIG.inputFile);
    } catch (error) {
      throw new Error(`Import file not found: ${IMPORT_CONFIG.inputFile}`);
    }
    
    // Read file content
    const fileContent = await fs.readFile(IMPORT_CONFIG.inputFile, 'utf8');
    const importData = JSON.parse(fileContent);
    
    console.log('Analyzing import file structure...');
    
    // Basic validation for different export formats
    if (!importData.metadata || !importData.data) {
      throw new Error('Invalid import file structure - missing metadata or data');
    }
    
    // Handle different format versions
    let serviceCategoriesData, servicesData, categoryServicesData;
    
    if (importData.metadata.exportVersion === '3.0' && importData.data.categoryServices) {
      // New format with edge collection
      serviceCategoriesData = importData.data.serviceCategories;
      servicesData = importData.data.services || [];
      categoryServicesData = importData.data.categoryServices || [];
      console.log('✓ Format v3.0 detected - importing serviceCategories, services, and categoryServices edges');
    } else if (importData.metadata.exportVersion === '2.0' && importData.data.serviceCategories) {
      // Format v2.0 without edge collection
      serviceCategoriesData = importData.data.serviceCategories;
      servicesData = importData.data.services || [];
      categoryServicesData = [];
      console.log('✓ Format v2.0 detected - importing serviceCategories and services (no edges)');
    } else if (Array.isArray(importData.data)) {
      // Old format - assume it's serviceCategories only
      serviceCategoriesData = importData.data;
      servicesData = [];
      categoryServicesData = [];
      console.log('⚠ Old format (v1.0) detected - importing serviceCategories only');
    } else {
      throw new Error('Invalid import file data structure - cannot determine format');
    }
    
    if (!Array.isArray(serviceCategoriesData) || !Array.isArray(servicesData) || !Array.isArray(categoryServicesData)) {
      throw new Error('Import data collections are not arrays');
    }
    
    console.log(`✓ Import file loaded successfully:`);
    console.log(`  - Source database: ${importData.metadata.sourceDatabase || 'unknown'}`);
    console.log(`  - Export date: ${importData.metadata.exportDate || 'unknown'}`);
    console.log(`  - Export version: ${importData.metadata.exportVersion || '1.0'}`);
    console.log(`  - ServiceCategories: ${serviceCategoriesData.length} documents`);
    console.log(`  - Services: ${servicesData.length} documents`);
    console.log(`  - CategoryServices: ${categoryServicesData.length} edges`);
    console.log(`  - Total: ${serviceCategoriesData.length + servicesData.length + categoryServicesData.length} items`);
    
    return {
      metadata: importData.metadata,
      serviceCategories: serviceCategoriesData,
      services: servicesData,
      categoryServices: categoryServicesData
    };
    
  } catch (error) {
    console.error('✗ Error reading import file:', error.message);
    throw error;
  }
}

// Validate import data
async function validateImportData(importData) {
  try {
    if (!IMPORT_CONFIG.validateBeforeImport) {
      console.log('Skipping data validation (VALIDATE_BEFORE_IMPORT=false)');
      return true;
    }
    
    console.log('Validating import data...');
    
    let errors = [];
    let warnings = [];
    
    // Validate serviceCategories
    console.log('Validating serviceCategories...');
    const categoryRequiredFields = ['_key', 'nameEN', 'order'];
    const categoryKeySet = new Set();
    
    importData.serviceCategories.forEach((doc, index) => {
      const missingFields = categoryRequiredFields.filter(field => !doc.hasOwnProperty(field) || doc[field] === null || doc[field] === undefined);
      if (missingFields.length > 0) {
        errors.push(`ServiceCategory ${index}: Missing required fields: ${missingFields.join(', ')}`);
      }
      
      if (doc._key) {
        if (categoryKeySet.has(doc._key)) {
          errors.push(`ServiceCategory ${index}: Duplicate _key: ${doc._key}`);
        } else {
          categoryKeySet.add(doc._key);
        }
      }
      
      if (doc.order !== undefined && typeof doc.order !== 'number') {
        warnings.push(`ServiceCategory ${index}: order field should be a number, got: ${typeof doc.order}`);
      }
    });
    
    // Validate services
    console.log('Validating services...');
    const serviceRequiredFields = ['_key', 'categoryId', 'nameEN', 'order'];
    const serviceKeySet = new Set();
    
    importData.services.forEach((doc, index) => {
      const missingFields = serviceRequiredFields.filter(field => !doc.hasOwnProperty(field) || doc[field] === null || doc[field] === undefined);
      if (missingFields.length > 0) {
        errors.push(`Service ${index}: Missing required fields: ${missingFields.join(', ')}`);
      }
      
      if (doc._key) {
        if (serviceKeySet.has(doc._key)) {
          errors.push(`Service ${index}: Duplicate _key: ${doc._key}`);
        } else {
          serviceKeySet.add(doc._key);
        }
      }
      
      if (doc.order !== undefined && typeof doc.order !== 'number') {
        warnings.push(`Service ${index}: order field should be a number, got: ${typeof doc.order}`);
      }
      
      // Check if categoryId references exist - handle both formats
      if (doc.categoryId) {
        let categoryRef = doc.categoryId;
        // Handle "serviceCategories/1" format by extracting just the key part
        if (categoryRef.includes('/')) {
          categoryRef = categoryRef.split('/')[1];
        }
        
        if (!categoryKeySet.has(categoryRef)) {
          warnings.push(`Service ${index}: categoryId '${doc.categoryId}' (extracted: '${categoryRef}') not found in serviceCategories`);
        }
      }
    });
    
    // Validate categoryServices edges
    console.log('Validating categoryServices edges...');
    const edgeRequiredFields = ['_from', '_to'];
    const edgeKeySet = new Set();
    
    importData.categoryServices.forEach((doc, index) => {
      const missingFields = edgeRequiredFields.filter(field => !doc.hasOwnProperty(field) || doc[field] === null || doc[field] === undefined);
      if (missingFields.length > 0) {
        errors.push(`CategoryServices edge ${index}: Missing required fields: ${missingFields.join(', ')}`);
      }
      
      // Validate _from points to a serviceCategory
      if (doc._from) {
        const fromKey = doc._from.split('/')[1];
        if (!categoryKeySet.has(fromKey)) {
          warnings.push(`CategoryServices edge ${index}: _from '${doc._from}' references non-existent serviceCategory`);
        }
      }
      
      // Validate _to points to a service
      if (doc._to) {
        const toKey = doc._to.split('/')[1];
        if (!serviceKeySet.has(toKey)) {
          warnings.push(`CategoryServices edge ${index}: _to '${doc._to}' references non-existent service`);
        }
      }
      
      // Check for duplicate edges
      const edgeKey = `${doc._from}-${doc._to}`;
      if (edgeKeySet.has(edgeKey)) {
        warnings.push(`CategoryServices edge ${index}: Duplicate edge from ${doc._from} to ${doc._to}`);
      } else {
        edgeKeySet.add(edgeKey);
      }
    });
    
    if (errors.length > 0) {
      console.error(`✗ Validation failed with ${errors.length} errors:`);
      errors.slice(0, 10).forEach(error => console.error(`  - ${error}`));
      if (errors.length > 10) {
        console.error(`  ... and ${errors.length - 10} more errors`);
      }
      return false;
    }
    
    if (warnings.length > 0) {
      console.log(`⚠ Validation completed with ${warnings.length} warnings:`);
      warnings.slice(0, 10).forEach(warning => console.log(`  - ${warning}`));
      if (warnings.length > 10) {
        console.log(`  ... and ${warnings.length - 10} more warnings`);
      }
    } else {
      console.log(`✓ Validation passed:`);
      console.log(`  - ServiceCategories: ${importData.serviceCategories.length} valid documents`);
      console.log(`  - Services: ${importData.services.length} valid documents`);
      console.log(`  - CategoryServices: ${importData.categoryServices.length} valid edges`);
    }
    
    return true;
    
  } catch (error) {
    console.error('✗ Error during validation:', error.message);
    return false;
  }
}

// Check for existing data conflicts
async function checkExistingData(collections, importData) {
  try {
    console.log('Checking existing data status...');
    
    const categoriesCount = await collections.serviceCategories.count();
    const servicesCount = await collections.services.count();
    const edgesCount = await collections.categoryServices.count();
    
    console.log(`Target collections currently have:`);
    console.log(`  - serviceCategories: ${categoriesCount.count} existing documents`);
    console.log(`  - services: ${servicesCount.count} existing documents`);
    console.log(`  - categoryServices: ${edgesCount.count} existing edges`);
    
    // Since we're now skipping duplicates instead of overwriting, we can always proceed
    console.log('✓ Import will skip any existing documents and only add new ones');
    
    return { conflicts: [], canProceed: true };
    
  } catch (error) {
    console.error('✗ Error checking existing data:', error.message);
    throw error;
  }
}

// Clean document based on schema requirements
function cleanDocument(doc, collectionName) {
  if (IMPORT_CONFIG.schemaStrict) {
    // Only include original schema fields for serviceCategories
    if (collectionName === 'serviceCategories') {
      const cleaned = {
        _key: doc._key,
        nameEN: doc.nameEN,
        order: doc.order
      };
      
      // Add optional fields if they exist and are not null
      if (doc.nameFR !== null && doc.nameFR !== undefined) {
        cleaned.nameFR = doc.nameFR;
      }
      if (doc.nameSW !== null && doc.nameSW !== undefined) {
        cleaned.nameSW = doc.nameSW;
      }
      
      return cleaned;
    } else if (collectionName === 'services') {
      // Only include original schema fields for services
      const cleaned = {
        _key: doc._key,
        categoryId: doc.categoryId,
        nameEN: doc.nameEN,
        order: doc.order
      };
      
      // Add optional fields if they exist and are not null
      if (doc.nameFR !== null && doc.nameFR !== undefined) {
        cleaned.nameFR = doc.nameFR;
      }
      if (doc.nameSW !== null && doc.nameSW !== undefined) {
        cleaned.nameSW = doc.nameSW;
      }
      if (doc.description !== null && doc.description !== undefined) {
        cleaned.description = doc.description;
      }
      
      return cleaned;
    } else if (collectionName === 'categoryServices') {
      // Only include required edge fields
      const cleaned = {
        _from: doc._from,
        _to: doc._to
      };
      
      // Add optional fields if they exist
      if (doc.order !== null && doc.order !== undefined) {
        cleaned.order = doc.order;
      }
      if (doc._key !== null && doc._key !== undefined) {
        cleaned._key = doc._key;
      }
      
      return cleaned;
    }
  } else {
    // Include all fields, clean nulls and add timestamps
    const cleanDoc = { ...doc };
    
    // Remove null values
    Object.keys(cleanDoc).forEach(key => {
      if (cleanDoc[key] === null) {
        delete cleanDoc[key];
      }
    });
    
    // Add timestamps if missing (not for edges)
    if (collectionName !== 'categoryServices') {
      const now = new Date().toISOString();
      if (!cleanDoc.createdAt) {
        cleanDoc.createdAt = now;
      }
      if (!cleanDoc.updatedAt) {
        cleanDoc.updatedAt = now;
      }
    }
    
    return cleanDoc;
  }
  
  return doc;
}

// Import documents for a single collection
async function importDocumentsForCollection(collection, documents, collectionName) {
  try {
    console.log(`\n=== Starting ${collectionName} import ===`);
    
    if (documents.length === 0) {
      console.log(`⚠ No ${collectionName} documents to import`);
      return { importedCount: 0, errorCount: 0, skippedCount: 0, errors: [] };
    }
    
    const totalDocs = documents.length;
    let importedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const errors = [];
    
    console.log(`${collectionName} import details:`);
    console.log(`  - Total documents to process: ${totalDocs}`);
    console.log(`  - Sample document:`, JSON.stringify(documents[0], null, 2));
    
    // Get existing document keys to avoid duplicates
    console.log(`Checking for existing ${collectionName} documents...`);
    const existingKeys = new Set();
    
    // For edges, we need to check unique combinations of _from and _to
    if (collectionName === 'categoryServices') {
      try {
        const existingCursor = await collection.all();
        const existingDocs = await existingCursor.all();
        existingDocs.forEach(doc => {
          const edgeKey = `${doc._from}-${doc._to}`;
          existingKeys.add(edgeKey);
        });
        console.log(`  - Found ${existingKeys.size} existing ${collectionName} edges`);
      } catch (error) {
        console.log(`  - Could not check existing edges: ${error.message}`);
      }
    } else {
      try {
        const existingCursor = await collection.all();
        const existingDocs = await existingCursor.all();
        existingDocs.forEach(doc => existingKeys.add(doc._key));
        console.log(`  - Found ${existingKeys.size} existing ${collectionName} documents`);
      } catch (error) {
        console.log(`  - Could not check existing documents: ${error.message}`);
      }
    }
    
    // Filter out documents that already exist
    const documentsToImport = documents.filter(doc => {
      if (collectionName === 'categoryServices') {
        const edgeKey = `${doc._from}-${doc._to}`;
        if (existingKeys.has(edgeKey)) {
          console.log(`  - Skipping existing edge from ${doc._from} to ${doc._to}`);
          skippedCount++;
          return false;
        }
      } else {
        if (existingKeys.has(doc._key)) {
          console.log(`  - Skipping existing ${collectionName} ${doc._key}: ${doc.nameEN || 'document already exists'}`);
          skippedCount++;
          return false;
        }
      }
      return true;
    });
    
    console.log(`  - Documents to import: ${documentsToImport.length}`);
    console.log(`  - Documents to skip: ${skippedCount}`);
    
    if (documentsToImport.length === 0) {
      console.log(`✓ All ${collectionName} documents already exist - nothing to import`);
      return { importedCount: 0, errorCount: 0, skippedCount, errors: [] };
    }
    
    // Clean documents based on schema requirements
    const cleanedDocs = documentsToImport.map(doc => cleanDocument(doc, collectionName));
    
    console.log(`  - Cleaned sample:`, JSON.stringify(cleanedDocs[0], null, 2));
    
    // Process in batches
    for (let i = 0; i < cleanedDocs.length; i += IMPORT_CONFIG.batchSize) {
      const batch = cleanedDocs.slice(i, i + IMPORT_CONFIG.batchSize);
      const batchNumber = Math.floor(i / IMPORT_CONFIG.batchSize) + 1;
      const totalBatches = Math.ceil(cleanedDocs.length / IMPORT_CONFIG.batchSize);
      
      console.log(`Processing ${collectionName} batch ${batchNumber}/${totalBatches} (${batch.length} documents)...`);
      
      try {
        // Use individual saves for better debugging
        for (let j = 0; j < batch.length; j++) {
          try {
            const result = await collection.save(batch[j], { 
              returnNew: false,
              returnOld: false,
              waitForSync: true
            });
            
            if (collectionName === 'categoryServices') {
              console.log(`    ✓ Edge ${batch[j]._from} → ${batch[j]._to} imported`);
            } else {
              console.log(`    ✓ ${collectionName} ${batch[j]._key}: ${batch[j].nameEN || 'imported'}`);
            }
            importedCount++;
            
          } catch (docError) {
            if (collectionName === 'categoryServices') {
              console.error(`    ✗ Failed edge ${batch[j]._from} → ${batch[j]._to}:`, docError.message);
            } else {
              console.error(`    ✗ Failed ${collectionName} ${batch[j]._key}:`, docError.message);
            }
            console.error(`    Document was:`, JSON.stringify(batch[j], null, 2));
            errorCount++;
            errors.push(`${collectionName} ${batch[j]._key || 'edge'}: ${docError.message}`);
          }
        }
        
        // Progress indicator
        const progress = Math.round((importedCount / cleanedDocs.length) * 100);
        console.log(`  ✓ ${collectionName} batch ${batchNumber} completed - Progress: ${progress}% (${importedCount}/${cleanedDocs.length})`);
        
      } catch (batchError) {
        console.error(`  ✗ ${collectionName} batch ${batchNumber} failed:`, batchError.message);
        errorCount += batch.length;
        errors.push(`${collectionName} batch ${batchNumber}: ${batchError.message}`);
      }
    }
    
    // Final count check
    const finalCount = await collection.count();
    console.log(`✓ ${collectionName} import completed:`);
    console.log(`  - Successfully imported: ${importedCount} documents`);
    console.log(`  - Skipped existing: ${skippedCount} documents`);
    console.log(`  - Errors: ${errorCount} documents`);
    console.log(`  - Final collection count: ${finalCount.count} documents`);
    
    return { importedCount, errorCount, skippedCount, errors };
    
  } catch (error) {
    console.error(`✗ Error during ${collectionName} import:`, error.message);
    throw error;
  }
}

// Import all data (serviceCategories first, then services, then edges)
async function importAllDocuments(collections, importData) {
  try {
    console.log('\n=== Starting import of all collections ===');
    
    // Import serviceCategories first (since services depend on them)
    const categoriesResult = await importDocumentsForCollection(
      collections.serviceCategories, 
      importData.serviceCategories, 
      'serviceCategories'
    );
    
    // Import services (which reference serviceCategories)
    const servicesResult = await importDocumentsForCollection(
      collections.services, 
      importData.services, 
      'services'
    );
    
    // Import categoryServices edges (which reference both categories and services)
    const edgesResult = await importDocumentsForCollection(
      collections.categoryServices,
      importData.categoryServices,
      'categoryServices'
    );
    
    const totalImported = categoriesResult.importedCount + servicesResult.importedCount + edgesResult.importedCount;
    const totalSkipped = categoriesResult.skippedCount + servicesResult.skippedCount + edgesResult.skippedCount;
    const totalErrors = categoriesResult.errorCount + servicesResult.errorCount + edgesResult.errorCount;
    const allErrors = [...categoriesResult.errors, ...servicesResult.errors, ...edgesResult.errors];
    
    console.log(`\n=== Combined Import Results ===`);
    console.log(`✓ ServiceCategories imported: ${categoriesResult.importedCount}`);
    console.log(`✓ ServiceCategories skipped: ${categoriesResult.skippedCount}`);
    console.log(`✓ Services imported: ${servicesResult.importedCount}`);
    console.log(`✓ Services skipped: ${servicesResult.skippedCount}`);
    console.log(`✓ CategoryServices edges imported: ${edgesResult.importedCount}`);
    console.log(`✓ CategoryServices edges skipped: ${edgesResult.skippedCount}`);
    console.log(`✓ Total items imported: ${totalImported}`);
    console.log(`✓ Total items skipped: ${totalSkipped}`);
    console.log(`${totalErrors > 0 ? '⚠' : '✓'} Total errors: ${totalErrors}`);
    
    if (allErrors.length > 0 && allErrors.length <= 10) {
      console.log('All errors encountered:');
      allErrors.forEach(error => console.log(`  - ${error}`));
    } else if (allErrors.length > 10) {
      console.log(`First 10 errors encountered:`);
      allErrors.slice(0, 10).forEach(error => console.log(`  - ${error}`));
      console.log(`  ... and ${allErrors.length - 10} more errors`);
    }
    
    return {
      serviceCategories: categoriesResult,
      services: servicesResult,
      categoryServices: edgesResult,
      totals: {
        importedCount: totalImported,
        skippedCount: totalSkipped,
        errorCount: totalErrors,
        errors: allErrors
      }
    };
    
  } catch (error) {
    console.error('✗ Error during import:', error.message);
    throw error;
  }
}

// Verify imported data
async function verifyImport(collections, originalData) {
  try {
    console.log('\n=== Verifying imported data ===');
    
    const categoriesFinalCount = await collections.serviceCategories.count();
    const servicesFinalCount = await collections.services.count();
    const edgesFinalCount = await collections.categoryServices.count();
    
    console.log(`Document counts:`);
    console.log(`  - Expected serviceCategories: ${originalData.serviceCategories.length}`);
    console.log(`  - Actual serviceCategories: ${categoriesFinalCount.count}`);
    console.log(`  - Expected services: ${originalData.services.length}`);
    console.log(`  - Actual services: ${servicesFinalCount.count}`);
    console.log(`  - Expected categoryServices edges: ${originalData.categoryServices.length}`);
    console.log(`  - Actual categoryServices edges: ${edgesFinalCount.count}`);
    
    // Sample verification for serviceCategories
    const categorySampleSize = Math.min(3, originalData.serviceCategories.length);
    const categorySampleKeys = originalData.serviceCategories.slice(0, categorySampleSize).map(doc => doc._key);
    
    console.log(`\nVerifying ${categorySampleSize} sample serviceCategories...`);
    let categoryVerifiedCount = 0;

    for (const key of categorySampleKeys) {
      try {
        const doc = await collections.serviceCategories.document(key);
        if (doc) {
          categoryVerifiedCount++;
          console.log(`  ✓ serviceCategory ${key}: ${doc.nameEN}`);
        }
      } catch (error) {
        console.log(`  ✗ serviceCategory ${key}: not found`);
      }
    }
    
    // Sample verification for services
    const serviceSampleSize = Math.min(3, originalData.services.length);
    const serviceSampleKeys = originalData.services.slice(0, serviceSampleSize).map(doc => doc._key);
    
    console.log(`\nVerifying ${serviceSampleSize} sample services...`);
    let serviceVerifiedCount = 0;
    
    for (const key of serviceSampleKeys) {
      try {
        const doc = await collections.services.document(key);
        if (doc) {
          serviceVerifiedCount++;
          console.log(`  ✓ service ${key}: ${doc.nameEN} (category: ${doc.categoryId})`);
        }
      } catch (error) {
        console.log(`  ✗ service ${key}: not found`);
      }
    }
    
    // Sample verification for categoryServices edges
    const edgeSampleSize = Math.min(3, originalData.categoryServices.length);
    const edgeSamples = originalData.categoryServices.slice(0, edgeSampleSize);
    
    console.log(`\nVerifying ${edgeSampleSize} sample categoryServices edges...`);
    let edgeVerifiedCount = 0;
    
    // Query to verify edges
    for (const edgeSample of edgeSamples) {
      try {
        const query = `
          FOR edge IN categoryServices
            FILTER edge._from == @from AND edge._to == @to
            RETURN edge
        `;
        const cursor = await db.query(query, { from: edgeSample._from, to: edgeSample._to });
        const results = await cursor.all();
        
        if (results.length > 0) {
          edgeVerifiedCount++;
          console.log(`  ✓ edge ${edgeSample._from} → ${edgeSample._to} found`);
        } else {
          console.log(`  ✗ edge ${edgeSample._from} → ${edgeSample._to} not found`);
        }
      } catch (error) {
        console.log(`  ✗ edge ${edgeSample._from} → ${edgeSample._to} verification failed: ${error.message}`);
      }
    }
    
    // Verify relationships with a sample query
    console.log('\nVerifying category-service relationships...');
    const relationshipQuery = `
      FOR cat IN serviceCategories
        LIMIT 2
        LET services = (
          FOR edge IN categoryServices
            FILTER edge._from == CONCAT('serviceCategories/', cat._key)
            FOR svc IN services
              FILTER svc._id == edge._to
              RETURN svc.nameEN
        )
        RETURN {
          category: cat.nameEN,
          serviceCount: LENGTH(services),
          sampleServices: services[* LIMIT 3]
        }
    `;
    
    try {
      const relCursor = await db.query(relationshipQuery);
      const relResults = await relCursor.all();
      
      console.log('Category-Service relationships:');
      relResults.forEach(result => {
        console.log(`  - ${result.category}: ${result.serviceCount} services`);
        if (result.sampleServices.length > 0) {
          console.log(`    Services: ${result.sampleServices.join(', ')}`);
        }
      });
    } catch (error) {
      console.log(`  ⚠ Could not verify relationships: ${error.message}`);
    }
    
    const categorySuccess = categorySampleSize === 0 || categoryVerifiedCount === categorySampleSize;
    const serviceSuccess = serviceSampleSize === 0 || serviceVerifiedCount === serviceSampleSize;
    const edgeSuccess = edgeSampleSize === 0 || edgeVerifiedCount === edgeSampleSize;
    const overallSuccess = categorySuccess && serviceSuccess && edgeSuccess;
    
    console.log(`\n${overallSuccess ? '✓' : '✗'} Verification ${overallSuccess ? 'passed' : 'failed'}`);
    console.log(`  - ServiceCategories: ${categoryVerifiedCount}/${categorySampleSize} samples found`);
    console.log(`  - Services: ${serviceVerifiedCount}/${serviceSampleSize} samples found`);
    console.log(`  - CategoryServices edges: ${edgeVerifiedCount}/${edgeSampleSize} samples found`);
    
    return overallSuccess;
    
  } catch (error) {
    console.error('✗ Error during verification:', error.message);
    return false;
  }
}

// Main import function
async function executeImport() {
  console.log('=== ArangoDB ServiceCategories, Services & CategoryServices Data Import ===\n');
  
  try {
    // Initialize database connection
    await initializeDatabase();
    
    // Read and validate import file
    const importData = await readImportFile();
    
    if (importData.serviceCategories.length === 0 && importData.services.length === 0 && importData.categoryServices.length === 0) {
      console.log('⚠ No data to import');
      return false;
    }
    
    // Validate import data
    const isValid = await validateImportData(importData);
    if (!isValid) {
      console.log('✗ Import aborted due to validation errors');
      return false;
    }
    
    // Ensure target database exists
    await ensureTargetDatabase();
    
    // Create collections
    const collections = {
      serviceCategories: await createServiceCategoriesCollection(),
      services: await createServicesCollection(),
      categoryServices: await createCategoryServicesCollection()
    };
    
    // Check for existing data conflicts
    const { conflicts, canProceed } = await checkExistingData(collections, importData);
    if (!canProceed) {
      console.log('✗ Import aborted due to existing data conflicts');
      return false;
    }
    
    // Perform import
    const importResult = await importAllDocuments(collections, importData);
    
    // Verify import
    const verificationSuccess = await verifyImport(collections, importData);
    
    console.log('\n=== Final Import Summary ===');
    console.log(`✓ Database: ${DB_CONFIG.databaseName}`);
    console.log(`✓ ServiceCategories imported: ${importResult.serviceCategories.importedCount}`);
    console.log(`✓ ServiceCategories skipped: ${importResult.serviceCategories.skippedCount}`);
    console.log(`✓ Services imported: ${importResult.services.importedCount}`);
    console.log(`✓ Services skipped: ${importResult.services.skippedCount}`);
    console.log(`✓ CategoryServices edges imported: ${importResult.categoryServices.importedCount}`);
    console.log(`✓ CategoryServices edges skipped: ${importResult.categoryServices.skippedCount}`);
    console.log(`✓ Total items imported: ${importResult.totals.importedCount}`);
    console.log(`✓ Total items skipped: ${importResult.totals.skippedCount}`);
    console.log(`${importResult.totals.errorCount > 0 ? '⚠' : '✓'} Total errors: ${importResult.totals.errorCount}`);
    console.log(`${verificationSuccess ? '✓' : '✗'} Verification: ${verificationSuccess ? 'passed' : 'failed'}`);
    
    const success = (importResult.totals.importedCount > 0 || importResult.totals.skippedCount > 0) && importResult.totals.errorCount === 0 && verificationSuccess;
    
    console.log('\n=== Next Steps ===');
    if (success) {
      console.log('1. Run your application tests against the new database');
      console.log('2. Consider running the translation migration script to add flexible translation support');
      console.log('3. Update your application configuration to use the new database');
      console.log('4. Verify the parent-child relationships between serviceCategories and services work correctly');
      console.log('5. Test that categoryServices edges properly link categories to their services');
    } else {
      console.log('1. Review the errors above');
      console.log('2. Fix the import file or configuration');
      console.log('3. Re-run the import script');
    }
    
    return success;
    
  } catch (error) {
    console.error('\n✗ Import failed:', error.message);
    return false;
  }
}

// Command line interface
if (require.main === module) {
  executeImport().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Import script crashed:', error);
    process.exit(1);
  });
}

module.exports = {
  executeImport,
  importAllDocuments,
  validateImportData,
  initializeDatabase,
  createServiceCategoriesCollection,
  createServicesCollection,
  createCategoryServicesCollection
};