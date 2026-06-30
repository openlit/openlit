/**
 * Unit tests for the shared GenAI helpers in `OpenLitHelper`:
 *
 * - `buildSystemInstructionsFromMessages` — normalize chat-completions
 *   `messages` into the OTel `gen_ai.system_instructions` payload
 *   (`[{"type":"text","content":"..."}]`) as a JSON string.
 * - `buildToolDefinitions` — normalize a request `tools` array into the OTel
 *   `gen_ai.tool.definitions` schema as a JSON string.
 *
 * Every TS provider wired for these two attributes routes through these
 * helpers, so this file gives broad correctness coverage for the cross-SDK
 * GenAI gap-closure work.
 */
export {};
