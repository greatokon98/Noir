FROM node:22-alpine

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code
COPY server/ ./server/
COPY views/ ./views/
COPY public/ ./public/
COPY luxury-gym-landing.html ./

# Copy env example (actual .env is injected at runtime)
COPY .env.example ./.env.example

EXPOSE 3000

# Health check for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# Run seed + start in production
CMD ["sh", "-c", "node server/seed.js && node server/index.js"]
