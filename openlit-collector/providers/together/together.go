package http

// Together AI payload extractor for OBI.
// Together uses OpenAI-compatible API format.
//
// Endpoints:
//   POST https://api.together.xyz/v1/chat/completions
//   POST https://api.together.xyz/v1/embeddings
//
// Uses the same request/response format as OpenAI.

const TogetherHost = "api.together.xyz"

const TogetherIsOpenAICompatible = true
