package export

import "testing"

func TestPreferGateBlankAllowsVendor(t *testing.T) {
	g := &PreferGate{}
	if g.SuppressVendor("gpu-a") {
		t.Fatal("inactive should not suppress")
	}
	g.SetActive(true)
	if g.SuppressVendor("gpu-a") {
		t.Fatal("active before healthy sample should allow vendor (no hole)")
	}
	g.NoteSample("gpu-a", false)
	if g.SuppressVendor("gpu-a") {
		t.Fatal("blank sample should allow NVML fallback")
	}
	g.NoteSample("gpu-a", true)
	if !g.SuppressVendor("gpu-a") {
		t.Fatal("healthy sample should suppress")
	}
	g.NoteSample("gpu-a", false)
	if g.SuppressVendor("gpu-a") {
		t.Fatal("blank after healthy should fall back to vendor")
	}
	g.SetActive(false)
	if g.SuppressVendor("gpu-a") {
		t.Fatal("deactivated should not suppress")
	}
}
