package nocode

import (
	"encoding/json"
	"fmt"
	"ingester/cost"
	"ingester/db"
	"io"
	"net/http"
	"time"
)

func RunOpenAITask() {
	apiToken := ""
	orgID := ""

	currentDate := time.Now().Format("2006-01-02")

	chatData, dalleData, err := fetchChatUsageData(currentDate, apiToken, orgID)
	if err != nil {
		fmt.Println("Error fetching usage data:", err)
		return
	}

	// Initialize transformedChatData as a slice of dictionaries (maps)
	var transformedChatData []map[string]interface{}
	var transformedDalleData []map[string]interface{}

	for _, data := range chatData {
		transformedChatData = append(transformedChatData, transformChatData(data))
	}

	for _, data := range dalleData {
		transformedDalleData = append(transformedDalleData, transformImageData(data))
	}

	allData := append(transformedChatData, transformedDalleData...)

	if err := db.InsertNoCodeLLM(allData); err != nil {
		fmt.Printf("Error batching data to ClickHouse: %v\n", err)
		return
	}
}

func fetchChatUsageData(date string, apiToken string, orgID string) ([]map[string]interface{}, []map[string]interface{}, error) {
	client := &http.Client{}
	url := fmt.Sprintf("https://api.openai.com/v1/usage?date=%s", date)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, nil, err
	}

	req.Header.Set("Authorization", "Bearer "+apiToken)
	req.Header.Set("Openai-Organization", orgID)

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}

	var usageResponse struct {
		Data         []map[string]interface{} `json:"data"`
		DalleAPIData []map[string]interface{} `json:"dalle_api_data"`
	}
	if err := json.Unmarshal(body, &usageResponse); err != nil {
		return nil, nil, err
	}

	return usageResponse.Data, usageResponse.DalleAPIData, nil
}

func transformChatData(data map[string]interface{}) map[string]interface{} {
	costResult, _ := cost.CalculateChatCost(data["n_context_tokens_total"].(float64), data["n_generated_tokens_total"].(float64), data["snapshot_id"].(string))
	transformed := make(map[string]interface{})
	transformed["endpoint"] = "openai.chat.completions"
	transformed["totalTokens"] = data["n_context_tokens_total"].(float64) + data["n_generated_tokens_total"].(float64)
	for key, value := range data {
		switch key {
		case "snapshot_id":
			transformed["model"] = value
		case "n_context_tokens_total":
			transformed["promptTokens"] = value
		case "n_generated_tokens_total":
			transformed["completionTokens"] = value
		// Exclude certain fields by not copying them over
		case "api_key_redacted", "operation":
			continue
		default:
			transformed[key] = value
		}
	}
	transformed["cost"] = costResult
	return transformed
}

func transformImageData(data map[string]interface{}) map[string]interface{} {
	costResult, _ := cost.CalculateImageCost(data["model_id"].(string), data["image_size"].(string), "standard")
	transformed := make(map[string]interface{})
	transformed["endpoint"] = "openai.image"
	for key, value := range data {
		switch key {
		case "model_id":
			transformed["model"] = value
		case "image_size":
			transformed["imageSize"] = value
		case "num_requests":
			transformed["n_requests"] = value
		case "timestamp":
			transformed["aggregation_timestamp"] = value
		// Exclude certain fields by not copying them over
		case "api_key_redacted", "num_images", "operation", "user_id":
			continue
		default:
			transformed[key] = value
		}
	}
	transformed["cost"] = costResult
	return transformed
}