package control

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/hostmetrics"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/intelpt"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/kineto"
)

const maxBodyBytes = 1 << 20 // 1 MiB

// Deps wires optional backends into the control HTTP server.
type Deps struct {
	Version    string
	Kineto     *kineto.Server // may be nil
	DCGMPause  func(d time.Duration) error
	DCGMResume func() error
	GPUPIDs    func() []int32
	Meter      metric.Meter // optional; when set, emits openlit.collector.profile.requests
	// HighResCPU is optional; when set, GET /v1/cpu/highres returns the ring buffer.
	HighResCPU *hostmetrics.HighResCPU
	// IntelPT is optional on-demand CPU instruction tracing.
	IntelPT intelpt.Capturer
	// IntelPTLimits apply safety caps from config.
	IntelPTMaxDurationMS  int
	IntelPTMaxBufferPages int
	IntelPTMaxCPUs        int
	IntelPTOutputDir      string
	// AllowRemote permits non-loopback bind when Token is non-empty.
	AllowRemote bool
}

// Start launches an HTTP control plane on addr. By default addr must be loopback
// (127.0.0.1, ::1, or localhost). Set AllowRemote with a non-empty token to bind
// on other interfaces for multi-node profile fan-out.
func Start(addr, token string, deps Deps, logger *slog.Logger) (*http.Server, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if err := requireAddr(addr, deps.AllowRemote, token); err != nil {
		return nil, err
	}
	if deps.Version == "" {
		deps.Version = "dev"
	}

	var profileCounter metric.Int64Counter
	if deps.Meter != nil {
		var err error
		profileCounter, err = deps.Meter.Int64Counter(
			"openlit.collector.profile.requests",
			metric.WithDescription("On-demand profiling requests handled by the control plane"),
			metric.WithUnit("{request}"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating openlit.collector.profile.requests: %w", err)
		}
	}

	mux := http.NewServeMux()
	h := &handler{
		deps:           deps,
		token:          token,
		logger:         logger,
		profileCounter: profileCounter,
	}
	mux.HandleFunc("/v1/status", h.withAuth(h.status))
	mux.HandleFunc("/v1/version", h.withAuth(h.version))
	mux.HandleFunc("/v1/profile/gpu", h.withAuth(h.profileGPU))
	mux.HandleFunc("/v1/profile/cpu/pt", h.withAuth(h.profileCPUPT))
	mux.HandleFunc("/v1/dcgm/pause", h.withAuth(h.dcgmPause))
	mux.HandleFunc("/v1/dcgm/resume", h.withAuth(h.dcgmResume))
	mux.HandleFunc("/v1/cpu/highres", h.withAuth(h.cpuHighRes))

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second, // PT capture may block briefly
		IdleTimeout:       60 * time.Second,
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("control listen %s: %w", addr, err)
	}
	go func() {
		logger.Info("control HTTP listening", "addr", addr, "allow_remote", deps.AllowRemote)
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("control HTTP stopped", "error", err)
		}
	}()
	return srv, nil
}

func requireAddr(addr string, allowRemote bool, token string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("control addr: %w", err)
	}
	switch strings.ToLower(host) {
	case "127.0.0.1", "::1", "localhost":
		return nil
	default:
		if !allowRemote {
			return fmt.Errorf("control addr must be loopback (127.0.0.1, ::1, or localhost), got %q (set OTEL_GPU_CONTROL_ALLOW_REMOTE=true with a token)", host)
		}
		if token == "" {
			return fmt.Errorf("control allow_remote requires a non-empty OTEL_GPU_CONTROL_TOKEN")
		}
		return nil
	}
}

type handler struct {
	deps           Deps
	token          string
	logger         *slog.Logger
	profileCounter metric.Int64Counter
}

func (h *handler) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.token != "" {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			got = strings.TrimSpace(got)
			if subtle.ConstantTimeCompare([]byte(got), []byte(h.token)) != 1 {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
		}
		next(w, r)
	}
}

func (h *handler) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	intelPT := false
	if h.deps.IntelPT != nil {
		intelPT = h.deps.IntelPT.Available()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":           1,
		"kineto":           h.deps.Kineto != nil,
		"intel_pt":         intelPT,
		"highres_cpu":      h.deps.HighResCPU != nil,
		"dcgm_control":     h.deps.DCGMPause != nil,
	})
}

func (h *handler) version(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, h.deps.Version)
}

type profileGPUBody struct {
	PIDs             []int  `json:"pids"`
	JobID            int64  `json:"job_id"`
	DurationMS       *uint64 `json:"duration_ms"`
	Iterations       *int64 `json:"iterations"`
	IterationRoundup uint64 `json:"iteration_roundup"`
	StartTimeMS      uint64 `json:"start_time_ms"`
	LogFile          string `json:"log_file"`
	ProcessLimit     int    `json:"process_limit"`
	RecordShapes     bool   `json:"record_shapes"`
	ProfileMemory    bool   `json:"profile_memory"`
	WithStacks       bool   `json:"with_stacks"`
	WithFlops        bool   `json:"with_flops"`
	WithModules      bool   `json:"with_modules"`
}

