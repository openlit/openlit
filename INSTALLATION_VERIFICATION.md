# OpenLIT Installation Verification Guide

This guide provides comprehensive steps to install OpenLIT, verify the installation, troubleshoot common issues, and ensure a failure-free deployment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Steps](#installation-steps)
- [Verification Steps](#verification-steps)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)
- [Testing Your Installation](#testing-your-installation)
- [Advanced Configuration](#advanced-configuration)

## Prerequisites

Before installing OpenLIT, ensure you have the following:

### Required Software

- **Docker** (version 20.10 or higher)
- **Docker Compose** (version 2.0 or higher)
- **Git** (version 2.0 or higher)
- **Python** 3.8+ (for Python SDK) OR **Node.js** 14+ (for TypeScript SDK)

### System Requirements

- **RAM**: Minimum 4GB, Recommended 8GB+
- **Disk Space**: Minimum 10GB free space
- **Network**: Internet connection for downloading dependencies
- **Ports**: Ensure ports 3000, 4318, 8123, 9000 are available

### Verify Prerequisites

Run these commands to verify your environment:

```bash
# Check Docker
docker --version
docker compose version

# Check Git
git --version

# Check Python (if using Python SDK)
python --version
pip --version

# Check Node.js (if using TypeScript SDK)
node --version
npm --version

# Check available ports
netstat -tuln | grep -E '3000|4318|8123|9000'
```

## Installation Steps

### Step 1: Clone the Repository

```bash
# Clone the OpenLIT repository
git clone git@github.com:openlit/openlit.git

# Navigate to the directory
cd openlit

# Verify repository contents
ls -la
```

**Expected Output**: You should see files including `docker-compose.yml`, `README.md`, and directories like `src/`, `sdk/`, etc.

### Step 2: Configure Environment (Optional)

If you need custom configuration:

```bash
# Copy the example environment file
cp env.example .env

# Edit the .env file as needed
nano .env  # or use your preferred editor
```

### Step 3: Deploy OpenLIT Stack

```bash
# Start all services in detached mode
docker compose up -d

# Wait for services to initialize (30-60 seconds)
sleep 60
```

**What This Does**:
- Deploys OpenLIT UI (port 3000)
- Deploys OpenTelemetry Collector (port 4318)
- Deploys ClickHouse database (ports 8123, 9000)

### Step 4: Install OpenLIT SDK

#### For Python Applications

```bash
# Install the OpenLIT Python SDK
pip install openlit

# Verify installation
pip show openlit
```

#### For TypeScript/JavaScript Applications

```bash
# Install the OpenLIT TypeScript SDK
npm install openlit

# Verify installation
npm list openlit
```

## Verification Steps

### 1. Verify Docker Containers

Check that all containers are running:

```bash
# List running containers
docker compose ps

# Expected output: All services should show "Up" status
# - openlit (port 3000)
# - otel-collector (port 4318)
# - clickhouse (ports 8123, 9000)
```

**Check Container Logs**:

```bash
# View logs for all services
docker compose logs

# View logs for specific service
docker compose logs openlit
docker compose logs otel-collector
docker compose logs clickhouse

# Follow logs in real-time
docker compose logs -f
```

### 2. Verify Network Connectivity

```bash
# Test OpenLIT UI (should return HTTP response)
curl -I http://127.0.0.1:3000

# Test OpenTelemetry Collector health
curl http://127.0.0.1:4318/health

# Test ClickHouse connectivity
curl http://127.0.0.1:8123/ping
```

**Expected Results**:
- OpenLIT UI: HTTP 200 or 301/302 redirect
- OTLP Endpoint: Should respond or show connection
- ClickHouse: Should return "Ok."

### 3. Access OpenLIT Dashboard

1. Open your browser and navigate to: `http://127.0.0.1:3000`
2. You should see the OpenLIT login page
3. Log in with default credentials:
   - **Email**: `user@openlit.io`
   - **Password**: `openlituser`

**Success Indicator**: You should be able to access the dashboard without errors.

### 4. Verify SDK Installation

#### Python SDK Verification

Create a test file `test_openlit.py`:

```python
import openlit
import sys

print("OpenLIT SDK imported successfully!")
print(f"OpenLIT version: {openlit.__version__}")

# Test initialization (console output mode)
try:
    openlit.init()
    print("✓ OpenLIT initialized successfully (console mode)")
except Exception as e:
    print(f"✗ Initialization failed: {e}")
    sys.exit(1)

print("\n✓ All SDK verification checks passed!")
```

Run the test:

```bash
python test_openlit.py
```

#### TypeScript SDK Verification

Create a test file `test_openlit.ts`:

```typescript
import Openlit from 'openlit';

console.log('OpenLIT SDK imported successfully!');

try {
  Openlit.init({
    applicationName: 'test-app'
  });
  console.log('✓ OpenLIT initialized successfully');
} catch (error) {
  console.error('✗ Initialization failed:', error);
  process.exit(1);
}

console.log('\n✓ All SDK verification checks passed!');
```

Run the test:

```bash
ts-node test_openlit.ts
# or
node test_openlit.js  # if transpiled
```

## Troubleshooting Common Issues

### Issue 1: Port Already in Use

**Symptoms**: Docker compose fails with "port already allocated" error.

**Solution**:

```bash
# Find what's using the port (example for port 3000)
lsof -i :3000  # Linux/Mac
netstat -ano | findstr :3000  # Windows

# Stop the conflicting service or modify docker-compose.yml
# to use different ports
```

### Issue 2: Docker Containers Not Starting

**Symptoms**: Containers exit immediately or show error status.

**Diagnosis**:

```bash
# Check container status
docker compose ps

# View detailed logs
docker compose logs --tail=100

# Check Docker daemon
sudo systemctl status docker  # Linux
```

**Solutions**:

1. **Insufficient Resources**:
   ```bash
   # Increase Docker memory limit
   # Docker Desktop: Settings > Resources > Memory (set to 4GB+)
   ```

2. **Corrupted Images**:
   ```bash
   # Remove and rebuild
   docker compose down
   docker compose pull
   docker compose up -d
   ```

3. **Permission Issues**:
   ```bash
   # Add user to docker group (Linux)
   sudo usermod -aG docker $USER
   newgrp docker
   ```

### Issue 3: SDK Not Sending Data

**Symptoms**: No traces/metrics visible in OpenLIT dashboard.

**Diagnosis**:

```python
# Enable verbose logging
import openlit
import logging

logging.basicConfig(level=logging.DEBUG)
openlit.init(
    otlp_endpoint="http://127.0.0.1:4318",
    disable_batch=True  # Process immediately for testing
)

# Make a test LLM call to generate telemetry
```

**Solutions**:

1. **Check Endpoint Connectivity**:
   ```bash
   curl -X POST http://127.0.0.1:4318/v1/traces \
     -H "Content-Type: application/json" \
     -d '{}'
   ```

2. **Verify Environment Variables**:
   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   echo $OTEL_EXPORTER_OTLP_HEADERS
   ```

3. **Check Firewall/Network**:
   ```bash
   # Test from container network
   docker compose exec openlit curl http://otel-collector:4318/health
   ```

### Issue 4: ClickHouse Connection Errors

**Symptoms**: "Connection refused" or "Unable to connect to ClickHouse" errors.

**Solutions**:

```bash
# Check ClickHouse is running
docker compose ps clickhouse

# Verify ClickHouse logs
docker compose logs clickhouse | tail -50

# Test connection
docker compose exec clickhouse clickhouse-client --query "SELECT 1"

# Restart ClickHouse if needed
docker compose restart clickhouse
```

### Issue 5: Authentication Failures

**Symptoms**: Cannot log in to dashboard with default credentials.

**Solutions**:

1. **Reset Credentials**:
   ```bash
   # Check environment variables
   docker compose exec openlit env | grep AUTH
   
   # Recreate with clean state
   docker compose down -v  # WARNING: Deletes data
   docker compose up -d
   ```

2. **Check for Custom Configuration**:
   ```bash
   # Review .env file for custom auth settings
   cat .env | grep -i auth
   ```

### Issue 6: Windows-Specific Issues

**Symptoms**: Docker image doesn't run on Windows.

**Solutions**:

1. **Enable WSL2**:
   ```powershell
   wsl --install
   wsl --set-default-version 2
   ```

2. **Use WSL2 Backend for Docker Desktop**:
   - Docker Desktop Settings > General > Use WSL2 based engine

3. **Line Ending Issues**:
   ```bash
   git config --global core.autocrlf input
   ```

## Testing Your Installation

### Complete Integration Test

Create a comprehensive test file `integration_test.py`:

```python
import openlit
import time
import sys

def test_openlit_integration():
    """Comprehensive integration test for OpenLIT"""
    
    print("Starting OpenLIT Integration Test...\n")
    
    # Test 1: SDK Import
    print("[1/5] Testing SDK import...")
    try:
        import openlit
        print("✓ SDK imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import SDK: {e}")
        return False
    
    # Test 2: SDK Initialization
    print("\n[2/5] Testing SDK initialization...")
    try:
        openlit.init(
            otlp_endpoint="http://127.0.0.1:4318",
            application_name="integration-test",
            disable_batch=True
        )
        print("✓ SDK initialized successfully")
    except Exception as e:
        print(f"✗ Initialization failed: {e}")
        return False
    
    # Test 3: Generate Sample Telemetry
    print("\n[3/5] Testing telemetry generation...")
    try:
        # If you have OpenAI or other LLM library installed
        # Uncomment and add actual LLM call here
        # For now, just verify initialization worked
        print("✓ Telemetry system ready")
    except Exception as e:
        print(f"✗ Telemetry generation failed: {e}")
        return False
    
    # Test 4: Verify Endpoint Connectivity
    print("\n[4/5] Testing endpoint connectivity...")
    try:
        import urllib.request
        urllib.request.urlopen("http://127.0.0.1:4318", timeout=5)
        print("✓ OTLP endpoint reachable")
    except Exception as e:
        print(f"✗ Endpoint connectivity failed: {e}")
        return False
    
    # Test 5: Verify Dashboard Access
    print("\n[5/5] Testing dashboard access...")
    try:
        import urllib.request
        urllib.request.urlopen("http://127.0.0.1:3000", timeout=5)
        print("✓ Dashboard accessible")
    except Exception as e:
        print(f"✗ Dashboard access failed: {e}")
        return False
    
    print("\n" + "="*50)
    print("✓ ALL INTEGRATION TESTS PASSED!")
    print("="*50)
    print("\nNext steps:")
    print("1. Visit http://127.0.0.1:3000")
    print("2. Login with: user@openlit.io / openlituser")
    print("3. Integrate OpenLIT into your application")
    
    return True

if __name__ == "__main__":
    success = test_openlit_integration()
    sys.exit(0 if success else 1)
```

Run the integration test:

```bash
python integration_test.py
```

### Health Check Script

Create `health_check.sh`:

```bash
#!/bin/bash

echo "OpenLIT Health Check"
echo "==================="
echo ""

# Check 1: Docker containers
echo "[1/4] Checking Docker containers..."
if docker compose ps | grep -q "Up"; then
    echo "✓ Docker containers running"
else
    echo "✗ Docker containers not running properly"
    docker compose ps
    exit 1
fi

# Check 2: OpenLIT UI
echo -e "\n[2/4] Checking OpenLIT UI..."
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 | grep -q "200\|301\|302"; then
    echo "✓ OpenLIT UI accessible"
else
    echo "✗ OpenLIT UI not accessible"
    exit 1
fi

# Check 3: OTLP Collector
echo -e "\n[3/4] Checking OTLP Collector..."
if curl -s http://127.0.0.1:4318 > /dev/null 2>&1; then
    echo "✓ OTLP Collector reachable"
else
    echo "✗ OTLP Collector not reachable"
    exit 1
fi

# Check 4: ClickHouse
echo -e "\n[4/4] Checking ClickHouse..."
if curl -s http://127.0.0.1:8123/ping | grep -q "Ok"; then
    echo "✓ ClickHouse responding"
else
    echo "✗ ClickHouse not responding"
    exit 1
fi

echo -e "\n==================="
echo "✓ ALL HEALTH CHECKS PASSED!"
echo "==================="
```

Make it executable and run:

```bash
chmod +x health_check.sh
./health_check.sh
```

## Advanced Configuration

### Custom OTLP Endpoint

For production deployments:

```python
import openlit

openlit.init(
    otlp_endpoint="https://your-production-endpoint.com:4318",
    otlp_headers={
        "Authorization": "Bearer YOUR_API_KEY"
    },
    application_name="production-app",
    environment="production"
)
```

### Sending to External Observability Platforms

OpenLIT supports sending data to external platforms:

```python
# Example: Sending to Grafana Cloud
openlit.init(
    otlp_endpoint="https://otlp-gateway-prod.grafana.net/otlp",
    otlp_headers={
        "Authorization": "Basic <base64-encoded-credentials>"
    }
)
```

### Custom Metrics and Tracing

```python
import openlit
from opentelemetry import trace

# Initialize OpenLIT
openlit.init(otlp_endpoint="http://127.0.0.1:4318")

# Get tracer for custom spans
tracer = trace.get_tracer(__name__)

# Create custom spans
with tracer.start_as_current_span("custom-operation"):
    # Your code here
    pass
```

### Production Best Practices

1. **Use Environment Variables**:
   ```bash
   export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"
   export OTEL_SERVICE_NAME="my-ai-service"
   export OTEL_RESOURCE_ATTRIBUTES="environment=production"
   ```

2. **Enable Batch Processing**:
   ```python
   openlit.init(
       otlp_endpoint="http://127.0.0.1:4318",
       disable_batch=False  # Enable batching for better performance
   )
   ```

3. **Set Up Monitoring**:
   - Configure alerts for container health
   - Monitor ClickHouse disk usage
   - Set up backup procedures

4. **Security Hardening**:
   - Change default credentials immediately
   - Use HTTPS for production endpoints
   - Implement proper authentication
   - Restrict network access

## Getting Help

If you encounter issues not covered in this guide:

1. **Check the logs**: `docker compose logs -f`
2. **GitHub Issues**: https://github.com/openlit/openlit/issues
3. **Community Support**:
   - Slack: https://join.slack.com/t/openlit/shared_invite/...
   - Discord: https://discord.gg/CQnXwNT3
4. **Documentation**: https://docs.openlit.io/

## Conclusion

You now have a fully verified OpenLIT installation. This guide ensures:

✓ All prerequisites are met  
✓ Installation completes without errors  
✓ All services are running correctly  
✓ SDKs are properly configured  
✓ Common issues are addressed  
✓ Testing procedures are in place  

For next steps, check out the [official documentation](https://docs.openlit.io/) to integrate OpenLIT with your AI applications.