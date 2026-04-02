<div align="center">
<img src="https://github.com/openlit/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="OpenLIT Logo" width="30%"><h1>
OpenTelemetry GPU Collector</h1>

**[Documentation](https://docs.openlit.io/latest/features/gpu) | [Quickstart](#-getting-started) | [Metrics](#-metrics) | [Configuration](#-configuration)**

**[Roadmap](#%EF%B8%8F-roadmap) | [Feature Request](https://github.com/openlit/openlit/issues/new?assignees=&labels=%3Araised_hand%3A+Up+for+Grabs%2C+%3Arocket%3A+Feature&projects=&template=feature-request.md&title=%5BFeat%5D%3A) | [Report a Bug](https://github.com/openlit/openlit/issues/new?assignees=&labels=%3Abug%3A+Bug%2C+%3Araised_hand%3A+Up+for+Grabs&projects=&template=bug.md&title=%5BBug%5D%3A)**

[![OpenLIT](https://img.shields.io/badge/OpenLIT-orange)](https://openlit.io/)
[![License](https://img.shields.io/github/license/openlit/openlit?label=License&logo=github&color=f80&logoColor=white)](https://github.com/openlit/openlit/blob/main/LICENSE)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/openlit/openlit)](https://github.com/openlit/openlit/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/openlit/openlit)](https://github.com/openlit/openlit/graphs/contributors)

[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
[![X](https://img.shields.io/badge/follow-%40openlit__io-1DA1F2?logo=x&style=social)](https://twitter.com/openlit_io)

</div>

A high-performance host and GPU metrics collector written in Go. Exports host-level system metrics (CPU, memory, disk, network), process metrics, DCGM-style GPU hardware telemetry, and optional eBPF-based CUDA kernel tracing — all via OpenTelemetry (OTLP).

Metric names and attributes follow the [OpenTelemetry semantic conventions for hardware](https://opentelemetry.io/docs/specs/semconv/hardware/gpu/) and [system metrics](https://opentelemetry.io/docs/specs/semconv/system/).

## Features

- **OpenTelemetry-native** — standard env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_RESOURCE_ATTRIBUTES`), exports via OTLP gRPC or HTTP
- **OTel semantic conventions** — `hw.gpu.*` metric names, `hw.id` / `hw.name` / `hw.vendor` attributes
- **Host metrics** — CPU utilization, memory, disk I/O, filesystem, network I/O (Linux, macOS, Windows)
- **Process metrics** — self-process CPU, memory, threads, file descriptors, Go runtime stats
- **Cross-vendor GPU support** — NVIDIA (via NVML), AMD (via sysfs/hwmon), Intel (via sysfs/hwmon + DRM) on Linux
- **eBPF CUDA tracing** (opt-in) — kernel launch counts, grid/block sizes, memory allocations, memory copies
- **Lightweight** — single static binary, no Python dependencies
- **Resilient** — stays alive on systems without GPUs, retries discovery every 30s

## Platform Support

| Feature | Linux | macOS | Windows |
|---|:---:|:---:|:---:|
| System metrics (CPU, memory, disk, network) | Yes | Yes | Yes |
| Process metrics (CPU, memory, threads, FDs) | Yes | Yes | Yes |
| GPU metrics — NVIDIA (NVML) | Yes | — | — |
| GPU metrics — AMD (sysfs/hwmon) | Yes | — | — |
| GPU metrics — Intel (sysfs/hwmon) | Yes | — | — |
| eBPF CUDA tracing | Yes | — | — |

On macOS/Windows the collector runs with host and process metrics only. GPU discovery is skipped gracefully. On Linux without GPUs, the collector retries discovery every 30 seconds while still exporting host metrics.

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

- An OpenTelemetry-compatible backend (e.g., OpenLIT, Grafana, Datadog)
- For GPU metrics: Linux with NVIDIA/AMD/Intel GPU drivers installed
- For eBPF tracing: Linux kernel 5.8+ with `CAP_BPF` + `CAP_PERFMON` (or root)

### Docker

```sh
docker pull ghcr.io/openlit/otel-gpu-collector:latest

docker run --gpus all \
    -e OTEL_SERVICE_NAME=my-app \
    -e OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production" \
    -e OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4317" \
    ghcr.io/openlit/otel-gpu-collector:latest
```

### Docker Compose

```yaml
services:
  otel-gpu-collector:
    image: ghcr.io/openlit/otel-gpu-collector:latest
    environment:
      OTEL_SERVICE_NAME: my-app
      OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=production"
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

### Binary

Download a pre-built binary from the [Releases](https://github.com/openlit/openlit/releases) page:

```sh
# Linux amd64
curl -L https://github.com/openlit/openlit/releases/latest/download/opentelemetry-gpu-collector-<version>-linux-amd64 \
    -o opentelemetry-gpu-collector
chmod +x opentelemetry-gpu-collector

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 ./opentelemetry-gpu-collector
```

### Build from source

```sh
git clone https://github.com/openlit/openlit.git
cd openlit/opentelemetry-gpu-collector
make build
./opentelemetry-gpu-collector
```

## Configuration

All configuration uses standard OpenTelemetry environment variables.

| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(required)* | OTLP endpoint URL (e.g. `http://localhost:4317`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | | Auth headers (`key=val,key2=val2`) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | `grpc` or `http/protobuf` |
| `OTEL_SERVICE_NAME` | `default` | Service name attached to all metrics |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=default` | Resource attributes (`deployment.environment=prod,team=ml`) |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | Metric polling interval in **milliseconds** |
| `OTEL_GPU_EBPF_ENABLED` | `false` | Enable eBPF CUDA kernel tracing (Linux only) |

`deployment.environment` is read from `OTEL_RESOURCE_ATTRIBUTES` and defaults to `default` if not set.

## Metrics

### GPU Hardware Telemetry (Linux only)

Follows the [OTel semantic conventions for hardware metrics](https://opentelemetry.io/docs/specs/semconv/hardware/gpu/).

| Metric | Type | Unit | Description | NVIDIA | AMD | Intel |
|---|---|---|---|:---:|:---:|:---:|
| `hw.gpu.utilization` | Gauge | 1 | GPU compute/encoder/decoder utilization (0.0–1.0) via `hw.gpu.task` | Yes | Yes | — |
| `hw.gpu.memory.utilization` | Gauge | 1 | Memory controller utilization (0.0–1.0) | Yes | Yes | — |
| `hw.gpu.memory.limit` | UpDownCounter | By | Total GPU memory | Yes | Yes | — |
| `hw.gpu.memory.usage` | UpDownCounter | By | Used GPU memory | Yes | Yes | — |
| `hw.gpu.memory.free` | UpDownCounter | By | Free GPU memory | Yes | Yes | — |
| `hw.gpu.temperature` | Gauge | Cel | Temperature via `sensor=die\|memory` | Yes | Yes | Yes |
| `hw.gpu.fan_speed` | Gauge | {rpm} | Fan speed | Yes | Yes | Yes* |
| `hw.gpu.power.draw` | Gauge | W | Current power draw | Yes | Yes | Yes |
| `hw.gpu.power.limit` | Gauge | W | Power limit/cap | Yes | Yes | Yes |
| `hw.gpu.energy.consumed` | Counter | J | Cumulative energy consumed | Yes | Yes | Yes |
| `hw.gpu.clock.graphics` | Gauge | MHz | Graphics/SM clock frequency | Yes | Yes | Yes* |
| `hw.gpu.clock.memory` | Gauge | MHz | Memory clock frequency | Yes | Yes | — |
| `hw.errors` | Counter | {error} | ECC and PCIe errors via `error.type` + `hw.type=gpu` | Yes | — | — |

\* Intel support depends on driver (i915/Xe) and kernel version.

**Attributes on all GPU metrics:**

| Attribute | Description | Example |
|---|---|---|
| `hw.id` | Unique device identifier (required by spec) | `GPU-a1b2c3d4-...` |
| `hw.name` | Product name | `NVIDIA A100-SXM4-80GB` |
| `hw.vendor` | Vendor name | `nvidia`, `amd`, `intel` |
| `gpu.index` | Device index | `0`, `1` |
| `gpu.pci_address` | PCI bus address | `0000:01:00.0` |

**Additional attributes per metric:**

| Metric | Extra Attribute | Values |
|---|---|---|
| `hw.gpu.utilization` | `hw.gpu.task` | `general`, `encoder`, `decoder` |
| `hw.gpu.temperature` | `sensor` | `die`, `memory` |
| `hw.errors` | `error.type` | `corrected`, `uncorrected`, `pcie_replay` |
| `hw.errors` | `hw.type` | `gpu` |

### System Metrics (all platforms)

Follows the [OTel semantic conventions for system metrics](https://opentelemetry.io/docs/specs/semconv/system/system-metrics/).

| Metric | Type | Unit | Description | Attributes |
|---|---|---|---|---|
| `system.cpu.utilization` | Gauge | 1 | CPU utilization per core (0.0–1.0) | `cpu.logical_number` |
| `system.cpu.logical.count` | UpDownCounter | {cpu} | Logical CPU core count | |
| `system.memory.usage` | UpDownCounter | By | Memory by state | `system.memory.state`={used,free,cached,buffers} |
| `system.memory.utilization` | Gauge | 1 | Memory utilization (0.0–1.0) | |
| `system.disk.io` | Counter | By | Disk I/O bytes | `system.device`, `disk.io.direction`={read,write} |
| `system.disk.operations` | Counter | {operation} | Disk I/O operations | `system.device`, `disk.io.direction`={read,write} |
| `system.filesystem.usage` | UpDownCounter | By | Filesystem space | `system.device`, `system.filesystem.mountpoint`, `system.filesystem.type`, `system.filesystem.state`={used,free} |
| `system.filesystem.utilization` | Gauge | 1 | Filesystem utilization (0.0–1.0) | `system.device`, `system.filesystem.mountpoint`, `system.filesystem.type` |
| `system.network.io` | Counter | By | Network I/O bytes | `network.interface.name`, `network.io.direction`={receive,transmit} |
| `system.network.errors` | Counter | {error} | Network errors | `network.interface.name`, `network.io.direction`={receive,transmit} |

### Process Metrics (all platforms)

Follows the [OTel semantic conventions for process metrics](https://opentelemetry.io/docs/specs/semconv/system/process-metrics/).

| Metric | Type | Unit | Description | Attributes |
|---|---|---|---|---|
| `process.cpu.time` | Counter | s | Process CPU time | `cpu.mode`={user,system} |
| `process.cpu.utilization` | Gauge | 1 | Process CPU utilization | |
| `process.memory.usage` | UpDownCounter | By | Resident memory (RSS) | |
| `process.memory.virtual` | UpDownCounter | By | Virtual memory size | |
| `process.thread.count` | UpDownCounter | {thread} | OS thread count | |
| `process.unix.file_descriptor.count` | UpDownCounter | {file_descriptor} | Open file descriptors (Linux/macOS) | |
| `process.runtime.go.goroutines` | Gauge | {goroutine} | Go goroutine count | |
| `process.runtime.go.mem.heap_alloc` | Gauge | By | Go heap memory allocated | |

### eBPF CUDA Tracing (opt-in, Linux only)

Enable with `OTEL_GPU_EBPF_ENABLED=true`. Requires `CAP_BPF` + `CAP_PERFMON` or root, and NVIDIA CUDA runtime (`libcudart.so`).

| Metric | Type | Unit | Description | Attributes |
|---|---|---|---|---|
| `gpu.kernel.launch.calls` | Counter | {call} | CUDA kernel launch count | `cuda.kernel.name` |
| `gpu.kernel.grid.size` | Histogram | {thread} | Total threads in grid per launch | `cuda.kernel.name` |
| `gpu.kernel.block.size` | Histogram | {thread} | Threads per block per launch | `cuda.kernel.name` |
| `gpu.memory.allocations` | Counter | By | Bytes allocated via cudaMalloc | |
| `gpu.memory.copies` | Histogram | By | Bytes per cudaMemcpy | `cuda.memcpy.kind`={HostToHost,HostToDevice,DeviceToHost,DeviceToDevice} |

## How It Works

### Device Discovery

The collector scans `/sys/bus/pci/devices/` for PCI class codes `0x0300` (VGA), `0x0302` (3D controller), and `0x0380` (display controller), then maps the vendor ID:

| Vendor ID | Backend | Collected metrics |
|---|---|---|
| `0x10de` (NVIDIA) | NVML via [go-nvml](https://github.com/NVIDIA/go-nvml) — loads `libnvidia-ml.so` at runtime | Utilization, memory, temperature, power, energy, clocks, ECC errors, PCIe errors, fan speed |
| `0x1002` (AMD) | sysfs + hwmon — zero external dependencies | Utilization, memory, temperature, power, energy, fan speed |
| `0x8086` (Intel) | sysfs + hwmon + DRM (i915/Xe driver) — requires Linux kernel 5.10+ | Temperature, power draw/limit, cumulative energy, graphics clock, fan speed (kernel 6.16+) |

### eBPF CUDA Tracing

Attaches uprobes to `libcudart.so` to intercept:
- `cudaLaunchKernel` — kernel name, grid/block dimensions
- `cudaMalloc` — allocation size
- `cudaMemcpy` / `cudaMemcpyAsync` — copy size and direction

Events flow through a BPF ring buffer to Go userspace, where kernel addresses are resolved to function names via ELF symbol tables.

## Contributing

Whether it's big or small, we love contributions. Check out our [Contribution guide](../../CONTRIBUTING.md) to get started.

Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) or [Discord](https://discord.gg/rjvTm6zd) community.

## Roadmap

| Feature | Status |
|---|---|
| NVIDIA GPU hardware telemetry (NVML) | Done |
| AMD GPU hardware telemetry (sysfs/hwmon) | Done |
| Intel GPU hardware telemetry (sysfs/hwmon) | Done |
| eBPF CUDA kernel tracing | Done |
| OTel semantic convention compliance (`hw.gpu.*`) | Done |
| Prometheus `/metrics` endpoint | Planned |
| ROCm HIP tracing (AMD eBPF) | Planned |
| Per-process GPU utilization (DRM fdinfo) | Planned |

## License

OpenTelemetry GPU Collector is built and maintained by OpenLIT under the [Apache-2.0 license](../../LICENSE).
