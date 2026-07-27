//go:build linux && (amd64 || arm64)

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
	"syscall"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
)

//go:generate ./tracer.sh

// Tracer manages eBPF programs for CUDA runtime interception.
type Tracer struct {
	logger  *slog.Logger
	objs    *gpueventObjects
	reader  *ringbuf.Reader
	links   []link.Link
	handler EventHandler
	symbols *SymbolResolver
	running atomic.Bool
	wg      sync.WaitGroup
	dropped atomic.Uint64
}

// NewTracer loads eBPF programs and attaches uprobes to CUDA libraries.
func NewTracer(logger *slog.Logger, handler EventHandler) (*Tracer, error) {
	libs := findCudaLibs()
	if len(libs) == 0 {
		return nil, fmt.Errorf("libcudart.so* not found; CUDA runtime is not installed")
	}

	spec, err := loadGpuevent()
	if err != nil {
		return nil, fmt.Errorf("loading eBPF spec: %w", err)
	}

	objs := new(gpueventObjects)
	if err := spec.LoadAndAssign(objs, &ebpf.CollectionOptions{}); err != nil {
		return nil, fmt.Errorf("loading eBPF objects: %w", err)
	}

	t := &Tracer{
		logger:  logger,
		objs:    objs,
		handler: handler,
		symbols: NewSymbolResolver(logger),
	}

	uprobes := map[string]*ebpf.Program{
		"cudaLaunchKernel":      objs.HandleCudaLaunch,
		"cudaMalloc":            objs.HandleCudaMallocEnter,
		"cudaFree":              objs.HandleCudaFree,
		"cudaMemcpyAsync":       objs.HandleCudaMemcpyAsync,
		"cudaStreamSynchronize": objs.HandleCudaStreamSyncEnter,
		"cudaSetDevice":         objs.HandleCudaSetDeviceEnter,
	}
	uretprobes := map[string]*ebpf.Program{
		"cudaMalloc":            objs.HandleCudaMalloc,
		"cudaMemcpy":            objs.HandleCudaMemcpy,
		"cudaStreamSynchronize": objs.HandleCudaStreamSync,
		"cudaDeviceSynchronize": objs.HandleCudaDeviceSync,
		"cudaSetDevice":         objs.HandleCudaSetDevice,
	}

	for _, cudaLib := range libs {
		logger.Info("attaching CUDA probes", "path", cudaLib)
		ex, err := link.OpenExecutable(cudaLib)
		if err != nil {
			logger.Warn("opening CUDA lib failed", "path", cudaLib, "error", err)
			continue
		}
		for sym, prog := range uprobes {
			if prog == nil {
				continue
			}
			l, err := ex.Uprobe(sym, prog, nil)
			if err != nil {
				logger.Warn("failed to attach uprobe", "symbol", sym, "path", cudaLib, "error", err)
				continue
			}
			t.links = append(t.links, l)
			logger.Info("attached uprobe", "symbol", sym, "path", cudaLib)
		}
		for sym, prog := range uretprobes {
			if prog == nil {
				continue
			}
			l, err := ex.Uretprobe(sym, prog, nil)
			if err != nil {
				logger.Warn("failed to attach uretprobe", "symbol", sym, "path", cudaLib, "error", err)
				continue
			}
			t.links = append(t.links, l)
			logger.Info("attached uretprobe", "symbol", sym, "path", cudaLib)
		}
	}

	if len(t.links) == 0 {
		t.Close()
		return nil, fmt.Errorf("no uprobes attached; CUDA symbols not found in %v", libs)
	}

	t.reader, err = ringbuf.NewReader(objs.GpuEvents)
	if err != nil {
		t.Close()
		return nil, fmt.Errorf("creating ring buffer reader: %w", err)
	}

	return t, nil
}

// Dropped returns approximate count of events that failed ringbuf reserve (not
// directly visible from userspace; reserved for future BPF stats map).
func (t *Tracer) Dropped() uint64 { return t.dropped.Load() }

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
	case EventTypeMalloc, EventTypeFree:
		t.processMalloc(data, eventType)
	case EventTypeMemcpy:
		t.processMemcpy(data)
	case EventTypeSync, EventTypeSyncDevice:
		t.processSync(data, eventType == EventTypeSyncDevice)
	case EventTypeSetDevice:
		t.processSetDevice(data)
	default:
		t.logger.Debug("unknown GPU event type", "type", eventType)
	}
}

func parseHeader(data []byte) (eventMeta, bool) {
	// cuda_event_header_t: type(1)+pad(1)+device_idx(2)+pid(4)+tid(4)+pad(4)+stream(8)+ktime(8) = 32
	if len(data) < 32 {
		return eventMeta{}, false
	}
	return eventMeta{
		PID:       binary.LittleEndian.Uint32(data[4:8]),
		TID:       binary.LittleEndian.Uint32(data[8:12]),
		DeviceIdx: binary.LittleEndian.Uint16(data[2:4]),
		StreamID:  binary.LittleEndian.Uint64(data[16:24]),
		KtimeNs:   binary.LittleEndian.Uint64(data[24:32]),
	}, true
}

