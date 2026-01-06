# External-DNS Firewalla Webhook Proxy
# Lightweight Node.js container that proxies external-dns requests to Firewalla

FROM node:20-alpine

LABEL org.opencontainers.image.source="https://github.com/TheOutdoorProgrammer/external-dns-firewalla-webhook"
LABEL org.opencontainers.image.description="External-DNS webhook proxy for Firewalla devices"
LABEL org.opencontainers.image.licenses="MIT"

# Create app directory
WORKDIR /app

# Copy proxy script and package files
COPY webhook-proxy/proxy.js .
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Create non-root user (use existing node user from base image)
RUN chown -R node:node /app

# Switch to non-root user using numeric UID for Kubernetes runAsNonRoot compatibility
USER 1000:1000

# Expose ports
# 8888: Webhook API (external-dns talks to this)
# 8080: Health/Metrics endpoint
EXPOSE 8888 8080

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => { process.exit(1); });"

# Environment variables (can be overridden)
ENV FIREWALLA_HOST=192.168.229.1 \
    FIREWALLA_PROVIDER_PORT=8888 \
    FIREWALLA_HEALTH_PORT=8080 \
    WEBHOOK_PORT=8888 \
    METRICS_PORT=8080 \
    NODE_ENV=production

# Start the proxy
CMD ["node", "proxy.js"]
