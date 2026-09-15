//go:build linux

// Package amdsmi wraps AMD SMI (libamd_smi) for XGMI, RAS, and PCIe metrics.
package amdsmi

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/ebitengine/purego"
)

const (
	amdsmiLinkTypeXGMI           = 2
	amdsmiMaxXGMIPhysicalLinks   = 64
	amdsmiUnsupportedUint8       = 0xff
)

// Metrics holds AMD SMI device extras beyond sysfs.
type Metrics struct {
	PCIeRxBytesPerSec         *float64
	PCIeTxBytesPerSec         *float64
	PCIeReplayErrors          *int64
	InterconnectRxBytesPerSec *float64
	InterconnectTxBytesPerSec *float64
	RASCE                     *int64
	RASUE                     *int64
	ThrottleReasons           *string
	Throttled                 *float64
	PowerWatts                *float64
	TemperatureC              *float64
	Utilization               *float64
	// EncoderUtilization is media/VCN activity (%) when only a combined counter exists.
	EncoderUtilization *float64
	MemoryTotal        *int64
	MemoryUsed         *int64
}

type lib struct {
	handle uintptr

	amdsmiInit          func(uint64) int32
	amdsmiShut          func() int32
	getProcessorHandles func(*uint32, *uintptr) int32
	getPowerInfo        func(uintptr, *amdsmiPowerInfo) int32
	getTempMetric       func(uintptr, int32, int32, *int64) int32
	getGpuActivity      func(uintptr, *amdsmiActivity) int32
	getVramUsage        func(uintptr, *amdsmiVram) int32
	getGpuMetrics       func(uintptr, *amdsmiGpuMetrics) int32
	getPciThroughput    func(uintptr, *uint64, *uint64, *uint64) int32
	getPciReplay        func(uintptr, *uint64) int32
	getLinkMetrics      func(uintptr, *amdsmiLinkMetrics) int32
	getViolationStatus  func(uintptr, *amdsmiViolationStatus) int32
}

type amdsmiPowerInfo struct {
	CurrentSocketPower uint32
	_pad               [60]byte
}

type amdsmiActivity struct {
	GfxActivity uint32
	UmcActivity uint32
	MmActivity  uint32
}

type amdsmiVram struct {
	VramTotal uint64
	VramUsed  uint64
}

// Layout is version-sensitive; we only read fields we need after size check.
type amdsmiGpuMetrics struct {
	CommonHeader struct {
		StructureSize   uint16
		FormatRevision  uint8
		ContentRevision uint8
	}
	_pad0 [100]byte
}

// amdsmi_link_metrics_t — see ROCm amdsmi.h
type amdsmiLinkEntry struct {
	BDF          uint64
	BitRate      uint32
	MaxBandwidth uint32
	LinkType     uint32
	_            uint32
	ReadKB       uint64
	WriteKB      uint64
	Reserved     uint64
}

type amdsmiLinkMetrics struct {
	NumLinks uint32
	_        uint32
	Links    [amdsmiMaxXGMIPhysicalLinks]amdsmiLinkEntry
	Reserved [7]uint64
}

// Truncated + oversized pad so newer MI3x fields can be written safely.
type amdsmiViolationStatus struct {
	ReferenceTimestamp uint64
	ViolationTimestamp uint64
	AccCounter         uint64
	AccProchot         uint64
	AccPpt             uint64
	AccSocket          uint64
	AccVr              uint64
	AccHbm             uint64
	AccGfxClk          uint64
	PerProchot         uint64
	PerPpt             uint64
	PerSocket          uint64
	PerVr              uint64
	PerHbm             uint64
	PerGfxClk          uint64
	ActiveProchot      uint8
	ActivePpt          uint8
	ActiveSocket       uint8
	ActiveVr           uint8
	ActiveHbm          uint8
	ActiveGfxClk       uint8
	_                  [2]byte
	// Remaining driver 1.8+ fields (XCP×XCC arrays) — keep large enough.
	_rest [8 * 1024]byte
}

type xgmiPrev struct {
	readKB  uint64
	writeKB uint64
	at      time.Time
}

var (
	once sync.Once
	l    *lib
	errL error

	handlesMu     sync.Mutex
	cachedHandles []uintptr

	xgmiMu   sync.Mutex
	xgmiPrevByIndex = map[int]*xgmiPrev{}
)

