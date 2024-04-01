package connections

import (
	"net/http"
	"regexp"
	"strings"
	"time"
)

type ConnectionConfig struct {
	Platform        string
	MetricsUrl      string
	LogsUrl         string
	ApiKey          string
	MetricsUsername string
	LogsUsername    string
}

var (
	Connections         string       // Connections contains the information on the platform in use.
	httpClient          *http.Client // httpClient is the HTTP client used to send data to the Observability Platform.
	endpointTypeMapping = map[string]string{
		"openai.chat.completions":         "Chat",
		"openai.completions":              "Chat",
		"azure.chat.completions":          "Chat",
		"azure.completions":               "Chat",
		"cohere.generate":                 "Chat",
		"cohere.chat":                     "Chat",
		"cohere.summarize":                "Chat",
		"anthropic.messages":              "Chat",
		"mistral.chat":                    "Chat",
		"openai.embeddings":               "Embeddings",
		"azure.embeddings":                "Embeddings",
		"cohere.embed":                    "Embeddings",
		"mistral.embeddings":              "Embeddings",
		"openai.images.create":            "Image",
		"azure.images.create":             "Image",
		"openai.images.create.variations": "Image",
		"openai.audio.speech.create":      "Audio",
		"openai.fine_tuning":              "FineTuning",
	}
)

func Init() {
	httpClient = &http.Client{Timeout: 5 * time.Second}
}

func normalizeString(s string) string {
	// Remove backslashes
	s = strings.ReplaceAll(s, `\`, "")

	// Replace double quotes with single quotes
	s = strings.ReplaceAll(s, `"`, "'")

	// Normalize spacing around hyphens: no space before, one space after hyphens
	s = strings.ReplaceAll(s, " - ", " -")
	s = strings.ReplaceAll(s, " -", " -")
	s = strings.ReplaceAll(s, "- ", " - ")

	// Collapse multiple spaces into a single space
	re := regexp.MustCompile(`\s+`)
	s = re.ReplaceAllString(s, " ")

	// Trim leading and trailing whitespace
	s = strings.TrimSpace(s)

	return s
}

// SendToPlatform sends observability data to the appropriate platform.
func SendToPlatform(data map[string]interface{}, config ConnectionConfig) {
	if config.Platform == "grafana" {
		configureGrafanaCloudData(data, config)
	} else if config.Platform == "newrelic" {
		configureNewRelicData(data, config)
	} else if config.Platform == "datadog" {
		configureDataDogData(data, config)
	} else if config.Platform == "signoz" {
		configureSignozData(data, config)
	} else if config.Platform == "dynatrace" {
		configureDynatraceData(data, config)
	}
}
