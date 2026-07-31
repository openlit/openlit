//go:build linux && (amd64 || arm64) && cgo

package nvidia

import (
	"strings"
	"sync/atomic"
	"time"

	"github.com/NVIDIA/go-nvml/pkg/nvml"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

func collectExtended(d *Device, s *gpu.Snapshot) {
	// PCIe throughput: NVML returns KB/s.
	if rx, ret := d.handle.GetPcieThroughput(nvml.PCIE_UTIL_RX_BYTES); ret == nvml.SUCCESS {
		v := float64(rx) * 1024.0
		s.PCIeRxBytesPerSec = &v
	}
	if tx, ret := d.handle.GetPcieThroughput(nvml.PCIE_UTIL_TX_BYTES); ret == nvml.SUCCESS {
		v := float64(tx) * 1024.0
		s.PCIeTxBytesPerSec = &v
	}

	if reasons, ret := d.handle.GetCurrentClocksThrottleReasons(); ret == nvml.SUCCESS {
		label := throttleLabel(reasons)
		s.ThrottleReasons = &label
		th := 0.0
		// Idle-only is not "throttled" for LLM health; treat thermal/power as throttled.
		if reasons&(nvml.ClocksThrottleReasonSwThermalSlowdown|
			nvml.ClocksThrottleReasonHwThermalSlowdown|
			nvml.ClocksThrottleReasonHwSlowdown|
			nvml.ClocksThrottleReasonSwPowerCap|
			nvml.ClocksThrottleReasonHwPowerBrakeSlowdown) != 0 {
			th = 1.0
		}
		s.Throttled = &th
	}

	collectNvLink(d, s)

	if xid := atomic.LoadInt64(&d.xidCount); xid > 0 {
		v := xid
		s.XIDErrors = &v
	}
}

func collectNvLink(d *Device, s *gpu.Snapshot) {
	var rxTotal, txTotal uint64
	var links int
	now := time.Now()
	for link := 0; link < 18; link++ {
		state, ret := d.handle.GetNvLinkState(link)
		if ret != nvml.SUCCESS || state != nvml.FEATURE_ENABLED {
			continue
		}
		rx, tx, ret := d.handle.GetNvLinkUtilizationCounter(link, 0)
		if ret != nvml.SUCCESS {
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

func throttleLabel(reasons uint64) string {
	var parts []string
	add := func(bit uint64, name string) {
		if reasons&bit != 0 {
			parts = append(parts, name)
		}
	}
	add(nvml.ClocksThrottleReasonGpuIdle, "gpu_idle")
	add(nvml.ClocksThrottleReasonApplicationsClocksSetting, "apps_clocks")
	add(nvml.ClocksThrottleReasonSwPowerCap, "sw_power_cap")
	add(nvml.ClocksThrottleReasonHwSlowdown, "hw_slowdown")
	add(nvml.ClocksThrottleReasonSyncBoost, "sync_boost")
	add(nvml.ClocksThrottleReasonSwThermalSlowdown, "sw_thermal")
	add(nvml.ClocksThrottleReasonHwThermalSlowdown, "hw_thermal")
	add(nvml.ClocksThrottleReasonHwPowerBrakeSlowdown, "hw_power_brake")
	add(nvml.ClocksThrottleReasonDisplayClockSetting, "display_clock")
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, ",")
}
