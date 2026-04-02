<div align="center">
<img src="https://github.com/openlit/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="OpenLIT Logo" width="30%"><h1>
OpenLIT Collector</h1>

**[Documentation](https://docs.openlit.io/latest/features/gpu) | [Quickstart](#-getting-started) | [Metrics](#-metrics) | [Configuration](#-configuration)**

**[Roadmap](#%EF%B8%8F-roadmap) | [Feature Request](https://github.com/openlit/openlit/issues/new?assignees=&labels=%3Araised_hand%3A+Up+for+Grabs%2C+%3Arocket%3A+Feature&projects=&template=feature-request.md&title=%5BFeat%5D%3A) | [Report a Bug](https://github.com/openlit/openlit/issues/new?assignees=&labels=%3Abug%3A+Bug%2C+%3Araised_hand%3A+Up+for+Grabs&projects=&template=bug.md&title=%5BBug%5D%3A)**

[![OpenLIT](https://img.shields.io/badge/OpenLIT-orange)](https://openlit.io/)
[![License](https://img.shields.io/github/license/openlit/openlit?label=License&logo=github&color=f80&logoColor=white)](https://github.com/openlit/openlit/blob/main/LICENSE)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/openlit/openlit)](https://github.com/openlit/openlit/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/openlit/openlit)](https://github.com/openlit/openlit/graphs/contributors)

[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
[![X](https://img.shields.io/badge/follow-%40openlit__io-1DA1F2?logo=x&style=social)](https://twitter.com/openlit_io)

</div>

A high-performance, cross-platform host and GPU metrics collector written in Go. Exports host-level system metrics (CPU, memory, disk, network), process metrics, DCGM-style GPU hardware telemetry, and optional eBPF-based CUDA kernel tracing -- all via OpenTelemetry (OTLP).

## Features

- **Cross-platform** -- runs on Linux, macOS, and Windows
- **Host metrics** -- CPU utilization, memory, disk I/O, filesystem, network I/O (all platforms)
- **Process metrics** -- self-process CPU, memory, threads, file descriptors, Go runtime stats
- **Cross-vendor GPU support** -- NVIDIA (via NVML), AMD (via sysfs/hwmon), Intel (via sysfs/hwmon + DRM) on Linux
- **DCGM-style GPU metrics** -- utilization, temperature, power draw, memory, clock speeds, ECC errors, fan speed, PCIe errors
- **eBPF CUDA tracing** (opt-in) -- kernel launch counts, grid/block sizes, memory allocations, memory copies
- **OpenTelemetry-native** -- exports metrics via OTLP (gRPC or HTTP)
- **Lightweight** -- single static Go binary, zero Python dependencies
- **Resilient** -- stays alive on systems without GPUs, retries discovery every 30s

## Platform Support

| Feature | Linux | macOS | Windows |
|---|:---:|:---:|:---:|
| System metrics (CPU, memory, disk, network) | Yes | Yes | Yes |
| Process metrics (CPU, memory, threads, FDs) | Yes | Yes | Yes |
| GPU metrics -- NVIDIA (NVML) | Yes | -- | -- |
| GPU metrics -- AMD (sysfs/hwmon) | Yes | -- | -- |
| GPU metrics -- Intel (sysfs/hwmon) | Yes | -- | -- |
| eBPF CUDA tracing | Yes | -- | -- |

On macOS/Windows, the collector runs with **host and process metrics only**. GPU discovery is skipped gracefully (no crash). On Linux without GPUs, the collector retries GPU discovery every 30 seconds while still exporting host metrics.

Note: Apple Silicon (M1-M4) has integrated GPUs accessible via Metal/IOKit, but these are not currently supported. macOS has no NVML or sysfs.

## Architecture

```
Host Metrics (all platforms via gopsutil)
    +-- CPU utilization, memory, disk I/O, filesystem, network
    +-- Process: self CPU, memory, threads, FDs, Go runtime

GPU Metrics (Linux only)
    +-- PCI Bus Scan (/sys/bus/pci/devices/)
    |     +-- NVIDIA (0x10de) --> NVML backend (go-nvml / libnvidia-ml.so)
    |     +-- AMD    (0x1002) --> sysfs/hwmon backend (zero dependencies)
    |     +-- Intel  (0x8086) --> sysfs/hwmon + DRM backend
    |
    +-- [Optional: eBPF CUDA tracing via uprobes on libcudart.so]

Export
    +-- OTel SDK --> OTLP gRPC/HTTP --> your OTel collector / backend
```

## Getting Started

### Prerequisites

- An OpenTelemetry-compatible backend (e.g., OpenLIT, Jaeger, Grafana, Datadog)
- For GPU metrics: Linux with NVIDIA/AMD/Intel GPU drivers installed

### Docker

```sh
docker pull ghcr.io/openlit/openlit-collector:latest

docker run --gpus all \
    -e GPU_APPLICATION_NAME='my-app' \
    -e GPU_ENVIRONMENT='production' \
    -e OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4317" \
    ghcr.io/openlit/openlit-collector:latest
```

### Docker Compose

Add under `services` in your `docker-compose.yml`:

```yaml
openlit-collector:
  image: ghcr.io/openlit/openlit-collector:latest
  environment:
    GPU_APPLICATION_NAME: 'my-app'
    GPU_ENVIRONMENT: 'production'
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4317"
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
  depends_on:
    - otel-collector
  restart: always
```

### Build from source

```sh
git clone https://github.com/openlit/openlit.git
cd openlit/openlit-collector
make build
./openlit-collector
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GPU_APPLICATION_NAME` | `default` | Application/service name |
| `GPU_ENVIRONMENT` | `default` | Deployment environment |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(required)* | OTLP endpoint URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | | Auth headers (`key=val,key2=val2`) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | `grpc` or `http/protobuf` |
| `OTEL_SERVICE_NAME` | *(from GPU_APPLICATION_NAME)* | OTel service name |
| `GPU_COLLECTION_INTERVAL` | `10s` | Metric polling interval |
| `OTEL_GPU_EBPF_ENABLED` | `false` | Enable eBPF CUDA kernel tracing |

## Metrics

### System Metrics (all platforms)

Collected via [gopsutil](https://github.com/shirou/gopsutil), following [OTel semantic conventions for system metrics](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/system/system-metrics.md).

| Metric | Type | Unit | Description | Attributes |
|---|---|---|---|---|
| `system.cpu.utilization` | Gauge | 1 | CPU utilization per core and total (0.0-1.0) | cpu |
| `system.cpu.count` | Gauge | {cpu} | Logical CPU core count | |
| `system.memory.usage` | Gauge | By | Memory by state | state={used,available,free,cached,buffers,swap_used,swap_free} |
| `system.memory.utilization` | Gauge | 1 | Memory utilization (0.0-1.0) | |
| `system.disk.io` | Counter | By | Disk I/O bytes | device, direction={read,write} |
| `system.disk.operations` | Counter | {operation} | Disk I/O operations | device, direction={read,write} |
| `system.filesystem.usage` | Gauge | By | Filesystem space | device, mountpoint, type, state={used,free} |
| `system.filesystem.utilization` | Gauge | 1 | Filesystem utilization (0.0-1.0) | device, mountpoint, type |
| `system.network.io` | Counter | By | Network I/O bytes | device, direction={receive,transmit} |
| `system.network.errors` | Counter | {error} | Network errors | device, direction={receive,transmit} |

### Process Metrics (all platforms)

Self-monitoring of the collector process, following [OTel semantic conventions for process metrics](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/system/process-metrics.md).

| Metric | Type | Unit | Description | Attributes |
|---|---|---|---|---|
| `process.cpu.time` | Counter | s | Process CPU time | state={user,system} |
| `process.cpu.utilization` | Gauge | 1 | Process CPU utilization | |
| `process.memory.usage` | Gauge | By | Resident memory (RSS) | |
| `process.memory.virtual` | Gauge | By | Virtual memory size | |
| `process.thread.count` | Gauge | {thread} | OS thread count | |
| `process.open_file_descriptor.count` | Gauge | {count} | Open file descriptors (Linux/macOS) | |
| `process.runtime.go.goroutines` | Gauge | {goroutine} | Go goroutine count | |
| `process.runtime.go.mem.heap_alloc` | Gauge | By | Go heap memory allocated | |

### GPU Hardware Telemetry (Linux only)

Collected for all detected GPUs. Availability depends on vendor and GPU model.

| Metric | Type | Unit | Description | NVIDIA | AMD | Intel |
|---|---|---|---|:---:|:---:|:---:|
| `gpu.utilization` | Gauge | percent | GPU compute utilization | Yes | Yes | -- |
| `gpu.memory.utilization` | Gauge | percent | Memory controller utilization | Yes | Yes | -- |
| `gpu.enc.utilization` | Gauge | percent | Video encoder utilization | Yes | -- | -- |
| `gpu.dec.utilization` | Gauge | percent | Video decoder utilization | Yes | -- | -- |
| `gpu.temperature` | Gauge | celsius | Temperature (labels: sensor=die\|memory) | Yes | Yes | Yes |
| `gpu.fan_speed` | Gauge | rpm | Fan speed | Yes | Yes | Yes* |
| `gpu.memory.total` | Gauge | bytes | Total GPU memory | Yes | Yes | -- |
| `gpu.memory.used` | Gauge | bytes | Used GPU memory | Yes | Yes | -- |
| `gpu.memory.free` | Gauge | bytes | Free GPU memory | Yes | Yes | -- |
| `gpu.power.draw` | Gauge | watts | Current power draw | Yes | Yes | Yes |
| `gpu.power.limit` | Gauge | watts | Power limit/cap | Yes | Yes | Yes |
| `gpu.energy.consumed` | Counter | joules | Cumulative energy consumed | Yes | Yes | Yes |
| `gpu.clock.graphics` | Gauge | mhz | Graphics/SM clock frequency | Yes | Yes | Yes* |
| `gpu.clock.memory` | Gauge | mhz | Memory clock frequency | Yes | Yes | -- |
| `gpu.pcie.replay.errors` | Counter | {error} | PCIe replay error count | Yes | -- | -- |
| `gpu.ecc.errors` | Counter | {error} | ECC errors (labels: severity=single_bit\|double_bit) | Yes | -- | -- |

\* Intel support depends on driver (i915/Xe) and kernel version.

**Attributes on all hardware metrics:**

| Attribute | Description |
|---|---|
| `vendor` | `nvidia`, `amd`, or `intel` |
| `gpu_index` | Device index (0, 1, 2...) |
| `gpu_name` | Product name |
| `gpu_uuid` | Unique device identifier |
| `pci_address` | PCI bus address |

### eBPF CUDA Tracing (opt-in)

Requires `OTEL_GPU_EBPF_ENABLED=true` and elevated privileges (`CAP_BPF` + `CAP_PERFMON` or root). NVIDIA CUDA only.

| Metric | Type | Unit | Description | Attributes |
|---|---|---|---|---|
| `gpu.kernel.launch.calls` | Counter | {call} | CUDA kernel launch count | `cuda.kernel.name` |
| `gpu.kernel.grid.size` | Histogram | {thread} | Total threads in grid per launch | `cuda.kernel.name` |
| `gpu.kernel.block.size` | Histogram | {thread} | Threads per block per launch | `cuda.kernel.name` |
| `gpu.memory.allocations` | Counter | bytes | Bytes allocated via cudaMalloc | |
| `gpu.memory.copies` | Histogram | bytes | Bytes per cudaMemcpy | `cuda.memcpy.kind` |

## How It Works

### Device Discovery

The collector scans `/sys/bus/pci/devices/` for VGA/3D controllers and identifies the vendor:
- **0x10de** = NVIDIA
- **0x1002** = AMD
- **0x8086** = Intel

### Vendor Backends

| Vendor | Data Source | Notes |
|---|---|---|
| NVIDIA | NVML via [go-nvml](https://github.com/NVIDIA/go-nvml) | Loads `libnvidia-ml.so` at runtime; no build-time dependency |
| AMD | sysfs (`/sys/class/drm/`) + hwmon | Zero external dependencies; reads kernel-exposed metrics directly |
| Intel | sysfs + hwmon + DRM | Xe/i915 driver; support varies by kernel version |

### eBPF CUDA Tracing

Attaches uprobes to `libcudart.so` to intercept:
- `cudaLaunchKernel` -- kernel name, grid/block dimensions
- `cudaMalloc` -- allocation size
- `cudaMemcpyAsync` / `cudaMemcpy` -- copy size and direction

Events flow through a BPF ring buffer to Go userspace, where kernel addresses are resolved to function names via ELF symbol tables.

## Building the Docker Image

```sh
git clone https://github.com/openlit/openlit.git
cd openlit/openlit-collector
docker build -t openlit-collector .
```

## Contributing

Whether it's big or small, we love contributions. Check out our [Contribution guide](../../CONTRIBUTING.md) to get started.

- Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) or [Discord](https://discord.gg/rjvTm6zd) community.

## Roadmap

| Feature | Status |
|---|---|
| NVIDIA GPU hardware telemetry (NVML) | Done |
| AMD GPU hardware telemetry (sysfs/hwmon) | Done |
| Intel GPU hardware telemetry (sysfs/hwmon) | Done |
| DCGM-style metrics (power, temp, clocks, ECC) | Done |
| eBPF CUDA kernel tracing | Done |
| Prometheus `/metrics` endpoint | Planned |
| ROCm HIP tracing (AMD eBPF) | Planned |
| Per-process GPU utilization (DRM fdinfo) | Planned |

## License

OpenTelemetry GPU Collector is built and maintained by OpenLIT under the [Apache-2.0 license](../../LICENSE).
