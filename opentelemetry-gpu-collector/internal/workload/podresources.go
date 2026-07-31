package workload

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"runtime"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	podresourcesapi "k8s.io/kubelet/pkg/apis/podresources/v1"
)

// PodResourcesClient talks to the kubelet PodResources gRPC API.
type PodResourcesClient struct {
	logger *slog.Logger
	conn   *grpc.ClientConn
	client podresourcesapi.PodResourcesListerClient
}

func podResourcesSocket() string {
	if p := os.Getenv("POD_RESOURCES_SOCKET"); p != "" {
		return p
	}
	if runtime.GOOS == "windows" {
		return `\\.\pipe\kubelet-podresources`
	}
	return "/var/lib/kubelet/pod-resources/kubelet.sock"
}

// NewPodResourcesClient connects to the kubelet PodResources socket.
// Does not probe List at connect time — first List failure is surfaced to the caller
// so transient kubelet unavailability does not permanently disable enrichment.
func NewPodResourcesClient(logger *slog.Logger) (*PodResourcesClient, error) {
	sock := podResourcesSocket()
	dialer := func(ctx context.Context, _ string) (net.Conn, error) {
		if runtime.GOOS == "windows" {
			return dialWindowsPipe(ctx, sock)
		}
		var d net.Dialer
		return d.DialContext(ctx, "unix", sock)
	}

	conn, err := grpc.NewClient("passthrough:///podresources",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(dialer),
	)
	if err != nil {
		return nil, fmt.Errorf("dial podresources %s: %w", sock, err)
	}
	return &PodResourcesClient{
		logger: logger,
		conn:   conn,
		client: podresourcesapi.NewPodResourcesListerClient(conn),
	}, nil
}

// List returns pod/container identity for containers known to kubelet.
func (c *PodResourcesClient) List(ctx context.Context) ([]PodInfo, error) {
	if c == nil || c.client == nil {
		return nil, fmt.Errorf("podresources client not connected")
	}
	resp, err := c.client.List(ctx, &podresourcesapi.ListPodResourcesRequest{})
	if err != nil {
		return nil, err
	}
	out := make([]PodInfo, 0, len(resp.GetPodResources()))
	for _, pod := range resp.GetPodResources() {
		conts := pod.GetContainers()
		if len(conts) == 0 {
			out = append(out, PodInfo{
				PodName:   pod.GetName(),
				Namespace: pod.GetNamespace(),
			})
			continue
		}
		for _, cont := range conts {
			var deviceIDs []string
			for _, dev := range cont.GetDevices() {
				deviceIDs = append(deviceIDs, dev.GetDeviceIds()...)
			}
			out = append(out, PodInfo{
				PodName:       pod.GetName(),
				Namespace:     pod.GetNamespace(),
				ContainerName: cont.GetName(),
				DeviceIDs:     deviceIDs,
			})
		}
	}
	return out, nil
}

func (c *PodResourcesClient) Close() {
	if c != nil && c.conn != nil {
		_ = c.conn.Close()
		c.conn = nil
		c.client = nil
	}
}
