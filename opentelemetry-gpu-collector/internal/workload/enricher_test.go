package workload

import "testing"

func TestIndexPodSeparatesContainerFromUID(t *testing.T) {
	byUID := map[string]PodInfo{}
	byName := map[string]PodInfo{}
	byCont := map[string]PodInfo{}
	byPID := map[int32]PodInfo{}
	byDev := map[string]PodInfo{}

	indexPod(byUID, byName, byCont, byPID, byDev, PodInfo{
		PodUID: "uid-1", PodName: "p", Namespace: "ns",
		ContainerName: "sidecar", ContainerID: "aaa",
	})
	indexPod(byUID, byName, byCont, byPID, byDev, PodInfo{
		PodUID: "uid-1", PodName: "p", Namespace: "ns",
		ContainerName: "app", ContainerID: "bbb",
		DeviceIDs:     []string{"GPU-1"},
	})

	if byUID["uid-1"].ContainerName != "" || byUID["uid-1"].ContainerID != "" {
		t.Fatalf("byUID should be pod-level only: %+v", byUID["uid-1"])
	}
	if byCont["bbb"].ContainerName != "app" {
		t.Fatalf("byContID lost app container: %+v", byCont["bbb"])
	}
	if byDev["GPU-1"].ContainerName != "app" || byDev["GPU-1"].PodName != "p" {
		t.Fatalf("byDevice missing allocation: %+v", byDev["GPU-1"])
	}
}

func TestIndexPodResourcesNameOnly(t *testing.T) {
	byUID := map[string]PodInfo{}
	byName := map[string]PodInfo{}
	byCont := map[string]PodInfo{}
	byPID := map[int32]PodInfo{}
	byDev := map[string]PodInfo{}

	ok := indexPod(byUID, byName, byCont, byPID, byDev, PodInfo{
		PodName: "vllm", Namespace: "llm", ContainerName: "server",
		DeviceIDs: []string{"GPU-abc"},
	})
	if !ok {
		t.Fatal("expected indexed")
	}
	if byDev["GPU-abc"].PodName != "vllm" || byDev["GPU-abc"].Namespace != "llm" {
		t.Fatalf("device join failed: %+v", byDev["GPU-abc"])
	}
}

func TestMergePodPrefersExistingContainer(t *testing.T) {
	info := PodInfo{ContainerID: "bbb", ContainerName: "app"}
	mergePod(&info, PodInfo{
		PodUID: "uid-1", PodName: "p", Namespace: "ns",
		ContainerName: "sidecar", ContainerID: "aaa",
	})
	if info.ContainerName != "app" || info.ContainerID != "bbb" {
		t.Fatalf("merge overwrote container identity: %+v", info)
	}
	if info.PodName != "p" || info.Namespace != "ns" {
		t.Fatalf("merge missed pod fields: %+v", info)
	}
}