func (h *handler) profileGPU(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if h.deps.Kineto == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "kineto disabled"})
		h.recordProfile("kineto_trace", "failed")
		return
	}

	var body profileGPUBody
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		h.recordProfile("kineto_trace", "failed")
		return
	}

	req := kineto.Request{
		LogFile:          body.LogFile,
		StartTimeMS:      body.StartTimeMS,
		IterationRoundup: body.IterationRoundup,
		Options: kineto.Options{
			RecordShapes:  body.RecordShapes,
			ProfileMemory: body.ProfileMemory,
			WithStacks:    body.WithStacks,
			WithFlops:     body.WithFlops,
			WithModules:   body.WithModules,
		},
	}
	if body.LogFile == "" {
		req.LogFile = filepath.Join(h.deps.Kineto.TraceDir, "libkineto_trace.json")
	}

	profileType := "kineto_trace"
	if body.ProfileMemory {
		profileType = "memory_snapshot"
	}

	switch {
	case body.Iterations != nil && *body.Iterations > 0:
		if body.ProfileMemory {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "profile_memory requires duration_ms (not iterations)",
			})
			h.recordProfile(profileType, "failed")
			return
		}
		req.Mode = kineto.TriggerIteration
		req.Iterations = *body.Iterations
		if req.IterationRoundup == 0 {
			req.IterationRoundup = 1
		}
	case body.DurationMS != nil:
		req.Mode = kineto.TriggerDuration
		req.DurationMS = *body.DurationMS
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "provide duration_ms or iterations",
		})
		h.recordProfile(profileType, "failed")
		return
	}

	config := req.ConfigText()

	var gpuPIDs []int32
	if h.deps.GPUPIDs != nil {
		gpuPIDs = h.deps.GPUPIDs()
	}

	// Pause DCGM during CUPTI capture when available.
	if h.deps.DCGMPause != nil && req.Mode == kineto.TriggerDuration && req.DurationMS > 0 {
		pauseFor := time.Duration(req.DurationMS)*time.Millisecond + 2*time.Second
		if err := h.deps.DCGMPause(pauseFor); err != nil {
			h.logger.Warn("dcgm pause before profile failed", "error", err)
		}
	}

	matched, paths := h.deps.Kineto.SetOnDemand(body.JobID, body.PIDs, config, body.ProcessLimit, gpuPIDs)
	result := "matched"
	if len(matched) == 0 {
		result = "no_match"
	}
	h.recordProfile(profileType, result)
	h.logger.Info("profile gpu request",
		"matched", matched,
		"paths", paths,
		"job_id", body.JobID,
		"result", result,
	)

	writeJSON(w, http.StatusOK, map[string]any{
		"matched_pids": matched,
		"trace_paths":  paths,
		"config":       config,
	})
}

type profileCPUPTBody struct {
	DurationMS  uint64 `json:"duration_ms"`
	OutputDir   string `json:"output_dir"`
	CPUs        []int  `json:"cpus"`
	MaxCPUs     int    `json:"max_cpus"`
	BufferPages int    `json:"buffer_pages"`
}

func (h *handler) profileCPUPT(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if h.deps.IntelPT == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "intel pt disabled"})
		h.recordProfile("intel_pt", "failed")
		return
	}
	if !h.deps.IntelPT.Available() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "intel pt unavailable (need intel_pt PMU and perf)"})
		h.recordProfile("intel_pt", "failed")
		return
	}

	var body profileCPUPTBody
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		h.recordProfile("intel_pt", "failed")
		return
	}

	opts := intelpt.Options{
		DurationMS:  body.DurationMS,
		OutputDir:   body.OutputDir,
		CPUs:        body.CPUs,
		MaxCPUs:     body.MaxCPUs,
		BufferPages: body.BufferPages,
	}
	if opts.OutputDir == "" {
		opts.OutputDir = h.deps.IntelPTOutputDir
	}
	if opts.MaxCPUs <= 0 {
		opts.MaxCPUs = h.deps.IntelPTMaxCPUs
	}
	if opts.BufferPages <= 0 {
		opts.BufferPages = h.deps.IntelPTMaxBufferPages
	}
	if h.deps.IntelPTMaxDurationMS > 0 && opts.DurationMS > uint64(h.deps.IntelPTMaxDurationMS) {
		opts.DurationMS = uint64(h.deps.IntelPTMaxDurationMS)
	}

	res, err := h.deps.IntelPT.Capture(opts)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		h.recordProfile("intel_pt", "failed")
		return
	}
	h.recordProfile("intel_pt", "ok")
	writeJSON(w, http.StatusOK, map[string]any{
		"output_path":  res.OutputPath,
		"duration_ms":  res.DurationMS,
		"cpus":         res.CPUs,
		"backend":      res.Backend,
	})
}

type dcgmPauseBody struct {
	DurationS int `json:"duration_s"`
}

func (h *handler) dcgmPause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if h.deps.DCGMPause == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "dcgm unavailable"})
		return
	}
	var body dcgmPauseBody
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.DurationS <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "duration_s must be > 0"})
		return
	}
	if err := h.deps.DCGMPause(time.Duration(body.DurationS) * time.Second); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "paused"})
}

func (h *handler) dcgmResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if h.deps.DCGMResume == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "dcgm unavailable"})
		return
	}
	if err := h.deps.DCGMResume(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "resumed"})
}

func (h *handler) cpuHighRes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if h.deps.HighResCPU == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "high-res CPU sampler unavailable"})
		return
	}
	samples := h.deps.HighResCPU.Snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"count":   len(samples),
		"samples": samples,
	})
}

func (h *handler) recordProfile(profileType, result string) {
	if h.profileCounter == nil {
		return
	}
	h.profileCounter.Add(context.Background(), 1,
		metric.WithAttributes(
			attribute.String("profile.type", profileType),
			attribute.String("result", result),
		),
	)
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func methodNotAllowed(w http.ResponseWriter) {
	http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
}
