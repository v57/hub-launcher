# Use Alpine as base image
FROM oven/bun:canary-alpine

# Install git and curl (curl needed to install bun)
RUN apk add --no-cache git curl bash

# Clone the hub-launcher repo into /root/hub-launcher
RUN git clone https://github.com/v57/hub-launcher.git /root/hub-launcher

WORKDIR /root/hub-launcher

RUN bun i --production

# Run bun . on container start
CMD ["bun", "."]
