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
	if got != want {
		t.Fatalf("CalculateCostWithCache() = %v, want %v", got, want)
	}

	if legacy := cache.CalculateCost("claude-test", 10, 5); legacy != 0.02 {
		t.Fatalf("CalculateCost() = %v, want 0.02", legacy)
	}
}

func TestFetchPricingReadsChatCacheRates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"chat":{"claude-test":{"promptPrice":1,"completionPrice":2,"cacheReadPrice":0.1,"cacheCreationPrice":3}}}`))
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
	if pricing.CacheReadCostPerToken != 0.0001 || pricing.CacheCreationCostPerToken != 0.003 {
		t.Fatalf("unexpected cache rates: %+v", pricing)
	}
}
