#!/usr/bin/env node

const { Database } = require('arangojs');
const fs = require('fs').promises;

// Redirect all console output to both console and log file
let logBuffer = [];

function logToFile(message) {
  logBuffer.push(`${new Date().toISOString()}: ${message}`);
}

// Override console methods to capture all output
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = function(...args) {
  const message = args.join(' ');
  originalLog(...args);
  logToFile(`LOG: ${message}`);
};

console.error = function(...args) {
  const message = args.join(' ');
  originalError(...args);
  logToFile(`ERROR: ${message}`);
};

console.warn = function(...args) {
  const message = args.join(' ');
  originalWarn(...args);
  logToFile(`WARN: ${message}`);
};

class ArangoSchemaCreator {
  constructor(config) {
    this.db = new Database({
      url: config.url || 'http://localhost:8529',
      databaseName: config.database,
      auth: config.auth || { username: 'root', password: '' }
    });
  }

  async saveFullLog(outputPath) {
    await fs.writeFile(outputPath, logBuffer.join('\n'), 'utf8');
    originalLog(`Complete log saved to: ${outputPath}`);
  }

  convertSchemaFormat(schema) {
    // Convert from extracted format to ArangoDB format
    // Remove "optional" properties and handle them correctly
    function processProperties(properties, parentRequired = []) {
      if (!properties || typeof properties !== 'object') return { properties, required: parentRequired };
      
      const newProperties = {};
      const required = [...parentRequired];
      
      for (const [key, value] of Object.entries(properties)) {
        const newValue = { ...value };
        
        // Remove the optional flag and handle required status
        if (newValue.optional === true) {
          delete newValue.optional;
          // Don't add to required if it's optional
        } else {
          // Add to required if not optional and not already there
          if (!required.includes(key)) {
            required.push(key);
          }
        }
        
        // Remove other non-standard properties
        delete newValue.default;
        
        // Process nested objects
        if (newValue.type === 'object' && newValue.properties) {
          const nested = processProperties(newValue.properties, []);
          newValue.properties = nested.properties;
          if (nested.required && nested.required.length > 0) {
            newValue.required = nested.required;
          }
        }
        
        // Process array items
        if (newValue.type === 'array' && newValue.items) {
          if (newValue.items.type === 'object' && newValue.items.properties) {
            const nested = processProperties(newValue.items.properties, []);
            newValue.items.properties = nested.properties;
            if (nested.required && nested.required.length > 0) {
              newValue.items.required = nested.required;
            }
          }
        }
        
        newProperties[key] = newValue;
      }
      
      return { properties: newProperties, required };
    }
    
    const result = { ...schema };
    
    if (result.properties) {
      const processed = processProperties(result.properties, result.required || []);
      result.properties = processed.properties;
      result.required = processed.required;
    }
    
    return result;
  }

  async loadSchema(schemaPath) {
    const schemaContent = await fs.readFile(schemaPath, 'utf8');
    return JSON.parse(schemaContent);
  }

