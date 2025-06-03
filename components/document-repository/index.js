// index.js 🍉🍉🍉🍉🍉🍉🍉🍉🍉🍉
// Main server file. Main Express entry point for the file system service
// This is the entry point of your service. 
// It sets up a web server that listens on port 9981 
// and lets other services (like the frontend/backend) send files, get files, or delete them.


const express = require('express'); // Import express
const fileRoutes = require('./fileRoutes');
const app = express(); // Create an express application
const morgan = require('morgan'); // Show logs in terminal for incoming requests
const cors = require('cors'); // Allow other apps (like frontend/backend) to access this service

const PORT = process.env.PORT || 9981;

// Middleware
app.use(cors()); // Allow cross-origin requests
app.use(express.json()); // Parse incoming JSON data
app.use(morgan('dev')); // Show logs of each request in the terminal
app.use('/uploads', express.static('uploads')); // Serve uploaded files through a URL (e.g., /uploads/file.png)

// Routes
app.use('/api/files', fileRoutes); // Attach our file-related routes under /api/files

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  // Adding '0.0.0.0' allows the server to be accessible from any IP address. Remove it if you want to restrict access to localhost only.
  console.log(`File system service running on port ${PORT}`);
});
