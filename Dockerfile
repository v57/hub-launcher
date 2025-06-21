# Use the Bun canary alpine image as base
FROM oven/bun:canary-alpine

RUN apk add git procps

# Set working directory
WORKDIR /app

# Copy all files into the container
COPY . .

# Install dependencies and update them
RUN bun install && bun update

# Set environment variable (can be overridden at runtime)
ENV HUBLISTEN=0.0.0.0:1997

# Expose the port (can be mapped on container run)
EXPOSE 1997

# Run your application
CMD ["bun", "index.ts"]
