//go:build windows && (amd64 || arm64)

package nvidia

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/windxg"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/winpdh"
)

const (
	nvmlSuccess                = 0
	nvmlTempGPU                = 0
	nvmlClockGraphics          = 0
	nvmlClockMem               = 1
	nvmlClockSM                = 2
	nvmlMemoryErrorCorrected   = 0
	nvmlMemoryErrorUncorrected = 1
	nvmlVolatileECC            = 0
	nvmlFeatureEnabled         = 1
)

var (
	initMu   sync.Mutex
	initDone bool
	initErr  error
	nvmlDLL  *windows.LazyDLL

	nvmlInit_v2                         *windows.LazyProc
	nvmlShutdown                        *windows.LazyProc
	nvmlDeviceGetCount_v2               *windows.LazyProc
	nvmlDeviceGetHandleByIndex_v2       *windows.LazyProc
	nvmlDeviceGetName                   *windows.LazyProc
	nvmlDeviceGetUUID                   *windows.LazyProc
	nvmlDeviceGetPciInfo_v3             *windows.LazyProc
	nvmlDeviceGetUtilizationRates       *windows.LazyProc
	nvmlDeviceGetMemoryInfo             *windows.LazyProc
	nvmlDeviceGetTemperature            *windows.LazyProc
	nvmlDeviceGetPowerUsage             *windows.LazyProc
	nvmlDeviceGetPowerManagementLimit   *windows.LazyProc
	nvmlDeviceGetTotalEnergyConsumption *windows.LazyProc
	nvmlDeviceGetClockInfo              *windows.LazyProc
	nvmlDeviceGetPcieReplayCounter      *windows.LazyProc
	nvmlDeviceGetTotalEccErrors         *windows.LazyProc
	nvmlDeviceGetEncoderUtilization     *windows.LazyProc
	nvmlDeviceGetDecoderUtilization     *windows.LazyProc
	nvmlDeviceGetNumGpuCores            *windows.LazyProc
	nvmlSystemGetDriverVersion          *windows.LazyProc
	nvmlDeviceGetPcieThroughput         *windows.LazyProc
	nvmlDeviceGetCurrentClocksThrottleReasons *windows.LazyProc
	nvmlDeviceGetNvLinkState            *windows.LazyProc
	nvmlDeviceGetNvLinkUtilizationCounter *windows.LazyProc
)

type nvmlUtilization struct {
	Gpu    uint32
	Memory uint32
}

type nvmlMemory struct {
	Total uint64
	Free  uint64
	Used  uint64
}

type nvmlPciInfo struct {
	BusIdLegacy    [16]byte
	Domain         uint32
	Bus            uint32
	Device         uint32
	PciDeviceId    uint32
	PciSubSystemId uint32
	BusId          [32]byte
}

// Device implements gpu.Device for NVIDIA GPUs via nvml.dll on Windows.
type Device struct {
	handle       uintptr
	info         gpu.DeviceInfo
	luidKey      string
	logger       *slog.Logger
	nvlinkRxPrev uint64
	nvlinkTxPrev uint64
	nvlinkLast   time.Time
}

func loadNVML() error {
	candidates := []string{
		"nvml.dll",
		filepath.Join(os.Getenv("SystemRoot"), "System32", "nvml.dll"),
	}
	if prog := os.Getenv("ProgramW6432"); prog != "" {
		candidates = append(candidates, filepath.Join(prog, "NVIDIA Corporation", "NVSMI", "nvml.dll"))
	}
	if prog := os.Getenv("ProgramFiles"); prog != "" {
		candidates = append(candidates, filepath.Join(prog, "NVIDIA Corporation", "NVSMI", "nvml.dll"))
	}

	var lastErr error
	for _, path := range candidates {
		dll := windows.NewLazyDLL(path)
		if err := dll.Load(); err != nil {
			lastErr = err
			continue
		}
		nvmlDLL = dll
		bindProcs()
		return nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("nvml.dll not found")
	}
	return lastErr
}

