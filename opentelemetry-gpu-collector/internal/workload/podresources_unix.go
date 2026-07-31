//go:build !windows

package workload

import (
	"context"
	"fmt"
	"net"
)

func dialWindowsPipe(ctx context.Context, pipe string) (net.Conn, error) {
	_ = ctx
	_ = pipe
	return nil, fmt.Errorf("windows named pipe dial not available on this OS")
}
