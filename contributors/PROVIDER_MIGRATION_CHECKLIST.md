# Provider Events Migration Checklist

**Provider Name:** `_________________`
**Date Started:** `_________________`
**Assignee:** `_________________`
**Status:** `[ ] Not Started` `[ ] In Progress` `[ ] Testing` `[ ] Complete`

---

## Phase 1: Planning & Analysis

### Provider Research
- [ ] Reviewed provider API documentation
- [ ] Identified all supported operations:
  - [ ] Chat/Completions
  - [ ] Embeddings
  - [ ] Image Generation
  - [ ] Audio/Speech
  - [ ] Other: `________________`
- [ ] Documented message format differences
- [ ] Created parameter mapping table
- [ ] Created finish reason mapping table

### Current State Analysis
- [ ] Found all existing `span.add_event()` calls
  - Location 1: `_______________________` Line: `____`
  - Location 2: `_______________________` Line: `____`
  - Location 3: `_______________________` Line: `____`
- [ ] Documented current span attributes
- [ ] Ran existing test suite (baseline)
  - Tests passed: `____` Failed: `____`

---

## Phase 2: Semantic Conventions

### File: `src/openlit/semcov/__init__.py`

- [ ] Added `GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS`
- [ ] Added `GEN_AI_INPUT_MESSAGES`
- [ ] Added `GEN_AI_OUTPUT_MESSAGES`
- [ ] Added `GEN_AI_SYSTEM_INSTRUCTIONS` (if applicable)
- [ ] Added `GEN_AI_TOOL_DEFINITIONS` (if applicable)
- [ ] Added provider-specific constants (if needed)
  - [ ] `_______________________`

---

## Phase 3: Helper Functions

### File: `src/openlit/instrumentation/<provider>/utils.py`

#### build_input_messages()
- [ ] Created function signature
- [ ] Handles text messages
- [ ] Handles multi-part messages
- [ ] Handles images (URI only, no data URIs)
- [ ] Handles tool call responses
- [ ] Handles provider-specific message types:
  - [ ] `_______________________`
- [ ] Returns structured objects (not JSON strings)
- [ ] Added error handling
- [ ] Added unit tests

#### build_output_messages()
- [ ] Created function signature
- [ ] Handles text responses
- [ ] Handles tool calls
- [ ] Maps finish reasons correctly
- [ ] Returns structured objects (not JSON strings)
- [ ] Added error handling
- [ ] Added unit tests

#### build_tool_definitions()
- [ ] Created function signature
- [ ] Extracts tool definitions from request
- [ ] Normalizes to OTel format
- [ ] Handles provider-specific format:
  - [ ] `_______________________`
- [ ] Returns None if no tools
- [ ] Added error handling
- [ ] Added unit tests

#### emit_inference_event()
- [ ] Created centralized emission function
- [ ] Maps all required attributes
- [ ] Maps all recommended attributes
- [ ] Maps optional attributes
- [ ] Uses `otel_event()` helper
- [ ] Includes comprehensive error handling
- [ ] Never raises exceptions
- [ ] Logs warnings on failure
- [ ] Added unit tests

---

## Phase 4: Processing Functions

### Update common logic functions

#### Chat/Completions Processing
- [ ] Added `event_provider` parameter
- [ ] **KEPT** existing span attributes
- [ ] **REMOVED** `span.add_event()` calls
- [ ] Added event emission with `capture_message_content` check
- [ ] Builds input messages
- [ ] Builds output messages
- [ ] Builds tool definitions
- [ ] Passes all attributes to `emit_inference_event()`
- [ ] Added error handling

#### Embeddings Processing (if applicable)
- [ ] Added `event_provider` parameter
- [ ] Added event emission logic
- [ ] Handles single text input
- [ ] Handles array of texts
- [ ] Added error handling

#### Image Generation Processing (if applicable)
- [ ] Added `event_provider` parameter
- [ ] Added event emission logic
- [ ] Handles text prompts
- [ ] Handles revised prompts (output)
- [ ] Added error handling

