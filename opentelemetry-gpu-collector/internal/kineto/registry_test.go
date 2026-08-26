package kineto

import (
	"reflect"
	"sort"
	"testing"
)

func TestRegistrySetConfigMatching(t *testing.T) {
	r := NewRegistry()
	r.Register(10, 1)
	r.Register(20, 1)
	r.Register(30, 2)

	matched := r.SetConfig([]int{10, 20, 99}, "cfg")
	sort.Ints(matched)
	if !reflect.DeepEqual(matched, []int{10, 20}) {
		t.Fatalf("matched = %v, want [10 20]", matched)
	}

	cfg, ok := r.TakeConfig(10)
	if !ok || cfg != "cfg" {
		t.Fatalf("TakeConfig(10) = %q %v", cfg, ok)
	}
	if _, ok := r.TakeConfig(10); ok {
		t.Fatal("expected config cleared after TakeConfig")
	}
	if _, ok := r.TakeConfig(99); ok {
		t.Fatal("unregistered pid should not have config")
	}
}

func TestMatchLauncherResolution(t *testing.T) {
	old := childrenOf
	t.Cleanup(func() { childrenOf = old })
	childrenOf = func(pid int) []int {
		if pid == 100 {
			return []int{200, 201, 202}
		}
		return nil
	}

	reg := NewRegistry()
	reg.Register(100, 42) // launcher
	reg.Register(200, 42) // GPU worker
	reg.Register(201, 42) // GPU worker
	reg.Register(300, 42) // registered but not GPU and not child

	gpuPIDs := []int32{200, 201, 999}
	matched, resolved := Match(reg, gpuPIDs, []int{100}, 42)

	sort.Ints(matched)
	if !reflect.DeepEqual(matched, []int{200, 201}) {
		t.Fatalf("matched = %v, want [200 201]", matched)
	}
	if !reflect.DeepEqual(resolved[100], []int{200, 201}) {
		t.Fatalf("resolved[100] = %v, want [200 201]", resolved[100])
	}
}

func TestMatchDirectGPUActive(t *testing.T) {
	reg := NewRegistry()
	reg.Register(50, 1)
	reg.Register(60, 1)

	matched, resolved := Match(reg, []int32{50}, []int{50, 60}, 1)
	if !reflect.DeepEqual(matched, []int{50}) {
		t.Fatalf("matched = %v, want [50]", matched)
	}
	if len(resolved) != 0 {
		t.Fatalf("resolved = %v, want empty", resolved)
	}
}

func TestMatchJobFilter(t *testing.T) {
	reg := NewRegistry()
	reg.Register(1, 10)
	reg.Register(2, 20)

	matched, _ := Match(reg, []int32{1, 2}, nil, 10)
	if !reflect.DeepEqual(matched, []int{1}) {
		t.Fatalf("matched = %v, want [1]", matched)
	}
}
