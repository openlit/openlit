package httpserver

import (
	"compress/gzip"
	"errors"
	"io"
	"net/http"
	"strings"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	colllog "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collmetric "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	colltrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"

	"github.com/openlit/openlit/otlp-receiver/internal/ingest"
	"github.com/openlit/openlit/otlp-receiver/internal/tenant"
)

func New(svc *ingest.Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/v1/traces", func(w http.ResponseWriter, r *http.Request) {
		handle(w, r, func(body []byte, contentType string) error {
			var req colltrace.ExportTraceServiceRequest
			if err := unmarshal(body, contentType, &req); err != nil {
				return err
			}
			return svc.Traces(r.Context(), r.Header.Get("Authorization"), &req)
		})
	})
	mux.HandleFunc("/v1/logs", func(w http.ResponseWriter, r *http.Request) {
		handle(w, r, func(body []byte, contentType string) error {
			var req colllog.ExportLogsServiceRequest
			if err := unmarshal(body, contentType, &req); err != nil {
				return err
			}
			return svc.Logs(r.Context(), r.Header.Get("Authorization"), &req)
		})
	})
	mux.HandleFunc("/v1/metrics", func(w http.ResponseWriter, r *http.Request) {
		handle(w, r, func(body []byte, contentType string) error {
			var req collmetric.ExportMetricsServiceRequest
			if err := unmarshal(body, contentType, &req); err != nil {
				return err
			}
			return svc.Metrics(r.Context(), r.Header.Get("Authorization"), &req)
		})
	})
	return headerGuard(mux)
}

func headerGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Del("x-database-config-id")
		r.Header.Del("X-Database-Config-Id")
		r.Header.Del("x-openlit-database-config-id")
		next.ServeHTTP(w, r)
	})
}

type decodeError struct{ error }

var errTooLarge = errors.New("payload too large")

const maxOTLPBody = 32 << 20

func handle(w http.ResponseWriter, r *http.Request, fn func([]byte, string) error) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := readBody(r)
	if err != nil {
		if errors.Is(err, errTooLarge) {
			http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if err := fn(body, r.Header.Get("Content-Type")); err != nil {
		if _, ok := err.(*decodeError); ok {
			http.Error(w, "invalid otlp payload", http.StatusBadRequest)
			return
		}
		status := ingest.HTTPStatus(err)
		if status == http.StatusUnauthorized {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		http.Error(w, "ingest failed", status)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func readBody(r *http.Request) ([]byte, error) {
	reader := r.Body
	if strings.EqualFold(r.Header.Get("Content-Encoding"), "gzip") {
		gz, err := gzip.NewReader(r.Body)
		if err != nil {
			return nil, err
		}
		defer gz.Close()
		reader = gz
	}
	limited := io.LimitReader(reader, int64(maxOTLPBody)+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(body) > maxOTLPBody {
		return nil, errTooLarge
	}
	return body, nil
}

func unmarshal(body []byte, contentType string, msg proto.Message) error {
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "json") {
		if err := protojson.Unmarshal(body, msg); err != nil {
			return &decodeError{err}
		}
		return nil
	}
	if err := proto.Unmarshal(body, msg); err != nil {
		return &decodeError{err}
	}
	return nil
}

func UnauthorizedFrom(err error) bool {
	return err == tenant.ErrUnauthorized
}
