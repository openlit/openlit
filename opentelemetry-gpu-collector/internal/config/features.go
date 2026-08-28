package config

// Feature names used in unavailable / fault reporting.
const (
	FeatureHostMetrics     = "host_metrics"
	FeatureProcessMetrics  = "process_metrics"
	FeatureInterrupts      = "interrupts"
	FeatureKVM             = "kvm"
	FeatureNIC             = "nic"
	FeaturePMU             = "pmu"
	FeatureTPU             = "tpu"
	FeatureHighResCPU      = "cpu_highres"
	FeatureEBPF            = "ebpf"
	FeatureOccupancy       = "occupancy"
	FeatureDCGM            = "dcgm"
	FeatureDCGMPrefer      = "dcgm_prefer"
	FeatureRDC             = "rdc"
	FeatureVendorMetrics   = "vendor_metrics"
	FeatureKineto          = "kineto"
	FeatureControlHTTP     = "control_http"
	FeatureIntelPT         = "intel_pt"
)

// FeatureFailure records a requested feature that did not become available
// (environment) or failed due to a collector fault / invalid configuration.
type FeatureFailure struct {
	Name   string
	Reason string
}
