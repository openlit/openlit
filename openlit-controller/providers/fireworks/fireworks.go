package http

// Fireworks AI payload extractor for OBI.
// Fireworks uses OpenAI-compatible API format.
//
// Endpoints:
//   POST https://api.fireworks.ai/inference/v1/chat/completions
//   POST https://api.fireworks.ai/inference/v1/embeddings
//
// Uses the same request/response format as OpenAI.

const FireworksHost = "api.fireworks.ai"

const FireworksIsOpenAICompatible = true
