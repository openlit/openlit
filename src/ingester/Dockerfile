# Build stage
FROM golang:1.22.1-alpine3.19 AS builder

# Set the working directory
WORKDIR /app

# Copy the Go Modules manifests and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the Go application and name the executable "ingester"
RUN CGO_ENABLED=0 go build -o ingester

# Final stage: Use a minimal alpine image
FROM alpine:3.19

# Install ca-certificates in case your application makes outgoing HTTPS requests
RUN apk --no-cache add ca-certificates

# Set the working directory
WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/ingester .

# Command to run the executable
CMD ["./ingester"]