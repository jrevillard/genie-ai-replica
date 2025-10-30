const multer = require('multer');
const config = require('../config/appConfig');
// const { validateFileType } = require('../utils/mimeTypes');

// Configure multer storage
const storage = multer.memoryStorage();

// File filter function
const fileFilter = async (req, file, cb) => {
  try {
    // Basic MIME type check
    if (!config.upload.allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error(`File type ${file.mimetype} is not allowed`), false);
    }
    
    cb(null, true);
  } catch (error) {
    cb(error, false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: config.upload.maxFileSize,
    files: config.upload.maxFilesUpload,
    fieldSize: config.upload.maxFileSize
  },
  fileFilter: fileFilter
});

// Middleware for single file upload
const uploadSingle = upload.single('file');

// Middleware for multiple file upload
const uploadMultiple = upload.array('files', config.upload.maxFilesUpload);

// Enhanced file validation middleware
const validateFiles = async (req, res, next) => {
  try {
    if (!req.file && !req.files) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const files = req.files || [req.file];
    
    // Validate each file
    for (const file of files) {
      // const validation = await validateFileType(file);
      // if (!validation.isValid) {
      //   return res.status(400).json({
      //     success: false,
      //     error: validation.error
      //   });
      // }
    }

    next();
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

// Error handling middleware for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          error: `File size too large. Maximum size is ${config.upload.maxFileSize} bytes`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          error: 'Too many files uploaded'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          error: 'Unexpected file field'
        });
      default:
        return res.status(400).json({
          success: false,
          error: `Upload error: ${error.message}`
        });
    }
  }
  
  // Handle other file-related errors
  if (error.message.includes('File type') || error.message.includes('not allowed')) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  next(error);
};

module.exports = {
  uploadSingle,
  uploadMultiple,
  validateFiles,
  handleMulterError
};