package intelpt

import "testing"

func TestClampOptions(t *testing.T) {
	o := ClampOptions(Options{DurationMS: 999999, MaxCPUs: 999, BufferPages: 9999})
	if o.DurationMS != HardMaxDurationMS {
		t.Fatalf("duration=%d", o.DurationMS)
	}
	if o.MaxCPUs != HardMaxCPUs {
		t.Fatalf("cpus=%d", o.MaxCPUs)
	}
	if o.BufferPages != HardMaxBufferPages {
		t.Fatalf("pages=%d", o.BufferPages)
	}
	o = ClampOptions(Options{})
	if o.DurationMS != 500 || o.MaxCPUs != DefaultMaxCPUs || o.BufferPages != DefaultMaxBufferPages {
		t.Fatalf("defaults: %+v", o)
	}
}

func TestSanitizeOutputDir(t *testing.T) {
	dir, err := SanitizeOutputDir("")
	if err != nil || dir == "" {
		t.Fatalf("empty dir: %q err=%v", dir, err)
	}
	got, err := SanitizeOutputDir("/tmp/intelpt")
	if err != nil {
		t.Fatal(err)
	}
	if got != "/tmp/intelpt" {
		t.Fatalf("got %q", got)
	}
	if _, err := SanitizeOutputDir("/tmp/foo/../etc"); err == nil {
		t.Fatal("expected rejection of path containing '..'")
	}
	rel, err := SanitizeOutputDir("intelpt-out")
	if err != nil {
		t.Fatal(err)
	}
	if rel == "" || rel == "intelpt-out" {
		t.Fatalf("relative path should be made absolute, got %q", rel)
	}
}
