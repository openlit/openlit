//go:build windows

package igcl

import (
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/levelzero"
)

// Metrics aliases Level Zero Sysman metrics (IGCL/ControlLib path uses the same loader on Windows).
type Metrics = levelzero.Metrics

// Init loads Level Zero Sysman.
func Init() error { return levelzero.Init() }

// Available reports Sysman availability.
func Available() bool { return levelzero.Available() }

// CollectByIndex scrapes Intel GPU metrics for device index.
func CollectByIndex(index int) (Metrics, bool) { return levelzero.Collect(index) }
