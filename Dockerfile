# A minimal Dockerfile for running the photo application. This uses an
# Alpine-based Node image for a small footprint. Only production
# dependencies are installed.

FROM node:18-alpine

WORKDIR /app

# Copy package descriptors and install production dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Expose the port (optional; docker-compose handles this)
EXPOSE 3000

# Environment variables can be overridden at runtime via docker-compose or
# other orchestrators. Default values match those in `.env.example`.
ENV PORT=3000

# Run the server
CMD ["node", "server.js"]