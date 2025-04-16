# Use Node.js 22.14.0 as the base image
FROM node:22.14.0-alpine

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install

#Set the required environment
ENV VUE_APP_API_URL=https://e2e-82-109.ssdcloudindia.net/api

# Copy the entire project
COPY . .

# Expose the port the Vue app runs on
EXPOSE 8090

# Start the Vue.js development server
CMD ["npm", "run", "serve"]

