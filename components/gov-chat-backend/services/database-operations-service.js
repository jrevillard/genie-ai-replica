require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { aql } = require('arangojs');
const { logger, dbService, formatSize } = require('../shared-lib');

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
    let backupPath = null;
    let backupCompleted = false;
    try {
      logger.info('Starting database backup');
      const fsStandard = require('fs');
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const filenameBase = `${this.appName.toLowerCase()}_backup_${timestamp}`;
      const backupFilename = `${filenameBase}.${this.backupFormat}`;
      backupPath = path.join(this.backupDir, backupFilename);

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

      // A stream error mid-backup must fail THIS backup, not hang the
      // request (a pending 'drain' never fires after 'error') or crash the
      // process (an 'error' event with no listener is an uncaughtException).
      let streamFailure = null;
      writeStream.on('error', (err) => {
        streamFailure = err;
      });

      // Bounded writes (issue #1762): the old backup stringified each
      // collection's ENTIRE document array into one string — a 46,938-doc
      // OKF collection crossed V8's string cap and 500'd the backup after
      // 34s of successful per-collection work. Per-document stringify
      // keeps every string at document size; awaiting 'drain' when the
      // stream signals backpressure keeps memory bounded too. Every write
      // (and every pending drain) rejects once the stream has failed.
      const writeBounded = (chunk) => {
        if (streamFailure) return Promise.reject(streamFailure);
        return new Promise((resolve, reject) => {
          if (writeStream.write(chunk)) return resolve();
          const onDrain = () => {
            writeStream.off('error', onFail);
            resolve();
          };
          const onFail = (e) => {
            writeStream.off('drain', onDrain);
            reject(e);
          };
          writeStream.once('drain', onDrain);
          writeStream.once('error', onFail);
        });
      };

      // No trailing comma after the metadata: a database with zero
      // non-system collections must still produce parseable JSON.
      if (this.backupFormat === 'json') {
        await writeBounded('{\n');
        await writeBounded(`  "_metadata": ${JSON.stringify(dbInfo, null, 2)}`);
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

        if (this.backupFormat === 'json') {
          // Every collection block is comma-prefixed (the metadata carries
          // no trailing comma), so an empty database still parses.
          await writeBounded(`,\n  "${collectionName}": [`);
        } else {
          await writeBounded(`{"collection":"${collectionName}","data":[`);
        }

        // Stream the documents one at a time — never accumulate the array.
        let docCount = 0;
        let first = true;
        for await (const doc of cursor) {
          await writeBounded((first ? '' : ',') + JSON.stringify(doc));
          first = false;
          docCount++;
        }

        if (this.backupFormat === 'json') {
          await writeBounded(']');
        } else {
          await writeBounded(']}\n');
        }
        logger.info(`Backed up collection: ${collectionName} (${docCount} documents)`);
        collectionCount++;
      }

      if (this.backupFormat === 'json') {
        await writeBounded('\n}');
      }
      writeStream.end();

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
      // The file on disk is complete from here — a later failure (stat,
      // compression, old-backup cleanup) must NOT destroy it.
      backupCompleted = true;

      const stats = await fs.stat(backupPath);
      const fileSize = formatSize(stats.size);

      let finalPath = backupPath;
      if (this.compressBackups) {
        finalPath = await this._compressBackup(backupPath);
        // _compressBackup swallows its own errors and returns the ORIGINAL
        // path when gzip fails — only unlink the raw file when compression
        // actually produced a new one, or we would delete the only copy of
        // a completed backup (review round-2, issue #1762).
        if (finalPath !== backupPath) {
          await fs.unlink(backupPath);
          const compressedStats = await fs.stat(finalPath);
          const compressedSize = formatSize(compressedStats.size);
          logger.info(`Backup compressed successfully: ${fileSize} -> ${compressedSize}`);
        } else {
          logger.warn(`Compression failed — keeping the uncompressed backup: ${backupPath}`);
        }
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
      // A failed backup must not leave a partial file that looks complete
      // (issue #1762): the streaming backup persists incrementally, so a
      // mid-backup failure leaves bytes on disk — remove them best-effort.
      // A failure AFTER the stream finished (stat/compress/cleanup) leaves
      // a COMPLETE backup — never destroy that one.
      if (backupPath && !backupCompleted) {
        try {
          await fs.unlink(backupPath);
          logger.info(`Removed partial backup file: ${backupPath}`);
        } catch (cleanupError) {
          // Nothing was written yet, or the unlink failed — nothing to do.
          logger.warn(`Could not remove partial backup file: ${cleanupError.message}`);
        }
      }
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

      const backupPattern = new RegExp(
        `^${this.appName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_backup_.*\\.(${backupExtensions.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`
      );
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
        if (figures) {
          // Same driver shape as the admin service (issue #1761): count at
          // the TOP level, byte sizes under figures.figures. MISSING reads
          // default to 0; GARBAGE (NaN) propagates to the tripwire below —
          // `|| 0` here once turned a broken payload into a confident zero.
          const inner = figures.figures || {};
          const rawSize = inner.documentsSize === undefined ? 0 : inner.documentsSize;
          totalSize += rawSize;
          collectionStats.push({
            name: collection.name,
            count: figures.count !== undefined ? figures.count : 0,
            size: rawSize,
            sizeFormatted: formatSize(rawSize)
          });
        }
      }

      // A non-finite or negative total is a payload failure, never a
      // renderable "NaN GB" (issue #1761).
      if (!Number.isFinite(totalSize) || totalSize < 0) {
        throw new Error(`Database stats total size is not a valid byte count: ${totalSize}`);
      }
      const formattedSize = formatSize(totalSize);

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
}

// Singleton instance
const instance = new DatabaseOperationsService();
module.exports = instance;
