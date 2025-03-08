require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Allow cross-origin requests
app.use(bodyParser.json()); // Parse JSON request bodies
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded request bodies
app.use(morgan('dev')); // HTTP request logging

// Static file serving for uploads
app.use('/uploads', express.static(uploadsDir));

// Check if route files exist
const routeFiles = ['user-routes', 'query-routes', 'service-routes', 'analytics-routes', 'session-routes'];
const availableRoutes = routeFiles.filter(file => fs.existsSync(`./routes/${file}.js`));

// Import available routes
const routes = {};
availableRoutes.forEach(file => {
  routes[file] = require(`./routes/${file}`);
});

// Use available routes
if (routes['user-routes']) app.use('/api/users', routes['user-routes']);
if (routes['query-routes']) app.use('/api/queries', routes['query-routes']);
if (routes['service-routes']) app.use('/api/services', routes['service-routes']);
if (routes['analytics-routes']) app.use('/api/analytics', routes['analytics-routes']);
if (routes['session-routes']) app.use('/api/sessions', routes['session-routes']);

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to the Chatbot Analytics API',
    availableEndpoints: availableRoutes.map(route => `/api/${route.replace('-routes', '')}`)
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'An unexpected error occurred',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Available endpoints: ${availableRoutes.map(route => `/api/${route.replace('-routes', '')}`).join(', ')}`);
});

module.exports = app; // For testing
