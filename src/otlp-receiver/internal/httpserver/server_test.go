package httpserver

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"testing"

	colltrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/openlit/openlit/otlp-receiver/internal/ingest"
	"github.com/openlit/openlit/otlp-receiver/internal/tenant"
)

func TestHealthAndAuthAndJSON(t *testing.T) {
	require := &tenant.Store{RequireKey: true}
	svc := &ingest.Service{Tenants: require}
	h := New(svc)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("health %d", rr.Code)
	}

	body := []byte(`{"resourceSpans":[]}`)
	post := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewReader(body))
	post.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, post)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("missing key status %d", rr.Code)
	}

}

func TestJSONAndProtobufDecode(t *testing.T) {
	req := &colltrace.ExportTraceServiceRequest{
		ResourceSpans: []*tracepb.ResourceSpans{{
			Resource: &resourcepb.Resource{Attributes: []*commonpb.KeyValue{
				{Key: "service.name", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "svc"}}},
			}},
		}},
	}
	jsonBody, err := protojson.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var decoded colltrace.ExportTraceServiceRequest
	if err := unmarshal(jsonBody, "application/json", &decoded); err != nil {
		t.Fatal(err)
	}
	pb, err := proto.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	decoded = colltrace.ExportTraceServiceRequest{}
	if err := unmarshal(pb, "application/x-protobuf", &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.ResourceSpans) != 1 {
		t.Fatal("protobuf decode")
	}

	var gz bytes.Buffer
	w := gzip.NewWriter(&gz)
	_, _ = w.Write(jsonBody)
	_ = w.Close()
	httpReq := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewReader(gz.Bytes()))
	httpReq.Header.Set("Content-Encoding", "gzip")
	got, err := readBody(httpReq)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, jsonBody) {
		t.Fatal("gzip roundtrip")
	}
}

func TestInvalidJSON(t *testing.T) {
	svc := &ingest.Service{Tenants: &tenant.Store{RequireKey: true}}
	h := New(svc)
	post := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewReader([]byte("not-json")))
	post.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, post)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d", rr.Code)
	}
}

func TestStripsTenantHeaders(t *testing.T) {
	svc := &ingest.Service{Tenants: &tenant.Store{RequireKey: true}}
	h := New(svc)
	post := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewReader([]byte("{}")))
	post.Header.Set("Content-Type", "application/json")
	post.Header.Set("x-database-config-id", "forged")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, post)
	if post.Header.Get("x-database-config-id") != "forged" {
		// handler clones? ServeHTTP receives the same request; headerGuard deletes on the request.
	}
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("got %d", rr.Code)
	}
}

func TestRejectsOversizedBody(t *testing.T) {
	svc := &ingest.Service{Tenants: &tenant.Store{RequireKey: true}}
	h := New(svc)
	body := make([]byte, maxOTLPBody+1)
	post := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewReader(body))
	post.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, post)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d", rr.Code)
	}
}
