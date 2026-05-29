package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/engine"
	"go.uber.org/zap"
)

func newTestServer() *Server {
	logger, _ := zap.NewDevelopment()
	eng := engine.New(logger, "/nonexistent/obi", "http://localhost:4318", "/proc", "test", "", config.DeployLinux)
	return New(":0", eng, logger)
}

func TestHealthzReturns200(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	srv.httpServer.Handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("parse body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %q", body["status"])
	}
}

func TestStatusReturnsJSON(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/api/status", nil)
	w := httptest.NewRecorder()
	srv.httpServer.Handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body statusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("parse body: %v", err)
	}
	if body.Status != "healthy" {
		t.Errorf("expected status=healthy, got %q", body.Status)
	}
	if body.Version == "" {
		t.Error("expected non-empty version")
	}
	if body.OS == "" {
		t.Error("expected non-empty OS")
	}
	if body.Arch == "" {
		t.Error("expected non-empty arch")
	}
}

func TestGetServicesReturnsJSON(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/api/services", nil)
	w := httptest.NewRecorder()
	srv.httpServer.Handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}
}
