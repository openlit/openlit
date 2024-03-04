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

	usageResponse, err := fetchChatUsageData(currentDate, apiToken, orgID)
	if err != nil {
		fmt.Println("Error fetching usage data:", err)
		return
	}

	// Initialize transformedData as a slice of dictionaries (maps)
	var transformedData []map[string]interface{}

	for _, data := range usageResponse.Data {
		transformedData = append(transformedData, transformData(data))
	}

	for _, data := range transformedData {
		db.InsertNoCodeLLM(data)
	}
}

func fetchChatUsageData(date string, apiToken string, orgID string) (struct {
	Data []map[string]interface{} `json:"data"`
}, error) {
	client := &http.Client{}
	url := fmt.Sprintf("https://api.openai.com/v1/usage?date=%s", date)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return struct {
			Data []map[string]interface{} `json:"data"`
		}{}, err
	}

	req.Header.Set("Authorization", "Bearer "+apiToken)
	req.Header.Set("Openai-Organization", orgID)

	resp, err := client.Do(req)
	if err != nil {
		return struct {
			Data []map[string]interface{} `json:"data"`
		}{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return struct {
			Data []map[string]interface{} `json:"data"`
		}{}, err
	}

	var usageResponse struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(body, &usageResponse); err != nil {
		return struct {
			Data []map[string]interface{} `json:"data"`
		}{}, err
	}

	return usageResponse, nil
}

func transformData(data map[string]interface{}) map[string]interface{} {
	costResult, _ := cost.CalculateChatCost(data["n_context_tokens_total"].(float64), data["n_generated_tokens_total"].(float64), data["snapshot_id"].(string))
	transformed := make(map[string]interface{})
	transformed["endpoint"] = "openai.com/chat/completions"
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
