package winpdh

import "testing"

func TestParseInstance(t *testing.T) {
	inst := ParseInstance("pid_1234_luid_0x00000000_0x00005678_phys_0_eng_0_engtype_3D")
	if inst.PID != 1234 {
		t.Fatalf("pid=%d", inst.PID)
	}
	if inst.LUIDKey != "0x00000000_0x00005678" {
		t.Fatalf("luid=%q", inst.LUIDKey)
	}
	if inst.Phys != "0" || inst.Eng != "0" || inst.EngType != "3D" {
		t.Fatalf("got %+v", inst)
	}
}

func TestParseInstanceMemory(t *testing.T) {
	inst := ParseInstance("pid_42_luid_0x00000001_0xABCDEF00_phys_1")
	if inst.PID != 42 || inst.LUIDKey != "0x00000001_0xABCDEF00" || inst.Phys != "1" {
		t.Fatalf("got %+v", inst)
	}
}

func TestNormalizeEngType(t *testing.T) {
	cases := map[string]string{
		"3D":           "3d",
		"Compute_0":    "compute",
		"VideoDecode":  "decode",
		"VideoEncode":  "encode",
		"Copy":         "copy",
	}
	for in, want := range cases {
		if got := NormalizeEngType(in); got != want {
			t.Errorf("NormalizeEngType(%q)=%q want %q", in, got, want)
		}
	}
}

func TestIsPrimaryCompute(t *testing.T) {
	if !IsPrimaryCompute("3D") || !IsPrimaryCompute("Compute") {
		t.Fatal("expected primary")
	}
	if IsPrimaryCompute("Copy") || IsPrimaryCompute("VideoDecode") {
		t.Fatal("expected non-primary")
	}
}
