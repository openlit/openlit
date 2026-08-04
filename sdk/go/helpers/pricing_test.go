package helpers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCalculateCostWithCache(t *testing.T) {
	cache := NewPricingCache("", true, map[string]PricingInfo{
		"claude-test": {
			InputCostPerToken:         0.001,
			OutputCostPerToken:        0.002,
			CacheReadCostPerToken:     0.0001,
			CacheCreationCostPerToken: 0.003,
		},
	})

	got := cache.CalculateCostWithCache("claude-test", 10, 5, 100, 20)
	want := 10*0.001 + 5*0.002 + 100*0.0001 + 20*0.003
	if diff := got - want; diff < -1e-12 || diff > 1e-12 {
		t.Fatalf("CalculateCostWithCache() = %v, want %v", got, want)
	}

	legacy := cache.CalculateCost("claude-test", 10, 5)
	if diff := legacy - 0.02; diff < -1e-12 || diff > 1e-12 {
		t.Fatalf("CalculateCost() = %v, want 0.02", legacy)
	}

	if unknown := cache.CalculateCostWithCache("unknown-model", 1, 1, 1, 1); unknown != 0 {
		t.Fatalf("unknown model cost = %v, want 0", unknown)
	}
}

func TestFetchPricingReadsChatCacheRates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"legacy-model":{"input":0.001,"output":0.002,"cache_read":0.0001,"cache_creation":0.003}},"chat":{"claude-test":{"promptPrice":1,"completionPrice":2,"cacheReadPrice":0.1,"cacheCreationPrice":3}}}`))
	}))
	defer server.Close()

	cache := NewPricingCache(server.URL, false, nil)
	if err := cache.RefreshPricing(context.Background()); err != nil {
		t.Fatalf("RefreshPricing() error = %v", err)
	}

	pricing, ok := cache.GetPricing("claude-test")
	if !ok {
		t.Fatal("expected fetched pricing")
	}
	if pricing.InputCostPerToken != 0.001 || pricing.OutputCostPerToken != 0.002 {
		t.Fatalf("unexpected regular rates: %+v", pricing)
	}
	got := pricing.CacheReadCostPerToken
	if diff := got - 0.0001; diff < -1e-12 || diff > 1e-12 {
		t.Fatalf("cache read rate = %v, want 0.0001", got)
	}
	got = pricing.CacheCreationCostPerToken
	if diff := got - 0.003; diff < -1e-12 || diff > 1e-12 {
		t.Fatalf("cache creation rate = %v, want 0.003", got)
	}

	legacy, ok := cache.GetPricing("legacy-model")
	if !ok {
		t.Fatal("expected legacy data pricing")
	}
	if diff := legacy.CacheReadCostPerToken - 0.0001; diff < -1e-12 || diff > 1e-12 {
		t.Fatalf("legacy cache read rate = %v, want 0.0001", legacy.CacheReadCostPerToken)
	}
	if diff := legacy.CacheCreationCostPerToken - 0.003; diff < -1e-12 || diff > 1e-12 {
		t.Fatalf("legacy cache creation rate = %v, want 0.003", legacy.CacheCreationCostPerToken)
	}
}
