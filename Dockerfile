# Use the official Go image as the base image
FROM golang:1.21.5

# Set the working directory to /app 
WORKDIR /app 

COPY src/go.mod .
COPY src/go.sum .

# Download dependencies in a separate layer to leverage Docker cache
RUN go mod download

# Now copy the rest of your source code.
COPY src .

# Build the Go application and name the executable as "ingester"
RUN go build -o ingester