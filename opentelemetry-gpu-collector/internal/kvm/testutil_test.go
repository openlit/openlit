package kvm

import (
	"io"
	"log/slog"
	"testing"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

func nilProvider(t *testing.T) *sdkmetric.MeterProvider {
	t.Helper()
	return sdkmetric.NewMeterProvider()
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
