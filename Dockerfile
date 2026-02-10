FROM oven/bun:canary-alpine

# Install system dependencies
RUN apk add --no-cache git procps

# Clone the repository
RUN git clone https://github.com/v57/hub-launcher /app

# Set working directory
WORKDIR /app

# Install and update dependencies
RUN bun install && bun update

# Set environment variable
ENV HUBLISTEN=0.0.0.0:1997

# Expose port
EXPOSE 1997

# Run the application
CMD ["bun", "index.ts"]
