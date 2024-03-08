package connections

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"
)

func configureSignozData(data map[string]interface{}, config ConnectionConfig) {
	signozUrl := config.LogsUrl
	signozAPIKey := config.ApiKey

	var platform string

	// Extract the platform from the endpoint string
	endpointParts := strings.Split(data["endpoint"].(string), ".")
	if len(endpointParts) > 0 {
		platform = endpointParts[0] // The first part of the endpoint string is the platform.
	} else {
		platform = "Unknown" // If the endpoint string is not in the expected format, set the platform to "unknown".
	}

	// Determine the type based on the endpoint by consulting the mapping.
	call_type, found := endpointTypeMapping[data["endpoint"].(string)]
	if !found {
		call_type = "Unknown"
	}

	if data["endpoint"] == "openai.chat.completions" || data["endpoint"] == "openai.completions" || data["endpoint"] == "cohere.generate" || data["endpoint"] == "cohere.chat" || data["endpoint"] == "cohere.summarize" || data["endpoint"] == "anthropic.messages" {
		if data["finishReason"] == nil {
			data["finishReason"] = "null"
		}

		jsonBody := fmt.Sprintf(`[
			{
				"trace_id": "",
				"span_id": "",
				"severity_text": "INFO",
				"severity_number": 0,
				"attributes": {
					"platform": "%v",
					"generation": "%v",
					"applicationName": "%v",
					"sourceLanguage": "%v",
					"endpoint": "%v",
					"model": "%v",
					"usageCost": %v,
					"promptTokens": %v,
					"completionTokens": %v,
					"requestDuration": %v,
					"totalTokens": %v,
					"finishReason": "%v",
					"response": "%v"
				},
				"resources": {
					"job": "doku",
					"environment": "%v"
				},
				"body": "%v"
			}
		]`, platform, call_type, data["applicationName"], data["sourceLanguage"], data["endpoint"], data["model"], data["usageCost"], data["promptTokens"], data["completionTokens"], data["requestDuration"], data["totalTokens"], data["finishReason"], normalizeString(data["response"].(string)), data["environment"], normalizeString(data["prompt"].(string)))

		// Send the data to Signoz
		err := sendTelemetrySignoz(jsonBody, signozAPIKey, signozUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to SigNoz")
		}
	} else if data["endpoint"] == "openai.embeddings" || data["endpoint"] == "cohere.embed" {
		jsonBody := fmt.Sprintf(`[
			{
				"trace_id": "",
				"span_id": "",
				"severity_text": "INFO",
				"severity_number": 0,
				"attributes": {
					"platform": "%v",
					"generation": "%v",
					"applicationName": "%v",
					"sourceLanguage": "%v",
					"endpoint": "%v",
					"model": "%v",
					"usageCost": %v,
					"promptTokens": %v,
					"requestDuration": %v,
					"totalTokens": %v
				},
				"resources": {
					"job": "doku",
					"environment": "%v"
				},
				"body": "%v"
			}
		]`, platform, call_type, data["applicationName"], data["sourceLanguage"], data["endpoint"], data["model"], data["usageCost"], data["promptTokens"], data["requestDuration"], data["totalTokens"], data["environment"], normalizeString(data["prompt"].(string)))

		// Send the data to Signoz
		err := sendTelemetrySignoz(jsonBody, signozAPIKey, signozUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to SigNoz")
		}
	} else if data["endpoint"] == "openai.fine_tuning" {
		jsonBody := fmt.Sprintf(`[
			{
				"trace_id": "",
				"span_id": "",
				"severity_text": "INFO",
				"severity_number": 0,
				"attributes": {
					"platform": "%v",
					"generation": "%v",
					"applicationName": "%v",
					"sourceLanguage": "%v",
					"endpoint": "%v",
					"model": "%v",
					"requestDuration": %v,
					"fineTuneJobStatus": "%v"
				},
				"resources": {
					"job": "doku",
					"environment": "%v"
				},
				"body": "%v"
			}
		]`, platform, call_type, data["applicationName"], data["sourceLanguage"], data["endpoint"], data["model"], data["requestDuration"], data["finetuneJobStatus"], data["environment"], normalizeString(data["prompt"].(string)))

		// Send the data to Signoz
		err := sendTelemetrySignoz(jsonBody, signozAPIKey, signozUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to SigNoz")
		}
	} else if data["endpoint"] == "openai.images.create" || data["endpoint"] == "openai.images.create.variations" {
		var promptMessage string
		if data["model"] == "dall-e-2" {
			// Assuming data["prompt"] exists and is a string
			promptMessage = normalizeString(data["prompt"].(string))
		} else {
			// Assuming data["revisedPrompt"] exists and is a string
			promptMessage = normalizeString(data["revisedPrompt"].(string))
		}

		jsonBody := fmt.Sprintf(`[
			{
				"trace_id": "",
				"span_id": "",
				"severity_text": "INFO",
				"severity_number": 0,
				"attributes": {
					"platform": "%v",
					"generation": "%v",
					"applicationName": "%v",
					"sourceLanguage": "%v",
					"endpoint": "%v",
					"model": "%v",
					"usageCost": %v,
					"requestDuration": %v,
					"imageSize": "%v",
					"imageQuality": "%v",
					"image": "%v"
				},
				"resources": {
					"job": "doku",
					"environment": "%v"
				},
				"body": "%v"
			}
		]`, platform, call_type, data["applicationName"], data["sourceLanguage"], data["endpoint"], data["model"], data["usageCost"], data["requestDuration"], data["imageSize"], data["imageQuality"], data["image"], data["environment"], promptMessage)

		// Send the data to Signoz
		err := sendTelemetrySignoz(jsonBody, signozAPIKey, signozUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to SigNoz")
		}
	} else if data["endpoint"] == "openai.audio.speech.create" {
		jsonBody := fmt.Sprintf(`[
			{
				"trace_id": "",
				"span_id": "",
				"severity_text": "INFO",
				"severity_number": 0,
				"attributes": {
					"platform": "%v",
					"generation": "%v",
					"applicationName": "%v",
					"sourceLanguage": "%v",
					"endpoint": "%v",
					"model": "%v",
					"usageCost": %v,
					"requestDuration": %v,
					"audioVoice": "%v"
				},
				"resources": {
					"job": "doku",
					"environment": "%v"
				},
				"body": "%v"
			}
		]`, platform, call_type, data["applicationName"], data["sourceLanguage"], data["endpoint"], data["model"], data["usageCost"], data["requestDuration"], data["audioVoice"], data["environment"], normalizeString(data["prompt"].(string)))

		// Send the data to Signoz
		err := sendTelemetrySignoz(jsonBody, signozAPIKey, signozUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to SigNoz")
		}
	}
}

func sendTelemetrySignoz(telemetryData, apiKey string, url string, requestType string) error {
	// Create a new request using http
	req, err := http.NewRequest("POST", url, bytes.NewBuffer([]byte(telemetryData)))
	if err != nil {
		return fmt.Errorf("error creating request")
	}

	// Add headers to the request
	req.Header.Add("Content-Type", "application/json")
	req.Header.Add("signoz-access-token", apiKey)

	// Send the request via a client
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request to %v", url)
	} else if resp.StatusCode == 404 {
		return fmt.Errorf("provided URL %v is not valid", url)
	} else if resp.StatusCode == 403 {
		return fmt.Errorf("provided credentials are not valid")
	}

	defer resp.Body.Close()

	log.Info().Msgf("Successfully exported data to %v", url)
	return nil
}
