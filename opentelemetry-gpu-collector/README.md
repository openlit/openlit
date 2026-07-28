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

A high-performance host and GPU metrics collector written in Go. Exports host-level system metrics (CPU, memory, disk, network), process metrics, DCGM-style GPU hardware telemetry, and eBPF-based CUDA kernel tracing (on by default on Linux) — all via OpenTelemetry (OTLP).

Metric names and attributes follow the [OpenTelemetry semantic conventions for hardware](https://opentelemetry.io/docs/specs/semconv/hardware/gpu/) and [system metrics](https://opentelemetry.io/docs/specs/semconv/system/).

## Features

- **OpenTelemetry-native** — standard env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_RESOURCE_ATTRIBUTES`), exports via OTLP gRPC or HTTP
- **OTel semantic conventions** — `hw.gpu.*` metric names, `hw.id` / `hw.name` / `hw.vendor` attributes
- **Host metrics** — CPU utilization, memory, disk I/O, filesystem, network I/O (Linux, macOS, Windows)
- **Process metrics** — self-process CPU, memory, threads, file descriptors, Go runtime stats
- **Cross-vendor GPU support** — NVIDIA (NVML), AMD, Intel on **Linux and Windows** (Windows: NVML / DXGI+PDH+ADL / Level Zero)
- **Fleet signals** — `hw.gpu.up`, `hw.gpu.allocated`, `hw.gpu.idle` for available vs active device aggregations
- **LLM process attribution** — cmdline, OS state (incl. zombie), owner, uptime, framework classification (`vllm`, `ollama`, …)
- **Kubernetes enrichment** — kubelet PodResources GPU→pod join (+ auto pod API when `K8S_NODE_NAME` is set)
- **PCIe / interconnect / health** — PCIe/NVLink/XGMI/throttle/XID/RAS when the driver exposes them (soft-omitted otherwise)
- **MIG devices** — NVIDIA MIG instances as first-class devices (**Linux only**; MIG is not available on Windows)
- **Encoder/decoder util** — NVIDIA NVENC/NVDEC; AMD/Intel via media engines or Windows PDH (AMD combined VCN → encoder only)
- **eBPF CUDA tracing** (on by default on Linux) — kernel launch counts, grid/block sizes, memory allocations, memory copies; soft-fails without caps/CUDA
- **Lightweight** — single static binary, no Python dependencies
- **Resilient** — stays alive on systems without GPUs, retries discovery every 30s

## Platform Support

| Feature | Linux | macOS | Windows |
|---|:---:|:---:|:---:|
| System metrics (CPU, memory, disk, network) | Yes | Yes | Yes |
| Process metrics (CPU, memory, threads, FDs) | Yes | Yes | Yes |
| GPU metrics — NVIDIA (NVML) | Yes | — | Yes |
| GPU metrics — AMD | Yes (sysfs) | — | Yes (DXGI+PDH) |
| GPU metrics — Intel | Yes (sysfs) | — | Yes (DXGI+PDH) |
| Per-process GPU memory / util | Yes | — | Yes (PDH) |
| eBPF CUDA tracing / occupancy | Yes | — | — |

On macOS the collector runs with host and process metrics only (no discrete GPU APIs). On Windows and Linux, GPU discovery retries every 30 seconds when no devices are found while still exporting host metrics. eBPF CUDA tracing and stream-sync occupancy remain Linux-only.

## Architecture

```
Host Metrics (all platforms via gopsutil)
    +-- CPU utilization, memory, disk I/O, filesystem, network
    +-- Process: self CPU, memory, threads, FDs, Go runtime

GPU Metrics (Linux + Windows)
    +-- Linux: PCI Bus Scan (/sys/bus/pci/devices/)
    |     +-- NVIDIA (0x10de) --> NVML (go-nvml / libnvidia-ml.so)
    |     +-- AMD    (0x1002) --> sysfs/hwmon
    |     +-- Intel  (0x8086) --> sysfs/hwmon + DRM
    |     +-- [Optional: eBPF CUDA tracing via uprobes on libcudart.so]
    |
    +-- Windows: NVML (nvml.dll) + DXGI enum + PDH GPU Engine/Process Memory
          +-- NVIDIA --> nvml.dll device metrics; PDH process attribution
          +-- AMD/Intel --> DXGI memory + PDH util/process (no eBPF)

Export
    +-- OTel SDK --> OTLP gRPC/HTTP --> your OTel collector / backend
```

## Getting Started

### Prerequisites

- An OpenTelemetry-compatible backend (e.g., OpenLIT, Grafana, Datadog)
- For GPU metrics: Linux or Windows with NVIDIA/AMD/Intel GPU drivers installed
  - Windows NVIDIA: `nvml.dll` (shipped with the driver)
  - Windows AMD/Intel: DXGI + Performance Counters (PDH); thermals/power may be limited vs Linux sysfs
- For eBPF tracing: Linux kernel 5.8+ with `CAP_BPF` + `CAP_PERFMON` (or root); Docker also needs `--ulimit memlock=-1:-1`

### Docker

```sh
docker pull ghcr.io/openlit/otel-gpu-collector:latest

docker run --gpus all --pid=host \
    -e OTEL_SERVICE_NAME=my-app \
    -e OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production" \
    -e OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4317" \
    ghcr.io/openlit/otel-gpu-collector:latest
```

`--pid=host` is required for per-process GPU attribution (cmdline, PID, zombie/`process.state`, owner). Device-level `hw.gpu.*` metrics still work without it.

### Docker Compose

```yaml
services:
  otel-gpu-collector:
    image: ghcr.io/openlit/otel-gpu-collector:latest
    pid: host
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
# Pick the asset matching your platform: linux-amd64 or linux-arm64.
curl -L https://github.com/openlit/openlit/releases/latest/download/opentelemetry-gpu-collector-<version>-linux-amd64 \
    -o opentelemetry-gpu-collector
chmod +x opentelemetry-gpu-collector

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 ./opentelemetry-gpu-collector
```

### Build from source

```sh
git clone https://github.com/openlit/openlit.git
cd openlit/opentelemetry-gpu-collector
make all
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
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=default` | Prefer `host.name`, `k8s.*`, `cloud.provider`, `host.type`, `cloud.region` here; overrides auto identity |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | Metric polling interval in **milliseconds** |
| `OTEL_GPU_EBPF_ENABLED` | `true` on Linux; `false` elsewhere | eBPF CUDA kernel tracing (Linux only). Soft-fails without caps/CUDA; set `false` to disable |
| `K8S_NODE_NAME` | | Downward API node name → also accepts Operator `OTEL_RESOURCE_ATTRIBUTES_NODE_NAME` or legacy `NODE_NAME` |
| `K8S_CLUSTER_NAME` | | Explicit cluster name (K8s only; on-prem when cloud detect fails) |
| `OPENLIT_K8S_NODE_LOOKUP` | `true` | Set `false` to skip Node API lookup for instance type / provider |
| `OPENLIT_CLOUD_DETECT` | `true` | Set `false` to skip AWS/GCP/Azure IMDS probes (avoids link-local timeouts on bare metal) |

`deployment.environment` is read from `OTEL_RESOURCE_ATTRIBUTES` and defaults to `default` if not set.

The collector auto-attaches `host.name`, and when running in Kubernetes (`KUBERNETES_SERVICE_HOST` set) also `k8s.node.name` / `k8s.cluster.name`. It also discovers `cloud.provider`, `host.type` (instance type), and `cloud.region` via Node labels/`providerID` and/or AWS/GCP/Azure IMDS (join keys for future cost UIs — no pricing in the collector). Recommended DaemonSet: `K8S_NODE_NAME` + resource attrs, plus ClusterRole `get` on `nodes`.

## Metrics

### GPU Hardware Telemetry (Linux + Windows)

Follows the [OTel semantic conventions for hardware metrics](https://opentelemetry.io/docs/specs/semconv/hardware/gpu/).

| Metric | Type | Unit | Description | NVIDIA | AMD | Intel |
|---|---|---|---|:---:|:---:|:---:|
| `hw.gpu.utilization` | Gauge | 1 | GPU compute/encoder/decoder utilization (0.0–1.0) via `hw.gpu.task` | Yes | Yes | — |
| `hw.gpu.memory.utilization` | Gauge | 1 | Memory controller utilization (0.0–1.0) | Yes | Yes | — |
| `hw.gpu.memory.limit` | UpDownCounter | By | Total GPU memory | Yes | Yes | — |
| `hw.gpu.memory.usage` | UpDownCounter | By | Used GPU memory | Yes | Yes | — |
| `hw.gpu.memory.free` | UpDownCounter | By | Free GPU memory | Yes | Yes | — |
| `hw.gpu.temperature` | Gauge | Cel | Temperature via `sensor=die\|memory` | Yes | Yes | Yes |
| `hw.gpu.fan_speed` | Gauge | {rpm} | Fan speed | -† | Yes | Yes* |
| `hw.gpu.power.draw` | Gauge | W | Current power draw | Yes | Yes | Yes |
| `hw.gpu.power.limit` | Gauge | W | Power limit/cap | Yes | Yes | Yes |
| `hw.gpu.energy.consumed` | Counter | J | Cumulative energy consumed | Yes | Yes | Yes |
| `hw.gpu.clock.graphics` | Gauge | MHz | Graphics/SM clock frequency | Yes | Yes | Yes* |
| `hw.gpu.clock.memory` | Gauge | MHz | Memory clock frequency | Yes | Yes | — |
| `hw.errors` | Counter | {error} | ECC and PCIe errors via `error.type` + `hw.type=gpu` | Yes | — | — |

\* Intel support depends on driver (i915/Xe) and kernel version.

† NVIDIA NVML reports fan speed as a percentage, not RPM — `hw.gpu.fan_speed` is omitted for NVIDIA.

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

### eBPF CUDA Tracing (on by default on Linux)

On by default on Linux. Discovers `libcudart` from install paths and `/proc/*/maps` (use `--pid=host` / `hostPID: true` so containerized/fleet workloads are visible — no CUDA toolkit mount required). Soft-fails without `CAP_BPF` + `CAP_PERFMON` (or root). Docker/K8s: also raise memlock (`--ulimit memlock=-1:-1`). Set `OTEL_GPU_EBPF_ENABLED=false` to disable. AMD/Intel process metrics do not use eBPF.

| Metric | Type | Unit | Description | Attributes |
|---|---|---|---|---|
| `gpu.kernel.launch.calls` | Counter | {call} | CUDA kernel launch count | `cuda.kernel.name` |
| `gpu.kernel.grid.size` | Histogram | {thread} | Total threads in grid per launch | `cuda.kernel.name` |
| `gpu.kernel.block.size` | Histogram | {thread} | Threads per block per launch | `cuda.kernel.name` |
| `gpu.memory.allocations` | Counter | By | Bytes allocated via cudaMalloc | |
| `gpu.memory.copies` | Histogram | By | Bytes per cudaMemcpy | `cuda.memcpy.kind`={HostToHost,HostToDevice,DeviceToHost,DeviceToDevice} |

## How It Works

### Device Discovery

**Linux:** scans `/sys/bus/pci/devices/` for PCI class codes `0x0300` / `0x0302` / `0x0380`, then maps vendor ID:

| Vendor ID | Backend | Collected metrics |
|---|---|---|
| `0x10de` (NVIDIA) | NVML via [go-nvml](https://github.com/NVIDIA/go-nvml) — `libnvidia-ml.so` | Utilization, memory, temperature, power, energy, clocks, ECC, PCIe |
| `0x1002` (AMD) | sysfs + hwmon + DRM fdinfo | Utilization, memory, temperature, power, energy, fan, processes |
| `0x8086` (Intel) | sysfs + hwmon + DRM (i915/Xe) | Temperature, power, energy, clocks, fan*, processes |

**Windows:** NVIDIA via `nvml.dll` (LoadLibrary); AMD/Intel via DXGI adapter enum + PDH `\GPU Engine` / `\GPU Process Memory` for util and per-process attribution. eBPF CUDA tracing is not available on Windows.

### eBPF CUDA Tracing

Attaches uprobes/uretprobes to `libcudart.so*` to intercept:
- `cudaLaunchKernel` — kernel name, grid/block dimensions, stream, shared mem
- `cudaMalloc` / `cudaFree` — allocation size
- `cudaMemcpy` / `cudaMemcpyAsync` — sync memcpy closes device-wide spans; async records bytes
- `cudaStreamSynchronize` / `cudaDeviceSynchronize` — stream-sync occupancy spans
- `cudaSetDevice` — per-thread device attribution

Events flow through a BPF ring buffer to Go userspace. Activity counters export with `process.pid`; the stream-sync occupancy engine emits `process.gpu.core.usage` / `process.gpu.sm_active` (model estimates, not hardware SM occupancy).

## Contributing

Whether it's big or small, we love contributions. Check out our [Contribution guide](../../CONTRIBUTING.md) to get started.

Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) or [Discord](https://discord.gg/rjvTm6zd) community.

## Roadmap

| Feature | Status |
|---|---|
| NVIDIA GPU hardware telemetry (NVML) | Done |
| AMD GPU hardware telemetry (sysfs/hwmon) | Done |
| Intel GPU hardware telemetry (sysfs/hwmon) | Done |
| Per-process GPU attribution (NVML + DRM fdinfo) | Done |
| eBPF CUDA activity + stream-sync occupancy | Done |
| OTel semantic convention compliance (`hw.gpu.*`) | Done |
| Prometheus `/metrics` endpoint | Planned |
| ROCm HIP tracing (AMD eBPF) | Planned |
| CUDA Graph launch hooks | Planned |

## License

OpenTelemetry GPU Collector is built and maintained by OpenLIT under the [Apache-2.0 license](../../LICENSE).
