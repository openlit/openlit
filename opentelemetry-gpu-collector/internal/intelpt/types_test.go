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
