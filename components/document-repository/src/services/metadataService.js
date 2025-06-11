// This service handles metadata extraction, storage, and querying for uploaded documents.
// Extract metadata from uploaded files (e.g., filename, MIME type, size, create/upload dates, text content for PDFs/DOCX).
// Store metadata (e.g., in a local JSON file, embedded DB like SQLite, or in-memory cache for MVP).
// Search/query metadata by criteria (e.g., filename, file type, date range, etc.).
// Support metadata deletion when a file is deleted.
// Manually Updating existing metadata; Validating user-provided metadata (optional but helpful)

const fs = require('fs').promises; // Using promises for async file operations
const path = require('path');
const mime = require('mime-types'); // For MIME type detection
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const { ensureDirectoryExists, getMetadataFilePath, getPdfPageCount, getDocxWordCount, getTxtLineCount, getTxtWordCount } = require('../utils/fileUtils'); // Utility to ensure directory exists
const appConfig = require('../config/appConfig');

async function extractMetadata(filePath, fileInfo = {}) {
    const stats = await fs.stat(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    const baseMeta = {
        file_id: fileInfo.file_id || uuidv4(),
        filename: fileInfo.filename || path.basename(filePath),
        file_size: stats.size,
        mime_type: mimeType,
        storage_path: filePath,
        labels: fileInfo.labels || [],
        author: fileInfo.author || '',
        upload_date: fileInfo.upload_date || new Date().toISOString(),
        create_date: fileInfo.create_date || stats.birthtime.toISOString(),
        crawl_date: fileInfo.crawl_date || '',
        source_url: fileInfo.source_url || '',
    };

    // File-type-specific metadata extraction

    if (mimeType === 'application/pdf') {
        baseMeta.page_count = await getPdfPageCount(filePath);
    }
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        baseMeta.word_count = await getDocxWordCount(filePath);
    }
    else if (mimeType.startsWith('text/')) {
        baseMeta.line_count = await getTxtLineCount(filePath);
        baseMeta.word_count = await getTxtWordCount(filePath);
    }
    // Add more file type as needed

    return baseMeta;
}

class MetadataService {
    // 1. Extract and store metadata (one JSON file per document)
    async addMetadata(filePath, fileInfo = {}) {
        try {
            const metadata = await extractMetadata(filePath, fileInfo);
            const metadataFilePath = getMetadataFilePath(filePath);

            // Write metadata to a JSON file
            await fs.writeFile(metadataFilePath, JSON.stringify(metadata, null, 2), 'utf8');
            return metadata;
        } catch (error) {
            console.error(`Failed to add metadata for ${filePath}: ${error.message}`);
            throw error;
        }
    }

    // 2. Search/query metadata (by filename, MIME type, date range, etc.) by scanning all *_metadata.json files in uploads directory
    async searchMetadata(file_name, file_type, upload_data_from, upload_date_to, create_data_from, create_data_to, labels, author) {
        try {
            const metadataDir = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');
            const files = await fs.readdir(metadataDir);
            const results = [];

            for (const file of files) {
                if (file.endsWith('_meta.json')) {
                    const metadataPath = path.join(metadataDir, file);
                    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));

                    // Filter based on search criteria
                    if ((file_name && metadata.filename.includes(file_name)) || // Check if file_name is provided and matches. includes is used for partial matches, which means its name can contain the search term.
                        (file_type && metadata.mime_type === file_type) || // Check if file_type is provided and matches exactly
                        (upload_data_from && new Date(metadata.upload_date) >= new Date(upload_data_from)) || // Check if upload_data_from is provided and matches. If provided, it checks if the upload date is greater than or equal to the specified date.
                        (upload_date_to && new Date(metadata.upload_date) <= new Date(upload_date_to)) ||
                        (create_data_from && new Date(metadata.create_date) >= new Date(create_data_from)) || 
                        (create_data_to && new Date(metadata.create_date) <= new Date(create_data_to)) ||
                        (labels && labels.some(label => metadata.labels.includes(label))) || // Check if labels are provided and at least one label matches
                        (author && metadata.author === author)) {
                        results.push(metadata);
                    }
                }
            }
            if (results.length === 0) {
                console.log('No metadata found matching the search criteria.');
            }
            else {
                console.log(`Found ${results.length} metadata entries matching the search criteria.`);
            }
            return results;
        } catch (error) {
            console.error(`Failed to search metadata: ${error.message}`);
            throw error;
        }
    }

    // 3. Get metadata by file_id (by scanning all *_metadata.json files in uploads directory). This is useful for retrieving metadata of a specific file during the final source tracking.
    async getMetadataById(file_id) {
        try {
            const metadataDir = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');
            const files = await fs.readdir(metadataDir);
            const metaFiles = files.filter(file => file.endsWith('_meta.json'));

            for (const metaFile of metaFiles) {
                const metadataPath = path.join(metadataDir, metaFile);
                const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
                if (metadata.file_id === file_id) {
                    return metadata; // Return the metadata if file_id matches
                }
            }
            return null; // Return null if no matching metadata found
        } catch (error) {
            console.error(`Failed to get metadata by ID: ${error.message}`);
            throw error;
        }
    }

    // 4. Delete metadata file when its file is deleted
    async deleteMetadata(filePath) {
        try {
            const metadataFilePath = getMetadataFilePath(filePath);
            await fs.unlink(metadataFilePath); // Delete the metadata file
            console.log(`Metadata for ${filePath} deleted successfully.`);
        } catch (error) {
            console.error(`Failed to delete metadata for ${filePath}: ${error.message}`);
            throw error;
        }
    }

    // 5. Manually update existing metadata
    async updateMetadata(filePath, updates= {}) {
        try {
            const metaDataPath = getMetadataFilePath(filePath); 
            metadata = JSON.parse(await fs.readFile(metaDataPath, 'utf8'));
        } catch {
            throw new Error(`Metadata file not found for ${filePath}. Please ensure the file exists and has metadata.`);
        }
        // Only allow certain fields to be updated
        const allowedFields = ['file_name', 'labels', 'author', 'create_date', 'crawl_date', 'source_url'];
        for (const key of Object.keys(updates)) {
            if (allowedFields.includes(key)) {
                metadata[key] = updates[key];
            } else {
                console.warn(`Field ${key} is not allowed to be updated.`);
            }
        }
        await fs.writeFile(metaDataPath, JSON.stringify(metadata, null, 2), 'utf8');
        console.log(`Metadata for ${filePath} updated successfully.`);
        return metadata; // Return the updated metadata
    }
}

module.exports = new MetadataService(); // Export an instance of MetadataService for use in other modules


