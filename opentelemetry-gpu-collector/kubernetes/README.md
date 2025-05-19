# OpenTelemetry GPU Collector - Kubernetes Deployment

This directory contains Kubernetes manifests for deploying the OpenTelemetry GPU Collector.

## Prerequisites

1. A Kubernetes cluster with GPU nodes
2. NVIDIA GPU Operator or AMD GPU Operator installed
3. OpenTelemetry Collector deployed in the cluster

## Deployment

### 1. Create the monitoring namespace

```bash
kubectl create namespace monitoring
```

### 2. Deploy the GPU Collector

```bash
kubectl apply -f daemonset.yaml
```

### 3. Verify the deployment

```bash
# Check if pods are running
kubectl get pods -n monitoring -l app=gpu-collector

# Check pod logs
kubectl logs -n monitoring -l app=gpu-collector
```

## Configuration

The collector is configured using a ConfigMap. You can modify the configuration by editing the ConfigMap:

```bash
kubectl edit configmap gpu-collector-config -n monitoring
```

### Key Configuration Options

- `collection.interval`: How often to collect metrics (default: 10s)
- `gpu.max_samples`: Maximum number of samples to keep in memory
- `gpu.enable_profiling`: Enable detailed GPU profiling metrics
- `export.otlp_endpoint`: OpenTelemetry Collector endpoint
- `kubernetes.enable_pod_metrics`: Enable pod-level GPU metrics
- `kubernetes.enable_node_metrics`: Enable node-level GPU metrics

## GPU Support

### NVIDIA GPUs

The collector supports NVIDIA GPUs through the NVIDIA GPU Operator. Make sure:

1. NVIDIA GPU Operator is installed
2. Nodes are labeled with `nvidia.com/gpu=true`
3. NVIDIA drivers are properly installed

### AMD GPUs

The collector supports AMD GPUs through the AMD GPU Operator. Make sure:

1. AMD GPU Operator is installed
2. Nodes are labeled with `amd.com/gpu=true`
3. AMD drivers are properly installed

## Metrics

The collector exposes the following metrics:

### Node-level Metrics
- GPU utilization
- GPU memory usage
- GPU temperature
- GPU power usage

### Pod-level Metrics
- Per-pod GPU utilization
- Per-pod GPU memory usage
- GPU device assignment

## Troubleshooting

### Common Issues

1. **Pod not starting**
   - Check if the node has GPUs
   - Verify GPU operator installation
   - Check pod logs for errors

2. **No metrics being collected**
   - Verify GPU driver installation
   - Check collector logs
   - Verify OpenTelemetry Collector endpoint

3. **Permission issues**
   - Ensure the pod has privileged access
   - Check GPU driver permissions

### Debugging

```bash
# Get pod logs
kubectl logs -n monitoring -l app=gpu-collector

# Describe pod
kubectl describe pod -n monitoring -l app=gpu-collector

# Check GPU status on node
kubectl exec -n monitoring -it <pod-name> -- nvidia-smi  # For NVIDIA
kubectl exec -n monitoring -it <pod-name> -- rocm-smi    # For AMD
```

## Monitoring

The collector sends metrics to the OpenTelemetry Collector. You can visualize these metrics using:

- Grafana
- Prometheus
- Other OpenTelemetry-compatible tools

## Security Considerations

1. The collector runs with privileged access to access GPU metrics
2. Use network policies to restrict pod communication
3. Consider using a service account with minimal permissions
4. Enable TLS for OTLP endpoint communication

## Upgrading

To upgrade the collector:

```bash
# Update the image
kubectl set image daemonset/gpu-collector gpu-collector=openlit/gpu-collector:new-version -n monitoring
```

## Uninstalling

To remove the collector:

```bash
kubectl delete -f daemonset.yaml
``` 