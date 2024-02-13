package connections

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"
)

func configureSignozData(data map[string]interface{}) {
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

	// Create JSON body using fmt.Sprintf and the data1 map
	jsonBody := fmt.Sprintf(`[
		{
			"trace_id": "",
			"span_id": "",
			"severity_text": "INFO",
			"severity_number": 0,
			"attributes": {
				"platform": "%v",
				"callType": "%v",
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
				"imageSize" : "%v",
				"revisedPrompt": "%v",
				"image" : "%v",
				"audioVoice" : "%v",
				"finetuneJobStatus": "%v",
				"response": "%v"
			},
			"resources": {
				"job": "doku",
				"environment": "%v"
			},
			"body": "%v"
		}
	]`, platform, call_type, data["applicationName"], data["sourceLanguage"], data["endpoint"], data["model"], data["usageCost"], data["promptTokens"], data["completionTokens"], data["requestDuration"], data["totalTokens"], data["finishReason"], data["imageSize"], data["revisedPrompt"], data["image"], data["audioVoice"], data["finetuneJobStatus"],normalizeString(data["response"].(string)), data["environment"], normalizeString(data["prompt"].(string)))

	// Send the data to Signoz
	err := sendTelemetrySignoz(jsonBody, signozAPIKey, signozUrl, "POST")
	if err != nil {
		log.Error().Err(err).Msgf("Error sending Metrics to SigNoz")
	}
}

func sendTelemetrySignoz(telemetryData, apiKey string, url string, requestType string) error {
	// Create a new request using http
    req, err := http.NewRequest("POST", url, bytes.NewBuffer([]byte(telemetryData)))
	if err != nil {
		return fmt.Errorf("Error creating request")
	}

	// Add headers to the request
	req.Header.Add("Content-Type", "application/json")
    req.Header.Add("signoz-access-token", apiKey)

	// Send the request via a client
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("Error sending request to %v", url)
	} else if resp.StatusCode == 404 {
		return fmt.Errorf("Provided URL %v is not valid", url)
	} else if resp.StatusCode == 403 {
		return fmt.Errorf("Provided credentials are not valid")
	}

	defer resp.Body.Close()

	log.Info().Msgf("Successfully exported data to %v", url)
	return nil
}
