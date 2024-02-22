# Use an official Node runtime as a base image
FROM node:20 as builder

# Set the working directory in the container
WORKDIR /doku/client

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Next.js application
RUN npm run build

# Use a smaller image for production
FROM node:20

# Set the working directory in the container
WORKDIR /doku/client

# Copy only necessary files from the builder stage
COPY --from=builder /doku/client/.next ./.next
COPY --from=builder /doku/client/node_modules ./node_modules
COPY --from=builder /doku/client/package.json ./package.json
COPY --from=builder /doku/client/package-lock.json ./package-lock.json
COPY --from=builder /doku/client/public ./public
COPY --from=builder /doku/client/prisma ./prisma

# Set environment variables
ARG API_URL
ENV API_URL $API_URL

# Set the database URL environment variable
ARG DATABASE_URL
ENV DATABASE_URL $DATABASE_URL

# Create an entrypoint script to generate NextAuth.js secret and run commands
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Expose the port that Next.js will run on
EXPOSE 3000

# Run Prisma migrations using npx
CMD ["./entrypoint.sh"]
