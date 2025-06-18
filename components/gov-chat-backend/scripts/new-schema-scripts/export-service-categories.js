// ArangoDB ServiceCategories, Services & CategoryServices Edge Data Export Script
// This script exports serviceCategories, services, and categoryServices edge collections to JSON file

const { Database } = require('arangojs');
const fs = require('fs').promises;
const path = require('path');

// =============================================================================
// DATABASE CONNECTION CONFIGURATION
// =============================================================================

const DB_CONFIG = {
  url: process.env.ARANGO_URL || 'http://localhost:8529',
  databaseName: process.env.ARANGO_DATABASE || 'node-services',
  auth: {
    username: process.env.ARANGO_USERNAME || 'root',
    password: process.env.ARANGO_PASSWORD || 'test'
  }
};

// Export configuration
const EXPORT_CONFIG = {
  outputDir: process.env.EXPORT_DIR || './exports',
  filename: process.env.EXPORT_FILENAME || `serviceCategoriesAndServices_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`,
  includeSystemFields: process.env.INCLUDE_SYSTEM_FIELDS === 'true' || false,
  prettyPrint: process.env.PRETTY_PRINT !== 'false' // default true
};

let db;

// Initialize database connection
async function initializeDatabase() {
  try {
    console.log(`Connecting to ArangoDB at ${DB_CONFIG.url}...`);
    
    db = new Database({
      url: DB_CONFIG.url,
      databaseName: DB_CONFIG.databaseName,
      auth: DB_CONFIG.auth
    });
    
    // Test connection
    const info = await db.get();
    console.log(`✓ Connected to database: ${info.name} (version: ${info.version})`);
    
    return db;
  } catch (error) {
    console.error('✗ Failed to connect to database:', error.message);
    throw error;
  }
}

// Check if all collections exist and get info
async function validateCollections() {
  try {
    console.log('Validating collections...');
    
    const serviceCategoriesCollection = db.collection('serviceCategories');
    const servicesCollection = db.collection('services');
    const categoryServicesCollection = db.collection('categoryServices');
    
    const categoriesExists = await serviceCategoriesCollection.exists();
    const servicesExists = await servicesCollection.exists();
    const categoryServicesExists = await categoryServicesCollection.exists();
    
    console.log(`Collection existence check:`);
    console.log(`  - serviceCategories: ${categoriesExists ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - services: ${servicesExists ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - categoryServices: ${categoryServicesExists ? 'EXISTS' : 'MISSING'}`);
    
    if (!categoriesExists) {
      throw new Error('serviceCategories collection does not exist');
    }
    
    if (!servicesExists) {
      throw new Error('services collection does not exist');
    }
    
    if (!categoryServicesExists) {
      console.log('⚠ Warning: categoryServices edge collection does not exist - will export without edges');
    }
    
    const categoriesInfo = await serviceCategoriesCollection.get();
    const servicesInfo = await servicesCollection.get();
    const categoriesCount = await serviceCategoriesCollection.count();
    const servicesCount = await servicesCollection.count();
    
    let categoryServicesInfo = null;
    let categoryServicesCount = { count: 0 };
    
    if (categoryServicesExists) {
      categoryServicesInfo = await categoryServicesCollection.get();
      categoryServicesCount = await categoryServicesCollection.count();
    }
    
    console.log(`✓ Collections validated:`);
    console.log(`  - serviceCategories: ${categoriesInfo.type === 2 ? 'Document' : 'Edge'} collection with ${categoriesCount.count} documents`);
    console.log(`  - services: ${servicesInfo.type === 2 ? 'Document' : 'Edge'} collection with ${servicesCount.count} documents`);
    if (categoryServicesExists) {
      console.log(`  - categoryServices: ${categoryServicesInfo.type === 3 ? 'Edge' : 'Document'} collection with ${categoryServicesCount.count} edges`);
    }
    
    return { 
      serviceCategories: { collection: serviceCategoriesCollection, count: categoriesCount.count },
      services: { collection: servicesCollection, count: servicesCount.count },
      categoryServices: categoryServicesExists ? { collection: categoryServicesCollection, count: categoryServicesCount.count } : null
    };
  } catch (error) {
    console.error('✗ Error validating collections:', error.message);
    throw error;
  }
}

// Create export directory if it doesn't exist
async function ensureExportDirectory() {
  try {
    await fs.mkdir(EXPORT_CONFIG.outputDir, { recursive: true });
    console.log(`✓ Export directory ready: ${EXPORT_CONFIG.outputDir}`);
  } catch (error) {
    console.error('✗ Error creating export directory:', error.message);
    throw error;
  }
}