func (t *Tracer) processKernelLaunch(data []byte) {
	// header(32) + kern(8) + grid(12) + block(12) + shared(4) + pad(4) = 72
	if len(data) < 72 {
		return
	}
	meta, ok := parseHeader(data)
	if !ok {
		return
	}
	ev := &KernelLaunchEvent{eventMeta: meta}
	ev.KernelAddr = binary.LittleEndian.Uint64(data[32:40])
	ev.GridX = binary.LittleEndian.Uint32(data[40:44])
	ev.GridY = binary.LittleEndian.Uint32(data[44:48])
	ev.GridZ = binary.LittleEndian.Uint32(data[48:52])
	ev.BlockX = binary.LittleEndian.Uint32(data[52:56])
	ev.BlockY = binary.LittleEndian.Uint32(data[56:60])
	ev.BlockZ = binary.LittleEndian.Uint32(data[60:64])
	ev.SharedMemBytes = binary.LittleEndian.Uint32(data[64:68])
	ev.KernelName = t.symbols.Resolve(ev.PID, ev.KernelAddr)
	t.handler(ev)
}

func (t *Tracer) processMalloc(data []byte, typ uint8) {
	if len(data) < 40 {
		return
	}
	meta, ok := parseHeader(data)
	if !ok {
		return
	}
	if typ == EventTypeFree {
		t.handler(&FreeEvent{eventMeta: meta})
		return
	}
	ev := &MallocEvent{eventMeta: meta}
	ev.Size = binary.LittleEndian.Uint64(data[32:40])
	t.handler(ev)
}

func (t *Tracer) processMemcpy(data []byte) {
	if len(data) < 48 {
		return
	}
	meta, ok := parseHeader(data)
	if !ok {
		return
	}
	ev := &MemcpyEvent{eventMeta: meta}
	ev.Size = binary.LittleEndian.Uint64(data[32:40])
	ev.Kind = data[40]
	t.handler(ev)
}

func (t *Tracer) processSync(data []byte, deviceWide bool) {
	meta, ok := parseHeader(data)
	if !ok {
		return
	}
	t.handler(&SyncEvent{eventMeta: meta, DeviceWide: deviceWide})
}

func (t *Tracer) processSetDevice(data []byte) {
	if len(data) < 40 {
		return
	}
	meta, ok := parseHeader(data)
	if !ok {
		return
	}
	ev := &SetDeviceEvent{eventMeta: meta}
	ev.Device = int32(binary.LittleEndian.Uint32(data[32:36]))
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
	if t.objs != nil {
		t.objs.Close()
	}
	t.wg.Wait()
}

// findCudaLibs finds libcudart shared libraries (including versioned sonames).
// Symlinks and duplicate paths that resolve to the same inode are attached once.
func findCudaLibs() []string {
	seenPath := make(map[string]struct{})
	seenInode := make(map[string]struct{})
	var out []string
	add := func(path string) {
		if path == "" {
			return
		}
		fi, err := os.Stat(path)
		if err != nil {
			return
		}
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			resolved = path
		}
		if _, ok := seenPath[resolved]; ok {
			return
		}
		if sys, ok := fi.Sys().(*syscall.Stat_t); ok {
			key := fmt.Sprintf("%d:%d", sys.Dev, sys.Ino)
			if _, ok := seenInode[key]; ok {
				return
			}
			seenInode[key] = struct{}{}
		}
		seenPath[resolved] = struct{}{}
		out = append(out, resolved)
	}

	candidates := []string{
		"/usr/local/cuda/lib64/libcudart.so",
		"/usr/lib/x86_64-linux-gnu/libcudart.so",
		"/usr/lib/aarch64-linux-gnu/libcudart.so",
		"/usr/lib64/libcudart.so",
		"/usr/lib/libcudart.so",
	}
	if ldPath := os.Getenv("LD_LIBRARY_PATH"); ldPath != "" {
		for _, dir := range strings.Split(ldPath, ":") {
			candidates = append(candidates, filepath.Join(dir, "libcudart.so"))
		}
	}
	if cudaHome := os.Getenv("CUDA_HOME"); cudaHome != "" {
		candidates = append(candidates,
			filepath.Join(cudaHome, "lib64", "libcudart.so"),
			filepath.Join(cudaHome, "lib", "libcudart.so"),
		)
	}
	for _, path := range candidates {
		add(path)
	}

	globs := []string{
		"/usr/local/cuda*/lib64/libcudart.so*",
		"/usr/lib/x86_64-linux-gnu/libcudart.so*",
		"/usr/lib/aarch64-linux-gnu/libcudart.so*",
		"/usr/local/lib/python*/dist-packages/nvidia/cuda_runtime/lib/libcudart.so*",
		"/usr/lib/python*/site-packages/nvidia/cuda_runtime/lib/libcudart.so*",
	}
	for _, g := range globs {
		matches, _ := filepath.Glob(g)
		for _, m := range matches {
			if strings.Contains(filepath.Base(m), ".so") {
				add(m)
			}
		}
	}

	return out
}

func findCudaLib() string {
	libs := findCudaLibs()
	if len(libs) == 0 {
		return ""
	}
	return libs[0]
}
