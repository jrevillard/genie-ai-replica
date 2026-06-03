require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

class DatabaseOperationsService {
  constructor() {
    this.backupDir = process.env.BACKUP_DIR || path.join(process.cwd(), 'database_backups');
    this.maxBackups = parseInt(process.env.MAX_BACKUPS || '5', 10);
    this.backupFormat = process.env.BACKUP_FORMAT || 'json';
    this.compressBackups = process.env.COMPRESS_BACKUPS === 'true';
    this.appName = process.env.APP_NAME || 'huduma';
    this.db = null;
    this.initialized = false;
    logger.info('DatabaseOperationsService constructor called');
  }

  async init() {
    if (this.initialized) {
      logger.debug('DatabaseOperationsService already initialized, skipping');
      return;
    }
    try {
      this.db = await dbService.getConnection('default');
      await this._ensureBackupDirectoryExists();
      await this._testConnection();
      this.initialized = true;
      logger.info('DatabaseOperationsService initialized');
      logger.info(`Using backup directory: ${this.backupDir}`);
      logger.info(`Max backups retained: ${this.maxBackups}`);
      logger.info(`Backup format: ${this.backupFormat}`);
      logger.info(`Compress backups: ${this.compressBackups}`);
    } catch (error) {
      logger.error(`Error initializing DatabaseOperationsService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  async _ensureBackupDirectoryExists() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      logger.info(`Backup directory created/verified: ${this.backupDir}`);
    } catch (error) {
      logger.error(`Error creating backup directory: ${error.message}`, { stack: error.stack });
    }
  }

  async _testConnection() {
    try {
      await this.db.query(aql`RETURN 1`);
      logger.info('Database connection tested successfully');
    } catch (error) {
      logger.error(`Failed to initialize database connection: ${error.message}`, { stack: error.stack });
      throw new Error('Database connection unavailable', { cause: error });
    }
  }

  async backupDatabase() {
    try {
      logger.info('Starting database backup');
      const fsStandard = require('fs');
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const filenameBase = `${this.appName.toLowerCase()}_backup_${timestamp}`;
      const backupFilename = `${filenameBase}.${this.backupFormat}`;
      const backupPath = path.join(this.backupDir, backupFilename);

      const dbInfo = {
        name: process.env.ARANGO_DB,
        version: await this.db.version(),
        timestamp: timestamp,
        environment: process.env.NODE_ENV
      };

      // Get collection metadata reliably
      const collectionInfos = await this.db.listCollections();
      dbInfo.collections = collectionInfos.filter((info) => !info.isSystem).map((info) => info.name);

      const writeStream = fsStandard.createWriteStream(backupPath);
      if (this.backupFormat === 'json') {
        writeStream.write('{\n');
        writeStream.write(`  "_metadata": ${JSON.stringify(dbInfo, null, 2)},\n`);
      }

      let collectionCount = 0;
      for (const info of collectionInfos) {
        const collectionName = info.name;
        if (info.isSystem) {
          logger.info(`Skipping system collection: ${collectionName}`);
          continue;
        }

        logger.info(`Attempting to backup collection: ${collectionName}`);

        // Get proxied collection instance
        const collection = this.db.collection(collectionName);

        // Use interpolation for safe collection binding
        const cursor = await this.db.query(aql`
          FOR doc IN ${collection}
          RETURN doc
        `);

        const documents = await cursor.all();
        logger.info(`Backed up collection: ${collectionName} (${documents.length} documents)`);

        if (this.backupFormat === 'json') {
          if (collectionCount > 0) {
            writeStream.write(',\n');
          }
          writeStream.write(`  "${collectionName}": ${JSON.stringify(documents, null, 2)}`);
        } else {
          writeStream.write(`{"collection":"${collectionName}","data":${JSON.stringify(documents)}}\n`);
        }
        collectionCount++;
      }

      if (this.backupFormat === 'json') {
        writeStream.write('\n}');
      }
      writeStream.end();

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      const stats = await fs.stat(backupPath);
      const fileSize = this._formatSize(stats.size);

      let finalPath = backupPath;
      if (this.compressBackups) {
        finalPath = await this._compressBackup(backupPath);
        await fs.unlink(backupPath);
        const compressedStats = await fs.stat(finalPath);
        const compressedSize = this._formatSize(compressedStats.size);
        logger.info(`Backup compressed successfully: ${fileSize} -> ${compressedSize}`);
      }

      await this._cleanupOldBackups();
      const relativeBackupPath = path.relative(process.cwd(), finalPath);

      logger.info(`Database backup completed successfully: ${relativeBackupPath} (${fileSize})`);
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
      logger.error(`Database backup error: ${error.message}`, { stack: error.stack });
      return {
        success: false,
        message: 'Failed to backup database',
        error: error.message
      };
    }
  }

  async _compressBackup(filePath) {
    try {
      const { createGzip } = require('zlib');
      const fsStandard = require('fs');
      const { pipeline } = require('stream');
      const { promisify } = require('util');
      const pipelineAsync = promisify(pipeline);

      const compressedPath = `${filePath}.gz`;
      const readStream = fsStandard.createReadStream(filePath);
      const writeStream = fsStandard.createWriteStream(compressedPath);

      await pipelineAsync(readStream, createGzip(), writeStream);
      logger.info(`File compressed successfully: ${filePath} -> ${compressedPath}`);
      return compressedPath;
    } catch (error) {
      logger.error(`Error compressing backup: ${error.message}`, { stack: error.stack });
      return filePath;
    }
  }

  async _cleanupOldBackups() {
    try {
      if (this.maxBackups <= 0) {
        logger.info('Backup cleanup disabled (maxBackups <= 0)');
        return;
      }

      const files = await fs.readdir(this.backupDir);
      const backupExtensions = [this.backupFormat];
      if (this.compressBackups) {
        backupExtensions.push(`${this.backupFormat}.gz`);
      }

      const backupPattern = new RegExp(`^${this.appName.toLowerCase()}_backup_.*\\.(${backupExtensions.join('|')})$`);
      const backupFiles = files
        .filter((file) => backupPattern.test(file))
        .map((file) => ({
          name: file,
          path: path.join(this.backupDir, file),
          time: fs.stat(path.join(this.backupDir, file)).then((stat) => stat.mtime.getTime())
        }));

      if (backupFiles.length <= this.maxBackups) {
        logger.info(`No backup cleanup needed. Current: ${backupFiles.length}, Max: ${this.maxBackups}`);
        return;
      }

      const backupsWithTimes = await Promise.all(
        backupFiles.map(async (file) => ({
          ...file,
          time: await file.time
        }))
      );

      backupsWithTimes.sort((a, b) => b.time - a.time);
      const filesToDelete = backupsWithTimes.slice(this.maxBackups);

      for (const file of filesToDelete) {
        try {
          await fs.unlink(file.path);
          logger.info(`Deleted old backup: ${file.name}`);
        } catch (unlinkError) {
          logger.error(`Error deleting old backup ${file.name}: ${unlinkError.message}`, { stack: unlinkError.stack });
        }
      }

      logger.info(`Backup cleanup completed successfully: ${filesToDelete.length} old backups deleted`);
    } catch (error) {
      logger.error(`Error during backup cleanup: ${error.message}`, { stack: error.stack });
    }
  }

  async optimizeDatabase() {
    try {
      logger.info('Starting database optimization');
      const optimizationResults = [];
      const collections = await this.db.collections();

      for (const collection of collections) {
        try {
          await collection.compact();
          const indexAnalysis = await this._analyzeIndexes(collection);
          optimizationResults.push({
            collection: collection.name,
            status: 'success',
            indexSuggestions: indexAnalysis
          });
          logger.info(`Optimized collection: ${collection.name}`);
        } catch (collectionError) {
          logger.error(`Optimization error for collection ${collection.name}: ${collectionError.message}`, {
            stack: collectionError.stack
          });
          optimizationResults.push({
            collection: collection.name,
            status: 'error',
            error: collectionError.message
          });
        }
      }

      logger.info('Database optimization completed successfully');
      return {
        success: true,
        message: 'Database optimization completed',
        results: optimizationResults
      };
    } catch (error) {
      logger.error(`Overall database optimization error: ${error.message}`, { stack: error.stack });
      return {
        success: false,
        message: 'Failed to optimize database',
        error: error.message
      };
    }
  }

  async _analyzeIndexes(collection) {
    try {
      const indexes = await collection.indexes();
      const analysis = [];

      indexes.forEach((index) => {
        if (index.type === 'hash' && index.selectivityEstimate < 0.5) {
          analysis.push(`Low selectivity for hash index on ${index.fields.join(', ')}`);
        }
        if (index.type === 'skiplist' && index.fields.length > 3) {
          analysis.push(`Consider breaking down complex multi-field skiplist index on ${index.fields.join(', ')}`);
        }
      });

      logger.info(`Index analysis completed successfully for collection ${collection.name}`);
      return analysis;
    } catch (error) {
      logger.error(`Error analyzing indexes for collection ${collection.name}: ${error.message}`, {
        stack: error.stack
      });
      return [];
    }
  }

  async getDatabaseStats() {
    try {
      logger.info('Fetching database statistics');
      const collections = await this.db.collections();
      const stats = await this.db.route('/_api/statistics').get();

      let totalSize = 0;
      const collectionStats = [];

      for (const collection of collections) {
        const figures = await collection.figures();
        if (figures && figures.figures) {
          totalSize += figures.figures.documentsSize || 0;
          collectionStats.push({
            name: collection.name,
            count: figures.figures.alive || 0,
            size: this._formatSize(figures.figures.documentsSize || 0)
          });
        }
      }

      const formattedSize = this._formatSize(totalSize);

      logger.info('Database statistics retrieved successfully');
      return {
        success: true,
        databaseSize: formattedSize,
        totalTables: collections.length,
        collections: collectionStats,
        systemStats: stats ? stats.body : null,
        server: {
          name: process.env.ARANGO_URL,
          database: process.env.ARANGO_DB,
          environment: process.env.NODE_ENV
        }
      };
    } catch (error) {
      logger.error(`Error getting database stats: ${error.message}`, { stack: error.stack });
      return {
        success: false,
        message: 'Failed to get database stats',
        error: error.message
      };
    }
  }

  _formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Singleton instance
const instance = new DatabaseOperationsService();
module.exports = instance;
