FROM oven/bun:canary-alpine

# Install system dependencies
RUN apk add --no-cache git procps

# Clone the repository
RUN git clone https://github.com/v57/hub-launcher /app

# Set working directory
WORKDIR /app

# Install dependencies exactly as bun.lock pins them (never `bun update`, which would take hub-service from main)
RUN bun install --production --frozen-lockfile

# The launcher installs hub-server at its release tag (`hubServerTag` in launcher/hub-server.ts), never from main

# Set environment variable
ENV HUBLISTEN=0.0.0.0:1997

# Expose port
EXPOSE 1997

# Run the application
CMD ["bun", "index.ts"]
