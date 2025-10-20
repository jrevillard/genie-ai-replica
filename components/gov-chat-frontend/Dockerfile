# Use Node.js 22.14.0 as the base image
FROM node:22.14.0-alpine

ARG VUE_APP_API_URL
ENV VUE_APP_API_URL=$VUE_APP_API_URL

ARG VUE_APP_CSP_CONNECT_SRC
ENV VUE_APP_CSP_CONNECT_SRC=$VUE_APP_CSP_CONNECT_SRC

ARG VUE_PROXY_HOST
ENV VUE_PROXY_HOST=$VUE_PROXY_HOST

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install

#Set the required environment
#ENV VUE_APP_API_URL=https://e2e-82-109.ssdcloudindia.net:443/api

# Copy the entire project
COPY . .

# Expose the port the Vue app runs on
EXPOSE 8090

# Start the Vue.js development server
CMD ["npm", "run", "serve"]
