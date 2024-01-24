package cost

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

var Pricing PricingModel

// PricingModel is the pricing information for the different models and features.
type PricingModel struct {
	Embeddings map[string]float64                       `json:"embeddings"`
	Images     map[string]map[string]map[string]float64 `json:"images"`
	Audio      map[string]float64                       `json:"audio"`
	Chat       map[string]struct {
		PromptPrice     float64 `json:"promptPrice"`
		CompletionPrice float64 `json:"completionPrice"`
	} `json:"chat"`
}

// validatePricingData validates the pricing data for the different models and features.
func validatePricingData(pricingModel PricingModel) error {
	// Example validation for Embeddings pricing
	if len(pricingModel.Embeddings) == 0 {
		return fmt.Errorf("Embeddings pricing data is not defined")
	}

	// Example validation for Audio pricing
	if len(pricingModel.Audio) == 0 {
		return fmt.Errorf("Audio pricing data is not defined")
	}

	// Validate the Images pricing, which has nested maps
	for model, qualityMap := range pricingModel.Images {
		if len(qualityMap) == 0 {
			return fmt.Errorf("image pricing data for model '%s' is not defined in the JSON File", model)
		}
		for quality, sizeMap := range qualityMap {
			if len(sizeMap) == 0 {
				return fmt.Errorf("image pricing data for model '%s', quality '%s' is not defined in the JSON File", model, quality)
			}
		}
	}

	// Validate the Chat pricing
	for model, chatPricing := range pricingModel.Chat {
		if chatPricing.PromptPrice == 0 {
			return fmt.Errorf("Prompt Tokens pricing data for model '%s' is not defined in the JSON File", model)
		} else if chatPricing.CompletionPrice == 0 {
			return fmt.Errorf("Completion Tokens pricing data for model '%s' is not defined in the JSON File", model)
		}
	}

	return nil
}

// fetchJSONFromURL is a new function for fetching JSON content from a URL.
func fetchJSONFromURL(url string) ([]byte, error) {
	maxRetries := 5
	var resp *http.Response
	var err error
	for i := 0; i < maxRetries; i++ {
		resp, err = http.Get(url)
		if err == nil {
			break
		}
	}

	if err != nil {
		return nil, fmt.Errorf("Failed to make request to URL %s", url)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Failed to fetch JSON content from URL %s", url)
	}

	return io.ReadAll(resp.Body)
}

// fetchJSONFromFile is a new function for fetching JSON content from a URL.
func fetchJSONFromFile(path string) ([]byte, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("Failed to fetch JSON content from file '%s'", path)
	}

	return content, nil
}

// LoadPricing loads the pricing information from the given file.
func LoadPricing(path, url string) error {
	var content []byte
	var err error

	switch {
	case path != "":
		content, err = fetchJSONFromFile(path)
	case url != "":
		content, err = fetchJSONFromURL(url)
	}
	if err != nil {
		return err
	}

	if err = json.Unmarshal(content, &Pricing); err != nil {
		return fmt.Errorf("Failed to unmarshal costing JSON: %w", err)
	}

	if err = validatePricingData(Pricing); err != nil {
		return err
	}

	return nil
}

// calculateEmbeddingsCost calculates the cost for embeddings based on the model and prompt tokens.
func CalculateEmbeddingsCost(promptTokens float64, model string) (float64, error) {
	price, ok := Pricing.Embeddings[model]
	if !ok {
		return 0, nil
	}
	return (promptTokens / 1000) * price, nil
}

// calculateImageCost calculates the cost for images based on the model, image size, and quality.
func CalculateImageCost(model, imageSize, quality string) (float64, error) {
	models, ok := Pricing.Images[model]
	if !ok {
		return 0, nil
	}
	qualities, ok := models[quality]
	if !ok {
		return 0, nil
	}
	price, ok := qualities[imageSize]
	if !ok {
		return 0, nil
	}

	return price, nil
}

// calculateChatCost calculates the cost for chat based on the model, prompt tokens, and completion tokens.
func CalculateChatCost(promptTokens, completionTokens float64, model string) (float64, error) {
	chatModel, ok := Pricing.Chat[model]
	if !ok {
		return 0, nil
	}
	return ((promptTokens / 1000) * chatModel.PromptPrice) + ((completionTokens / 1000) * chatModel.CompletionPrice), nil
}

// CalculateAudioCost calculates the cost for Audio based on the model, and prompt.
func CalculateAudioCost(prompt string, model string) (float64, error) {
	price, ok := Pricing.Audio[model]
	if !ok {
		return 0, nil
	}
	return ((float64(len(prompt)) / 1000) * price), nil
}
