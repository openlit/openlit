//go:build linux

package ebpf

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"unsafe"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -target bpf -type gpu_kernel_launch_t -type gpu_malloc_t -type gpu_memcpy_t gpuevent ./bpf/gpuevent.c -- -I./bpf

// Tracer manages eBPF programs for CUDA runtime interception.
type Tracer struct {
	logger   *slog.Logger
	reader   *ringbuf.Reader
	links    []link.Link
	handler  EventHandler
	symbols  *SymbolResolver
	running  atomic.Bool
	wg       sync.WaitGroup
}

// NewTracer loads eBPF programs and attaches uprobes to libcudart.so.
func NewTracer(logger *slog.Logger, handler EventHandler) (*Tracer, error) {
	cudaLib := findCudaLib()
	if cudaLib == "" {
		return nil, fmt.Errorf("libcudart.so not found; CUDA runtime is not installed")
	}

	logger.Info("found CUDA runtime library", "path", cudaLib)

	spec, err := loadGpuevent()
	if err != nil {
		return nil, fmt.Errorf("loading eBPF spec: %w", err)
	}

	var objs gpueventObjects
	if err := spec.LoadAndAssign(&objs, &ebpf.CollectionOptions{}); err != nil {
		return nil, fmt.Errorf("loading eBPF objects: %w", err)
	}

	t := &Tracer{
		logger:  logger,
		handler: handler,
		symbols: NewSymbolResolver(logger),
	}

	ex, err := link.OpenExecutable(cudaLib)
	if err != nil {
		objs.Close()
		return nil, fmt.Errorf("opening %s: %w", cudaLib, err)
	}

	probes := map[string]*ebpf.Program{
		"cudaLaunchKernel": objs.HandleCudaLaunch,
		"cudaMalloc":       objs.HandleCudaMalloc,
		"cudaMemcpy":       objs.HandleCudaMemcpy,
		"cudaMemcpyAsync":  objs.HandleCudaMemcpy,
	}

	for sym, prog := range probes {
		l, err := ex.Uprobe(sym, prog, nil)
		if err != nil {
			logger.Warn("failed to attach uprobe", "symbol", sym, "error", err)
			continue
		}
		t.links = append(t.links, l)
		logger.Info("attached uprobe", "symbol", sym)
	}

	if len(t.links) == 0 {
		objs.Close()
		return nil, fmt.Errorf("no uprobes attached; CUDA symbols not found in %s", cudaLib)
	}

	t.reader, err = ringbuf.NewReader(objs.GpuEvents)
	if err != nil {
		t.Close()
		return nil, fmt.Errorf("creating ring buffer reader: %w", err)
	}

	return t, nil
}

// Run starts reading events from the ring buffer. Blocks until ctx is cancelled.
func (t *Tracer) Run(ctx context.Context) {
	t.running.Store(true)
	t.wg.Add(1)
	defer t.wg.Done()

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		record, err := t.reader.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			t.logger.Warn("ring buffer read error", "error", err)
			continue
		}

		t.processRecord(record.RawSample)
	}
}

func (t *Tracer) processRecord(data []byte) {
	if len(data) < 1 {
		return
	}

	eventType := data[0]
	switch eventType {
	case EventTypeKernelLaunch:
		t.processKernelLaunch(data)
	case EventTypeMalloc:
		t.processMalloc(data)
	case EventTypeMemcpy:
		t.processMemcpy(data)
	default:
		t.logger.Debug("unknown GPU event type", "type", eventType)
	}
}

func (t *Tracer) processKernelLaunch(data []byte) {
	// Parse the gpu_kernel_launch_t struct.
	// Layout: flags(1) + pad(3) + pid_info(12) + kern_func_off(8) + grid(12) + block(12) + ...
	if len(data) < 48 {
		return
	}

	ev := &KernelLaunchEvent{}
	ev.PID = binary.LittleEndian.Uint32(data[4:8])
	ev.KernelAddr = binary.LittleEndian.Uint64(data[16:24])
	ev.GridX = binary.LittleEndian.Uint32(data[24:28])
	ev.GridY = binary.LittleEndian.Uint32(data[28:32])
	ev.GridZ = binary.LittleEndian.Uint32(data[32:36])
	ev.BlockX = binary.LittleEndian.Uint32(data[36:40])
	ev.BlockY = binary.LittleEndian.Uint32(data[40:44])
	ev.BlockZ = binary.LittleEndian.Uint32(data[44:48])

	ev.KernelName = t.symbols.Resolve(ev.PID, ev.KernelAddr)

	t.handler(ev)
}

func (t *Tracer) processMalloc(data []byte) {
	if len(data) < int(unsafe.Sizeof(gpueventGpuMallocT{})) {
		return
	}

	ev := &MallocEvent{}
	ev.PID = binary.LittleEndian.Uint32(data[4:8])
	ev.Size = binary.LittleEndian.Uint64(data[16:24])

	t.handler(ev)
}

func (t *Tracer) processMemcpy(data []byte) {
	if len(data) < 24 {
		return
	}

	ev := &MemcpyEvent{}
	ev.Kind = data[1]
	ev.PID = binary.LittleEndian.Uint32(data[4:8])
	ev.Size = binary.LittleEndian.Uint64(data[16:24])

	t.handler(ev)
}

// Close detaches all probes and frees resources.
func (t *Tracer) Close() {
	if t.reader != nil {
		t.reader.Close()
	}
	for _, l := range t.links {
		l.Close()
	}
	t.wg.Wait()
}

// findCudaLib searches for libcudart.so in common locations.
func findCudaLib() string {
	candidates := []string{
		"/usr/local/cuda/lib64/libcudart.so",
		"/usr/lib/x86_64-linux-gnu/libcudart.so",
		"/usr/lib64/libcudart.so",
		"/usr/lib/libcudart.so",
	}

	// Also check LD_LIBRARY_PATH
	if ldPath := os.Getenv("LD_LIBRARY_PATH"); ldPath != "" {
		for _, dir := range strings.Split(ldPath, ":") {
			candidates = append(candidates, filepath.Join(dir, "libcudart.so"))
		}
	}

	// Check CUDA_HOME
	if cudaHome := os.Getenv("CUDA_HOME"); cudaHome != "" {
		candidates = append(candidates,
			filepath.Join(cudaHome, "lib64", "libcudart.so"),
			filepath.Join(cudaHome, "lib", "libcudart.so"),
		)
	}

	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	// Try to find via /etc/ld.so.cache by searching /usr/local/cuda*/lib64/
	matches, _ := filepath.Glob("/usr/local/cuda*/lib64/libcudart.so")
	if len(matches) > 0 {
		return matches[len(matches)-1]
	}

	return ""
}
