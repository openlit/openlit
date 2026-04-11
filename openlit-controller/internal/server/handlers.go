package server

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"

	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

type statusResponse struct {
	Status   string                 `json:"status"`
	Mode     openlit.ControllerMode `json:"mode"`
	Version  string                 `json:"version"`
	NodeName string                 `json:"node_name,omitempty"`
	OS       string                 `json:"os"`
	Arch     string                 `json:"arch"`
	Engine   engineStatus           `json:"engine"`
}

type engineStatus struct {
	Running              bool `json:"running"`
	ServicesDiscovered   int  `json:"services_discovered"`
	ServicesInstrumented int  `json:"services_instrumented"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	discovered, instrumented := s.engine.ServiceCount()

	mode := s.engine.ControllerMode()

	nodeName, _ := os.Hostname()

	resp := statusResponse{
		Status:   "healthy",
		Mode:     mode,
		Version:  Version,
		NodeName: nodeName,
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		Engine: engineStatus{
			Running:              s.engine.IsRunning(),
			ServicesDiscovered:   discovered,
			ServicesInstrumented: instrumented,
		},
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleGetServices(w http.ResponseWriter, r *http.Request) {
	services := s.engine.GetServices()
	writeJSON(w, http.StatusOK, services)
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		// Response already partially written; log but cannot recover.
		_ = err
	}
}

var Version = "dev"
