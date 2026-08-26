package dcgm

// Sample is one GPU's latest DCGM field readings.
type Sample struct {
	DeviceID string // GPU UUID when available, else strconv of DCGM gpu id
	GPUID    uint
	Values   map[string]float64 // metric key -> value
	Blank    bool               // true if any blank DCGM sentinel seen
}

// Metric keys for DCGM profiling / clock fields.
const (
	MetricEngineUtil   = "engine.graphics"              // 1001
	MetricSMUtil       = "sm.utilization"               // 1002
	MetricSMOccupancy  = "sm.occupancy"                 // 1003
	MetricPipeTensor   = "pipe.tensor"                  // 1004
	MetricMemBWUtil    = "memory.bandwidth.utilization" // 1005
	MetricPipeFP64     = "pipe.fp64"                    // 1006
	MetricPipeFP32     = "pipe.fp32"                    // 1007
	MetricPipeFP16     = "pipe.fp16"                    // 1008
	MetricPCIeTxRate   = "pcie.tx.rate"                 // 1009 By/s
	MetricPCIeRxRate   = "pcie.rx.rate"                 // 1010
	MetricNVLinkTxRate = "nvlink.tx.rate"               // 1011
	MetricNVLinkRxRate = "nvlink.rx.rate"               // 1012
	MetricSMClockMHz   = "clock.sm.mhz"                 // 100
	MetricPowerWatts   = "power.watts"                  // 155 DCGM_FI_DEV_POWER_USAGE
	MetricGPUUtilPct   = "gpu.utilization.pct"          // 203 DCGM_FI_DEV_GPU_UTIL (0–100)
	MetricMemCopyUtil  = "memory.copy.utilization"      // 204 DCGM_FI_DEV_MEM_COPY_UTIL (0–100)
)

// DCGM field IDs used by default (NVIDIA field IDs + DCP profiling).
// Note: 155 is POWER_USAGE, not GPU util. GPU util is 203.
const (
	FieldName         uint16 = 50
	FieldUUID         uint16 = 54
	FieldSMClock      uint16 = 100
	FieldPowerUsage   uint16 = 155 // DCGM_FI_DEV_POWER_USAGE (Watts)
	FieldGPUUtil      uint16 = 203 // DCGM_FI_DEV_GPU_UTIL (%)
	FieldMemCopyUtil  uint16 = 204 // DCGM_FI_DEV_MEM_COPY_UTIL (%)
	FieldProfEngine   uint16 = 1001
	FieldProfSMActive uint16 = 1002
	FieldProfSMOccup  uint16 = 1003
	FieldProfTensor   uint16 = 1004
	FieldProfDRAM     uint16 = 1005
	FieldProfFP64     uint16 = 1006
	FieldProfFP32     uint16 = 1007
	FieldProfFP16     uint16 = 1008
	FieldProfPCIeTx   uint16 = 1009
	FieldProfPCIeRx   uint16 = 1010
	FieldProfNVLinkTx uint16 = 1011
	FieldProfNVLinkRx uint16 = 1012
)

// ProfFieldMin is the first profiling field ID.
const ProfFieldMin uint16 = 1001

// FieldIDToMetric maps known DCGM field IDs to Sample.Values keys.
var FieldIDToMetric = map[uint16]string{
	FieldSMClock:      MetricSMClockMHz,
	FieldPowerUsage:   MetricPowerWatts,
	FieldGPUUtil:      MetricGPUUtilPct,
	FieldMemCopyUtil:  MetricMemCopyUtil,
	FieldProfEngine:   MetricEngineUtil,
	FieldProfSMActive: MetricSMUtil,
	FieldProfSMOccup:  MetricSMOccupancy,
	FieldProfTensor:   MetricPipeTensor,
	FieldProfDRAM:     MetricMemBWUtil,
	FieldProfFP64:     MetricPipeFP64,
	FieldProfFP32:     MetricPipeFP32,
	FieldProfFP16:     MetricPipeFP16,
	FieldProfPCIeTx:   MetricPCIeTxRate,
	FieldProfPCIeRx:   MetricPCIeRxRate,
	FieldProfNVLinkTx: MetricNVLinkTxRate,
	FieldProfNVLinkRx: MetricNVLinkRxRate,
}

// IsProfField reports whether fieldID is a DCGM profiling (DCP) field.
func IsProfField(fieldID uint16) bool {
	return fieldID >= ProfFieldMin
}
