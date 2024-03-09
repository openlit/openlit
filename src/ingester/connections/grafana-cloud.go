package connections

import (
	"bytes"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

func configureGrafanaCloudData(data map[string]interface{}, config ConnectionConfig) {
	grafanaPromUsername := config.MetricsUsername
	grafanaLokiUsername := config.LogsUsername
	grafanaAccessToken := config.ApiKey
	grafanaPromUrl := config.MetricsUrl
	grafanaLokiUrl := config.LogsUrl

	// The current time for the timestamp field.
	currentTime := strconv.FormatInt(time.Now().UnixNano(), 10)
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
		metrics := []string{
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v,platform=%v,generation=%v completionTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["completionTokens"]),
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v,platform=%v,generation=%v promptTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["promptTokens"]),
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v,platform=%v,generation=%v totalTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["totalTokens"]),
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v,platform=%v,generation=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["requestDuration"]),
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,finishReason=%v,platform=%v,generation=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["finishReason"], platform, call_type, data["usageCost"]),
		}

		var metricsBody = []byte(strings.Join(metrics, "\n"))
		authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
		err := sendTelemetryGrafanaCloud(metricsBody, authHeader, grafanaPromUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
		}

		authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)

		response_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"platform\": \"%v\", \"generation\": \"%v\", \"type\": \"response\", \"job\": \"doku\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, currentTime, normalizeString(data["response"].(string))))
		err = sendTelemetryGrafanaCloud(response_log, authHeader, grafanaLokiUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
		}

		prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"platform\": \"%v\", \"generation\": \"%v\", \"type\": \"prompt\", \"job\": \"doku\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, currentTime, normalizeString(data["prompt"].(string))))
		err = sendTelemetryGrafanaCloud(prompt_log, authHeader, grafanaLokiUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
		}
	} else if data["endpoint"] == "openai.embeddings" || data["endpoint"] == "cohere.embed" {
		if data["endpoint"] == "openai.embeddings" {
			metrics := []string{
				fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,platform=%v,generation=%v promptTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["promptTokens"]),
				fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,platform=%v,generation=%v totalTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["totalTokens"]),
				fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,platform=%v,generation=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["requestDuration"]),
				fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,platform=%v,generation=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["usageCost"]),
			}
			var metricsBody = []byte(strings.Join(metrics, "\n"))
			authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
			err := sendTelemetryGrafanaCloud(metricsBody, authHeader, grafanaPromUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
			}

			authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)
			prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"platform\": \"%v\", \"generation\": \"%v\", \"type\": \"prompt\", \"job\": \"doku\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, currentTime, data["prompt"]))
			err = sendTelemetryGrafanaCloud(prompt_log, authHeader, grafanaLokiUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
			}
		} else {
			metrics := []string{
				fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,platform=%v,generation=%v promptTokens=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["promptTokens"]),
				fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,platform=%v,generation=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["requestDuration"]),
				fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,platform=%v,generation=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["usageCost"]),
			}
			var metricsBody = []byte(strings.Join(metrics, "\n"))
			authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
			err := sendTelemetryGrafanaCloud(metricsBody, authHeader, grafanaPromUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
			}

			authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)
			prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"platform\": \"%v\", \"generation\": \"%v\", \"type\": \"prompt\", \"job\": \"doku\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, currentTime, data["prompt"]))
			err = sendTelemetryGrafanaCloud(prompt_log, authHeader, grafanaLokiUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
			}
		}
	} else if data["endpoint"] == "openai.fine_tuning" {
		metrics := []string{
			fmt.Sprintf(`doku_llm,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,platform=%v,generation=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, data["requestDuration"]),
		}
		var metricsBody = []byte(strings.Join(metrics, "\n"))
		authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
		err := sendTelemetryGrafanaCloud(metricsBody, authHeader, grafanaPromUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
		}
	} else if data["endpoint"] == "openai.images.create" || data["endpoint"] == "openai.images.create.variations" {
		metrics := []string{
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,imageSize=%v,imageQuality=%v,platform=%v,generation=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["imageSize"], data["imageQuality"], platform, call_type, data["requestDuration"]),
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,imageSize=%v,imageQuality=%v,platform=%v,generation=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["imageSize"], data["imageQuality"], platform, call_type, data["usageCost"]),
		}
		var metricsBody = []byte(strings.Join(metrics, "\n"))
		authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
		err := sendTelemetryGrafanaCloud(metricsBody, authHeader, grafanaPromUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
		}

		authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)
		if data["endpoint"] != "openai.images.create.variations" {
			prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"platform\": \"%v\", \"generation\": \"%v\", \"type\": \"prompt\", \"job\": \"doku\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, currentTime, data["revisedPrompt"]))
			if data["model"] == "dall-e-2" {
				prompt_log = []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"platform\": \"%v\", \"generation\": \"%v\", \"type\": \"prompt\", \"job\": \"doku\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, currentTime, data["prompt"]))
			}
			err = sendTelemetryGrafanaCloud(prompt_log, authHeader, grafanaLokiUrl, "POST")
			if err != nil {
				log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
			}
		}
		image_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"platform\": \"%v\", \"generation\": \"%v\", \"type\": \"image\", \"job\": \"doku\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, currentTime, data["image"]))
		err = sendTelemetryGrafanaCloud(image_log, authHeader, grafanaLokiUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
		}
	} else if data["endpoint"] == "openai.audio.speech.create" {
		metrics := []string{
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,audioVoice=%v,platform=%v,generation=%v requestDuration=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["audioVoice"], platform, call_type, data["requestDuration"]),
			fmt.Sprintf(`doku_llm,job=doku,environment=%v,endpoint=%v,applicationName=%v,source=%v,model=%v,audioVoice=%v,platform=%v,generation=%v usageCost=%v`, data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], data["audioVoice"], platform, call_type, data["usageCost"]),
		}
		var metricsBody = []byte(strings.Join(metrics, "\n"))
		authHeader := fmt.Sprintf("Bearer %v:%v", grafanaPromUsername, grafanaAccessToken)
		err := sendTelemetryGrafanaCloud(metricsBody, authHeader, grafanaPromUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Prometheus")
		}

		authHeader = fmt.Sprintf("Bearer %v:%v", grafanaLokiUsername, grafanaAccessToken)
		prompt_log := []byte(fmt.Sprintf("{\"streams\": [{\"stream\": {\"environment\": \"%v\",\"endpoint\": \"%v\", \"applicationName\": \"%v\", \"source\": \"%v\", \"model\": \"%v\", \"platform\": \"%v\", \"generation\": \"%v\", \"type\": \"prompt\", \"job\": \"doku\" }, \"values\": [[\"%s\", \"%v\"]]}]}", data["environment"], data["endpoint"], data["applicationName"], data["sourceLanguage"], data["model"], platform, call_type, currentTime, data["prompt"]))
		err = sendTelemetryGrafanaCloud(prompt_log, authHeader, grafanaLokiUrl, "POST")
		if err != nil {
			log.Error().Err(err).Msgf("Error sending data to Grafana Cloud Loki")
		}
	}
}

func sendTelemetryGrafanaCloud(telemetryData []byte, authHeader string, url string, requestType string) error {
	req, err := http.NewRequest(requestType, url, bytes.NewBuffer(telemetryData))
	if err != nil {
		return fmt.Errorf("error creating request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request to %v", url)
	} else if resp.StatusCode == 404 {
		return fmt.Errorf("provided URL %v is not valid", url)
	} else if resp.StatusCode == 401 {
		return fmt.Errorf("provided credentials are not valid")
	}

	defer resp.Body.Close()

	log.Info().Msgf("Successfully exported data to %v", url)
	return nil
}
