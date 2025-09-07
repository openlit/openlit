# OpenLIT Operator Helm Chart

This Helm chart deploys the OpenLIT Kubernetes operator for zero-code AI/ML application instrumentation.

## Prerequisites

- Kubernetes 1.20+
- Helm 3.8+

## Installation

### Add the OpenLIT Helm repository

```bash
helm repo add openlit https://openlit.github.io/helm/
helm repo update
```

### Install the operator

```bash
# Basic installation (creates namespace automatically)
helm install openlit-operator openlit/openlit-operator \
  --create-namespace --namespace openlit

# With custom values
helm install openlit-operator openlit/openlit-operator \
  --create-namespace --namespace openlit \
  --set image.tag=v1.0.0 \
  --set observability.logLevel=debug
```

### Install from source

```bash
# Clone the repository
git clone https://github.com/openlit/openlit.git
cd openlit/operator/helm

# Install the chart (create namespace if needed)
helm install openlit-operator ./openlit-operator \
  --create-namespace --namespace openlit
```

## Version Management

The Helm chart automatically synchronizes versions between the operator and instrumentation images for consistency. Here are some common scenarios:

### Synchronized Versions (Recommended)

```bash
# All components use v1.2.0
helm install openlit-operator ./openlit-operator \
  --create-namespace --namespace openlit \
  --set image.tag=v1.2.0

# This will result in:
# - Operator: ghcr.io/openlit/openlit-operator:v1.2.0
# - OpenLIT: ghcr.io/openlit/openlit-ai-instrumentation:v1.2.0
# - OpenInference: ghcr.io/openlit/openinference-ai-instrumentation:v1.2.0
# - OpenLLMetry: ghcr.io/openlit/openllmetry-ai-instrumentation:v1.2.0
```

### Mixed Versions (Advanced)

```bash
# Operator v1.2.0, but OpenInference uses v0.8.0
helm install openlit-operator ./openlit-operator \
  --create-namespace --namespace openlit \
  --set image.tag=v1.2.0 \
  --set providerImages.openinference.tag=v0.8.0

# This will result in:
# - Operator: ghcr.io/openlit/openlit-operator:v1.2.0
# - OpenLIT: ghcr.io/openlit/openlit-ai-instrumentation:v1.2.0
# - OpenInference: ghcr.io/openlit/openinference-ai-instrumentation:v0.8.0
# - OpenLLMetry: ghcr.io/openlit/openllmetry-ai-instrumentation:v1.2.0
```

### Development/Latest Versions

```bash
# Use latest for development
helm install openlit-operator ./openlit-operator \
  --create-namespace --namespace openlit \
  --set image.tag=latest
  
# This automatically sets all provider images to latest as well
```

### How Provider Selection Works

The operator automatically selects the correct image when you create an AutoInstrumentation resource:

```yaml
# This will use ghcr.io/openlit/openinference-ai-instrumentation:v1.2.0
apiVersion: openlit.io/v1alpha1
kind: AutoInstrumentation
metadata:
  name: my-instrumentation
spec:
  python:
    instrumentation:
      provider: openinference  # Operator selects the right image
  # ... rest of config
```

If you installed the operator with `--set image.tag=v1.2.0`, the operator will automatically use `ghcr.io/openlit/openinference-ai-instrumentation:v1.2.0` for any AutoInstrumentation resources that specify `provider: openinference`.

## Configuration

The following table lists the configurable parameters of the OpenLIT operator chart and their default values.

### Global Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace` | Override namespace for all resources | `""` |
| `global.commonLabels` | Common labels to add to all resources | `{}` |
| `global.commonAnnotations` | Common annotations to add to all resources | `{}` |

### Image Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Operator image repository | `ghcr.io/openlit/openlit-operator` |
| `image.tag` | Operator image tag | `""` (uses Chart.AppVersion) |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `image.pullSecrets` | Image pull secrets | `[]` |

#### Provider Images & Version Synchronization

The operator dynamically selects instrumentation images based on the provider specified in AutoInstrumentation CRs. By default, all provider images use the same version as the operator for consistency:

| Parameter | Description | Default Behavior |
|-----------|-------------|------------------|
| `providerImages.openlit.repository` | OpenLIT provider image | `ghcr.io/openlit/openlit-ai-instrumentation` |
| `providerImages.openlit.tag` | OpenLIT provider image tag | `""` (uses operator tag → Chart.AppVersion) |
| `providerImages.openinference.repository` | OpenInference provider image | `ghcr.io/openlit/openinference-ai-instrumentation` |
| `providerImages.openinference.tag` | OpenInference provider image tag | `""` (uses operator tag → Chart.AppVersion) |
| `providerImages.openllmetry.repository` | OpenLLMetry provider image | `ghcr.io/openlit/openllmetry-ai-instrumentation` |
| `providerImages.openllmetry.tag` | OpenLLMetry provider image tag | `""` (uses operator tag → Chart.AppVersion) |
| `instrumentation.defaultProvider` | Default provider for fallback scenarios | `openlit` |

**How Image Selection Works:**
1. AutoInstrumentation CR specifies provider (e.g., `spec.python.instrumentation.provider: openinference`)
2. Operator looks up the corresponding image from `providerImages.{provider}`
3. If no provider-specific tag is set, uses operator's image tag
4. For operator's own init image default, uses the `defaultProvider` image

**Version Fallback Order:**
1. Provider-specific tag (if set)
2. Operator image tag (if set)  
3. Chart.AppVersion (default)