#### Audio/Speech Processing (if applicable)
- [ ] Added `event_provider` parameter
- [ ] Added event emission logic
- [ ] Handles text input
- [ ] Handles audio output references
- [ ] Added error handling

---

## Phase 5: Wrapper Functions (Sync)

### File: `src/openlit/instrumentation/<provider>/<provider>.py`

#### chat_completions()
- [ ] Added `event_provider` parameter to wrapper factory
- [ ] Updated `TracedSyncStream.__init__()` to accept event_provider
- [ ] Stored event_provider in TracedSyncStream instance
- [ ] Passed event_provider in StopIteration handler
- [ ] Passed event_provider in non-streaming branch
- [ ] Tested streaming responses
- [ ] Tested non-streaming responses

#### embeddings()
- [ ] Added `event_provider` parameter
- [ ] Passed to processing function
- [ ] Tested with single text
- [ ] Tested with text array

#### image_generation()
- [ ] Added `event_provider` parameter
- [ ] Passed to processing function
- [ ] Tested single image
- [ ] Tested multiple images

#### audio_create()
- [ ] Added `event_provider` parameter
- [ ] Passed to processing function
- [ ] Tested text-to-speech

#### Other operations:
- [ ] `_________________`: Added event_provider
- [ ] `_________________`: Added event_provider

---

## Phase 6: Wrapper Functions (Async)

### File: `src/openlit/instrumentation/<provider>/async_<provider>.py`

#### async_chat_completions()
- [ ] Added `event_provider` parameter to wrapper factory
- [ ] Updated `TracedAsyncStream.__init__()` to accept event_provider
- [ ] Stored event_provider in TracedAsyncStream instance
- [ ] Passed event_provider in StopAsyncIteration handler
- [ ] Passed event_provider in non-streaming branch
- [ ] Tested async streaming responses
- [ ] Tested async non-streaming responses

#### async_embeddings()
- [ ] Added `event_provider` parameter
- [ ] Passed to processing function
- [ ] Tested async embeddings

#### async_image_generation()
- [ ] Added `event_provider` parameter
- [ ] Passed to processing function
- [ ] Tested async image generation

#### async_audio_create()
- [ ] Added `event_provider` parameter
- [ ] Passed to processing function
- [ ] Tested async audio

#### Other async operations:
- [ ] `_________________`: Added event_provider
- [ ] `_________________`: Added event_provider

---

## Phase 7: Instrumentation Entry Point

### File: `src/openlit/instrumentation/<provider>/__init__.py`

- [ ] Extracted `event_provider = kwargs.get("event_provider")`
- [ ] Passed to all sync wrapper calls:
  - [ ] chat_completions
  - [ ] embeddings
  - [ ] image_generation
  - [ ] audio_create
  - [ ] Other: `_________________`
- [ ] Passed to all async wrapper calls:
  - [ ] async_chat_completions
  - [ ] async_embeddings
  - [ ] async_image_generation
  - [ ] async_audio_create
  - [ ] Other: `_________________`

---

## Phase 8: Cleanup

- [ ] Verified all `span.add_event()` calls removed
  - Remaining: `____` (should be 0)
- [ ] Verified all span attributes still present
- [ ] Removed any unused imports
- [ ] Ran linter/formatter
- [ ] Updated code comments

---

## Phase 9: Testing

### Unit Tests
- [ ] Added tests for `build_input_messages()`
  - [ ] Text messages
  - [ ] Multi-part messages
  - [ ] Images (URIs)
  - [ ] Tool responses
  - [ ] Edge cases
- [ ] Added tests for `build_output_messages()`
  - [ ] Text responses
  - [ ] Tool calls
  - [ ] Finish reasons
  - [ ] Edge cases
- [ ] Added tests for `build_tool_definitions()`
  - [ ] Function definitions
  - [ ] None/empty tools
- [ ] Added tests for `emit_inference_event()`
  - [ ] All attributes present
  - [ ] Error handling

### Integration Tests

#### Chat/Completions
- [ ] Non-streaming text only
- [ ] Non-streaming with images (if supported)
- [ ] Non-streaming with tools
- [ ] Non-streaming with tool responses
- [ ] Streaming text
- [ ] Streaming with tools
- [ ] Multi-message conversation
- [ ] System messages