func bindProcs() {
	nvmlInit_v2 = nvmlDLL.NewProc("nvmlInit_v2")
	nvmlShutdown = nvmlDLL.NewProc("nvmlShutdown")
	nvmlDeviceGetCount_v2 = nvmlDLL.NewProc("nvmlDeviceGetCount_v2")
	nvmlDeviceGetHandleByIndex_v2 = nvmlDLL.NewProc("nvmlDeviceGetHandleByIndex_v2")
	nvmlDeviceGetName = nvmlDLL.NewProc("nvmlDeviceGetName")
	nvmlDeviceGetUUID = nvmlDLL.NewProc("nvmlDeviceGetUUID")
	nvmlDeviceGetPciInfo_v3 = nvmlDLL.NewProc("nvmlDeviceGetPciInfo_v3")
	nvmlDeviceGetUtilizationRates = nvmlDLL.NewProc("nvmlDeviceGetUtilizationRates")
	nvmlDeviceGetMemoryInfo = nvmlDLL.NewProc("nvmlDeviceGetMemoryInfo")
	nvmlDeviceGetTemperature = nvmlDLL.NewProc("nvmlDeviceGetTemperature")
	nvmlDeviceGetPowerUsage = nvmlDLL.NewProc("nvmlDeviceGetPowerUsage")
	nvmlDeviceGetPowerManagementLimit = nvmlDLL.NewProc("nvmlDeviceGetPowerManagementLimit")
	nvmlDeviceGetTotalEnergyConsumption = nvmlDLL.NewProc("nvmlDeviceGetTotalEnergyConsumption")
	nvmlDeviceGetClockInfo = nvmlDLL.NewProc("nvmlDeviceGetClockInfo")
	nvmlDeviceGetPcieReplayCounter = nvmlDLL.NewProc("nvmlDeviceGetPcieReplayCounter")
	nvmlDeviceGetTotalEccErrors = nvmlDLL.NewProc("nvmlDeviceGetTotalEccErrors")
	nvmlDeviceGetEncoderUtilization = nvmlDLL.NewProc("nvmlDeviceGetEncoderUtilization")
	nvmlDeviceGetDecoderUtilization = nvmlDLL.NewProc("nvmlDeviceGetDecoderUtilization")
	nvmlDeviceGetNumGpuCores = nvmlDLL.NewProc("nvmlDeviceGetNumGpuCores")
	nvmlSystemGetDriverVersion = nvmlDLL.NewProc("nvmlSystemGetDriverVersion")
	nvmlDeviceGetPcieThroughput = nvmlDLL.NewProc("nvmlDeviceGetPcieThroughput")
	nvmlDeviceGetCurrentClocksThrottleReasons = nvmlDLL.NewProc("nvmlDeviceGetCurrentClocksThrottleReasons")
	nvmlDeviceGetNvLinkState = nvmlDLL.NewProc("nvmlDeviceGetNvLinkState")
	nvmlDeviceGetNvLinkUtilizationCounter = nvmlDLL.NewProc("nvmlDeviceGetNvLinkUtilizationCounter")
}

// InitNVML initializes NVML via nvml.dll.
func InitNVML() error {
	initMu.Lock()
	defer initMu.Unlock()
	if initDone && initErr == nil {
		return nil
	}
	if err := loadNVML(); err != nil {
		initDone = false
		initErr = err
		return initErr
	}
	ret, _, _ := nvmlInit_v2.Call()
	if ret != nvmlSuccess {
		initDone = false
		initErr = fmt.Errorf("nvmlInit_v2: %d", ret)
		return initErr
	}
	initDone = true
	initErr = nil
	return nil
}

// ShutdownNVML shuts down NVML.
func ShutdownNVML() {
	initMu.Lock()
	defer initMu.Unlock()
	if initDone && nvmlShutdown != nil {
		nvmlShutdown.Call()
	}
	initDone = false
	initErr = nil
}

