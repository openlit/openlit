package helpers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// PricingInfo holds pricing information for a model
type PricingInfo struct {
	InputCostPerToken  float64 `json:"input_cost_per_token"`
	OutputCostPerToken float64 `json:"output_cost_per_token"`
}

// PricingCache manages pricing information with automatic fetching
type PricingCache struct {
	mu                sync.RWMutex
	prices            map[string]PricingInfo
	endpoint          string
	disableFetch      bool
	lastFetch         time.Time
	fetchInterval     time.Duration
	client            *http.Client
}

// pricingResponse represents the structure from the pricing JSON
type pricingResponse struct {
	Data map[string]struct {
		Input  float64 `json:"input"`
		Output float64 `json:"output"`
	} `json:"data"`
}

var (
	globalPricingCache *PricingCache
	pricingCacheMutex  sync.Mutex
)

// NewPricingCache creates a new pricing cache
func NewPricingCache(endpoint string, disableFetch bool, customPricing map[string]PricingInfo) *PricingCache {
	if endpoint == "" {
		endpoint = "https://github.com/openlit/openlit/raw/main/assets/pricing.json"
	}

	pc := &PricingCache{
		prices:        make(map[string]PricingInfo),
		endpoint:      endpoint,
		disableFetch:  disableFetch,
		fetchInterval: 24 * time.Hour, // Refresh pricing daily
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}

	// Add custom pricing
	for model, pricing := range customPricing {
		pc.prices[normalizeModelName(model)] = pricing
	}

	// Fetch pricing if not disabled
	if !disableFetch {
		go pc.fetchPricing(context.Background())
	}

	return pc
}

// InitGlobalPricingCache initializes the global pricing cache
func InitGlobalPricingCache(endpoint string, disableFetch bool, customPricing map[string]PricingInfo) {
	pricingCacheMutex.Lock()
	defer pricingCacheMutex.Unlock()

	globalPricingCache = NewPricingCache(endpoint, disableFetch, customPricing)
}

// GetGlobalPricingCache returns the global pricing cache
func GetGlobalPricingCache() *PricingCache {
	pricingCacheMutex.Lock()
	defer pricingCacheMutex.Unlock()

	if globalPricingCache == nil {
		globalPricingCache = NewPricingCache("", false, nil)
	}

	return globalPricingCache
}

// GetPricing returns pricing information for a model
func (pc *PricingCache) GetPricing(model string) (PricingInfo, bool) {
	pc.mu.RLock()
	defer pc.mu.RUnlock()

	normalizedModel := normalizeModelName(model)
	pricing, ok := pc.prices[normalizedModel]
	return pricing, ok
}

// SetPricing sets pricing information for a model
func (pc *PricingCache) SetPricing(model string, pricing PricingInfo) {
	pc.mu.Lock()
	defer pc.mu.Unlock()

	pc.prices[normalizeModelName(model)] = pricing
}

// CalculateCost calculates the cost for input and output tokens
func (pc *PricingCache) CalculateCost(model string, inputTokens, outputTokens int) float64 {
	pricing, ok := pc.GetPricing(model)
	if !ok {
		return 0.0
	}

	inputCost := float64(inputTokens) * pricing.InputCostPerToken
	outputCost := float64(outputTokens) * pricing.OutputCostPerToken

	return inputCost + outputCost
}

// fetchPricing fetches pricing information from the endpoint
func (pc *PricingCache) fetchPricing(ctx context.Context) {
	pc.mu.Lock()
	// Check if we need to fetch
	if time.Since(pc.lastFetch) < pc.fetchInterval {
		pc.mu.Unlock()
		return
	}
	pc.mu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pc.endpoint, nil)
	if err != nil {
		return
	}

	resp, err := pc.client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var pricingData pricingResponse
	if err := json.NewDecoder(resp.Body).Decode(&pricingData); err != nil {
		return
	}

	pc.mu.Lock()
	defer pc.mu.Unlock()

	// Update pricing information
	for model, prices := range pricingData.Data {
		normalizedModel := normalizeModelName(model)
		// Don't override custom pricing
		if _, exists := pc.prices[normalizedModel]; !exists {
			pc.prices[normalizedModel] = PricingInfo{
				InputCostPerToken:  prices.Input,
				OutputCostPerToken: prices.Output,
			}
		}
	}

	pc.lastFetch = time.Now()
}

// RefreshPricing forces a refresh of pricing information
func (pc *PricingCache) RefreshPricing(ctx context.Context) error {
	if pc.disableFetch {
		return fmt.Errorf("pricing fetch is disabled")
	}

	pc.fetchPricing(ctx)
	return nil
}

// normalizeModelName normalizes model names for lookup
func normalizeModelName(model string) string {
	// Convert to lowercase and remove common prefixes
	model = strings.ToLower(model)
	model = strings.TrimSpace(model)
	return model
}

// CalculateGlobalCost is a convenience function using the global cache
func CalculateGlobalCost(model string, inputTokens, outputTokens int) float64 {
	cache := GetGlobalPricingCache()
	return cache.CalculateCost(model, inputTokens, outputTokens)
}
