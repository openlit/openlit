package amdsmi

import "testing"

func TestXGMIRateBytesPerSec(t *testing.T) {
	rx, tx, ok := XGMIRateBytesPerSec(100, 200, 1100, 2200, 1.0)
	if !ok {
		t.Fatal("expected ok")
	}
	if rx != 1000*1024 || tx != 2000*1024 {
		t.Fatalf("rx=%v tx=%v", rx, tx)
	}
	if _, _, ok := XGMIRateBytesPerSec(100, 200, 50, 2200, 1.0); ok {
		t.Fatal("underflow should fail")
	}
	if _, _, ok := XGMIRateBytesPerSec(100, 200, 1100, 2200, 0); ok {
		t.Fatal("zero dt should fail")
	}
}
