# Use Node.js 22.14.0 as the base image
FROM node:22.14.0-alpine

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy the entire project
COPY . .

# Build the Vue app for production
RUN npm run build

# Install http-server to serve static files
RUN npm install -g http-server

# Expose the port the Vue app runs on
EXPOSE 8090

# Serve the built app with http-server
CMD ["sh", "-c", "http-server /app/dist -p 8090"]
