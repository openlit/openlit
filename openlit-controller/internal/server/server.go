package server

import (
	"context"
	"net/http"

	"github.com/openlit/openlit/openlit-controller/internal/engine"
	"go.uber.org/zap"
)

type Server struct {
	httpServer *http.Server
	engine     *engine.Engine
	logger     *zap.Logger
}

func New(listenAddr string, eng *engine.Engine, logger *zap.Logger) *Server {
	s := &Server{
		engine: eng,
		logger: logger,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/services", s.handleGetServices)
	mux.HandleFunc("POST /api/services/{id}/instrument", s.handleInstrument)
	mux.HandleFunc("POST /api/services/{id}/uninstrument", s.handleUninstrument)

	s.httpServer = &http.Server{
		Addr:    listenAddr,
		Handler: mux,
	}

	return s
}

func (s *Server) Start() error {
	s.logger.Info("REST API server starting", zap.String("addr", s.httpServer.Addr))
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}
