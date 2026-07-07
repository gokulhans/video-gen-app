# Remotion renderer for the AI video SaaS render pipeline (apps/render's
# RendererContainer). Node 22 + headless Chromium deps per Remotion's Docker
# guide (https://www.remotion.dev/docs/docker) + a small HTTP server
# (server.mjs) that runs renderMedia() and uploads the result to R2.

FROM node:22-bookworm-slim

# Chromium runtime dependencies recommended by Remotion for Debian bookworm.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libgbm-dev \
    libasound2 \
    libxrandr2 \
    libxkbcommon-dev \
    libxfixes3 \
    libxcomposite1 \
    libxdamage1 \
    libatk-bridge2.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    libx11-xcb1 \
    libxcursor1 \
    libgtk-3-0 \
    libpangocairo-1.0-0 \
    fonts-liberation \
    libnspr4 \
    xdg-utils \
    wget \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# Pre-download Remotion's managed Chromium build at image-build time so the
# first render doesn't pay that cost (and so the container has no need for
# outbound internet access to fetch it at runtime).
RUN npx remotion browser ensure

COPY server.mjs ./
COPY remotion ./remotion

ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
