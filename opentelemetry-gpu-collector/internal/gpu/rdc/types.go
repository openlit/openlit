package rdc

import (
	"encoding/binary"
	"math"
	"unsafe"
)

// Sample is one GPU (or compute partition) reading from AMD RDC.
type Sample struct {
	DeviceID  string             // GPU UUID or stable id
	GPUID     uint               // RDC GPU index
	ParentID  string             // physical GPU id when this sample is a partition
	Partition string             // partition / XCD label when known
	Values    map[string]float64 // metric key -> value
}

// Metric keys mapped from RDC field readings.
const (
	MetricOccupancy = "sm.occupancy"
	MetricPipeFP16  = "pipe.fp16"
	MetricPipeFP32  = "pipe.fp32"
	MetricPipeFP64  = "pipe.fp64"
	MetricSIMDUtil  = "simd.utilization"
	MetricGPUUtil   = "engine.graphics"
	MetricSMActive  = "sm.utilization"
)

// RDC field IDs from rdc/rdc.h (ROCm RDC).
const (
	FieldUUID                 uint32 = 8   // RDC_FI_UUID
	FieldGPUUtilPercent       uint32 = 500 // RDC_FI_GPU_UTIL
	FieldOccupancyPercent     uint32 = 800 // RDC_FI_PROF_OCCUPANCY_PERCENT
	FieldSMActive             uint32 = 812 // RDC_FI_PROF_SM_ACTIVE
	FieldEvalFLOPS16Percent   uint32 = 815 // RDC_FI_PROF_EVAL_FLOPS_16_PERCENT
	FieldEvalFLOPS32Percent   uint32 = 816 // RDC_FI_PROF_EVAL_FLOPS_32_PERCENT
	FieldEvalFLOPS64Percent   uint32 = 817 // RDC_FI_PROF_EVAL_FLOPS_64_PERCENT
	FieldSIMDUtilization      uint32 = 853 // RDC_FI_PROF_SIMD_UTILIZATION
)

// DefaultWatchFields are the profiling fields OpenLIT watches by default.
var DefaultWatchFields = []uint32{
	FieldUUID,
	FieldOccupancyPercent,
	FieldSMActive,
	FieldEvalFLOPS16Percent,
	FieldEvalFLOPS32Percent,
	FieldEvalFLOPS64Percent,
	FieldSIMDUtilization,
}

// FieldIDToMetric maps known RDC field IDs to Sample.Values keys.
var FieldIDToMetric = map[uint32]string{
	FieldGPUUtilPercent:     MetricGPUUtil,
	FieldOccupancyPercent:   MetricOccupancy,
	FieldSMActive:           MetricSMActive,
	FieldEvalFLOPS16Percent: MetricPipeFP16,
	FieldEvalFLOPS32Percent: MetricPipeFP32,
	FieldEvalFLOPS64Percent: MetricPipeFP64,
	FieldSIMDUtilization:    MetricSIMDUtil,
}

const (
	rdcFieldTypeInteger = 0
	rdcFieldTypeDouble  = 1
	rdcFieldTypeString  = 2
)

// rdcFieldValueSize matches sizeof(rdc_field_value) on linux amd64/arm64
// (field_id + status + ts + type + pad + 256-byte value union).
const rdcFieldValueSize = 280

// MapFieldValue stores a normalized ratio (0–1) into Values when the field is known.
func MapFieldValue(values map[string]float64, fieldID uint32, raw float64) {
	key, ok := FieldIDToMetric[fieldID]
	if !ok {
		return
	}
	v := raw
	switch fieldID {
	case FieldGPUUtilPercent, FieldOccupancyPercent, FieldSIMDUtilization, FieldSMActive,
		FieldEvalFLOPS16Percent, FieldEvalFLOPS32Percent, FieldEvalFLOPS64Percent:
		if v > 1.0 {
			v = v / 100.0
		}
	}
	values[key] = v
}

func parseFieldValue(buf []byte) (fieldID uint32, status int32, typ int32, dbl float64, str string, ok bool) {
	if len(buf) < rdcFieldValueSize {
		return 0, 0, 0, 0, "", false
	}
	fieldID = binary.LittleEndian.Uint32(buf[0:4])
	status = int32(binary.LittleEndian.Uint32(buf[4:8]))
	// ts at 8:16 unused here
	typ = int32(binary.LittleEndian.Uint32(buf[16:20]))
	// value union starts at offset 24 after 4-byte pad to 8-byte alignment
	val := buf[24:280]
	switch typ {
	case rdcFieldTypeInteger:
		i := int64(binary.LittleEndian.Uint64(val[0:8]))
		return fieldID, status, typ, float64(i), "", true
	case rdcFieldTypeDouble:
		bits := binary.LittleEndian.Uint64(val[0:8])
		return fieldID, status, typ, math.Float64frombits(bits), "", true
	case rdcFieldTypeString:
		n := 0
		for n < len(val) && val[n] != 0 {
			n++
		}
		return fieldID, status, typ, 0, string(val[:n]), true
	default:
		return fieldID, status, typ, 0, "", false
	}
}

func cString(s string) *byte {
	b := append([]byte(s), 0)
	return &b[0]
}

func fieldValuePtr(buf []byte) unsafe.Pointer {
	return unsafe.Pointer(&buf[0])
}
