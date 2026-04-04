# Build stage
FROM node:22.14.0-alpine AS build

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy the entire project
COPY . .

# Build the Vue app for production
RUN npm run build

# Production stage
FROM node:22.14.0-alpine

# Set working directory
WORKDIR /app

COPY --from=build /app/dist /app/dist
COPY --from=build /app/server.js /app/server.js

# Expose the port the Vue app runs on
EXPOSE 8090

# Serve the built app with SPA routing support
CMD ["node", "server.js"]