// DiscoverDevices returns NVIDIA GPUs via NVML on Windows.
func DiscoverDevices(logger *slog.Logger) ([]*Device, error) {
	if err := InitNVML(); err != nil {
		return nil, err
	}

	var count uint32
	ret, _, _ := nvmlDeviceGetCount_v2.Call(uintptr(unsafe.Pointer(&count)))
	if ret != nvmlSuccess {
		return nil, fmt.Errorf("DeviceGetCount: %d", ret)
	}

	driverVersion := "unknown"
	var drvBuf [80]byte
	if ret, _, _ := nvmlSystemGetDriverVersion.Call(uintptr(unsafe.Pointer(&drvBuf[0])), 80); ret == nvmlSuccess {
		driverVersion = cString(drvBuf[:])
	}

	var nvidiaLUIDs []string
	if adapters, err := windxg.EnumAdapters(); err == nil {
		for _, a := range adapters {
			if a.VendorID == windxg.VendorNVIDIA {
				nvidiaLUIDs = append(nvidiaLUIDs, a.LUIDKey)
			}
		}
	}

	devices := make([]*Device, 0, count)
	for i := uint32(0); i < count; i++ {
		var handle uintptr
		ret, _, _ := nvmlDeviceGetHandleByIndex_v2.Call(uintptr(i), uintptr(unsafe.Pointer(&handle)))
		if ret != nvmlSuccess {
			logger.Warn("skipping NVIDIA GPU", "index", i, "error", ret)
			continue
		}

		var nameBuf [96]byte
		nvmlDeviceGetName.Call(handle, uintptr(unsafe.Pointer(&nameBuf[0])), 96)
		name := cString(nameBuf[:])

		var uuidBuf [96]byte
		nvmlDeviceGetUUID.Call(handle, uintptr(unsafe.Pointer(&uuidBuf[0])), 96)
		uuid := cString(uuidBuf[:])

		var pci nvmlPciInfo
		nvmlDeviceGetPciInfo_v3.Call(handle, uintptr(unsafe.Pointer(&pci)))
		pciAddr := cString(pci.BusId[:])
		if pciAddr == "" {
			pciAddr = fmt.Sprintf("%04x:%02x:%02x.0", pci.Domain, pci.Bus, pci.Device)
		}

		coreCount := 0
		var cores uint32
		if ret, _, _ := nvmlDeviceGetNumGpuCores.Call(handle, uintptr(unsafe.Pointer(&cores))); ret == nvmlSuccess {
			coreCount = int(cores)
		}

		// Match LUID by successful NVIDIA ordinal (not display name — duplicates collide).
		ord := len(devices)
		luidKey := ""
		if ord < len(nvidiaLUIDs) {
			luidKey = nvidiaLUIDs[ord]
		}

		devices = append(devices, &Device{
			handle: handle,
			info: gpu.DeviceInfo{
				Vendor:        gpu.VendorNVIDIA,
				Index:         ord,
				Name:          name,
				UUID:          uuid,
				PCIAddress:    pciAddr,
				DriverVersion: driverVersion,
				CoreCount:     coreCount,
			},
			luidKey: luidKey,
			logger:  logger.With("gpu", ord, "vendor", "nvidia"),
		})
	}
	return devices, nil
}

func (d *Device) Info() gpu.DeviceInfo { return d.info }

func (d *Device) Collect() (*gpu.Snapshot, error) {
	s := &gpu.Snapshot{}
	h := d.handle

	var util nvmlUtilization
	if ret, _, _ := nvmlDeviceGetUtilizationRates.Call(h, uintptr(unsafe.Pointer(&util))); ret == nvmlSuccess {
		gpuUtil := float64(util.Gpu)
		memUtil := float64(util.Memory)
		s.Utilization = &gpuUtil
		s.MemoryUtilization = &memUtil
	}

	var encUtil, encSample uint32
	if ret, _, _ := nvmlDeviceGetEncoderUtilization.Call(h, uintptr(unsafe.Pointer(&encUtil)), uintptr(unsafe.Pointer(&encSample))); ret == nvmlSuccess {
		v := float64(encUtil)
		s.EncoderUtilization = &v
	}
	var decUtil, decSample uint32
	if ret, _, _ := nvmlDeviceGetDecoderUtilization.Call(h, uintptr(unsafe.Pointer(&decUtil)), uintptr(unsafe.Pointer(&decSample))); ret == nvmlSuccess {
		v := float64(decUtil)
		s.DecoderUtilization = &v
	}

	var temp uint32
	if ret, _, _ := nvmlDeviceGetTemperature.Call(h, nvmlTempGPU, uintptr(unsafe.Pointer(&temp))); ret == nvmlSuccess {
		v := float64(temp)
		s.TemperatureGPU = &v
	}

	var mem nvmlMemory
	if ret, _, _ := nvmlDeviceGetMemoryInfo.Call(h, uintptr(unsafe.Pointer(&mem))); ret == nvmlSuccess {
		total := int64(mem.Total)
		used := int64(mem.Used)
		free := int64(mem.Free)
		s.MemoryTotalBytes = &total
		s.MemoryUsedBytes = &used
		s.MemoryFreeBytes = &free
	}

	var power uint32
	if ret, _, _ := nvmlDeviceGetPowerUsage.Call(h, uintptr(unsafe.Pointer(&power))); ret == nvmlSuccess {
		v := float64(power) / 1000.0
		s.PowerDrawWatts = &v
	}
	var limit uint32
	if ret, _, _ := nvmlDeviceGetPowerManagementLimit.Call(h, uintptr(unsafe.Pointer(&limit))); ret == nvmlSuccess {
		v := float64(limit) / 1000.0
		s.PowerLimitWatts = &v
	}
	var energy uint64
	if ret, _, _ := nvmlDeviceGetTotalEnergyConsumption.Call(h, uintptr(unsafe.Pointer(&energy))); ret == nvmlSuccess {
		v := float64(energy) / 1000.0
		s.EnergyJoules = &v
	}

	var clock uint32
	if ret, _, _ := nvmlDeviceGetClockInfo.Call(h, nvmlClockGraphics, uintptr(unsafe.Pointer(&clock))); ret == nvmlSuccess {
		v := float64(clock)
		s.ClockGraphicsMHz = &v
	}
	if ret, _, _ := nvmlDeviceGetClockInfo.Call(h, nvmlClockSM, uintptr(unsafe.Pointer(&clock))); ret == nvmlSuccess {
		v := float64(clock)
		s.ClockSMMHz = &v
	}
	if ret, _, _ := nvmlDeviceGetClockInfo.Call(h, nvmlClockMem, uintptr(unsafe.Pointer(&clock))); ret == nvmlSuccess {
		v := float64(clock)
		s.ClockMemoryMHz = &v
	}

	var replay uint32
	if ret, _, _ := nvmlDeviceGetPcieReplayCounter.Call(h, uintptr(unsafe.Pointer(&replay))); ret == nvmlSuccess {
		v := int64(replay)
		s.PCIeReplayErrors = &v
	}
	var ecc uint64
	if ret, _, _ := nvmlDeviceGetTotalEccErrors.Call(h, nvmlMemoryErrorCorrected, nvmlVolatileECC, uintptr(unsafe.Pointer(&ecc))); ret == nvmlSuccess {
		v := int64(ecc)
		s.ECCSingleBit = &v
	}
	if ret, _, _ := nvmlDeviceGetTotalEccErrors.Call(h, nvmlMemoryErrorUncorrected, nvmlVolatileECC, uintptr(unsafe.Pointer(&ecc))); ret == nvmlSuccess {
		v := int64(ecc)
		s.ECCDoubleBit = &v
	}

	// PCIe throughput (KB/s)
	const pcieUtilRX = 1
	const pcieUtilTX = 0
	var thr uint32
	if ret, _, _ := nvmlDeviceGetPcieThroughput.Call(h, pcieUtilRX, uintptr(unsafe.Pointer(&thr))); ret == nvmlSuccess {
		v := float64(thr) * 1024.0
		s.PCIeRxBytesPerSec = &v
	}
	if ret, _, _ := nvmlDeviceGetPcieThroughput.Call(h, pcieUtilTX, uintptr(unsafe.Pointer(&thr))); ret == nvmlSuccess {
		v := float64(thr) * 1024.0
		s.PCIeTxBytesPerSec = &v
	}

	var reasons uint64
	if ret, _, _ := nvmlDeviceGetCurrentClocksThrottleReasons.Call(h, uintptr(unsafe.Pointer(&reasons))); ret == nvmlSuccess {
		label := fmt.Sprintf("0x%x", reasons)
		s.ThrottleReasons = &label
		th := 0.0
		if reasons&(32|64|8|4|128) != 0 { // thermal/power bits
			th = 1.0
		}
		s.Throttled = &th
	}

	collectNvLinkWindows(d, s)

	return s, nil
}

