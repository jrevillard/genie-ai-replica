require('dotenv').config();
const { createLogger, format, transports } = require('winston');
const fs = require('fs').promises;
const path = require('path');
const { Database, aql } = require('arangojs');

// Initialize ArangoDB connection
const dbService = require('../utils/db-connect-service');

const initDB = dbService.getConnection();

// Set up Winston logger (consistent with other files)
const logFormat = format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        logFormat
    ),
    transports: [
        new transports.Console(),
        new transports.File({ filename: 'logs/error.log', level: 'error' }),
        new transports.File({ filename: 'logs/combined.log' })
    ],
});

class DatabaseOperationsService {
    constructor() {
        this.db = initDB;
        
        // Use environment variables for backup configuration
        this.backupDir = process.env.BACKUP_DIR || path.join(process.cwd(), 'database_backups');
        this.maxBackups = parseInt(process.env.MAX_BACKUPS || '5', 10);
        this.backupFormat = process.env.BACKUP_FORMAT || 'json'; // json or jsonl format
        this.compressBackups = process.env.COMPRESS_BACKUPS === 'true';
        
        // App name from environment for backup file naming
        this.appName = process.env.APP_NAME || 'huduma';

        // Create backup directory if it doesn't exist
        this._ensureBackupDirectoryExists();

        logger.info('DatabaseOperationsService initialized');
        logger.info(`Using backup directory: ${this.backupDir}`);
        logger.info(`Max backups retained: ${this.maxBackups}`);
        logger.info(`Backup format: ${this.backupFormat}`);
        logger.info(`Compress backups: ${this.compressBackups}`);
    }

