package scanner

// LLMConnectEvent is emitted when a process connects to a known LLM API endpoint.
type LLMConnectEvent struct {
	PID      uint32
	Provider string
}

var providerNames = map[uint8]string{
	1:  "openai",
	2:  "anthropic",
	3:  "gemini",
	4:  "cohere",
	5:  "mistral",
	6:  "groq",
	7:  "deepseek",
	8:  "together",
	9:  "fireworks",
	10: "vercel_ai",
	11: "vertex_ai",
	12: "azure_inference",
	// IDs 20-26 are Bedrock regions (assigned dynamically in hosts.go init)
	20: "bedrock",
	21: "bedrock",
	22: "bedrock",
	23: "bedrock",
	24: "bedrock",
	25: "bedrock",
	26: "bedrock",
}
