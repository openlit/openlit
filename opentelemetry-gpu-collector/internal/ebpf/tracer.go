//go:build linux && (amd64 || arm64)

package ebpf

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

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
	closed  atomic.Bool
	wg      sync.WaitGroup
	dropped atomic.Uint64

	mu            sync.Mutex
	attachedInode map[string]struct{} // successfully attached, or permanently skipped
	uprobes       map[string]*ebpf.Program
	uretprobes    map[string]*ebpf.Program
	stop          chan struct{}
	runStarted    bool
}

// NewTracer loads eBPF programs and attaches uprobes to CUDA libraries.
// Libraries are discovered from the filesystem and from /proc/*/maps (fleet-friendly
// with host PID visibility). If none are present yet, the tracer still starts and
// periodically rescans so late-starting CUDA workloads are picked up.
func NewTracer(logger *slog.Logger, handler EventHandler) (*Tracer, error) {
	spec, err := loadGpuevent()
	if err != nil {
		return nil, fmt.Errorf("loading eBPF spec: %w", err)
	}

	objs := new(gpueventObjects)
	if err := spec.LoadAndAssign(objs, &ebpf.CollectionOptions{}); err != nil {
		return nil, fmt.Errorf("loading eBPF objects: %w", err)
	}

	t := &Tracer{
		logger:        logger,
		objs:          objs,
		handler:       handler,
		symbols:       NewSymbolResolver(logger),
		attachedInode: make(map[string]struct{}),
		stop:          make(chan struct{}),
		uprobes: map[string]*ebpf.Program{
			"cudaLaunchKernel":      objs.HandleCudaLaunch,
			"cudaMalloc":            objs.HandleCudaMallocEnter,
			"cudaFree":              objs.HandleCudaFree,
			"cudaMemcpyAsync":       objs.HandleCudaMemcpyAsync,
			"cudaStreamSynchronize": objs.HandleCudaStreamSyncEnter,
			"cudaSetDevice":         objs.HandleCudaSetDeviceEnter,
		},
		uretprobes: map[string]*ebpf.Program{
			"cudaMalloc":            objs.HandleCudaMalloc,
			"cudaMemcpy":            objs.HandleCudaMemcpy,
			"cudaStreamSynchronize": objs.HandleCudaStreamSync,
			"cudaDeviceSynchronize": objs.HandleCudaDeviceSync,
			"cudaSetDevice":         objs.HandleCudaSetDevice,
		},
	}

	n := t.attachNewCudaLibs()
	if n == 0 {
		logger.Info("no CUDA runtime found yet; rescanning /proc for libcudart (Docker --pid=host / Kubernetes hostPID recommended)")
	}

	t.reader, err = ringbuf.NewReader(objs.GpuEvents)
	if err != nil {
		// Do not call Close()/wg.Wait() here — Run has not started. Free BPF objs only.
		t.closed.Store(true)
		close(t.stop)
		objs.Close()
		t.objs = nil
		return nil, fmt.Errorf("creating ring buffer reader: %w", err)
	}

	return t, nil
}

// attachNewCudaLibs discovers libcudart copies and attaches probes to new inodes.
// Returns the number of libraries newly attached.
func (t *Tracer) attachNewCudaLibs() int {
	if t.closed.Load() {
		return 0
	}
	libs := findCudaLibs()
	attached := 0
	for _, cudaLib := range libs {
		if t.attachCudaLib(cudaLib) {
			attached++
		}
	}
	return attached
}

func (t *Tracer) attachCudaLib(cudaLib string) bool {
	if t.closed.Load() {
		return false
	}
	fi, err := os.Stat(cudaLib)
	if err != nil {
		return false
	}
	var key string
	if sys, ok := fi.Sys().(*syscall.Stat_t); ok {
		key = fmt.Sprintf("%d:%d", sys.Dev, sys.Ino)
	} else {
		key = cudaLib
	}

	// Reserve the inode under the lock so concurrent rescans cannot double-attach.
	t.mu.Lock()
	if _, ok := t.attachedInode[key]; ok {
		t.mu.Unlock()
		return false
	}
	t.attachedInode[key] = struct{}{}
	t.mu.Unlock()

	unreserve := func() {
		t.mu.Lock()
		delete(t.attachedInode, key)
		t.mu.Unlock()
	}

	t.logger.Info("attaching CUDA probes", "path", cudaLib)
	ex, err := link.OpenExecutable(cudaLib)
	if err != nil {
		t.logger.Warn("opening CUDA lib failed", "path", cudaLib, "error", err)
		unreserve() // transient (e.g. process exited); allow retry
		return false
	}

	var newLinks []link.Link
	for sym, prog := range t.uprobes {
		if prog == nil {
			continue
		}
		l, err := ex.Uprobe(sym, prog, nil)
		if err != nil {
			t.logger.Warn("failed to attach uprobe", "symbol", sym, "path", cudaLib, "error", err)
			continue
		}
		newLinks = append(newLinks, l)
		t.logger.Info("attached uprobe", "symbol", sym, "path", cudaLib)
	}
	for sym, prog := range t.uretprobes {
		if prog == nil {
			continue
		}
		l, err := ex.Uretprobe(sym, prog, nil)
		if err != nil {
			t.logger.Warn("failed to attach uretprobe", "symbol", sym, "path", cudaLib, "error", err)
			continue
		}
		newLinks = append(newLinks, l)
		t.logger.Info("attached uretprobe", "symbol", sym, "path", cudaLib)
	}

	if len(newLinks) == 0 {
		// Keep inode reserved to avoid log spam every rescan on stripped/non-CUDA .so.
		t.logger.Warn("no CUDA symbols attached; skipping further attempts for this library", "path", cudaLib)
		return false
	}

	if t.closed.Load() {
		for _, l := range newLinks {
			l.Close()
		}
		return false
	}

	t.mu.Lock()
	t.links = append(t.links, newLinks...)
	t.mu.Unlock()
	return true
}

// Dropped returns approximate count of events that failed ringbuf reserve (not
// directly visible from userspace; reserved for future BPF stats map).
func (t *Tracer) Dropped() uint64 { return t.dropped.Load() }

// Run starts reading events from the ring buffer. Blocks until ctx is cancelled
// or Close is called.
func (t *Tracer) Run(ctx context.Context) {
	t.mu.Lock()
	if t.closed.Load() {
		t.mu.Unlock()
		return
	}
	t.wg.Add(2) // this goroutine + rescan
	t.runStarted = true
	t.running.Store(true)
	t.mu.Unlock()
	defer t.wg.Done()

	go func() {
		defer t.wg.Done()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.stop:
				return
			case <-ticker.C:
				if n := t.attachNewCudaLibs(); n > 0 {
					t.logger.Info("attached CUDA probes after /proc rescan", "libraries", n)
				}
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-t.stop:
			return
		default:
		}

		record, err := t.reader.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			if t.closed.Load() {
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
// Safe to call before Run. Callers should cancel the Run context first when active.
func (t *Tracer) Close() {
	t.mu.Lock()
	if t.closed.Load() {
		t.mu.Unlock()
		return
	}
	t.closed.Store(true)
	close(t.stop)
	started := t.runStarted
	t.mu.Unlock()

	if t.reader != nil {
		t.reader.Close()
	}
	if started {
		t.wg.Wait()
	}

	t.mu.Lock()
	links := t.links
	t.links = nil
	t.mu.Unlock()
	for _, l := range links {
		l.Close()
	}
	if t.objs != nil {
		t.objs.Close()
		t.objs = nil
	}
}
