package connections

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

func configureDataDogData(data map[string]interface{}) {
	currentTime := time.Now().Unix()

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

	if data["endpoint"] == "openai.chat.completions" || data["endpoint"] == "openai.completions" || data["endpoint"] == "cohere.generate" || data["endpoint"] == "cohere.chat" || data["endpoint"] == "cohere.summarize" || data["endpoint"] == "anthropic.completions" {
		if data["finishReason"] == nil {
			data["finishReason"] = "null"
		}
		// Create individual metric strings
		metricStrings := []string{
			fmt.Sprintf(`{
				"metric": "doku.llm.completion.tokens",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "finishReason:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["completionTokens"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
			fmt.Sprintf(`{
				"metric": "doku.llm.prompt.tokens",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "finishReason:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["promptTokens"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
			fmt.Sprintf(`{
				"metric": "doku.llm.total.tokens",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "finishReason:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["totalTokens"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
			fmt.Sprintf(`{
				"metric": "doku.llm.request.duration",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "finishReason:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["requestDuration"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
			fmt.Sprintf(`{
				"metric": "doku.llm.usage.cost",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "finishReason:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["usageCost"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type),
		}

		metrics := fmt.Sprintf(`{"series": [%s]}`, strings.Join(metricStrings, ","))
		err := sendTelemetryDataDog(metrics, dataDogAPIKey, dataDogMetricsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to DataDog")
		}

		logEntries := []string{
			fmt.Sprintf(`{
				"ddsource": "doku",
				"message": "%s",
				"ddtags": "environment:%v,endpoint:%v,applicationName:%v,source:%v,model:%v,type:prompt,platform:%v,generation:%v",
				"hostname": "doku",
				"service": "%v"
			}`, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["applicationName"]),
			fmt.Sprintf(`{
				"ddsource": "doku",
				"message": "%s",
				"ddtags": "environment:%v,endpoint:%v,applicationName:%v,source:%v,model:%v,type:response,platform:%v,generation:%v",
				"hostname": "doku",
				"service": "%v"
			}`, normalizeString(data["response"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["applicationName"]),
		}

		logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
		err = sendTelemetryDataDog(logs, dataDogAPIKey, dataDogLogsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to DataDog")
		}
	} else if data["endpoint"] == "openai.embeddings" || data["endpoint"] == "cohere.embed" {
		if data["endpoint"] == "openai.embeddings" {

			metricStrings := []string{
				fmt.Sprintf(`{
					"metric": "doku.llm.prompt.tokens",
					"type": 0,
					"points": [{ "timestamp": %d, "value": %f }],
					"resources": [{ "name": "doku", "type": "host" }],
					"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "platform:%v", "generation:%v"]
				}`, currentTime, data["promptTokens"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"metric": "doku.llm.total.tokens",
					"type": 0,
					"points": [{ "timestamp": %d, "value": %f }],
					"resources": [{ "name": "doku", "type": "host" }],
					"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "platform:%v", "generation:%v"]
				}`, currentTime, data["totalTokens"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"metric": "doku.llm.request.duration",
					"type": 0,
					"points": [{ "timestamp": %d, "value": %f }],
					"resources": [{ "name": "doku", "type": "host" }],
					"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "platform:%v", "generation:%v"]
				}`, currentTime, data["requestDuration"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"metric": "doku.llm.usage.cost",
					"type": 0,
					"points": [{ "timestamp": %d, "value": %f }],
					"resources": [{ "name": "doku", "type": "host" }],
					"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "platform:%v", "generation:%v"]
				}`, currentTime, data["usageCost"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
			}

			metrics := fmt.Sprintf(`{"series": [%s]}`, strings.Join(metricStrings, ","))
			err := sendTelemetryDataDog(metrics, dataDogAPIKey, dataDogMetricsUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Metrics to DataDog")
			}

			logEntries := []string{
				fmt.Sprintf(`{
					"ddsource": "doku",
					"message": "%s",
					"ddtags": "environment:%v,endpoint:%v,applicationName:%v,source:%v,model:%v,type:prompt,platform:%v,generation:%v",
					"hostname": "doku",
					"service": "%v"
				}`, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["applicationName"]),
			}

			logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
			err = sendTelemetryDataDog(logs, dataDogAPIKey, dataDogLogsUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Logs to DataDog")
			}
		} else {
			metricStrings := []string{
				fmt.Sprintf(`{
					"metric": "doku.llm.prompt.tokens",
					"type": 0,
					"points": [{ "timestamp": %d, "value": %f }],
					"resources": [{ "name": "doku", "type": "host" }],
					"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "platform:%v", "generation:%v"]
				}`, currentTime, data["promptTokens"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"metric": "doku.llm.request.duration",
					"type": 0,
					"points": [{ "timestamp": %d, "value": %f }],
					"resources": [{ "name": "doku", "type": "host" }],
					"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "platform:%v", "generation:%v"]
				}`, currentTime, data["requestDuration"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
				fmt.Sprintf(`{
					"metric": "doku.llm.usage.cost",
					"type": 0,
					"points": [{ "timestamp": %d, "value": %f }],
					"resources": [{ "name": "doku", "type": "host" }],
					"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "platform:%v", "generation:%v"]
				}`, currentTime, data["usageCost"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
			}

			metrics := fmt.Sprintf(`{"series": [%s]}`, strings.Join(metricStrings, ","))
			err := sendTelemetryDataDog(metrics, dataDogAPIKey, dataDogMetricsUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Metrics to DataDog")
			}

			logEntries := []string{
				fmt.Sprintf(`{
					"ddsource": "doku",
					"message": "%s",
					"ddtags": "environment:%v,endpoint:%v,applicationName:%v,source:%v,model:%v,type:prompt,platform:%v,generation:%v",
					"hostname": "doku",
					"service": "%v"
				}`, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["applicationName"]),
			}

			logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
			err = sendTelemetryDataDog(logs, dataDogAPIKey, dataDogLogsUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending Logs to DataDog")
			}
		}
	} else if data["endpoint"] == "openai.fine_tuning" {
		metricStrings := []string{
			fmt.Sprintf(`{
				"metric": "doku.llm.request.duration",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["requestDuration"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type),
		}

		metrics := fmt.Sprintf(`{"series": [%s]}`, strings.Join(metricStrings, ","))
		err := sendTelemetryDataDog(metrics, dataDogAPIKey, dataDogMetricsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to DataDog")
		}
	} else if data["endpoint"] == "openai.images.create" || data["endpoint"] == "openai.images.create.variations" {
		metricStrings := []string{
			fmt.Sprintf(`{
				"metric": "doku.llm.request.duration",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "imageSize:%v","imageQuality:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["requestDuration"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["imageSize"], data["imageQuality"], platform, call_type),
			fmt.Sprintf(`{
				"metric": "doku.llm.usage.cost",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "imageSize:%v","imageQuality:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["usageCost"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["imageSize"], data["imageQuality"], platform, call_type),
		}

		metrics := fmt.Sprintf(`{"series": [%s]}`, strings.Join(metricStrings, ","))
		err := sendTelemetryDataDog(metrics, dataDogAPIKey, dataDogMetricsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to DataDog")
		}

		var logEntries []string
		// Check the condition for the prompt
		if data["endpoint"] != "openai.images.create.variations" {
			var promptMessage string
			if data["model"] == "dall-e-2" {
				// Assuming data["prompt"] exists and is a string
				promptMessage = normalizeString(data["prompt"].(string))
			} else {
				// Assuming data["revisedPrompt"] exists and is a string
				promptMessage = normalizeString(data["revisedPrompt"].(string))
			}

			// Build the prompt log
			logEntries = append(logEntries, fmt.Sprintf(`{
				"ddsource": "doku",
					"message": "%s",
					"ddtags": "environment:%v,endpoint:%v,applicationName:%v,source:%v,model:%v,type:prompt,platform:%v,generation:%v",
					"hostname": "doku",
					"service": "%v"
				}`, promptMessage, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["applicationName"]),
			)
		}

		logEntries = append(logEntries, fmt.Sprintf(`{
			"ddsource": "doku",
				"message": "%s",
				"ddtags": "environment:%v,endpoint:%v,applicationName:%v,source:%v,model:%v,type:image,platform:%v,generation:%v",
				"hostname": "doku",
				"service": "%v"
			}`, data["image"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["applicationName"]),
		)

		logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
		err = sendTelemetryDataDog(logs, dataDogAPIKey, dataDogLogsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to DataDog")
		}
	} else if data["endpoint"] == "openai.audio.speech.create" {
		metricStrings := []string{
			fmt.Sprintf(`{
				"metric": "doku.llm.request.duration",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "audioVoice:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["requestDuration"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["audioVoice"], platform, call_type),
			fmt.Sprintf(`{
				"metric": "doku.llm.usage.cost",
				"type": 0,
				"points": [{ "timestamp": %d, "value": %f }],
				"resources": [{ "name": "doku", "type": "host" }],
				"tags": ["environment:%v", "endpoint:%v", "applicationName:%v", "source:%v", "model:%v", "audioVoice:%v", "platform:%v", "generation:%v"]
			}`, currentTime, data["usageCost"], data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["audioVoice"], platform, call_type),
		}

		metrics := fmt.Sprintf(`{"series": [%s]}`, strings.Join(metricStrings, ","))
		err := sendTelemetryDataDog(metrics, dataDogAPIKey, dataDogMetricsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Metrics to DataDog")
		}

		logEntries := []string{
			fmt.Sprintf(`{
				"ddsource": "doku",
				"message": "%s",
				"ddtags": "environment:%v,endpoint:%v,applicationName:%v,source:%v,model:%v,type:prompt,platform:%v,generation:%v",
				"hostname": "doku",
				"service": "%v"
			}`, normalizeString(data["prompt"].(string)), data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["applicationName"]),
		}

		logs := fmt.Sprintf("[%s]", strings.Join(logEntries, ","))
		err = sendTelemetryDataDog(logs, dataDogAPIKey, dataDogLogsUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending Logs to DataDog")
		}
	}
}

func sendTelemetryDataDog(telemetryData, headerKey string, url string, requestType string) error {
	// Create a new request using http
	req, err := http.NewRequest(requestType, url, bytes.NewBuffer([]byte(telemetryData)))
	if err != nil {
		return fmt.Errorf("Error creating request")
	}

	// Add headers to the request
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("DD-API-KEY", headerKey)

	// Send the request via a client
	httpClient := &http.Client{}
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
