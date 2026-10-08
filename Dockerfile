# Multi-stage production build for MedFinder Ethiopia
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json tsconfig.json ./
RUN npm install

# Copy application source code
COPY src/ ./src/
COPY config/ ./config/

# Compile TypeScript to JavaScript
RUN npm run build

# Stage 2: Minimal Production Image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist
COPY src/database/schema.sql ./dist/database/schema.sql

# Copy public static assets & html web studio
COPY public/ ./public/
COPY config/ ./config/

EXPOSE 4000

CMD ["node", "dist/server.js"]
