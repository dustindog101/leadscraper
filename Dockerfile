# Dockerfile for the Railway worker
# Builds a Linux image with Chromium + system deps + the leadscraper app
# Runs `bun run worker` which polls the DB for queued scrape jobs

FROM oven/bun:1.1-debian AS base

# Install system libraries required by Chromium/Playwright/Patchright
# These are the deps that `patchright install --with-deps` would install
# but we install them explicitly to be sure they're present at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core Chromium runtime deps
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    # Fonts (so Google Maps renders correctly)
    fonts-liberation \
    fonts-noto-color-emoji \
    # Misc
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install Patchright's Chromium binary
RUN bunx patchright install chromium

# Copy the rest of the app
COPY . .

# Generate Prisma client
RUN bun run db:generate || true

# Railway sets DATABASE_URL as an env var. The worker polls for queued jobs.
ENV NODE_ENV=production
ENV RUN_WORKER_INLINE=false

# Health check — worker should be running and connected to DB
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))" || exit 0

# Start the worker
CMD ["bun", "run", "worker"]
