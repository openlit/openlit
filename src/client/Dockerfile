# Use an alpine as a base image
FROM alpine as builder

# Installing node and npm
RUN apk add --update nodejs npm

# Set the working directory in the container
WORKDIR /app/client

# Copy package.json and package-lock.json to the working directory & the rest of the application code
COPY . .

# Install dependencies & Build the Next.js application
RUN npm install && npm run build


# Use a smaller image for production
FROM alpine

# Installing extra packages
RUN apk add --no-cache nodejs npm bash openssl python3 py3-pip pipx rust cargo build-base

# Create a virtual environment
RUN python3 -m venv /app/client/venv

# Install litellm inside the virtual environment
RUN /app/client/venv/bin/pip install --no-cache-dir litellm

# Set the working directory in the container
WORKDIR /app/client

# Copy only necessary files from the builder stage
COPY --from=builder /app/client/.next ./.next
COPY --from=builder /app/client/package.json ./package.json
COPY --from=builder /app/client/package-lock.json ./package-lock.json
COPY --from=builder /app/client/public ./public
COPY --from=builder /app/client/prisma ./prisma

# Execute entrypoint script to generate NextAuth.js secret and run commands
COPY --from=builder /app/client/scripts ./scripts
RUN chmod +x ./scripts/entrypoint.sh

# Install Prisma globally
RUN npm install -g prisma

# Expose the port that Next.js will run on
EXPOSE ${DOCKER_PORT:-3000}

# Run the entrypoint script
CMD ["/app/client/scripts/entrypoint.sh"]
