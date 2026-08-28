package config

import (
	"os"
	"runtime"
	"slices"
	"testing"
)

func clearModeFeatureEnvs(t *testing.T) {
	t.Helper()
	keys := []string{
		"OTEL_GPU_COLLECTOR_MODE",
		"OTEL_GPU_EBPF_ENABLED",
		"OTEL_GPU_DCGM_ENABLED", "OTEL_GPU_DCGM_PREFER",
		"OTEL_GPU_RDC_ENABLED",
		"OTEL_HOST_NIC_ENABLED", "OTEL_HOST_RDMA_ENABLED",
		"OTEL_HOST_PMU_ENABLED", "OTEL_HOST_PMU_EVENTS",
		"OTEL_TPU_ENABLED",
		"OTEL_HOST_KVM_ENABLED", "OTEL_HOST_INTERRUPTS_ENABLED",
		"OTEL_GPU_KINETO_ENABLED",
		"OTEL_HOST_INTEL_PT_ENABLED", "OTEL_HOST_CPU_HIGHRES",
		"OTEL_GPU_CONTROL_ADDR",
		"OTEL_GPU_PROMETHEUS_ADDR",
	}
	for _, k := range keys {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}
}

func TestResolveMode(t *testing.T) {
	tests := []struct {
		in   string
		want string
		ok   bool
	}{
		{"", ModeAll, true},
		{"  ALL ", ModeAll, true},
		{"light", ModeLight, true},
		{"serving", ModeServing, true},
		{"training", ModeTraining, true},
		{"deep", ModeDeep, true},
		{"nope", ModeAll, false},
	}
	for _, tt := range tests {
		got, ok := ResolveMode(tt.in)
		if got != tt.want || ok != tt.ok {
			t.Errorf("ResolveMode(%q) = (%q,%v), want (%q,%v)", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func TestModeFeatureMatrix(t *testing.T) {
	linux := runtime.GOOS == "linux"
	type expect struct {
		ebpf, dcgm, prefer, rdc, nic, rdma, pmu, tpu, kvm, irq, kineto, pt, highres bool
		control                                                                     string
	}
	cases := map[string]expect{
		ModeLight: {},
		ModeServing: {
			ebpf: linux, dcgm: true, prefer: true,
		},
		ModeTraining: {
			ebpf: linux, dcgm: true, prefer: true, nic: true, rdma: true, pmu: true,
		},
		ModeDeep: {
			ebpf: linux, dcgm: true, prefer: true, nic: true, rdma: true, pmu: true,
			kineto: true, pt: true, highres: true, control: DefaultControlAddr,
		},
		ModeAll: {
			ebpf: linux, dcgm: true, prefer: true, rdc: true, nic: true, rdma: true, pmu: true,
			tpu: true, kvm: true, irq: true, kineto: true, pt: true, highres: true,
			control: DefaultControlAddr,
		},
	}

	for mode, want := range cases {
		t.Run(mode, func(t *testing.T) {
			clearModeFeatureEnvs(t)
			t.Setenv("OTEL_GPU_COLLECTOR_MODE", mode)
			cfg := Load()
			if cfg.CollectorMode != mode {
				t.Fatalf("mode = %q", cfg.CollectorMode)
			}
			checks := []struct {
				name string
				got  bool
				want bool
			}{
				{"ebpf", cfg.EBPFEnabled, want.ebpf},
				{"dcgm", cfg.DCGMEnabled, want.dcgm},
				{"prefer", cfg.DCGMPrefer, want.prefer},
				{"rdc", cfg.RDCEnabled, want.rdc},
				{"nic", cfg.NICEnabled, want.nic},
				{"rdma", cfg.RDMAEnabled, want.rdma},
				{"pmu", cfg.PMUEnabled, want.pmu},
				{"tpu", cfg.TPUEnabled, want.tpu},
				{"kvm", cfg.KVMEnabled, want.kvm},
				{"irq", cfg.InterruptsEnabled, want.irq},
				{"kineto", cfg.KinetoEnabled, want.kineto},
				{"pt", cfg.IntelPTEnabled, want.pt},
				{"highres", cfg.CPUHighRes, want.highres},
			}
			for _, c := range checks {
				if c.got != c.want {
					t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
				}
			}
			if cfg.ControlAddr != want.control {
				t.Errorf("ControlAddr = %q, want %q", cfg.ControlAddr, want.control)
			}
			if want.pmu {
				if !slices.Contains(cfg.PMUEvents, "memory_bandwidth") {
					t.Errorf("PMUEvents = %v, want memory_bandwidth", cfg.PMUEvents)
				}
			}
		})
	}
}

func TestModeDefaultIsAll(t *testing.T) {
	clearModeFeatureEnvs(t)
	cfg := Load()
	if cfg.CollectorMode != ModeAll {
		t.Fatalf("default mode = %q, want all", cfg.CollectorMode)
	}
	if !cfg.DCGMEnabled || !cfg.KinetoEnabled || !cfg.RDCEnabled {
		t.Fatalf("all mode should enable DCGM/Kineto/RDC: dcgm=%v kineto=%v rdc=%v",
			cfg.DCGMEnabled, cfg.KinetoEnabled, cfg.RDCEnabled)
	}
}

func TestModeInvalidFallsBackToAll(t *testing.T) {
	clearModeFeatureEnvs(t)
	t.Setenv("OTEL_GPU_COLLECTOR_MODE", "banana")
	cfg := Load()
	if cfg.CollectorMode != ModeAll || !cfg.ModeInvalid {
		t.Fatalf("mode=%q invalid=%v", cfg.CollectorMode, cfg.ModeInvalid)
	}
}

func TestModeExplicitEnvOverridesPreset(t *testing.T) {
	clearModeFeatureEnvs(t)
	t.Setenv("OTEL_GPU_COLLECTOR_MODE", ModeAll)
	t.Setenv("OTEL_GPU_DCGM_ENABLED", "false")
	t.Setenv("OTEL_GPU_KINETO_ENABLED", "false")
	t.Setenv("OTEL_GPU_CONTROL_ADDR", "")
	cfg := Load()
	if cfg.DCGMEnabled || cfg.KinetoEnabled {
		t.Fatalf("explicit false should win: dcgm=%v kineto=%v", cfg.DCGMEnabled, cfg.KinetoEnabled)
	}
	if cfg.ControlAddr != "" {
		t.Fatalf("explicit empty ControlAddr should win, got %q", cfg.ControlAddr)
	}
}

func TestModeLightDisablesOptional(t *testing.T) {
	clearModeFeatureEnvs(t)
	t.Setenv("OTEL_GPU_COLLECTOR_MODE", ModeLight)
	cfg := Load()
	if cfg.EBPFEnabled || cfg.DCGMEnabled || cfg.NICEnabled || cfg.KinetoEnabled {
		t.Fatalf("light should disable optional scrapers: %+v", cfg.FeatureSummary())
	}
	if !cfg.HostMetricsEnabled || !cfg.InterconnectEnabled {
		t.Fatal("light should keep host + interconnect")
	}
}

func TestDeepDoesNotEnablePlatformExtras(t *testing.T) {
	clearModeFeatureEnvs(t)
	t.Setenv("OTEL_GPU_COLLECTOR_MODE", ModeDeep)
	cfg := Load()
	if cfg.RDCEnabled || cfg.TPUEnabled || cfg.KVMEnabled || cfg.InterruptsEnabled {
		t.Fatalf("deep should not enable RDC/TPU/KVM/interrupts: %+v", cfg.FeatureSummary())
	}
	if !cfg.KinetoEnabled || cfg.ControlAddr == "" {
		t.Fatal("deep should arm kineto + control")
	}
}
