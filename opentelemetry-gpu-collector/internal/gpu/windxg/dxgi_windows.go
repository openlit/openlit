//go:build windows

package windxg

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Vendor PCI IDs.
const (
	VendorNVIDIA = 0x10DE
	VendorAMD    = 0x1002
	VendorIntel  = 0x8086
)

// Adapter is one DXGI adapter (GPU).
type Adapter struct {
	Name                 string
	VendorID             uint32
	DeviceID             uint32
	SubSysID             uint32
	Revision             uint32
	DedicatedVideoMemory uint64
	DedicatedSystemMem   uint64
	SharedSystemMemory   uint64
	LUID                 LUID
	LUIDKey              string // "0xHHHHHHHH_0xLLLLLLLL" for PDH matching
}

type dxgiAdapterDesc1 struct {
	Description           [128]uint16
	VendorId              uint32
	DeviceId              uint32
	SubSysId              uint32
	Revision              uint32
	DedicatedVideoMemory  uint64
	DedicatedSystemMemory uint64
	SharedSystemMemory    uint64
	AdapterLuid           LUID
	Flags                 uint32
}

var (
	modDXGI                = windows.NewLazySystemDLL("dxgi.dll")
	procCreateDXGIFactory1 = modDXGI.NewProc("CreateDXGIFactory1")
	iidIDXGIFactory1       = windows.GUID{Data1: 0x770aae78, Data2: 0xf26f, Data3: 0x4dba, Data4: [8]byte{0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87}}
)

// EnumAdapters returns discrete/integrated DXGI adapters (skips software adapters).
func EnumAdapters() ([]Adapter, error) {
	if err := modDXGI.Load(); err != nil {
		return nil, fmt.Errorf("dxgi.dll: %w", err)
	}
	var factory uintptr
	hr, _, _ := procCreateDXGIFactory1.Call(
		uintptr(unsafe.Pointer(&iidIDXGIFactory1)),
		uintptr(unsafe.Pointer(&factory)),
	)
	if hr != 0 || factory == 0 {
		return nil, fmt.Errorf("CreateDXGIFactory1: HRESULT 0x%08X", uint32(hr))
	}
	defer releaseCOM(factory)

	var out []Adapter
	for i := uint32(0); ; i++ {
		var adapter uintptr
		hr, _, _ := syscall.SyscallN(
			vtable(factory, 12), // EnumAdapters1
			factory,
			uintptr(i),
			uintptr(unsafe.Pointer(&adapter)),
		)
		if hr != 0 || adapter == 0 {
			break
		}
		var desc dxgiAdapterDesc1
		hr, _, _ = syscall.SyscallN(
			vtable(adapter, 10), // GetDesc1
			adapter,
			uintptr(unsafe.Pointer(&desc)),
		)
		releaseCOM(adapter)
		if hr != 0 {
			continue
		}
		// DXGI_ADAPTER_FLAG_SOFTWARE = 2
		if desc.Flags&2 != 0 {
			continue
		}
		name := windows.UTF16ToString(desc.Description[:])
		if isBasicDisplay(name, desc.VendorId) {
			continue
		}
		luid := desc.AdapterLuid
		out = append(out, Adapter{
			Name:                 name,
			VendorID:             desc.VendorId,
			DeviceID:             desc.DeviceId,
			SubSysID:             desc.SubSysId,
			Revision:             desc.Revision,
			DedicatedVideoMemory: desc.DedicatedVideoMemory,
			DedicatedSystemMem:   desc.DedicatedSystemMemory,
			SharedSystemMemory:   desc.SharedSystemMemory,
			LUID:                 luid,
			LUIDKey:              FormatLUIDKey(luid),
		})
	}
	return out, nil
}

func isBasicDisplay(name string, vendorID uint32) bool {
	if vendorID == 0x1414 { // Microsoft
		return true
	}
	lower := name
	if len(lower) > 0 {
		// cheap ASCII lower
		b := make([]byte, len(lower))
		for i := 0; i < len(lower); i++ {
			c := lower[i]
			if c >= 'A' && c <= 'Z' {
				c += 'a' - 'A'
			}
			b[i] = c
		}
		lower = string(b)
	}
	return contains(lower, "microsoft basic") || contains(lower, "basic render")
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		(len(s) > 0 && indexOf(s, sub) >= 0))
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func vtable(obj uintptr, index int) uintptr {
	vtbl := *(*uintptr)(unsafe.Pointer(obj))
	return *(*uintptr)(unsafe.Pointer(vtbl + uintptr(index)*unsafe.Sizeof(uintptr(0))))
}

func releaseCOM(obj uintptr) {
	if obj == 0 {
		return
	}
	syscall.SyscallN(vtable(obj, 2), obj) // IUnknown::Release
}
