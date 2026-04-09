package http

// Mistral API payload extractor for OBI.
// Mistral uses OpenAI-compatible API format.
//
// Endpoints:
//   POST https://api.mistral.ai/v1/chat/completions
//   POST https://api.mistral.ai/v1/embeddings
//
// Uses the same request/response format as OpenAI.
// This file provides hostname detection; the actual parsing
// reuses the OpenAI extractor logic.

const MistralHost = "api.mistral.ai"

// MistralIsOpenAICompatible indicates this provider uses
// the OpenAI request/response format and can reuse the
// OpenAI payload extractor with hostname-based routing.
const MistralIsOpenAICompatible = true
