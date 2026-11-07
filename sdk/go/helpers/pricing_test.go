package helpers

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestPricingServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../../../assets/pricing.json")
	}))
	t.Cleanup(srv.Close)
	return srv
}

func assertCost(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("cost = %v, want %v", got, want)
	}
}

func TestFetchPricingReadsPublishedPricingFile(t *testing.T) {
	srv := newTestPricingServer(t)
	pc := NewPricingCache(srv.URL, true, nil)
	pc.fetchPricing(context.Background())

	// assets/pricing.json lists gpt-4.1-nano at 0.0001 / 0.0004 USD per 1K
	// tokens, i.e. 0.10 / 0.40 USD per 1M tokens.
	assertCost(t, pc.CalculateCost("gpt-4.1-nano", 1_000_000, 0), 0.10)
	assertCost(t, pc.CalculateCost("gpt-4.1-nano", 0, 1_000_000), 0.40)
	assertCost(t, pc.CalculateCost("GPT-4.1-NANO", 1000, 1000), 0.0005)

	// Embedding prices are a single USD per 1K tokens value.
	assertCost(t, pc.CalculateCost("text-embedding-3-small", 1_000_000, 0), 0.02)
}

func TestFetchPricingKeepsCustomPricing(t *testing.T) {
	srv := newTestPricingServer(t)
	custom := map[string]PricingInfo{
		"gpt-4.1-nano": {InputCostPerToken: 1, OutputCostPerToken: 2},
	}
	pc := NewPricingCache(srv.URL, true, custom)
	pc.fetchPricing(context.Background())

	assertCost(t, pc.CalculateCost("gpt-4.1-nano", 3, 4), 11)
}

func TestCalculateCostUnknownModel(t *testing.T) {
	pc := NewPricingCache("", true, nil)
	assertCost(t, pc.CalculateCost("does-not-exist", 1000, 1000), 0)
}
