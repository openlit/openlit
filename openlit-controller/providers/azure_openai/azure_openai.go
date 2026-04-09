package http

// Azure OpenAI payload extractor for OBI.
// Azure OpenAI uses the OpenAI request/response format but with different URL patterns.
//
// Endpoints:
//   POST https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=...
//   POST https://{resource}.openai.azure.com/openai/deployments/{deployment}/embeddings?api-version=...
//
// Host pattern: *.openai.azure.com
// Uses the same request/response format as OpenAI.

import "strings"

const AzureOpenAIHostSuffix = ".openai.azure.com"

func IsAzureOpenAIHost(host string) bool {
	return strings.HasSuffix(host, AzureOpenAIHostSuffix)
}

const AzureOpenAIIsOpenAICompatible = true
