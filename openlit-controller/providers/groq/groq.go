package http

// Groq API payload extractor for OBI.
// Groq uses OpenAI-compatible API format.
//
// Endpoints:
//   POST https://api.groq.com/openai/v1/chat/completions
//   POST https://api.groq.com/openai/v1/embeddings
//
// Uses the same request/response format as OpenAI.

const GroqHost = "api.groq.com"

const GroqIsOpenAICompatible = true