### Deployment Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `deployment.replicas` | Number of operator replicas | `1` |
| `deployment.strategy` | Deployment strategy | `RollingUpdate` |
| `deployment.podAnnotations` | Pod annotations | `{}` |
| `deployment.podLabels` | Pod labels | `{}` |
| `deployment.nodeSelector` | Node selector | `{}` |
| `deployment.tolerations` | Tolerations | See values.yaml |
| `deployment.affinity` | Affinity | `{}` |

### Resource Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `resources.requests.cpu` | CPU request | `100m` |
| `resources.requests.memory` | Memory request | `128Mi` |
| `resources.limits.cpu` | CPU limit | `500m` |
| `resources.limits.memory` | Memory limit | `512Mi` |

### Webhook Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `webhook.server.port` | Webhook server port | `9443` |
| `webhook.server.path` | Webhook server path | `/mutate` |
| `webhook.server.certDir` | Certificate directory | `/tmp/k8s-webhook-server/serving-certs` |
| `webhook.failurePolicy` | Webhook failure policy | `Ignore` |
| `webhook.reinvocationPolicy` | Webhook reinvocation policy | `Never` |
| `webhook.service.type` | Service type | `ClusterIP` |
| `webhook.service.port` | Service port | `443` |
| `webhook.service.targetPort` | Service target port | `9443` |

### TLS Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `tls.validityDays` | Certificate validity in days | `365` |
| `tls.refreshDays` | Certificate refresh threshold in days | `30` |
| `tls.secretName` | Secret name for certificates | `""` (auto-generated) |

### Observability Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `observability.logLevel` | Log level (debug, info, warn, error) | `info` |
| `observability.selfMonitoringEnabled` | Enable operator self-monitoring | `false` |
| `observability.otel.endpoint` | OTLP endpoint for operator telemetry | `""` |
| `observability.otel.headers` | OTLP headers | `""` |

### RBAC Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `serviceAccount.create` | Create service account | `true` |
| `serviceAccount.name` | Service account name | `""` (auto-generated) |
| `serviceAccount.annotations` | Service account annotations | `{}` |
| `rbac.create` | Create RBAC resources | `true` |

### CRD Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `crd.install` | Install CRD | `true` |
| `crd.annotations` | CRD annotations | `{}` |

## Usage Examples

### Basic AutoInstrumentation Configuration

```yaml
apiVersion: openlit.io/v1alpha1
kind: AutoInstrumentation
metadata:
  name: openlit-instrumentation
  namespace: default
spec:
  selector:
    matchLabels:
      openlit.io/instrument: "true"
  otlp:
    endpoint: "http://openlit.default.svc.cluster.local:4318"
  python:
    instrumentation:
      provider: openlit
      version: latest
```

### Advanced Configuration with Custom Packages

```yaml
apiVersion: openlit.io/v1alpha1
kind: AutoInstrumentation
metadata:
  name: advanced-instrumentation
  namespace: production
spec:
  selector:
    matchLabels:
      app.type: "ai-application"
    matchExpressions:
    - key: "environment"
      operator: In
      values: ["production", "staging"]
  otlp:
    endpoint: "https://otel-collector.monitoring.svc.cluster.local:4318"
    headers: "authorization=Bearer <token>"
    timeout: 30
  python:
    instrumentation:
      provider: openlit
      version: "1.0.0"
      customPackages: "my-custom-package==1.0.0,another-package"
      env:
      - name: CUSTOM_CONFIG
        value: "production"
      - name: API_KEY
        valueFrom:
          secretKeyRef:
            name: api-secrets
            key: openai-key
  resource:
    environment: production
```

### Instrumentation with OpenInference Provider

```yaml
apiVersion: openlit.io/v1alpha1
kind: AutoInstrumentation
metadata:
  name: openinference-instrumentation
  namespace: default
spec:
  selector:
    matchLabels:
      provider: "openinference"
  otlp:
    endpoint: "http://openlit.default.svc.cluster.local:4318"
  python:
    instrumentation:
      provider: openinference
      version: latest
```

## Instrumenting Applications

To instrument your applications, add the appropriate labels to your pods:

```bash
# Label existing pods
kubectl label pods my-app-pod openlit.io/instrument=true

# Update deployment to add labels to new pods
kubectl patch deployment my-app -p '{"spec":{"template":{"metadata":{"labels":{"openlit.io/instrument":"true"}}}}}'
```

Or add labels directly to your deployment YAML:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-ai-app
spec:
  template:
    metadata:
      labels:
        openlit.io/instrument: "true"
        app.type: "ai-application"
    spec:
      containers:
      - name: app
        image: my-ai-app:latest
```

## Uninstallation

```bash
# Uninstall the operator
helm uninstall openlit-operator

# Clean up CRDs (if needed)
kubectl delete crd autoinstrumentations.openlit.io
```

## Troubleshooting

1. **Check operator status:**
   ```bash
   kubectl get pods -n openlit
   kubectl logs -n openlit deployment/openlit-operator
   ```

2. **Verify AutoInstrumentation resources:**
   ```bash
   kubectl get autoinstrumentations -A
   kubectl describe autoinstrumentation my-instrumentation
   ```

3. **Check webhook configuration:**
   ```bash
   kubectl get mutatingwebhookconfigurations
   kubectl describe mutatingwebhookconfigurations openlit-instrumentation-webhook
   ```

4. **Inspect instrumented pods:**
   ```bash
   kubectl describe pod my-instrumented-pod
   kubectl logs my-instrumented-pod -c init-openlit
   ```

## Contributing

Contributions are welcome! Please see the [contributing guide](https://github.com/openlit/openlit/blob/main/CONTRIBUTING.md) for more details.

## License

This chart is licensed under the Apache License 2.0. See [LICENSE](https://github.com/openlit/openlit/blob/main/LICENSE) for more details.