// Export all collections data
async function exportServiceCategoriesAndServices() {
  try {
    console.log('Starting export of serviceCategories, services, and categoryServices collections...');
    
    // Build AQL queries for all collections based on configuration
    let serviceCategoriesQuery, servicesQuery, categoryServicesQuery;
    
    if (!EXPORT_CONFIG.includeSystemFields) {
      serviceCategoriesQuery = `
        FOR doc IN serviceCategories
          SORT doc.order ASC
          RETURN {
            _key: doc._key,
            nameEN: doc.nameEN,
            nameFR: doc.nameFR,
            nameSW: doc.nameSW,
            order: doc.order,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
          }`;
      
      servicesQuery = `
        FOR doc IN services
          SORT doc.categoryId ASC, doc.order ASC
          RETURN {
            _key: doc._key,
            categoryId: doc.categoryId,
            nameEN: doc.nameEN,
            nameFR: doc.nameFR,
            nameSW: doc.nameSW,
            description: doc.description,
            order: doc.order,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
          }`;
          
      categoryServicesQuery = `
        FOR doc IN categoryServices
          SORT doc._from ASC, doc.order ASC
          RETURN {
            _key: doc._key,
            _from: doc._from,
            _to: doc._to,
            order: doc.order,
            createdAt: doc.createdAt
          }`;
    } else {
      serviceCategoriesQuery = `
        FOR doc IN serviceCategories
          SORT doc.order ASC
          RETURN doc`;
      
      servicesQuery = `
        FOR doc IN services
          SORT doc.categoryId ASC, doc.order ASC
          RETURN doc`;
          
      categoryServicesQuery = `
        FOR doc IN categoryServices
          SORT doc._from ASC, doc.order ASC
          RETURN doc`;
    }
    
    console.log('Executing export queries...');
    console.log('  - Executing serviceCategories query...');
    const serviceCategoriesCursor = await db.query(serviceCategoriesQuery);
    const serviceCategoriesDocuments = await serviceCategoriesCursor.all();
    console.log(`  ✓ Retrieved ${serviceCategoriesDocuments.length} serviceCategories documents`);
    
    console.log('  - Executing services query...');
    const servicesCursor = await db.query(servicesQuery);
    const servicesDocuments = await servicesCursor.all();
    console.log(`  ✓ Retrieved ${servicesDocuments.length} services documents`);
    
    // Handle categoryServices edge collection
    let categoryServicesDocuments = [];
    const categoryServicesExists = await db.collection('categoryServices').exists();
    
    if (categoryServicesExists) {
      console.log('  - Executing categoryServices query...');
      const categoryServicesCursor = await db.query(categoryServicesQuery);
      categoryServicesDocuments = await categoryServicesCursor.all();
      console.log(`  ✓ Retrieved ${categoryServicesDocuments.length} categoryServices edges`);
    } else {
      console.log('  ⚠ Skipping categoryServices - collection does not exist');
    }
    
    console.log(`Export data summary:`);
    console.log(`  - ServiceCategories: ${serviceCategoriesDocuments.length} documents`);
    console.log(`  - Services: ${servicesDocuments.length} documents`);
    console.log(`  - CategoryServices: ${categoryServicesDocuments.length} edges`);
    console.log(`  - Total: ${serviceCategoriesDocuments.length + servicesDocuments.length + categoryServicesDocuments.length} items`);
    
    // Show sample data for verification
    if (serviceCategoriesDocuments.length > 0) {
      console.log('Sample serviceCategory:', JSON.stringify(serviceCategoriesDocuments[0], null, 2));
    }
    if (servicesDocuments.length > 0) {
      console.log('Sample service:', JSON.stringify(servicesDocuments[0], null, 2));
    }
    if (categoryServicesDocuments.length > 0) {
      console.log('Sample categoryServices edge:', JSON.stringify(categoryServicesDocuments[0], null, 2));
    }
    
    // Prepare export data with metadata for all collections
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        sourceDatabase: DB_CONFIG.databaseName,
        sourceUrl: DB_CONFIG.url,
        collections: ['serviceCategories', 'services', 'categoryServices'],
        documentCounts: {
          serviceCategories: serviceCategoriesDocuments.length,
          services: servicesDocuments.length,
          categoryServices: categoryServicesDocuments.length
        },
        totalDocuments: serviceCategoriesDocuments.length + servicesDocuments.length + categoryServicesDocuments.length,
        includeSystemFields: EXPORT_CONFIG.includeSystemFields,
        exportVersion: '3.0' // Updated version to indicate categoryServices support
      },
      schemas: {
        serviceCategories: {
          type: "object",
          properties: {
            "_key": { type: "string" },
            "nameEN": { type: "string" },
            "nameFR": { type: "string", optional: true },
            "nameSW": { type: "string", optional: true },
            "order": { type: "number" }
          },
          required: ["_key", "nameEN", "order"]
        },
        services: {
          type: "object",
          properties: {
            "_key": { type: "string" },
            "categoryId": { type: "string" },
            "nameEN": { type: "string" },
            "nameFR": { type: "string", optional: true },
            "nameSW": { type: "string", optional: true },
            "description": { type: "string", optional: true },
            "order": { type: "number" }
          },
          required: ["_key", "categoryId", "nameEN", "order"]
        },
        categoryServices: {
          type: "object",
          properties: {
            "_from": { type: "string" },
            "_to": { type: "string" },
            "order": { type: "number", optional: true }
          },
          required: ["_from", "_to"]
        }
      },
      data: {
        serviceCategories: serviceCategoriesDocuments,
        services: servicesDocuments,
        categoryServices: categoryServicesDocuments
      }
    };
    
    // Write to file
    const filePath = path.join(EXPORT_CONFIG.outputDir, EXPORT_CONFIG.filename);
    const jsonData = EXPORT_CONFIG.prettyPrint 
      ? JSON.stringify(exportData, null, 2)
      : JSON.stringify(exportData);
    
    console.log('Writing export file...');
    await fs.writeFile(filePath, jsonData, 'utf8');
    
    console.log(`✓ Export completed successfully`);
    console.log(`  - File: ${filePath}`);
    console.log(`  - Size: ${Math.round(jsonData.length / 1024)} KB`);
    console.log(`  - ServiceCategories: ${serviceCategoriesDocuments.length} documents`);
    console.log(`  - Services: ${servicesDocuments.length} documents`);
    console.log(`  - CategoryServices: ${categoryServicesDocuments.length} edges`);
    console.log(`  - Total items: ${serviceCategoriesDocuments.length + servicesDocuments.length + categoryServicesDocuments.length}`);
    
    return {
      filePath,
      documentCounts: {
        serviceCategories: serviceCategoriesDocuments.length,
        services: servicesDocuments.length,
        categoryServices: categoryServicesDocuments.length
      },
      totalDocuments: serviceCategoriesDocuments.length + servicesDocuments.length + categoryServicesDocuments.length,
      fileSize: jsonData.length
    };
    
  } catch (error) {
    console.error('✗ Error during export:', error.message);
    throw error;
  }
}

