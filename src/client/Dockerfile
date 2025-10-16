# Use an alpine as a base image
FROM alpine AS builder

# Installing node and npm
RUN apk add --update nodejs npm


# Installing extra packages
RUN apk add --no-cache python3 py3-pip pipx rust cargo build-base


# Create a virtual environment
RUN python3 -m venv /app/client/venv

# Install litellm inside the virtual environment
RUN /app/client/venv/bin/pip install --no-cache-dir litellm

RUN find /app/client/venv -name '*.pyc' -delete && \
    find /app/client/venv -name '__pycache__' -type d -exec rm -r {} +


# Set the working directory in the container
WORKDIR /app/client

# Copy package.json and package-lock.json to the working directory & the rest of the application code
COPY . .

# Install dependencies & Build the Next.js application
RUN npm install && npm run build


# Use a smaller image for production
FROM alpine

# Installing extra packages
RUN apk add nodejs bash openssl python3


# Set the working directory in the container
WORKDIR /app/client

# Copy only necessary files from the builder stage

# Copying python virtual environment
COPY --from=builder /app/client/venv ./venv
# Copying the standalone next.js build
COPY --from=builder /app/client/.next/standalone ./
# Standalone build doesn't copy public, static, prisma, scripts
COPY --from=builder /app/client/public ./public
COPY --from=builder /app/client/.next/static ./.next/static
COPY --from=builder /app/client/prisma ./prisma
COPY --from=builder /app/client/scripts ./scripts
# Copying prisma client, prisma and prisma cli (.bin) from builder stage
COPY --from=builder /app/client/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/client/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/client/node_modules/prisma ./node_modules/prisma

# Execute entrypoint script to generate NextAuth.js secret and run commands
RUN chmod +x ./scripts/entrypoint.sh

# Install Prisma globally
# RUN npm install -g prisma@5.15.0

# Expose the port that Next.js will run on
EXPOSE ${DOCKER_PORT:-3000}

# Run the entrypoint script
CMD ["/app/client/scripts/entrypoint.sh"]