// Init loads libamd_smi.
func Init() error {
	once.Do(func() {
		for _, name := range []string{"libamd_smi.so", "libamd_smi.so.1"} {
			h, err := purego.Dlopen(name, purego.RTLD_NOW|purego.RTLD_GLOBAL)
			if err != nil {
				continue
			}
			l = &lib{handle: h}
			bind := func(name string, fptr any) {
				sym, err := purego.Dlsym(h, name)
				if err != nil {
					return
				}
				purego.RegisterFunc(fptr, sym)
			}
			bind("amdsmi_init", &l.amdsmiInit)
			bind("amdsmi_shut_down", &l.amdsmiShut)
			bind("amdsmi_get_processor_handles", &l.getProcessorHandles)
			bind("amdsmi_get_power_info", &l.getPowerInfo)
			bind("amdsmi_get_temp_metric", &l.getTempMetric)
			bind("amdsmi_get_gpu_activity", &l.getGpuActivity)
			bind("amdsmi_get_gpu_vram_usage", &l.getVramUsage)
			bind("amdsmi_get_gpu_metrics_info", &l.getGpuMetrics)
			bind("amdsmi_get_gpu_pci_throughput", &l.getPciThroughput)
			bind("amdsmi_get_gpu_pci_replay_counter", &l.getPciReplay)
			bind("amdsmi_get_link_metrics", &l.getLinkMetrics)
			bind("amdsmi_get_violation_status", &l.getViolationStatus)
			if l.amdsmiInit == nil || l.getProcessorHandles == nil {
				errL = fmt.Errorf("amdsmi required symbols missing")
				l = nil
				return
			}
			// AMDSMI_INIT_AMD_GPUS = 1 << 0 typically; try 0 for all.
			if rc := l.amdsmiInit(1); rc != 0 {
				if rc2 := l.amdsmiInit(0); rc2 != 0 {
					errL = fmt.Errorf("amdsmi_init: %d", rc)
					l = nil
					return
				}
			}
			return
		}
		errL = fmt.Errorf("libamd_smi not found")
	})
	return errL
}

// Available reports whether AMD SMI loaded.
func Available() bool {
	return Init() == nil && l != nil
}

// Collect returns AMD SMI metrics for processor index.
func Collect(index int) (Metrics, bool) {
	if !Available() || l.getProcessorHandles == nil {
		return Metrics{}, false
	}
	handlesMu.Lock()
	if cachedHandles == nil {
		var n uint32
		if l.getProcessorHandles(&n, nil) != 0 || n == 0 {
			handlesMu.Unlock()
			return Metrics{}, false
		}
		handles := make([]uintptr, n)
		if l.getProcessorHandles(&n, &handles[0]) != 0 {
			handlesMu.Unlock()
			return Metrics{}, false
		}
		cachedHandles = handles
	}
	handles := cachedHandles
	handlesMu.Unlock()

	if index < 0 || index >= len(handles) {
		return Metrics{}, false
	}
	h := handles[index]
	m := Metrics{}

	if l.getPowerInfo != nil {
		var pi amdsmiPowerInfo
		if l.getPowerInfo(h, &pi) == 0 && pi.CurrentSocketPower > 0 {
			p := float64(pi.CurrentSocketPower)
			m.PowerWatts = &p
		}
	}
	if l.getTempMetric != nil {
		// AMDSMI_TEMPERATURE_TYPE_EDGE = 0, CURRENT = 0
		var t int64
		if l.getTempMetric(h, 0, 0, &t) == 0 {
			tc := float64(t)
			m.TemperatureC = &tc
		}
	}
	if l.getGpuActivity != nil {
		var a amdsmiActivity
		if l.getGpuActivity(h, &a) == 0 {
			u := float64(a.GfxActivity)
			m.Utilization = &u
			// Combined media/VCN — encoder only when value looks like a percent.
			if a.MmActivity <= 100 {
				enc := float64(a.MmActivity)
				m.EncoderUtilization = &enc
			}
		}
	}
	if l.getVramUsage != nil {
		var v amdsmiVram
		if l.getVramUsage(h, &v) == 0 && v.VramTotal > 0 {
			tot := int64(v.VramTotal)
			used := v.VramUsed
			if used > v.VramTotal {
				used = v.VramTotal
			}
			u := int64(used)
			m.MemoryTotal = &tot
			m.MemoryUsed = &u
		}
	}

	if l.getPciThroughput != nil {
		var sent, recv, maxPkt uint64
		if l.getPciThroughput(h, &sent, &recv, &maxPkt) == 0 {
			// API returns bytes transferred in the last ~1 second.
			tx := float64(sent)
			rx := float64(recv)
			m.PCIeTxBytesPerSec = &tx
			m.PCIeRxBytesPerSec = &rx
		}
	}
	if l.getPciReplay != nil {
		var counter uint64
		if l.getPciReplay(h, &counter) == 0 {
			v := int64(counter)
			m.PCIeReplayErrors = &v
		}
	}

	collectXGMI(index, h, &m)
	collectThrottle(h, &m)

	ok := m.PowerWatts != nil || m.TemperatureC != nil || m.Utilization != nil || m.MemoryTotal != nil ||
		m.PCIeRxBytesPerSec != nil || m.InterconnectRxBytesPerSec != nil || m.Throttled != nil ||
		m.EncoderUtilization != nil || m.PCIeReplayErrors != nil
	return m, ok
}

