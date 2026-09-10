package control

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/kineto"
)

func TestRequireAddr(t *testing.T) {
	if err := requireAddr("127.0.0.1:1778", false, ""); err != nil {
		t.Fatal(err)
	}
	if err := requireAddr("localhost:1778", false, ""); err != nil {
		t.Fatal(err)
	}
	if err := requireAddr("[::1]:1778", false, ""); err != nil {
		t.Fatal(err)
	}
	if err := requireAddr("0.0.0.0:1778", false, "tok"); err == nil {
		t.Fatal("expected reject for 0.0.0.0 without allow_remote")
	}
	if err := requireAddr("0.0.0.0:1778", true, ""); err == nil {
		t.Fatal("expected reject allow_remote without token")
	}
	if err := requireAddr("0.0.0.0:1778", true, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := requireAddr(":1778", false, ""); err == nil {
		t.Fatal("expected reject for empty host")
	}
}

func TestStatusAndAuth(t *testing.T) {
	mux := newTestMux(t, "secret", Deps{Version: "1.2.3"})

	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status without token: %d", rr.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status: %d %s", rr.Code, rr.Body.String())
	}
	var st map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st["status"] != float64(1) {
		t.Fatalf("status body: %v", st)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/version", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || rr.Body.String() != "1.2.3" {
		t.Fatalf("version: %d %q", rr.Code, rr.Body.String())
	}
}

func TestProfileGPU(t *testing.T) {
	dir := t.TempDir()
	ks := kineto.NewServer(dir, filepath.Join(dir, "sock"), slog.Default())
	ks.Registry.Register(42, 7)
	ks.Registry.Register(43, 7)

	mux := newTestMux(t, "", Deps{
		Version: "test",
		Kineto:  ks,
		GPUPIDs: func() []int32 { return []int32{42, 43} },
	})

	body := map[string]any{
		"pids":        []int{42},
		"job_id":      7,
		"duration_ms": 100,
		"log_file":    filepath.Join(dir, "trace.json"),
	}
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1/profile/gpu", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("profile: %d %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	matched, ok := resp["matched_pids"].([]any)
	if !ok || len(matched) != 1 || int(matched[0].(float64)) != 42 {
		t.Fatalf("matched_pids: %v", resp["matched_pids"])
	}
}

func TestDCGMPauseResume(t *testing.T) {
	var paused, resumed bool
	mux := newTestMux(t, "", Deps{
		Version: "test",
		DCGMPause: func(d time.Duration) error {
			if d != 5*time.Second {
				t.Fatalf("pause duration %v", d)
			}
			paused = true
			return nil
		},
		DCGMResume: func() error {
			resumed = true
			return nil
		},
	})

	raw := []byte(`{"duration_s":5}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/dcgm/pause", bytes.NewReader(raw))
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !paused {
		t.Fatalf("pause: %d paused=%v body=%s", rr.Code, paused, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/dcgm/resume", http.NoBody)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !resumed {
		t.Fatalf("resume: %d resumed=%v", rr.Code, resumed)
	}
}

func TestStartRejectsNonLoopback(t *testing.T) {
	_, err := Start("0.0.0.0:19999", "", Deps{Version: "t"}, slog.Default())
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestStartAndShutdown(t *testing.T) {
	srv, err := Start("127.0.0.1:0", "", Deps{Version: "t"}, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
}

func newTestMux(t *testing.T, token string, deps Deps) http.Handler {
	t.Helper()
	if deps.Version == "" {
		deps.Version = "test"
	}
	h := &handler{
		deps:   deps,
		token:  token,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/status", h.withAuth(h.status))
	mux.HandleFunc("/v1/version", h.withAuth(h.version))
	mux.HandleFunc("/v1/profile/gpu", h.withAuth(h.profileGPU))
	mux.HandleFunc("/v1/profile/cpu/pt", h.withAuth(h.profileCPUPT))
	mux.HandleFunc("/v1/dcgm/pause", h.withAuth(h.dcgmPause))
	mux.HandleFunc("/v1/dcgm/resume", h.withAuth(h.dcgmResume))
	mux.HandleFunc("/v1/cpu/highres", h.withAuth(h.cpuHighRes))
	return mux
}

func TestCPUHighResUnavailable(t *testing.T) {
	mux := newTestMux(t, "", Deps{Version: "test"})
	req := httptest.NewRequest(http.MethodGet, "/v1/cpu/highres", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
}
