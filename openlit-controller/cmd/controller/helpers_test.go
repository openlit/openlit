package main

import (
	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/engine"
	"go.uber.org/zap"
)

func newNilEngine() *engine.Engine {
	return engine.New(testLogger(), "/nonexistent/obi", "http://localhost:4318", "/proc", "test", "", config.DeployLinux)
}

func testLogger() *zap.Logger {
	logger, _ := zap.NewDevelopment()
	return logger
}
