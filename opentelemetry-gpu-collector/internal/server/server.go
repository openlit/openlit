package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/openlit/opentelemetry-gpu-collector/internal/collector"
)

// Server represents the HTTP server for health checks
type Server struct {
	collector *collector.Collector
	server    *http.Server
}

// NewServer creates a new HTTP server
func NewServer(collector *collector.Collector, port int) *Server {
	mux := http.NewServeMux()
	server := &http.Server{
		Addr:         ":" + string(port),
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	s := &Server{
		collector: collector,
		server:    server,
	}

	// Register routes
	mux.HandleFunc("/health", s.healthCheck)
	mux.HandleFunc("/ready", s.readyCheck)
	mux.HandleFunc("/metrics", s.metricsCheck)

	return s
}

// Start starts the HTTP server
func (s *Server) Start() error {
	return s.server.ListenAndServe()
}

// Stop stops the HTTP server
func (s *Server) Stop() error {
	return s.server.Close()
}

// healthCheck handles the health check endpoint
func (s *Server) healthCheck(w http.ResponseWriter, r *http.Request) {
	status := s.collector.GetHealthStatus()
	
	// Set response headers
	w.Header().Set("Content-Type", "application/json")
	
	// Determine HTTP status code
	httpStatus := http.StatusOK
	if status.Status == "degraded" {
		httpStatus = http.StatusServiceUnavailable
	} else if status.Status == "initializing" {
		httpStatus = http.StatusAccepted
	}
	
	// Write response
	w.WriteHeader(httpStatus)
	json.NewEncoder(w).Encode(status)
}

// readyCheck handles the readiness check endpoint
func (s *Server) readyCheck(w http.ResponseWriter, r *http.Request) {
	status := s.collector.GetHealthStatus()
	
	// Set response headers
	w.Header().Set("Content-Type", "application/json")
	
	// Only return 200 if the collector is initialized
	if status.IsInitialized {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":        status.Status,
		"is_initialized": status.IsInitialized,
		"gpu_count":     status.GPUCount,
	})
}

// metricsCheck handles the metrics status endpoint
func (s *Server) metricsCheck(w http.ResponseWriter, r *http.Request) {
	status := s.collector.GetHealthStatus()
	
	// Set response headers
	w.Header().Set("Content-Type", "application/json")
	
	// Write response
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"metric_count": status.MetricCount,
		"last_success": status.LastSuccess,
		"error_count":  status.ErrorCount,
		"last_error":   status.LastError,
	})
} 