// Generate export summary
async function generateExportSummary(exportResult) {
  try {
    console.log('Generating export summary...');
    
    const summaryData = {
      export: exportResult,
      timestamp: new Date().toISOString(),
      config: EXPORT_CONFIG,
      database: {
        url: DB_CONFIG.url,
        name: DB_CONFIG.databaseName
      }
    };
    
    const summaryPath = path.join(
      EXPORT_CONFIG.outputDir, 
      `export_summary_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
    );
    
    await fs.writeFile(summaryPath, JSON.stringify(summaryData, null, 2), 'utf8');
    console.log(`✓ Export summary saved: ${summaryPath}`);
    
  } catch (error) {
    console.error('⚠ Failed to generate export summary:', error.message);
  }
}

// Validate exported data
async function validateExportedData(filePath) {
  try {
    console.log('\nValidating exported data...');
    
    const fileContent = await fs.readFile(filePath, 'utf8');
    const exportData = JSON.parse(fileContent);
    
    console.log('Checking export file structure...');
    
    // Basic validation
    if (!exportData.metadata || !exportData.data) {
      throw new Error('Invalid export file structure - missing metadata or data');
    }
    
    if (!exportData.data.serviceCategories || !exportData.data.services) {
      throw new Error('Missing serviceCategories or services data in export file');
    }
    
    // categoryServices is optional (might not exist in source)
    if (!exportData.data.categoryServices) {
      console.log('⚠ categoryServices data not present in export (collection may not exist in source)');
    }
    
    if (!Array.isArray(exportData.data.serviceCategories) || !Array.isArray(exportData.data.services)) {
      throw new Error('Export data collections are not arrays');
    }
    
    if (exportData.data.categoryServices && !Array.isArray(exportData.data.categoryServices)) {
      throw new Error('categoryServices data is not an array');
    }
    
    console.log('Validating document structure...');
    
    // Validate serviceCategories documents
    const categoryRequiredFields = ['_key', 'nameEN', 'order'];
    const invalidCategories = [];
    
    exportData.data.serviceCategories.forEach((doc, index) => {
      const missingFields = categoryRequiredFields.filter(field => !doc.hasOwnProperty(field));
      if (missingFields.length > 0) {
        invalidCategories.push({ index, missingFields });
      }
    });
    
    // Validate services documents
    const serviceRequiredFields = ['_key', 'categoryId', 'nameEN', 'order'];
    const invalidServices = [];
    
    exportData.data.services.forEach((doc, index) => {
      const missingFields = serviceRequiredFields.filter(field => !doc.hasOwnProperty(field));
      if (missingFields.length > 0) {
        invalidServices.push({ index, missingFields });
      }
    });
    
    // Validate categoryServices edges if present
    const edgeRequiredFields = ['_from', '_to'];
    const invalidEdges = [];
    
    if (exportData.data.categoryServices) {
      exportData.data.categoryServices.forEach((doc, index) => {
        const missingFields = edgeRequiredFields.filter(field => !doc.hasOwnProperty(field));
        if (missingFields.length > 0) {
          invalidEdges.push({ index, missingFields });
        }
      });
    }
    
    if (invalidCategories.length > 0) {
      console.error(`✗ Found ${invalidCategories.length} invalid serviceCategory documents:`, invalidCategories.slice(0, 5));
      return false;
    }
    
    if (invalidServices.length > 0) {
      console.error(`✗ Found ${invalidServices.length} invalid service documents:`, invalidServices.slice(0, 5));
      return false;
    }
    
    if (invalidEdges.length > 0) {
      console.error(`✗ Found ${invalidEdges.length} invalid categoryServices edges:`, invalidEdges.slice(0, 5));
      return false;
    }
    
    console.log(`✓ Validation passed:`);
    console.log(`  - ServiceCategories: ${exportData.data.serviceCategories.length} valid documents`);
    console.log(`  - Services: ${exportData.data.services.length} valid documents`);
    console.log(`  - CategoryServices: ${exportData.data.categoryServices ? exportData.data.categoryServices.length : 0} valid edges`);
    console.log(`  - Export date: ${exportData.metadata.exportDate}`);
    console.log(`  - Source database: ${exportData.metadata.sourceDatabase}`);
    console.log(`  - Export version: ${exportData.metadata.exportVersion}`);
    
    return true;
    
  } catch (error) {
    console.error('✗ Validation failed:', error.message);
    return false;
  }
}

// Main export function
async function executeExport() {
  console.log('=== ArangoDB ServiceCategories, Services & CategoryServices Data Export ===\n');
  
  try {
    // Initialize database connection
    await initializeDatabase();
    
    // Validate all collections exist
    const collections = await validateCollections();
    
    if (collections.serviceCategories.count === 0 && collections.services.count === 0) {
      console.log('⚠ Both main collections are empty, nothing to export');
      return false;
    }
    
    // Ensure export directory exists
    await ensureExportDirectory();
    
    // Perform export of all collections
    const exportResult = await exportServiceCategoriesAndServices();
    
    // Validate exported data
    const isValid = await validateExportedData(exportResult.filePath);
    
    if (isValid) {
      // Generate summary
      await generateExportSummary(exportResult);
    }
    
    console.log('\n=== Export Summary ===');
    console.log(`✓ Export completed ${isValid ? 'successfully' : 'with warnings'}`);
    console.log(`✓ File: ${exportResult.filePath}`);
    console.log(`✓ ServiceCategories: ${exportResult.documentCounts.serviceCategories} documents`);
    console.log(`✓ Services: ${exportResult.documentCounts.services} documents`);
    console.log(`✓ CategoryServices: ${exportResult.documentCounts.categoryServices} edges`);
    console.log(`✓ Total items: ${exportResult.totalDocuments}`);
    console.log(`✓ File size: ${Math.round(exportResult.fileSize / 1024)} KB`);
    
    console.log('\n=== Usage ===');
    console.log('Use the generated file with the import script to restore all collections to another database.');
    console.log(`Filename for import: ${path.basename(exportResult.filePath)}`);
    
    return true;
    
  } catch (error) {
    console.error('\n✗ Export failed:', error.message);
    return false;
  }
}

// Command line interface
if (require.main === module) {
  executeExport().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Export script crashed:', error);
    process.exit(1);
  });
}

module.exports = {
  executeExport,
  exportServiceCategoriesAndServices,
  validateExportedData,
  initializeDatabase
};