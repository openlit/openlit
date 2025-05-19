package profiler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"
)

// GPUEvent represents a GPU-related event
type GPUEvent struct {
	Timestamp   time.Time
	EventType   string
	GPUIndex    int
	GPUType     string
	ProcessID   int
	ProcessName string
	Value       float64
	Attributes  map[string]string
}

// EventMonitor manages GPU event monitoring
type EventMonitor struct {
	logger     *zap.Logger
	events     chan GPUEvent
	stopCh     chan struct{}
	wg         sync.WaitGroup
	eventTypes map[string]bool
}

// NewEventMonitor creates a new GPU event monitor
func NewEventMonitor(logger *zap.Logger) *EventMonitor {
	return &EventMonitor{
		logger: logger,
		events: make(chan GPUEvent, 1000),
		stopCh: make(chan struct{}),
		eventTypes: map[string]bool{
			"gpu_utilization":     true,
			"gpu_memory_usage":    true,
			"gpu_power_usage":     true,
			"gpu_temperature":     true,
			"gpu_fan_speed":       true,
			"gpu_encoder_usage":   true,
			"gpu_decoder_usage":   true,
			"gpu_compute_mode":    true,
			"gpu_power_efficiency": true,
		},
	}
}

// Start begins monitoring GPU events
func (m *EventMonitor) Start(ctx context.Context) error {
	m.wg.Add(1)
	go m.monitorLoop(ctx)
	return nil
}

// Stop stops monitoring GPU events
func (m *EventMonitor) Stop() error {
	close(m.stopCh)
	m.wg.Wait()
	close(m.events)
	return nil
}

// GetEvents returns the channel for receiving GPU events
func (m *EventMonitor) GetEvents() <-chan GPUEvent {
	return m.events
}

// monitorLoop runs the main monitoring loop
func (m *EventMonitor) monitorLoop(ctx context.Context) {
	defer m.wg.Done()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-m.stopCh:
			return
		case <-ticker.C:
			// Collect events from all GPU profilers
			for _, profiler := range profilers {
				profile, err := profiler.GetProfile()
				if err != nil {
					m.logger.Error("Failed to get GPU profile",
						zap.Error(err),
						zap.String("gpu_type", profiler.GetGPUType()),
					)
					continue
				}

				// Convert metrics to events
				for name, value := range profile.Metrics {
					if m.eventTypes[name] {
						event := GPUEvent{
							Timestamp:   time.Now(),
							EventType:   name,
							GPUIndex:    profile.GPUIndex,
							GPUType:     profile.GPUType,
							Value:       value,
							Attributes:  make(map[string]string),
						}

						// Add process information if available
						if profile.ProcessInfo != nil {
							event.ProcessID = profile.ProcessInfo.PID
							event.ProcessName = profile.ProcessInfo.Name
						}

						// Add additional attributes
						for k, v := range profile.Attributes {
							event.Attributes[k] = v
						}

						select {
						case m.events <- event:
						default:
							m.logger.Warn("Event channel full, dropping event",
								zap.String("event_type", name),
								zap.String("gpu_type", profile.GPUType),
							)
						}
					}
				}
			}
		}
	}
}

// AddEventType adds a new event type to monitor
func (m *EventMonitor) AddEventType(eventType string) {
	m.eventTypes[eventType] = true
}

// RemoveEventType removes an event type from monitoring
func (m *EventMonitor) RemoveEventType(eventType string) {
	delete(m.eventTypes, eventType)
}

// GetEventTypes returns the list of monitored event types
func (m *EventMonitor) GetEventTypes() []string {
	types := make([]string, 0, len(m.eventTypes))
	for t := range m.eventTypes {
		types = append(types, t)
	}
	return types
} 