func collectXGMI(index int, h uintptr, m *Metrics) {
	if l.getLinkMetrics == nil {
		return
	}
	var lm amdsmiLinkMetrics
	if l.getLinkMetrics(h, &lm) != 0 {
		return
	}
	var readKB, writeKB uint64
	var n int
	maxN := int(lm.NumLinks)
	if maxN > amdsmiMaxXGMIPhysicalLinks {
		maxN = amdsmiMaxXGMIPhysicalLinks
	}
	for i := 0; i < maxN; i++ {
		link := lm.Links[i]
		if link.LinkType != amdsmiLinkTypeXGMI {
			continue
		}
		readKB += link.ReadKB
		writeKB += link.WriteKB
		n++
	}
	if n == 0 {
		return
	}
	now := time.Now()
	xgmiMu.Lock()
	prev := xgmiPrevByIndex[index]
	if prev != nil && !prev.at.IsZero() {
		dt := now.Sub(prev.at).Seconds()
		if dt > 0 && readKB >= prev.readKB && writeKB >= prev.writeKB {
			if rx, tx, ok := XGMIRateBytesPerSec(prev.readKB, prev.writeKB, readKB, writeKB, dt); ok {
				m.InterconnectRxBytesPerSec = &rx
				m.InterconnectTxBytesPerSec = &tx
			}
		}
	}
	xgmiPrevByIndex[index] = &xgmiPrev{readKB: readKB, writeKB: writeKB, at: now}
	xgmiMu.Unlock()
}

func collectThrottle(h uintptr, m *Metrics) {
	if l.getViolationStatus == nil {
		return
	}
	var vs amdsmiViolationStatus
	if l.getViolationStatus(h, &vs) != 0 {
		return
	}
	parts := make([]string, 0, 6)
	active := false
	check := func(v uint8, name string) {
		if v == amdsmiUnsupportedUint8 {
			return
		}
		if v != 0 {
			active = true
			parts = append(parts, name)
		}
	}
	check(vs.ActiveProchot, "prochot")
	check(vs.ActivePpt, "ppt_power")
	check(vs.ActiveSocket, "socket_thermal")
	check(vs.ActiveVr, "vr_thermal")
	check(vs.ActiveHbm, "hbm_thermal")
	check(vs.ActiveGfxClk, "gfx_clk_limit")

	// If all active flags unsupported, soft-omit.
	if vs.ActiveProchot == amdsmiUnsupportedUint8 &&
		vs.ActivePpt == amdsmiUnsupportedUint8 &&
		vs.ActiveSocket == amdsmiUnsupportedUint8 &&
		vs.ActiveVr == amdsmiUnsupportedUint8 &&
		vs.ActiveHbm == amdsmiUnsupportedUint8 &&
		vs.ActiveGfxClk == amdsmiUnsupportedUint8 {
		return
	}

	th := 0.0
	if active {
		th = 1.0
	}
	m.Throttled = &th
	label := "none"
	if len(parts) > 0 {
		label = strings.Join(parts, ",")
	}
	m.ThrottleReasons = &label
}

// CollectRAS reads RAS UE/CE from sysfs for a DRM device path.
func CollectRAS(drmDevicePath string) (ce, ue *int64) {
	return readRAS(drmDevicePath)
}
