#!/bin/bash

# Script to fetch PostHog credentials from Cloudflare Worker

# Default values
WORKER_URL=${1:-"https://workers.openlit.io/api/posthog"}

POSTHOG_API_KEY="POSTHOG_API_KEY"

# Function to display error messages
error() {
    echo "ERROR: $1" >&2
    exit 1
}

# Validate inputs
[ -z "$WORKER_URL" ] && error "Worker URL is required"

# Check if curl is installed
command -v curl >/dev/null 2>&1 || error "curl is required but not installed"

echo "Fetching PostHog credentials from Cloudflare Worker..."

# Make the API request
response=$(curl -s -f \
                -H "User-Agent: Docker-Build" \
                -H "Content-Type: application/json" \
                "${WORKER_URL}" 2>&1) || error "Failed to fetch credentials: $response"

# Extract credentials using grep and sed since we no longer require jq
POSTHOG_API_KEY=$(echo "$response" | grep -o '"POSTHOG_API_KEY":"[^"]*"' | sed 's/"POSTHOG_API_KEY":"\([^"]*\)"/\1/')
POSTHOG_HOST=$(echo "$response" | grep -o '"POSTHOG_HOST":"[^"]*"' | sed 's/"POSTHOG_HOST":"\([^"]*\)"/\1/')

# Validate required fields
[ -z "$POSTHOG_API_KEY" ] && error "PostHog API Key not found in response"
[ -z "$POSTHOG_HOST" ] && error "PostHog Host not found in response"

# Update environment variables
echo "POSTHOG_API_KEY=\"${POSTHOG_API_KEY}\"" >> /etc/environment
echo "POSTHOG_HOST=\"${POSTHOG_HOST}\"" >> /etc/environment

echo "Credentials successfully fetched and saved to /etc/environment"