#### Embeddings (if applicable)
- [ ] Single text
- [ ] Multiple texts
- [ ] Token array input

#### Image Generation (if applicable)
- [ ] Single image
- [ ] Multiple images
- [ ] With revised prompts

#### Audio (if applicable)
- [ ] Text-to-speech
- [ ] Different voices/models

### Event Validation
- [ ] Event name is `gen_ai.client.inference.operation.details`
- [ ] Input messages are structured (not JSON strings)
- [ ] Output messages are structured (not JSON strings)
- [ ] Messages follow OTel JSON schema format
- [ ] Tool definitions included when present
- [ ] All required attributes present:
  - [ ] `gen_ai.operation`
  - [ ] `gen_ai.request.model`
  - [ ] `gen_ai.response.model`
- [ ] All recommended attributes present (when available):
  - [ ] `gen_ai.system_instructions`
  - [ ] `gen_ai.tool.definitions`
  - [ ] `gen_ai.response.id`
  - [ ] `gen_ai.response.finish_reasons`
  - [ ] `server.address`
  - [ ] `server.port`
- [ ] Optional attributes included (when available):
  - [ ] Request parameters (temperature, max_tokens, etc.)
  - [ ] Response metadata (choice_count, output_type)
  - [ ] Usage tokens (input_tokens, output_tokens)

### Backward Compatibility
- [ ] Existing span attributes still set:
  - [ ] `gen_ai.prompt`
  - [ ] `gen_ai.completion`
  - [ ] All provider-specific attributes
- [ ] Metrics still recorded correctly
- [ ] No span events present (all removed)
- [ ] `capture_message_content=False` skips events
- [ ] `event_provider=None` skips events
- [ ] Existing functionality unchanged

### Error Handling
- [ ] Event emission failure doesn't break instrumentation
- [ ] Malformed messages handled gracefully
- [ ] Missing fields don't cause crashes
- [ ] Non-serializable objects handled
- [ ] Exceptions logged but not raised

### Performance Testing
- [ ] No significant latency increase
  - Baseline: `____ms` New: `____ms`
- [ ] No memory leaks with streaming
- [ ] Event size reasonable (<100KB per event)
- [ ] No base64 images in events

### Manual Verification
- [ ] Events visible in console exporter
- [ ] Events visible in OTLP collector
- [ ] Message structure validated against JSON schema
- [ ] Tested with real provider API
- [ ] Tested with rate limits/errors

---

## Phase 10: Documentation

- [ ] Updated provider README with event support
- [ ] Added example code showing event usage
- [ ] Documented provider-specific message format differences
- [ ] Documented finish reason mappings
- [ ] Added troubleshooting section
- [ ] Updated CHANGELOG.md
- [ ] Added migration notes (if breaking changes)

---

## Phase 11: Code Review

- [ ] Self-review completed
- [ ] Peer review requested
- [ ] All review comments addressed
- [ ] CI/CD pipeline passing
- [ ] Test coverage maintained/improved
  - Previous: `____%` New: `____%`

---

## Phase 12: Deployment

- [ ] Merged to main branch
- [ ] Version bumped (if applicable)
- [ ] Release notes prepared
- [ ] Released to production
- [ ] Monitoring dashboards updated
- [ ] Announced to team/users

---

## Notes & Issues

### Provider-Specific Quirks
```
Document any unusual behavior, workarounds, or special handling required:

1.

2.

3.
```

### Open Questions
```
List any unresolved questions or items needing clarification:

1.

2.

3.
```

### Known Issues
```
Document any known issues or limitations:

1.

2.

3.
```

---

## Sign-Off

- [ ] Developer: `_________________` Date: `_________`
- [ ] Reviewer: `_________________` Date: `_________`
- [ ] QA: `_________________` Date: `_________`

---

**Reference Documentation:**
- [Events Migration Guide](./EVENTS_MIGRATION_GUIDE.md)
- [OTel Gen-AI Events Spec](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-events.md)
- [OpenAI Reference Implementation](./src/openlit/instrumentation/openai/)
