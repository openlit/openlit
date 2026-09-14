// Package cudaspans owns shared CUDA launch→sync device attribution.
package cudaspans

import (
	"sync"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

const threadDevMaxSize = 8192

// DeviceResolver maps cudaSetDevice(index) onto NVML device identity.
//
// Resolution order for a (pid, tid):
//  1. Last successful cudaSetDevice for that thread
//  2. Sole NVIDIA GPU on the host (unambiguous)
//  3. CUDA runtime default current device 0, when index 0 is a known NVIDIA GPU
//
// CUDA_VISIBLE_DEVICES remapping is not applied: CUDA index is treated as the
// NVML index. That assumption already applies to NoteSetDevice.
type DeviceResolver struct {
	mu sync.Mutex

	indexUUID map[int]string
	indexName map[int]string
	indexPCI  map[int]string
	threadDev map[uint64]int // pid<<32|tid → CUDA device index
	soleIndex int            // set when exactly one NVIDIA device; else -1
}

// NewDeviceResolver builds a resolver from discovered GPUs.
func NewDeviceResolver(devices []gpu.Device) *DeviceResolver {
	r := &DeviceResolver{
		indexUUID: make(map[int]string),
		indexName: make(map[int]string),
		indexPCI:  make(map[int]string),
		threadDev: make(map[uint64]int),
		soleIndex: -1,
	}
	n := 0
	sole := -1
	for _, d := range devices {
		info := d.Info()
		if info.Vendor != gpu.VendorNVIDIA || info.UUID == "" {
			continue
		}
		r.indexUUID[info.Index] = info.UUID
		r.indexName[info.Index] = info.Name
		r.indexPCI[info.Index] = info.PCIAddress
		sole = info.Index
		n++
	}
	if n == 1 {
		r.soleIndex = sole
	}
	return r
}

// SetDeviceIndexUUID registers or overrides an index→UUID mapping.
func (r *DeviceResolver) SetDeviceIndexUUID(idx int, uuid string) {
	if r == nil || uuid == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.indexUUID[idx] = uuid
}

// NoteSetDevice records the active CUDA device for a thread.
func (r *DeviceResolver) NoteSetDevice(pid, tid uint32, deviceIdx int) {
	if r == nil || deviceIdx < 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.indexUUID[deviceIdx]; !ok {
		return
	}
	if len(r.threadDev) >= threadDevMaxSize {
		n := 0
		for k := range r.threadDev {
			delete(r.threadDev, k)
			n++
			if n >= threadDevMaxSize/2 {
				break
			}
		}
	}
	r.threadDev[threadKey(pid, tid)] = deviceIdx
}

// ResolveIndex returns the CUDA device index for a thread, or -1 if unknown.
func (r *DeviceResolver) ResolveIndex(pid, tid uint32) int {
	if r == nil {
		return -1
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.resolveIndexLocked(pid, tid)
}

// ResolveUUID returns the GPU UUID for a thread (via index), or "".
func (r *DeviceResolver) ResolveUUID(pid, tid uint32) string {
	if r == nil {
		return ""
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	idx := r.resolveIndexLocked(pid, tid)
	if idx < 0 {
		return ""
	}
	return r.indexUUID[idx]
}

func (r *DeviceResolver) resolveIndexLocked(pid, tid uint32) int {
	if idx, ok := r.threadDev[threadKey(pid, tid)]; ok {
		return idx
	}
	if r.soleIndex >= 0 {
		return r.soleIndex
	}
	// CUDA runtime: current device is 0 until cudaSetDevice.
	if _, ok := r.indexUUID[0]; ok {
		return 0
	}
	return -1
}

// UUIDForIndex returns the UUID for a CUDA device index.
func (r *DeviceResolver) UUIDForIndex(idx int) string {
	if r == nil {
		return ""
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.indexUUID[idx]
}

// IndexInfo returns uuid, name, pci for an index.
func (r *DeviceResolver) IndexInfo(idx int) (uuid, name, pci string, ok bool) {
	if r == nil || idx < 0 {
		return "", "", "", false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	uuid = r.indexUUID[idx]
	if uuid == "" {
		return "", "", "", false
	}
	return uuid, r.indexName[idx], r.indexPCI[idx], true
}

// IndexForUUID returns the CUDA/NVML index for a GPU UUID.
func (r *DeviceResolver) IndexForUUID(uuid string) (int, bool) {
	if r == nil || uuid == "" {
		return -1, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for idx, u := range r.indexUUID {
		if u == uuid {
			return idx, true
		}
	}
	return -1, false
}

// ForgetPID drops thread mappings for a PID (inactive cleanup).
func (r *DeviceResolver) ForgetPID(pid uint32) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for tk := range r.threadDev {
		if uint32(tk>>32) == pid {
			delete(r.threadDev, tk)
		}
	}
}

func threadKey(pid, tid uint32) uint64 {
	return uint64(pid)<<32 | uint64(tid)
}
