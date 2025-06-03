// fileService.js 🍏🍏🍏🍏🍏🍏🍏🍏🍏🍏
// Handles file saving/deleting logic. 
// This file does the actual work: saving, getting, or deleting files in the uploads folder.


const fs = require('fs'); // Import file system module (Node.js module to interact with the file system)
const path = require('path'); // Import path module (to handle file paths correctly)

const uploadDir = path.join(__dirname, 'uploads'); // Define the upload directory


// Make sure the 'uploads' folder exists when app starts
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir); // Create it if missing
}


exports.validateFilename = (filename) => {
    if (!filename || typeof filename !== 'string') {
        throw new Error(`❌ Invalid filename passed to validateFilename: ${filename}`); // Throw an error if filename is not provided
    }
    if (filename.includes('..') || path.isAbsolute(filename)) {
        throw new Error(`Path injection attempt detected`); // Throw an error if filename is invalid
    }
    return filename; // Return the validated filename
}


// Get full file path
exports.getFilePath = (filename) => {
    filename = exports.validateFilename(filename); // Validate the filename
    const fullPath = path.join(uploadDir, filename); // Return the full file path
    console.log("✅ Full file path resolved:", fullPath); // Log the file path
    return fullPath; // Return the full file path
}


// Ensure file exists, throw if not
exports.ensureFileExists = (filename) => {
    const filePath = exports.getFilePath(filename); // Get the full file path
    if (!fs.existsSync(filePath)) { // Check if the file exists
        throw new Error(`❌ File not found: ${filename}`); // Throw an error if file not found
    }
    console.log(`✅ File exists: ${filename}`); // Log success message
    return true; // Return true if file exists
}


// Process uploaded files (used in /upload route)
exports.uploadFiles = (files) => {
    return files.map(file => ({
        filename: file.filename,
        filepath: `/uploads/${file.filename}`,
        message: `File uploaded successfully: ${file.originalname}`
    }));
};


// Delete a file
exports.deleteFile = (filename) => {
    exports.ensureFileExists(filename); // Ensure the file exists before trying to delete it
    const filePath = exports.getFilePath(filename); // Get the full file path
    fs.unlinkSync(filePath); // Delete the file
    console.log(`✅ File deleted successfully: ${filename}`); // Log success message
    return true; // Return true if deleted successfully
};


// Read a file's content
exports.readFile = (filename, res) => {
    exports.ensureFileExists(filename); // Ensure the file exists before trying to read it
    const filePath = exports.getFilePath(filename); // Get the full file path
    res.sendFile(filePath, (err) => { // Serve the file directly for browser
        if (err) {
            console.error("Error sending file:", err.message); // Log the error
            res.status(500).json({ error: 'Fail to serve file' }); // Handle file serving error
        } else {
            console.log(`✅ File read successfully: ${filename}`); // Log success message
        }
    });
};



// // Write (overwrite) a file's content
// exports.writeFile = (filename, content) => {
//     exports.ensureFileExists(filename); // Ensure the file exists before trying to write to it
//     const filePath = exports.getFilePath(filename); // Get the full file path
//     fs.writeFileSync(filePath, content, 'utf8'); // Write the content to the file
//     console.log(`✅ File written successfully: ${filename}`); // Log success message
//     return true; // Return true if written successfully
// }