    // Ensure backup directory exists
    async _ensureBackupDirectoryExists() {
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
            logger.info(`Backup directory created/verified: ${this.backupDir}`);
        } catch (error) {
            logger.error(`Error creating backup directory: ${error.message}`, error);
        }
    }

    async reindexDatabase() {
        try {
          logger.info('Starting database reindexing');
          
          // Get all collections
          const collections = await this.db.collections();
          const reindexResults = [];
      
          for (const collection of collections) {
            try {
              // Get the collection name
              const collectionName = collection.name;
              
              // Retrieve existing indexes using collection method
              const existingIndexes = await collection.indexes();
              
              // Remove existing non-primary indexes
              for (const index of existingIndexes) {
                try {
                  // Skip primary index
                  if (index.type === 'primary') continue;
                  
                  await collection.dropIndex(index.id);
                  logger.info(`Dropped index ${index.id} from collection ${collectionName}`);
                } catch (dropError) {
                  logger.warn(`Error dropping index ${index.id} for collection ${collectionName}:`, dropError);
                }
              }
              
              // Recreate indexes
              const recreatedIndexes = await this._recreateCollectionIndexes(collection);
              
              reindexResults.push({
                collection: collectionName,
                status: 'success',
                indexesRecreated: recreatedIndexes.length
              });
              
              logger.info(`Reindexed collection: ${collectionName}`);
            } catch (collectionError) {
              logger.error(`Reindexing error for collection ${collection.name}:`, collectionError);
              
              reindexResults.push({
                collection: collection.name,
                status: 'error',
                error: collectionError.message
              });
            }
          }
          
          // Save the reindex timestamp
          await this._saveReindexTimestamp();
          
          logger.info('Database reindexing completed');
          return {
            success: true,
            message: 'Database reindexing completed',
            results: reindexResults
          };
        } catch (error) {
          logger.error('Overall database reindexing error:', error);
          return {
            success: false,
            message: 'Failed to reindex database',
            error: error.message
          };
        }
      }
      
    // Helper method to recreate indexes for a collection
    async _recreateCollectionIndexes(collection) {
        try {
            const indexCreationResults = [];
            const collectionName = collection.name;
            
            logger.info(`Starting index recreation for collection: ${collectionName}`);
        
            // General index creation strategy
            const indexDefinitions = {
                'users': [
                {
                    type: 'hash',
                    fields: ['email'],
                    unique: true,
                    name: 'email_unique_index'
                },
                {
                    type: 'skiplist',
                    fields: ['createdAt'],
                    name: 'users_created_at_index'
                }
                ],
                'sessions': [
                {
                    type: 'hash',
                    fields: ['userId', 'createdAt'],
                    name: 'user_session_index'
                }
                ],
                'userSessions': [
                {
                    type: 'hash',
                    fields: ['userId', 'createdAt'],
                    name: 'user_session_index'
                }
                ],
                'serviceCategories': [
                {
                    type: 'skiplist',
                    fields: ['catCode', 'order'],
                    name: 'category_order_index'
                }
                ],
                'services': [
                {
                    type: 'hash',
                    fields: ['categoryId', 'order'],
                    name: 'service_category_order_index'
                }
                ]
            };
        
            // Get index definitions for this collection, or use a default createdAt index
            const collectionIndexes = indexDefinitions[collectionName] || [
                {
                type: 'skiplist',
                fields: ['createdAt'],
                name: `${collectionName}_created_at_index`
                }
            ];
        
            // Create indexes for the collection
            for (const indexDef of collectionIndexes) {
                try {
                logger.info(`Creating index for ${collectionName}: ${JSON.stringify(indexDef)}`);
                
                // Validate index definition
                if (!indexDef.fields || indexDef.fields.length === 0) {
                    logger.warn(`Skipping invalid index definition for ${collectionName}`);
                    continue;
                }
        
                // Construct index parameters
                const indexParams = {
                    type: indexDef.type,
                    fields: indexDef.fields
                };
        
                // Add unique constraint if specified
                if (indexDef.unique) {
                    indexParams.unique = true;
                }
        
                // Use ensureIndex method
                await collection.ensureIndex(indexParams);
                
                indexCreationResults.push({
                    name: indexDef.name,
                    type: indexDef.type,
                    fields: indexDef.fields
                });
                
                logger.info(`Successfully created index ${indexDef.name} for ${collectionName}`);
                } catch (indexError) {
                logger.error(`Error creating index ${indexDef.name} for ${collectionName}:`, indexError);
                }
            }
        
            logger.info(`Completed index creation for ${collectionName}. Created ${indexCreationResults.length} indexes.`);
            
            return indexCreationResults;
        } catch (error) {
            logger.error(`Comprehensive error in index recreation for ${collection.name}:`, error);
            return [];
        }
    }

    /**
     * Save reindex timestamp to a file
     * @returns {Promise<void>}
     */
    async _saveReindexTimestamp() {
        try {
            const timestamp = new Date().toISOString();
            const reindexTrackingFile = path.join(process.cwd(), 'logs', 'last_reindex.txt');
            
            await fs.writeFile(reindexTrackingFile, timestamp);
            logger.info(`Saved reindex timestamp: ${timestamp}`);
        } catch (error) {
            logger.error('Error saving reindex timestamp:', error);
        }
    }

    /**
 * Backup Database
 * @returns {Promise<Object>} Backup results
 */
  async backupDatabase() {
    try {
      logger.info('Starting database backup');

      // We need to use the standard fs module for stream operations
      const fsStandard = require('fs');

      // Format timestamp for the filename
      const timestamp = new Date().toISOString()
        .replace(/:/g, '-')
        .replace(/\..+/, '');

      // Create filename based on app name from environment
      const filenameBase = `${this.appName.toLowerCase()}_backup_${timestamp}`;
      const backupFilename = `${filenameBase}.${this.backupFormat}`;
      const backupPath = path.join(this.backupDir, backupFilename);

      // Get all collections
      const collections = await this.db.collections();

      // Get database info to include in backup metadata
      const dbInfo = {
        name: process.env.ARANGO_DB,
        version: await this.db.version(),
        timestamp: timestamp,
        environment: process.env.NODE_ENV,
        collections: collections.map(c => c.name)
      };

      // Create a backup stream with standard fs module
      const writeStream = fsStandard.createWriteStream(backupPath);

      // Write metadata if using JSON format
      if (this.backupFormat === 'json') {
        writeStream.write('{\n');
        writeStream.write(`  "_metadata": ${JSON.stringify(dbInfo, null, 2)},\n`);
      }

      // Backup data for each collection
      let collectionCount = 0;
      for (const collection of collections) {
        const collectionName = collection.name;

        // Get the documents from the collection
        const cursor = await collection.all();
        const documents = await cursor.all();

        logger.info(`Backing up collection: ${collectionName} (${documents.length} documents)`);

        // Write to file based on format
        if (this.backupFormat === 'json') {
          // JSON format (pretty-printed)
          if (collectionCount > 0) {
            writeStream.write(',\n');
          }
          writeStream.write(`  "${collectionName}": ${JSON.stringify(documents, null, 2)}`);
        } else {
          // JSON Lines format (one document per line)
          writeStream.write(`{"collection":"${collectionName}","data":${JSON.stringify(documents)}}\n`);
        }

        collectionCount++;
      }

      // Close JSON object if using JSON format
      if (this.backupFormat === 'json') {
        writeStream.write('\n}');
      }

      // Close the stream
      writeStream.end();

      // Wait for stream to finish
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Calculate file size
      const stats = await fs.stat(backupPath);
      const fileSize = this._formatSize(stats.size);

      // Compress if configured
      let finalPath = backupPath;
      if (this.compressBackups) {
        finalPath = await this._compressBackup(backupPath);

        // Delete the original uncompressed file
        await fs.unlink(backupPath);

        // Get compressed file size
        const compressedStats = await fs.stat(finalPath);
        const compressedSize = this._formatSize(compressedStats.size);

        logger.info(`Backup compressed: ${fileSize} -> ${compressedSize}`);
      }

      // Clean up old backups
      await this._cleanupOldBackups();

      // Get relative path for display
      const relativeBackupPath = path.relative(process.cwd(), finalPath);

      logger.info(`Database backup completed: ${relativeBackupPath} (${fileSize})`);
      return {
        success: true,
        message: 'Database backup completed',
        backupFile: path.basename(finalPath),
        backupLocation: relativeBackupPath,
        size: fileSize,
        collections: collectionCount,
        timestamp: timestamp,
        compressed: this.compressBackups
      };
    } catch (error) {
      logger.error('Database backup error:', error);
      return {
        success: false,
        message: 'Failed to backup database',
        error: error.message
      };
    }
  }
    
    /**
 * Compress a backup file using gzip
 * @param {string} filePath - Path to the file to compress
 * @returns {Promise<string>} Path to the compressed file
 */
  async _compressBackup(filePath) {
    try {
      const { createGzip } = require('zlib');
      // Use standard fs for streams
      const fsStandard = require('fs');
      const { pipeline } = require('stream');
      const { promisify } = require('util');

      // Promisify the pipeline function
      const pipelineAsync = promisify(pipeline);

      const compressedPath = `${filePath}.gz`;

      // Create read/write streams with standard fs
      const readStream = fsStandard.createReadStream(filePath);
      const writeStream = fsStandard.createWriteStream(compressedPath);

      // Compress
      await pipelineAsync(readStream, createGzip(), writeStream);

      logger.info(`File compressed: ${filePath} -> ${compressedPath}`);
      return compressedPath;
    } catch (error) {
      logger.error('Error compressing backup:', error);
      return filePath; // Return original file path if compression fails
    }
  }
    
    /**
     * Clean up old backups, keeping only the most recent ones
     * @returns {Promise<void>}
     */
    async _cleanupOldBackups() {
        try {
            if (this.maxBackups <= 0) {
                logger.info('Backup cleanup disabled (maxBackups <= 0)');
                return;
            }
            
            // Get all files in the backup directory
            const files = await fs.readdir(this.backupDir);
            
            // Filter backup files
            const backupExtensions = [this.backupFormat];
            if (this.compressBackups) {
                backupExtensions.push(`${this.backupFormat}.gz`);
            }
            
            // Find backup files matching pattern
            const backupPattern = new RegExp(`^${this.appName.toLowerCase()}_backup_.*\\.(${backupExtensions.join('|')})$`);
            const backupFiles = files
                .filter(file => backupPattern.test(file))
                .map(file => ({
                    name: file,
                    path: path.join(this.backupDir, file),
                    time: fs.stat(path.join(this.backupDir, file)).then(stat => stat.mtime.getTime())
                }));
                
            // If we have more backups than the max, delete the oldest ones
            if (backupFiles.length <= this.maxBackups) {
                logger.info(`No backup cleanup needed. Current: ${backupFiles.length}, Max: ${this.maxBackups}`);
                return;
            }
            
            // Get file stats and sort by modification time (newest first)
            const backupsWithTimes = await Promise.all(
                backupFiles.map(async file => ({
                    ...file,
                    time: await file.time
                }))
            );
            
            // Sort by time, newest first
            backupsWithTimes.sort((a, b) => b.time - a.time);
            
            // Delete all but the newest maxBackups
            const filesToDelete = backupsWithTimes.slice(this.maxBackups);
            
            for (const file of filesToDelete) {
                try {
                    await fs.unlink(file.path);
                    logger.info(`Deleted old backup: ${file.name}`);
                } catch (unlinkError) {
                    logger.error(`Error deleting old backup ${file.name}:`, unlinkError);
                }
            }
            
            logger.info(`Backup cleanup completed. Deleted ${filesToDelete.length} old backups.`);
        } catch (error) {
            logger.error('Error during backup cleanup:', error);
        }
    }

    /**
     * Optimize Database
     * @returns {Promise<Object>} Optimization results
     */
    async optimizeDatabase() {
        try {
            logger.info('Starting database optimization');

            // Collect optimization results
            const optimizationResults = [];

            // Get all collections
            const collections = await this.db.collections();

            for (const collection of collections) {
                try {
                    // Compact the collection
                    await collection.compact();

                    // Analyze and suggest index improvements
                    const indexAnalysis = await this._analyzeIndexes(collection);

                    optimizationResults.push({
                        collection: collection.name,
                        status: 'success',
                        indexSuggestions: indexAnalysis
                    });

                    logger.info(`Optimized collection: ${collection.name}`);
                } catch (collectionError) {
                    logger.error(`Optimization error for collection ${collection.name}:`, collectionError);

                    optimizationResults.push({
                        collection: collection.name,
                        status: 'error',
                        error: collectionError.message
                    });
                }
            }

            logger.info('Database optimization completed');
            return {
                success: true,
                message: 'Database optimization completed',
                results: optimizationResults
            };
        } catch (error) {
            logger.error('Overall database optimization error:', error);
            return {
                success: false,
                message: 'Failed to optimize database',
                error: error.message
            };
        }
    }

    /**
     * Analyze indexes for a collection
     * @param {Object} collection - ArangoDB collection
     * @returns {Promise<Array>} Index analysis results
     */
    async _analyzeIndexes(collection) {
        try {
            const indexes = await collection.indexes();
            const analysis = [];

            indexes.forEach(index => {
                // Example suggestions (customize based on specific use case)
                if (index.type === 'hash' && index.selectivityEstimate < 0.5) {
                    analysis.push(
                        `Low selectivity for hash index on ${index.fields.join(', ')}`
                    );
                }

                if (index.type === 'skiplist' && index.fields.length > 3) {
                    analysis.push(
                        `Consider breaking down complex multi-field skiplist index on ${index.fields.join(', ')}`
                    );
                }
            });

            return analysis;
        } catch (error) {
            logger.error('Error analyzing indexes:', error);
            return [];
        }
    }
    
    /**
     * Get database statistics
     * @returns {Promise<Object>} Database statistics
     */
    async getDatabaseStats() {
        try {
            logger.info('Fetching database statistics');
            
            // Get all collections
            const collections = await this.db.collections();
            
            // Get server statistics
            const stats = await this.db.route('/_api/statistics').get();
            
            // Get database information
            const dbInfo = await this.db.get();
            
            // Calculate total database size
            let totalSize = 0;
            const collectionStats = [];
            
            for (const collection of collections) {
                const figures = await collection.figures();
                
                if (figures && figures.figures) {
                    // Add this collection's size to total
                    totalSize += figures.figures.documentsSize || 0;
                    
                    // Store collection stats
                    collectionStats.push({
                        name: collection.name,
                        count: figures.figures.alive || 0,
                        size: this._formatSize(figures.figures.documentsSize || 0)
                    });
                }
            }
            
            // Get last reindex time from logs or use a default value
            const lastReindex = await this._getLastReindexTime();
            
            // Format total size as human-readable
            const formattedSize = this._formatSize(totalSize);
            
            return {
                success: true,
                databaseSize: formattedSize,
                totalTables: collections.length,
                lastReindex: lastReindex,
                collections: collectionStats,
                systemStats: stats ? stats.body : null,
                server: {
                    name: process.env.ARANGO_URL,
                    database: process.env.ARANGO_DB,
                    environment: process.env.NODE_ENV
                }
            };
        } catch (error) {
            logger.error('Error getting database stats:', error);
            return {
                success: false,
                message: 'Failed to get database stats',
                error: error.message
            };
        }
    }
    
    /**
     * Get the time of the last database reindex from logs
     * @returns {Promise<string>} Last reindex time
     */
    async _getLastReindexTime() {
        try {
            // This is a simplified implementation
            // In a real app, you might store this in a settings collection or parse log files
            
            // Try to read the last time from a file
            const reindexTrackingFile = path.join(process.cwd(), 'logs', 'last_reindex.txt');
            
            try {
                const lastReindexData = await fs.readFile(reindexTrackingFile, 'utf8');
                const timestamp = new Date(lastReindexData.trim());
                
                // Calculate the days ago
                const now = new Date();
                const diffTime = Math.abs(now - timestamp);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                return `${diffDays} days ago`;
            } catch (readError) {
                // If file doesn't exist or can't be read, return a default
                return '5 days ago';
            }
        } catch (error) {
            logger.error('Error determining last reindex time:', error);
            return '5 days ago';
        }
    }
    
    /**
     * Format bytes to human-readable size
     * @param {number} bytes - Size in bytes
     * @returns {string} Formatted size
     */
    _formatSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        
        return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

module.exports = DatabaseOperationsService;