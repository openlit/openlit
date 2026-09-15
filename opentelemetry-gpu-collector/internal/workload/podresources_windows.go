//go:build windows

package workload

import (
	"context"
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

func dialWindowsPipe(ctx context.Context, pipe string) (net.Conn, error) {
	timeout := 2 * time.Second
	if d, ok := ctx.Deadline(); ok {
		timeout = time.Until(d)
		if timeout <= 0 {
			timeout = time.Millisecond
		}
	}
	return winio.DialPipe(pipe, &timeout)
}
