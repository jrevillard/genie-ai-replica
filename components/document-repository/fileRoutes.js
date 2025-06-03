//fileRoutes.js 🍋🍋🍋🍋🍋🍋🍋🍋
// Defines the file-related APIs. File upload/download/delete routes
// This file creates 3 APIs:
// POST /upload – Save a file sent from frontend or backend
// GET /:filename – Return the file if it exists
// DELETE /:filename – Remove the file


// fileRoutes.js
const express = require('express'); // Import express, which is a web framework for Node.js
const router = express.Router(); // Create a router to define endpoints
const multer = require('multer'); // Used to handle file uploads
const fileService = require('./fileService'); // File saving logic
const fs = require('fs'); // Used to interact with the file system


// Tell multer where to save files and how to name them
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads'); // Set the destination for uploaded files
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9); // Create a unique filename
    cb(null, uniqueSuffix + '-' + file.originalname); // Save the file with a unique name
  }
});
const upload = multer({ storage }); // Create multer instance with storage config



// Upload a file (e.g., POST /api/files/upload)
router.post('/upload', upload.array('files', 10), (req, res) => {// Allow up to 10 files to be uploaded at once, or limit by environment variable
    console.log("🧪 DEBUG - Incoming fields:", req.body, req.files); // Log the uploaded files for debugging
    if (!req.files || req.files.length === 0) { // Check if a file was uploaded
        return res.status(400).json({ error: 'No file uploaded' }); // Handle no file uploaded
    }
    const uploadedFiles = fileService.uploadFiles(req.files); // Process the uploaded files using fileService
    res.json({
        message: 'File uploaded successfully',
        files: uploadedFiles // Respond with the uploaded file information
    });
    console.log("✅ Uploaded files:", uploadedFiles); // Log the uploaded file name
}); // req means request, res means response





// Read multiple files' content
router.post('/read', (req, res) => {
    const { filenames } = req.body; // Get the file names from the request body
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json({ error: 'Filename must be a non-empty array' });
    }
    try {
        filenames.forEach(filename => {
            fileService.readFile(filename, res); // Read each file's content
        });
    } catch (error) {
        if (error.message === 'File not found') {
            return res.status(404).json({ error: 'One or more files not found' }); // Handle file not found error
        }
        // If any other error occurs, log it and respond with a generic error message
        console.error("Error reading files:", error.message); // Log the error
        res.status(500).json({ error: 'Internal server error' }); // Handle internal server error
    }
});


// router.get('/read/:filename', (req, res) => {
//     const { filename } = req.params; // Get the file name from the request parameters
//     if (!filename) {
//         return res.status(400).json({ error: 'Filename is required' }); // Handle missing filename
//     }
//     try {
//         fileService.readFile(filename, res); // Delegate reading the file in browser 
//     } catch (error) {
//         if (error.message === 'File not found') {
//             return res.status(404).json({ error: 'File not found' }); // Handle file not found error
//         }
//         // If any other error occurs, log it and respond with a generic error message
//         console.error("Error reading file:", error.message); // Log the error
//         res.status(500).json({ error: 'Internal server error' }); // Handle internal server error
//     }
// });




// // Modify (overwrite) a file's content (e.g., PUT /api/files/example.txt)
// router.put('/:filename', (req, res) => {
//     const { filename } = req.params; // Get the file name from the request parameters
//     if (!filename) {
//         return res.status(400).json({ error: 'Filename is required' }); // Handle missing filename
//     }
//     const content = req.body.content; // Get the new content from the request body
//     if (!content) {
//         return res.status(400).json({ error: 'Content is required' }); // Handle missing content
//     }
//     if (typeof content !== 'string') {
//         return res.status(400).json({ error: 'Content must be a string' }); // Handle invalid content type
//     }
//     try {
//         fileService.writeFile(filename, content); // Write the new content to the file
//         res.json({ message: 'File modified successfully', filename }); // Respond with success message
//     } catch (error) {
//         if (error.message === 'File not found') {
//             return res.status(404).json({ error: 'File not found' }); // Handle file not found error
//         }
//         console.error("Error modifying file:", error.message); // Log the error
//         res.status(500).json({ error: 'Internal server error' }); // Handle internal server error
//     }
// });


// Download a file by name (e.g., GET /api/files/example.pdf)
router.get('/:filename', (req, res) => {
    const { filename } = req.params; // Get the file name from the request parameters of the URL
    if (!filename) {
        return res.status(400).json({ error: 'Filename is required' }); // Handle missing filename
    }
    console.log("🧪 DEBUG - Downloading file:", filename); // Log the requested file name
    try {
        const filePath = fileService.getFilePath(filename); // full path
        fileService.ensureFileExists(filename); // Ensure the file exists before sending it
        res.sendFile(filePath, (err) => { // Send the file for download
            if (err) {
                console.error("Error sending file:", err.message); // Log the error
                res.status(404).json({ error: 'File not found' }); // Handle file not found error
            }
    });
    } catch (error) {
        if (error.message === 'File not found') {
            return res.status(404).json({ error: 'File not found' }); // Handle file not found error
        }
        console.error("Error getting file path:", error.message); // Log the error
        res.status(500).json({ error: 'Internal server error' }); // Handle internal server error
    }  
});


// Delete a file (e.g., DELETE /api/files/example.pdf)
router.delete('/', (req, res) => {
    const { filename } = req.body; // Get the file name from the request body
    if (!filename || !Array.isArray(filename) || filename.length === 0) { 
        return res.status(400).json({ error: 'Filename must be a non-empty array' }); // Handle missing or invalid filenames
    }
    try {
        const deletedFiles = filename.map(file => {
            fileService.deleteFile(file); // Ensure the file exists and delete it
            return filename; // Return success message for each deleted file
        });
        res.status(200).json({ message: 'Files deleted successfully', files: deletedFiles }); // Respond with success message
    } catch (error) {
        if (error.message === 'File not found') {
            return res.status(404).json({ error: 'One or more files not found' }); // Handle file not found error
        }
        console.error("Error deleting file:", error.message); // Log the error
        res.status(500).json({ error: 'Internal server error' }); // Handle internal server error
    }
});




module.exports = router; // Export the router