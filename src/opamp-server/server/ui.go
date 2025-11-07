package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	"opamp-server/certman"
	"opamp-server/constants"
	"opamp-server/data"

	"github.com/google/uuid"

	"github.com/open-telemetry/opamp-go/protobufs"
)

var (
	srv     *http.Server
	opampCA = sync.OnceValue(func() string {
		p, err := os.ReadFile(constants.CaCertPath)
		if err != nil {
			panic(err)
		}
		return string(p)
	})
)

func (srv *Server) setupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/agents", srv.handleGetAgents)
	mux.HandleFunc("/api/agent", srv.handleGetAgent)
	mux.HandleFunc("/api/agent/config", srv.handleSaveConfig)
	mux.HandleFunc("/api/agent/connection", srv.handleConnectionSettings)
	mux.HandleFunc("/api/agent/certificate", srv.handleRotateCertificate)
	// mux.HandleFunc("/api/capabilities", srv.handleCapabilities)
}

func Shutdown() {
	srv.Shutdown(context.Background())
}

func (srv *Server) handleGetAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	agents := srv.agents.GetAllAgentsReadonlyClone()
	response := make([]data.Agent, 0, len(agents))

	for _, agent := range agents {
		response = append(response, *agent)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (srv *Server) handleGetAgent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	instanceID := r.URL.Query().Get("id")
	if instanceID == "" {
		http.Error(w, "Missing instance ID", http.StatusBadRequest)
		return
	}

	uid, err := uuid.Parse(instanceID)
	if err != nil {
		http.Error(w, "Invalid instance ID", http.StatusBadRequest)
		return
	}

	agent := srv.agents.GetAgentReadonlyClone(data.InstanceId(uid))
	if agent == nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agent)
}

func (srv *Server) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request struct {
		InstanceID string `json:"id"`
		Config     string `json:"config"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	uid, err := uuid.Parse(request.InstanceID)
	if err != nil {
		http.Error(w, "Invalid instance ID", http.StatusBadRequest)
		return
	}

	instanceId := data.InstanceId(uid)
	agent := srv.agents.GetAgentReadonlyClone(instanceId)
	if agent == nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	configStr := request.Config
	config := &protobufs.AgentConfigMap{
		ConfigMap: map[string]*protobufs.AgentConfigFile{
			"": {Body: []byte(configStr)},
		},
	}

	notifyNextStatusUpdate := make(chan struct{}, 1)
	data.AllAgents.SetCustomConfigForAgent(instanceId, config, notifyNextStatusUpdate)

	// Wait for up to 5 seconds for a Status update, which is expected
	// to be reported by the Agent after we set the remote config.
	timer := time.NewTicker(time.Second * 5)
	defer timer.Stop()

	select {
	case <-notifyNextStatusUpdate:
		w.WriteHeader(http.StatusOK)
	case <-timer.C:
		w.WriteHeader(http.StatusRequestTimeout)
	}
}

func (srv *Server) handleRotateCertificate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request struct {
		InstanceID string `json:"id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	uid, err := uuid.Parse(request.InstanceID)
	if err != nil {
		http.Error(w, "Invalid instance ID", http.StatusBadRequest)
		return
	}

	instanceId := data.InstanceId(uid)
	agent := data.AllAgents.GetAgentReadonlyClone(instanceId)
	if agent == nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	// Create a new certificate for the agent.
	certificate, err := certman.CreateTLSCert(constants.CaCertPath, constants.PrivateKeyPath)
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		srv.logger.Println(err)
		return
	}

	// Create an offer for the agent.
	offers := &protobufs.ConnectionSettingsOffers{
		Opamp: &protobufs.OpAMPConnectionSettings{
			Certificate: certificate,
		},
	}

	// Send the offer to the agent.
	data.AllAgents.OfferAgentConnectionSettings(instanceId, offers)

	srv.logger.Printf("Waiting for agent %s to reconnect\n", instanceId)

	// Wait for up to 5 seconds for a Status update, which is expected
	// to be reported by the agent after we set the remote config.
	timer := time.NewTicker(time.Second * 5)
	defer timer.Stop()

	// TODO: wait for agent to reconnect instead of waiting full 5 seconds.

	select {
	case <-timer.C:
		srv.logger.Printf("Time out waiting for agent %s to reconnect\n", instanceId)
	}

	w.WriteHeader(http.StatusOK)
}

func (srv *Server) handleConnectionSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request struct {
		InstanceID string `json:"id"`
		TLSMin     string `json:"tls_min"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	uid, err := uuid.Parse(request.InstanceID)
	if err != nil {
		http.Error(w, "Invalid instance ID", http.StatusBadRequest)
		return
	}

	instanceId := data.InstanceId(uid)
	agent := srv.agents.GetAgentReadonlyClone(instanceId)
	if agent == nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	var tlsMin string
	switch request.TLSMin {
	case "TLSv1.0":
		tlsMin = "1.0"
	case "TLSv1.1":
		tlsMin = "1.1"
	case "TLSv1.2":
		tlsMin = "1.2"
	case "TLSv1.3":
		tlsMin = "1.3"
	default:
		http.Error(w, "Invalid TLS version", http.StatusBadRequest)
		return
	}

	offers := &protobufs.ConnectionSettingsOffers{
		Opamp: &protobufs.OpAMPConnectionSettings{
			Tls: &protobufs.TLSConnectionSettings{
				CaPemContents: opampCA(),
				MinVersion:    tlsMin,
				MaxVersion:    "1.3",
			},
		},
	}

	data.AllAgents.OfferAgentConnectionSettings(instanceId, offers)

	srv.logger.Printf("Waiting for agent %s to reconnect\n", instanceId)

	// Wait for up to 5 seconds for a Status update, which is expected
	// to be reported by the agent after we set the remote config.
	timer := time.NewTicker(time.Second * 5)
	defer timer.Stop()

	// TODO: wait for agent to reconnect instead of waiting full 5 seconds.

	select {
	case <-timer.C:
		srv.logger.Printf("Time out waiting for agent %s to reconnect\n", instanceId)
	}

	w.WriteHeader(http.StatusOK)
}
