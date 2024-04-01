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

RUN apk add --update nodejs npm

# Set the working directory in the container
WORKDIR /app/client

# Copy only necessary files from the builder stage
COPY --from=builder /app/client/.next ./.next
# COPY --from=builder /app/client/node_modules ./node_modules
COPY --from=builder /app/client/package.json ./package.json
COPY --from=builder /app/client/package-lock.json ./package-lock.json
COPY --from=builder /app/client/public ./public
COPY --from=builder /app/client/prisma ./prisma

# Execute entrypoint script to generate NextAuth.js secret and run commands
COPY --from=builder /app/client/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
# Installing extra packages
RUN apk --no-cache add bash openssl

# Expose the port that Next.js will run on
EXPOSE 3000

# Run Prisma migrations using npx
CMD ["/app/client/entrypoint.sh"]
