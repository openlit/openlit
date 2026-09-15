package workload

import "testing"

func TestParseCgroupV1(t *testing.T) {
	content := `11:memory:/kubepods/burstable/poda1b2c3d4-e5f6-7890-abcd-ef1234567890/cri-containerd-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`
	info, ok := ParseCgroup(content)
	if !ok {
		t.Fatal("expected ok")
	}
	if info.PodUID != "a1b2c3d4-e5f6-7890-abcd-ef1234567890" {
		t.Fatalf("uid=%q", info.PodUID)
	}
	if info.ContainerID != "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" {
		t.Fatalf("containerID=%q", info.ContainerID)
	}
}

func TestParseCgroupV2(t *testing.T) {
	content := `0::/kubepods.slice/kubepods-burstable.slice/kubepods-burstable-poda1b2c3d4_e5f6_7890_abcd_ef1234567890.slice/cri-containerd-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.scope`
	info, ok := ParseCgroup(content)
	if !ok {
		t.Fatal("expected ok")
	}
	want := "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	if info.PodUID != want {
		t.Fatalf("uid=%q want %q", info.PodUID, want)
	}
}

func TestParseCgroupBareContainerID(t *testing.T) {
	cid := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	content := `0::/kubepods/poda1b2c3d4-e5f6-7890-abcd-ef1234567890/` + cid
	info, ok := ParseCgroup(content)
	if !ok {
		t.Fatal("expected ok")
	}
	if info.ContainerID != cid {
		t.Fatalf("containerID=%q", info.ContainerID)
	}
}