  async createSchema(schema) {
    console.log(`Creating schema for database: ${schema.database}`);
    
    try {
      await this.createCollections(schema.collections);
      await this.createIndexes(schema.collections);
      await this.createGraphs(schema.graphs);
      await this.createViews(schema.views);
      await this.createAnalyzers(schema.analyzers);
      await this.createFunctions(schema.functions);
      
      console.log('Schema creation completed successfully');
      await this.saveFullLog('./schema-creation-complete-log.txt');
    } catch (error) {
      console.error(`Error during schema creation: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
      await this.saveFullLog('./schema-creation-complete-log.txt');
      throw error;
    }
  }

  async createCollections(collections) {
    console.log('Creating collections...');
    
    for (const collectionSchema of collections) {
      try {
        const collection = this.db.collection(collectionSchema.name);
        
        const options = {
          type: collectionSchema.type === 'edge' ? 3 : 2,
          waitForSync: collectionSchema.properties.waitForSync,
          keyOptions: collectionSchema.properties.keyOptions
        };

        // Add cluster options if available
        if (collectionSchema.properties.shardKeys) {
          options.shardKeys = collectionSchema.properties.shardKeys;
          options.numberOfShards = collectionSchema.properties.numberOfShards;
          options.shardingStrategy = collectionSchema.properties.shardingStrategy;
          options.distributeShardsLike = collectionSchema.properties.distributeShardsLike;
          options.replicationFactor = collectionSchema.properties.replicationFactor;
          options.minReplicationFactor = collectionSchema.properties.minReplicationFactor;
        }

        // Add computed values if available
        if (collectionSchema.properties.computedValues && collectionSchema.properties.computedValues.length > 0) {
          options.computedValues = collectionSchema.properties.computedValues;
        }

        // Add schema validation if available
        if (collectionSchema.properties.schema && collectionSchema.properties.schema.rule) {
          try {
            console.log(`  Processing schema for ${collectionSchema.name}`);
            console.log(`  Original schema:`, JSON.stringify(collectionSchema.properties.schema.rule, null, 2));
            
            // Convert schema format to ArangoDB format
            const convertedSchema = this.convertSchemaFormat(collectionSchema.properties.schema.rule);
            console.log(`  Converted schema:`, JSON.stringify(convertedSchema, null, 2));
            
            // ArangoDB expects schema to be wrapped in a rule object
            options.schema = {
              rule: convertedSchema,
              level: collectionSchema.properties.schema.level || "none",
              message: collectionSchema.properties.schema.message || "Document does not match schema"
            };
            
            console.log(`  Final schema options:`, JSON.stringify(options.schema, null, 2));
            console.log(`  Adding schema validation to ${collectionSchema.name}`);
            console.log(`  Schema rule applied with ${Object.keys(convertedSchema.properties || {}).length} properties`);
            console.log(`  Required fields: ${(convertedSchema.required || []).join(', ')}`);
          } catch (schemaError) {
            console.error(`  Schema conversion failed for ${collectionSchema.name}: ${schemaError.message}`);
            console.error(`  Schema error stack: ${schemaError.stack}`);
            console.log(`  Creating collection without schema validation`);
          }
        } else {
          console.log(`  No schema validation for ${collectionSchema.name}`);
        }

        console.log(`  Creating collection with options:`, JSON.stringify(options, null, 2));
        await collection.create(options);
        console.log(`Created collection: ${collectionSchema.name}`);
      } catch (error) {
        if (error.code === 1207) { // Collection already exists
          console.log(`Collection already exists: ${collectionSchema.name}`);
        } else {
          console.error(`Error creating collection ${collectionSchema.name}: ${error.message}`);
          console.error(`Error details:`, JSON.stringify(error, null, 2));
          throw error;
        }
      }
    }
  }

  async createIndexes(collections) {
    console.log('Creating indexes...');
    
    for (const collectionSchema of collections) {
      const collection = this.db.collection(collectionSchema.name);
      
      for (const indexSchema of collectionSchema.indexes) {
        try {
          const indexOptions = {
            type: indexSchema.type,
            fields: indexSchema.fields,
            unique: indexSchema.unique,
            sparse: indexSchema.sparse,
            deduplicate: indexSchema.deduplicate
          };

          // Add type-specific options
          if (indexSchema.name) indexOptions.name = indexSchema.name;
          if (indexSchema.selectivityEstimate !== undefined) indexOptions.selectivityEstimate = indexSchema.selectivityEstimate;
          if (indexSchema.estimates !== undefined) indexOptions.estimates = indexSchema.estimates;
          if (indexSchema.minLength !== undefined) indexOptions.minLength = indexSchema.minLength;
          if (indexSchema.geoJson !== undefined) indexOptions.geoJson = indexSchema.geoJson;
          if (indexSchema.constraint !== undefined) indexOptions.constraint = indexSchema.constraint;
          if (indexSchema.expireAfter !== undefined) indexOptions.expireAfter = indexSchema.expireAfter;
          if (indexSchema.cacheEnabled !== undefined) indexOptions.cacheEnabled = indexSchema.cacheEnabled;
          if (indexSchema.storedValues && indexSchema.storedValues.length > 0) indexOptions.storedValues = indexSchema.storedValues;
          if (indexSchema.inBackground !== undefined) indexOptions.inBackground = indexSchema.inBackground;

          await collection.ensureIndex(indexOptions);
          console.log(`Created index on ${collectionSchema.name}: ${indexSchema.fields.join(', ')}`);
        } catch (error) {
          console.error(`Error creating index on ${collectionSchema.name}: ${error.message}`);
        }
      }
    }
  }

  async createGraphs(graphs) {
    console.log('Creating graphs...');
    
    for (const graphSchema of graphs) {
      try {
        const options = {
          edgeDefinitions: Array.isArray(graphSchema.edgeDefinitions) ? graphSchema.edgeDefinitions : [],
          orphanCollections: Array.isArray(graphSchema.orphanCollections) ? graphSchema.orphanCollections : []
        };

        // Add smart graph options if available
        if (graphSchema.isSmart) {
          options.isSmart = true;
          if (graphSchema.options.smartGraphAttribute) {
            options.smartGraphAttribute = graphSchema.options.smartGraphAttribute;
          }
          if (graphSchema.options.numberOfShards) {
            options.numberOfShards = graphSchema.options.numberOfShards;
          }
          if (graphSchema.options.replicationFactor) {
            options.replicationFactor = graphSchema.options.replicationFactor;
          }
          if (graphSchema.options.minReplicationFactor) {
            options.minReplicationFactor = graphSchema.options.minReplicationFactor;
          }
        }

        const graph = this.db.graph(graphSchema.name);
        await graph.create(options);
        console.log(`Created graph: ${graphSchema.name}`);
      } catch (error) {
        if (error.code === 1925) { // Graph already exists
          console.log(`Graph already exists: ${graphSchema.name}`);
        } else {
          console.error(`Error creating graph ${graphSchema.name}:`, error.message);
        }
      }
    }
  }

  async createViews(views) {
    console.log('Creating views...');
    
    for (const viewSchema of views) {
      try {
        const view = this.db.view(viewSchema.name);
        await view.create(viewSchema.properties, viewSchema.type);
        console.log(`Created view: ${viewSchema.name}`);
      } catch (error) {
        if (error.code === 1207) { // View already exists
          console.log(`View already exists: ${viewSchema.name}`);
        } else {
          console.error(`Error creating view ${viewSchema.name}:`, error);
        }
      }
    }
  }

  async createAnalyzers(analyzers) {
    console.log('Creating analyzers...');
    
    for (const analyzerSchema of analyzers) {
      try {
        await this.db.request({
          method: 'POST',
          path: '/_api/analyzer',
          body: {
            name: analyzerSchema.name,
            type: analyzerSchema.type,
            properties: analyzerSchema.properties,
            features: analyzerSchema.features
          }
        });
        console.log(`Created analyzer: ${analyzerSchema.name}`);
      } catch (error) {
        if (error.code === 1650) { // Analyzer already exists
          console.log(`Analyzer already exists: ${analyzerSchema.name}`);
        } else {
          console.error(`Error creating analyzer ${analyzerSchema.name}:`, error);
        }
      }
    }
  }

  async createFunctions(functions) {
    console.log('Creating AQL functions...');
    
    for (const functionSchema of functions) {
      try {
        await this.db.request({
          method: 'POST',
          path: '/_api/aqlfunction',
          body: {
            name: functionSchema.name,
            code: functionSchema.code,
            isDeterministic: functionSchema.isDeterministic
          }
        });
        console.log(`Created function: ${functionSchema.name}`);
      } catch (error) {
        if (error.code === 1582) { // Function already exists
          console.log(`Function already exists: ${functionSchema.name}`);
        } else {
          console.error(`Error creating function ${functionSchema.name}:`, error);
        }
      }
    }
  }
}

// Usage example
async function main() {
  const schemaPath = process.argv[2] || './arango-schema.json';
  
  const config = {
    url: 'http://localhost:8529',
    database: 'test-temp',
    auth: {
      username: 'root',
      password: 'test'
    }
  };

  const creator = new ArangoSchemaCreator(config);
  
  try {
    const schema = await creator.loadSchema(schemaPath);
    await creator.createSchema(schema);
    
    console.log('\nSchema creation completed!');
    
  } catch (error) {
    console.error('Schema creation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ArangoSchemaCreator;