func collectNvLinkWindows(d *Device, s *gpu.Snapshot) {
	if nvmlDeviceGetNvLinkState == nil || nvmlDeviceGetNvLinkUtilizationCounter == nil {
		return
	}
	var rxTotal, txTotal uint64
	var links int
	now := time.Now()
	for link := uint32(0); link < 18; link++ {
		var state uint32
		ret, _, _ := nvmlDeviceGetNvLinkState.Call(d.handle, uintptr(link), uintptr(unsafe.Pointer(&state)))
		if ret != nvmlSuccess || state != nvmlFeatureEnabled {
			continue
		}
		var rx, tx uint64
		ret, _, _ = nvmlDeviceGetNvLinkUtilizationCounter.Call(
			d.handle, uintptr(link), 0,
			uintptr(unsafe.Pointer(&rx)), uintptr(unsafe.Pointer(&tx)),
		)
		if ret != nvmlSuccess {
			continue
		}
		rxTotal += rx
		txTotal += tx
		links++
	}
	if links == 0 {
		return
	}
	s.InterconnectType = "nvlink"
	if !d.nvlinkLast.IsZero() {
		dt := now.Sub(d.nvlinkLast).Seconds()
		if dt > 0 && rxTotal >= d.nvlinkRxPrev && txTotal >= d.nvlinkTxPrev {
			rxRate := float64(rxTotal-d.nvlinkRxPrev) / dt
			txRate := float64(txTotal-d.nvlinkTxPrev) / dt
			s.InterconnectRxBytesPerSec = &rxRate
			s.InterconnectTxBytesPerSec = &txRate
		}
	}
	d.nvlinkRxPrev = rxTotal
	d.nvlinkTxPrev = txTotal
	d.nvlinkLast = now
}

func (d *Device) CollectProcesses() ([]gpu.ProcessUsage, error) {
	if d.luidKey == "" {
		return nil, nil
	}
	return winpdh.CollectForLUID(d.luidKey)
}

func (d *Device) Close() {}

func cString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

// Ensure syscall import used on some toolchains.
var _ = syscall.Errno(0)
