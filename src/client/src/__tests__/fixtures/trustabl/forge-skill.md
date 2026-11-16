---
name: trustabl-pre-coding
description: >-
  Pre-coding reliability constraints for: claude_sdk, mcp
allowed-tools: Read
disable-model-invocation: false
---

# Trustabl Pre-Coding Reliability Constraints

<!-- generated: 2026-11-10 | rules: 9eca09df82f84b232638a08a68eb20d6cda4f864 | schema: 41 | sdks: claude_sdk, mcp -->

Before writing any agent code, apply every constraint below. Rules are
ordered by severity. A violation here will fire the corresponding finding
in post-build scan — prevent it now.

---

## Claude Agent SDK subagent wiring safety

### Tool Rules

---

#### [CSDK-003] Network call has no timeout
**Severity:** high | **Confidence:** 0.85

**Directive:** Pass `timeout=` (typically 5–30s) to the request.

**Why:** An agent tool that makes a network request without a timeout can hang indefinitely, blocking the conversation loop and exhausting the agent's wall-clock budget.

**When this applies:** When defining a tool.

---

#### [CSDK-004] Path parameter used in I/O without validation
**Severity:** high | **Confidence:** 0.70

**Directive:** Resolve the path with `Path(...).resolve()` and assert it sits under an allowed root.

**Why:** The tool accepts a path-like parameter and passes it to file or directory operations without resolving or sandboxing the path.

**When this applies:** When defining a tool.

---

#### [CSDK-009] Tool fetches a caller-controlled URL (SSRF)
**Severity:** high | **Confidence:** 0.60

**Directive:** Don't fetch arbitrary URLs.

**Why:** This tool issues an HTTP request to a URL built from a parameter or an interpolated string rather than a fixed literal.

**When this applies:** When defining a tool.

---

#### [CSDK-010] TypeScript Claude SDK tool shells out to the OS
**Severity:** high | **Confidence:** 0.70

**Directive:** Avoid shelling out from agent-callable tools.

**Why:** This Claude Agent SDK tool, authored in TypeScript, invokes a child-process API.

**When this applies:** When defining a tool.

---

#### [CSDK-011] TypeScript Claude SDK tool evaluates dynamic code
**Severity:** high | **Confidence:** 0.90

**Directive:** Remove `eval`/`new Function`.

**Why:** This TypeScript Claude SDK tool calls `eval()` or constructs a `new Function(...)`.

**When this applies:** When defining a tool.

---

#### [CSDK-013] TypeScript Claude SDK tool fetches a caller-controlled URL (SSRF)
**Severity:** high | **Confidence:** 0.60

**Directive:** Validate the destination before fetching: resolve the host and reject private, loopback, and link-local ranges; prefer an allowlist of exact hosts.

**Why:** This TypeScript Claude SDK tool issues an HTTP request to a URL built from a tool argument or an interpolated string rather than a fixed literal.

**When this applies:** When defining a tool.

---

#### [CSDK-020] TypeScript Claude SDK tool HTTP call has no timeout
**Severity:** high | **Confidence:** 0.60

**Directive:** Attach a deadline.

**Why:** This TypeScript Claude SDK tool makes an outbound HTTP call (fetch / axios / got / undici) with no deadline — no signal, timeout, or abortSignal option.

**When this applies:** When defining a tool.

---

#### [CSDK-023] TypeScript side-effecting tool lets the model choose the recipient or amount with no visible bound
**Severity:** high | **Confidence:** 0.50

**Directive:** Do not let the model supply the recipient or the amount unconstrained.

**Why:** This Claude Agent SDK tool, created with tool(name, description, schema, handler), has a name that signals a send/notify or a refund/charge/pay side effect, and its schema takes a free-form recipient or amount parameter with no visible bound: no allow-list constraining who the message reaches, and no cap, max, or enum constraining how much money moves.

**When this applies:** When defining a tool.

---

#### [CSDK-107] Tool body calls eval/exec/compile on dynamic input
**Severity:** high | **Confidence:** 0.85

**Directive:** Remove eval/exec/compile from the tool.

**Why:** The tool body invokes Python's eval, exec, or compile.

**When this applies:** When defining a tool.

---

#### [CSDK-108] Tool body spawns a subprocess
**Severity:** high | **Confidence:** 0.70

**Directive:** Prefer a typed library API over shelling out (e.g.

**Why:** The tool body spawns an OS process (subprocess.*, os.system, os.popen, or os.spawn*).

**When this applies:** When defining a tool.

---

#### [CSDK-002] Tool parameters are not type-annotated
**Severity:** medium | **Confidence:** 0.90

**Directive:** Annotate every parameter with a type.

**Why:** Without parameter type annotations, the SDK cannot generate an input schema to validate model output.

**When this applies:** When defining a tool.

---

#### [CSDK-006] Mutating tool has no idempotency key
**Severity:** medium | **Confidence:** 0.55

**Directive:** Add an `idempotency_key: str` parameter; verify the receiving API respects it.

**Why:** Tool name suggests a side effect (create/send/refund/…).

**When this applies:** When defining a tool.

---

#### [CSDK-008] Tool exposes **kwargs without explicit input_schema
**Severity:** medium | **Confidence:** 0.80

**Directive:** Either declare each accepted parameter on the function signature with a type annotation so the SDK can derive the schema, or pass an explicit `input_schema=` to the `@tool` decorator — either a JSON Schema dict or a Pydantic `BaseModel` subclass — so the contract published to the model matches what the body actually reads from `kwargs`.

**Why:** The Claude Agent SDK derives a tool's JSON input schema from the function signature.

**When this applies:** When defining a tool.

---

#### [CSDK-016] TypeScript Claude SDK mutating tool has no idempotency key
**Severity:** medium | **Confidence:** 0.50

**Directive:** Add an `idempotencyKey` (or `requestId`) field to the tool's Zod schema, thread it to the downstream API, and confirm that API treats a repeated key as a no-op rather than a second mutation.

**Why:** This TypeScript tool's name implies a side effect (create/send/refund/…) but its Zod schema exposes no idempotency parameter.

**When this applies:** When defining a tool.

---

#### [CSDK-001] Tool has no description
**Severity:** low | **Confidence:** 0.95

**Directive:** Add a one-paragraph docstring describing inputs, outputs, and when to use this tool.

**Why:** The Claude Agent SDK uses the tool's docstring as the description shown to the model.

**When this applies:** When defining a tool.

---

#### [CSDK-005] Tool raises exceptions without a structured error contract
**Severity:** low | **Confidence:** 0.60

**Directive:** Catch known failure modes and return a `{"error": ..., "retryable": bool}` payload.

**Why:** When a tool raises, the SDK surfaces the exception to the model as an opaque string.

**When this applies:** When defining a tool.

---

#### [CSDK-007] Ambiguous tool name
**Severity:** low | **Confidence:** 0.90

**Directive:** Rename to a verb-object form, e.g.

**Why:** Tool names like `process`, `handle`, or `run` give the model no signal about intent.

**When this applies:** When defining a tool.

---

#### [CSDK-012] TypeScript Claude SDK tool writes to the filesystem
**Severity:** low | **Confidence:** 0.50

**Directive:** Confine writes to a dedicated working directory, resolve the final path and verify it stays within that root before writing, and reject absolute or `..`-containing inputs.

**Why:** This TypeScript Claude SDK tool writes to the filesystem.

**When this applies:** When defining a tool.

---

#### [CSDK-014] TypeScript Claude SDK tool has no description
**Severity:** low | **Confidence:** 0.90

**Directive:** Pass a clear one-line description as the second argument to `tool(name, description, schema, handler)`, stating what the tool does, what it returns, and when the model should reach for it.

**Why:** The Claude Agent SDK passes a TypeScript tool's description — the second argument to `tool(name, description, schema, handler)` — to the model as the sole signal for when to invoke it.

**When this applies:** When defining a tool.

---

#### [CSDK-017] Tool description is a placeholder
**Severity:** low | **Confidence:** 0.85

**Directive:** Replace the placeholder with a real one-paragraph description covering what the tool does, what it returns, and when the model should call it.

**Why:** The description passes the has-docstring check but carries a placeholder marker instead of real content.

**When this applies:** When defining a tool.

---

#### [CSDK-018] Tool description is too short to guide model selection
**Severity:** low | **Confidence:** 0.80

**Directive:** Expand the description to at least a full sentence covering inputs, outputs, and the situation in which this tool should be used over alternatives.

**Why:** A description under 40 characters is rarely enough to convey what a tool does, what it returns, and when to call it versus a similarly named neighbor.

**When this applies:** When defining a tool.

---

#### [CSDK-019] Tool prints to stdout for diagnostics
**Severity:** low | **Confidence:** 0.65

**Directive:** Remove the print().

**Why:** The tool body calls print(), which writes diagnostics to the process's stdout.

**When this applies:** When defining a tool.

---

#### [CSDK-021] TypeScript Claude SDK tool description is a placeholder
**Severity:** low | **Confidence:** 0.85

**Directive:** Replace the placeholder with a real description covering what the tool does, what it returns, and when the model should call it rather than a neighboring tool.

**Why:** The tool sets a description, so it passes CSDK-014, but the string is a placeholder rather than real content.

**When this applies:** When defining a tool.

---

#### [CSDK-022] TypeScript Claude SDK tool description is too short to guide model selection
**Severity:** low | **Confidence:** 0.80

**Directive:** Expand the description to at least a full sentence covering inputs, outputs, and the situation in which this tool should be used over the alternatives.

**Why:** A description under 40 characters is rarely enough to convey what a tool does, what it returns, and when to call it rather than a similarly named neighbor.

**When this applies:** When defining a tool.

### Agent Rules

---

#### [CSDK-101] Claude subagent is granted the Bash tool
**Severity:** high | **Confidence:** 0.80

**Directive:** Remove "Bash" from this subagent's tools list unless shell execution is essential to its job.

**Why:** This AgentDefinition grants the built-in Bash tool, giving the subagent arbitrary shell-command execution.

**When this applies:** When declaring an agent.

---

#### [CSDK-103] AgentDefinition sets permissionMode to bypassPermissions with a broad tool set
**Severity:** high | **Confidence:** 0.90

**Directive:** Remove permissionMode="bypassPermissions" unless this subagent runs in a fully sandboxed, non-interactive context you control (e.g.

**Why:** This AgentDefinition sets permissionMode="bypassPermissions", which disables the SDK's interactive approval gate for every tool the subagent runs, and either omits tools entirely (which inherits every tool available to subagents) or lists a side-effecting or exfiltration- capable one.

**When this applies:** When declaring an agent.

---

#### [CSDK-104] Claude subagent is granted filesystem-write built-ins
**Severity:** high | **Confidence:** 0.80

**Directive:** Remove the write built-ins from this subagent's tools list unless file mutation is essential to its job.

**Why:** This AgentDefinition grants a filesystem-write built-in (Write, Edit, MultiEdit, or NotebookEdit), letting the subagent modify files on disk.

**When this applies:** When declaring an agent.

---

#### [CSDK-105] Claude subagent is granted the WebFetch tool
**Severity:** high | **Confidence:** 0.75

**Directive:** Remove "WebFetch" from this subagent's tools list unless fetching is essential.

**Why:** This AgentDefinition grants the built-in WebFetch tool, which retrieves a model-chosen URL and feeds its content back into the agent loop.

**When this applies:** When declaring an agent.

---

#### [CSDK-120] TypeScript AgentDefinition sets permissionMode to bypassPermissions with a broad tool set
**Severity:** high | **Confidence:** 0.90

**Directive:** Remove permissionMode: "bypassPermissions" unless this agent runs in a fully sandboxed, non-interactive context you control (e.g.

**Why:** This TypeScript AgentDefinition sets permissionMode: "bypassPermissions", which disables the SDK's interactive approval gate for every tool the agent runs, and either omits tools entirely (which inherits every tool available to subagents) or lists a side-effecting or exfiltration- capable one.

**When this applies:** When declaring an agent.

---

#### [CSDK-121] TypeScript AgentDefinition is granted the Bash tool
**Severity:** high | **Confidence:** 0.80

**Directive:** Remove "Bash" from this agent definition's tools array unless shell execution is essential to its job.

**Why:** This TypeScript AgentDefinition (a typed const or an inline entry in options.agents) lists "Bash" in its tools array, giving the subagent arbitrary shell-command execution.

**When this applies:** When declaring an agent.

---

#### [CSDK-123] TypeScript AgentDefinition is granted filesystem-write built-ins
**Severity:** high | **Confidence:** 0.80

**Directive:** Remove the write built-ins from this agent definition's tools array unless file mutation is essential to its job.

**Why:** This TypeScript AgentDefinition lists a filesystem-write built-in (Write, Edit, MultiEdit, or NotebookEdit) in its tools array, letting the subagent modify files on disk.

**When this applies:** When declaring an agent.

---

#### [CSDK-124] TypeScript AgentDefinition is granted the WebFetch tool
**Severity:** high | **Confidence:** 0.75

**Directive:** Remove "WebFetch" from this agent definition's tools array unless fetching is essential.

**Why:** This TypeScript AgentDefinition lists "WebFetch" in its tools array.

**When this applies:** When declaring an agent.

---

#### [CSDK-130] TypeScript query() main agent is granted the Bash tool
**Severity:** high | **Confidence:** 0.80

**Directive:** Remove "Bash" from `options.allowedTools` unless shell execution is essential to the agent's task.

**Why:** This `query(...)` call configures the main agent thread with "Bash" in its `options.allowedTools`, granting the top-level agent arbitrary shell-command execution.

**When this applies:** When declaring an agent.

---

#### [CSDK-131] TypeScript query() main agent is granted filesystem-write or web-fetch built-ins
**Severity:** high | **Confidence:** 0.75

**Directive:** Drop the write and fetch built-ins from `options.allowedTools` unless the task requires them.

**Why:** This `query(...)` main agent's `options.allowedTools` includes a filesystem-write built-in (Write/Edit/MultiEdit/NotebookEdit) or WebFetch.

**When this applies:** When declaring an agent.

---

#### [CSDK-102] Claude subagent is granted the WebSearch tool
**Severity:** medium | **Confidence:** 0.80

**Directive:** Remove "WebSearch" from this subagent's tools list unless internet access is essential to its job.

**Why:** This AgentDefinition grants the built-in WebSearch tool, giving the subagent access to live internet content.

**When this applies:** When declaring an agent.

---

#### [CSDK-122] TypeScript AgentDefinition is granted the WebSearch tool
**Severity:** medium | **Confidence:** 0.80

**Directive:** Remove "WebSearch" from this agent definition's tools array unless internet access is essential to its job.

**Why:** This TypeScript AgentDefinition lists "WebSearch" in its tools array, giving the subagent access to live internet content.

**When this applies:** When declaring an agent.

---

#### [CSDK-114] TypeScript query() main agent sets no maxBudgetUsd spend cap
**Severity:** low | **Confidence:** 0.60

**Directive:** Set `maxBudgetUsd` in the `query()` options to a ceiling sized to the task (a few dollars for an interactive agent, less for a batch worker), and pair it with `maxTurns`.

**Why:** This `query(...)` call configures the main agent thread with inline `options` but sets no `options.maxBudgetUsd`.

**When this applies:** When declaring an agent.

### Subagent Rules

---

#### [CSDK-110] Subagent granted the built-in Bash tool
**Severity:** high | **Confidence:** 0.90

**Directive:** Remove `Bash` from the subagent's `tools:` list unless shell access is essential.

**Why:** This subagent's frontmatter grants the built-in `Bash` tool, letting it run arbitrary shell commands.

**When this applies:** When declaring a subagent.

---

#### [CSDK-111] Subagent granted filesystem-write or web-fetch built-ins
**Severity:** high | **Confidence:** 0.85

**Directive:** Remove the write and fetch built-ins from the subagent's `tools:` list unless the role genuinely requires them.

**Why:** This subagent's frontmatter grants a filesystem-write (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) or web-fetch (`WebFetch`) built-in.

**When this applies:** When declaring a subagent.

---

#### [CSDK-112] Subagent granted the WebSearch tool
**Severity:** medium | **Confidence:** 0.80

**Directive:** Remove `WebSearch` from the subagent's `tools:` list unless the role is genuinely research-oriented.

**Why:** This subagent's frontmatter grants the built-in `WebSearch` tool, so search-result content chosen by the model flows back into the subagent's context.

**When this applies:** When declaring a subagent.

### Repo Rules

---

#### [CSDK-201] Project default permission mode bypasses approvals
**Severity:** high | **Confidence:** 0.90

**Directive:** Remove the "defaultMode": "bypassPermissions" entry from .claude/settings.json (and settings.local.json), or change it to "default" so tool calls prompt, or "acceptEdits" if you only want to auto-approve file edits while still gating shell and network actions.

**Why:** The project's .claude/settings.json sets defaultMode to "bypassPermissions", which disables Claude Code's permission prompts for the whole repo.

**When this applies:** For any repo using this SDK.

---

#### [CSDK-205] Claude Agent SDK session auto-approves edits with no tool deny-list
**Severity:** medium | **Confidence:** 0.70

**Directive:** Pass disallowed_tools= to ClaudeAgentOptions(...), naming the tools this session must never call — at minimum shell execution and any tool that reaches the network or credentials.

**Why:** A ClaudeAgentOptions(...) in this project sets permission_mode to "acceptEdits", which auto-approves file writes and edits without a prompt, and no construction in the project sets disallowed_tools.

**When this applies:** For any repo using this SDK.

---

#### [CSDK-203] Repo ships Claude Agent SDK code without an agent-guidance doc (AGENTS.md/CLAUDE.md)
**Severity:** low | **Confidence:** 0.90

**Directive:** Add a CLAUDE.md (or an AGENTS.md) at the repository root documenting how to build, test, and lint the project, the coding conventions the agent must respect, the directories or files it must not modify, and any project-specific safety guardrails (e.g.

**Why:** A repository that builds on the Claude Agent SDK but ships no agent-guidance doc — CLAUDE.md (the Claude Code convention) or AGENTS.md (the cross-vendor one) — leaves any coding agent that opens the repo with no project-specific guidance.

**When this applies:** For any repo using this SDK.

---

#### [CSDK-204] Claude Agent SDK session sets no explicit max_turns limit
**Severity:** low | **Confidence:** 0.60

**Directive:** Pass max_turns= to ClaudeAgentOptions(...), sized to the work the session actually does — a handful of turns for a single-file edit, more for a multi-step investigation.

**Why:** No ClaudeAgentOptions(...) in this project sets max_turns, so the agent loop runs to whatever ceiling the runtime applies by default rather than to a bound sized for this task.

**When this applies:** For any repo using this SDK.

---

## MCP dynamic code execution

### Tool Rules

---

#### [MCP-004] Network call has no timeout
**Severity:** high | **Confidence:** 0.85

**Directive:** Pass timeout= (typically 5-30 seconds depending on the endpoint) to every outbound call.

**Why:** An MCP tool handler that makes a network request without a timeout can hang indefinitely on a slow or unresponsive host.

**When this applies:** When defining a tool.

---

#### [MCP-005] Path parameter used in I/O without validation
**Severity:** high | **Confidence:** 0.70

**Directive:** Resolve the path with `Path(...).resolve()` and assert it sits under an allowed root before any I/O touches it.

**Why:** The tool accepts a path-like parameter and passes it to file or directory operations without resolving or sandboxing the path.

**When this applies:** When defining a tool.

---

#### [MCP-008] Tool fetches a caller-controlled URL (SSRF)
**Severity:** high | **Confidence:** 0.60

**Directive:** Constrain the destination to an explicit allow-list of hosts (or a single fixed base URL with only a path parameter), reject requests to private, loopback, and link-local IP ranges after DNS resolution, and disable redirects to addresses outside the allow-list.

**Why:** This MCP tool issues an HTTP request to a URL built from a parameter or an interpolated string rather than a fixed literal.

**When this applies:** When defining a tool.

---

#### [MCP-009] Tool body calls eval/exec/compile on dynamic input
**Severity:** high | **Confidence:** 0.85

**Directive:** Remove eval/exec/compile from the handler.

**Why:** The tool handler invokes Python's eval, exec, or compile.

**When this applies:** When defining a tool.

---

#### [MCP-010] Tool body spawns a subprocess
**Severity:** high | **Confidence:** 0.70

**Directive:** Prefer a typed library API over shelling out.

**Why:** The tool handler spawns an OS process (subprocess.*, os.system, os.popen, or os.spawn*).

**When this applies:** When defining a tool.

---

#### [MCP-012] TypeScript MCP tool spawns a subprocess
**Severity:** high | **Confidence:** 0.70

**Directive:** Avoid shelling out from MCP tools.

**Why:** This MCP tool handler, authored in TypeScript, invokes a child-process API (child_process exec/execSync/spawn).

**When this applies:** When defining a tool.

---

#### [MCP-013] TypeScript MCP tool fetches a caller-controlled URL (SSRF)
**Severity:** high | **Confidence:** 0.60

**Directive:** Validate the destination before fetching: resolve the host and reject private, loopback, and link-local ranges; prefer an allowlist of exact hosts, or resolve an opaque ID against a server-side registry and build the URL from the trusted entry.

**Why:** This MCP tool handler, authored in TypeScript, issues an HTTP request to a URL built from a tool argument or an interpolated string rather than a fixed literal.

**When this applies:** When defining a tool.

---

#### [MCP-014] TypeScript MCP tool evaluates dynamic code
**Severity:** high | **Confidence:** 0.90

**Directive:** Remove `eval`/`new Function`.

**Why:** This MCP tool handler, authored in TypeScript, calls `eval()` or constructs a `new Function(...)`.

**When this applies:** When defining a tool.

---

#### [MCP-024] TypeScript MCP tool HTTP call has no timeout
**Severity:** high | **Confidence:** 0.60

**Directive:** Attach a deadline.

**Why:** This TypeScript MCP tool handler makes an outbound HTTP call (fetch / axios / got / undici) with no deadline — no signal, timeout, or abortSignal option.

**When this applies:** When defining a tool.

---

#### [MCP-030] Side-effecting tool lets the model choose the recipient or amount with no visible bound
**Severity:** high | **Confidence:** 0.50

**Directive:** Do not let the model supply the recipient or the amount unconstrained.

**Why:** This MCP tool's name signals a send/notify or a refund/charge/pay side effect, and it takes a free-form recipient or amount parameter with no visible bound: no allow-list constraining who the message reaches, and no cap, range, or enum constraining how much money moves.

**When this applies:** When defining a tool.

---

#### [MCP-002] Tool has no type-annotated parameters
**Severity:** medium | **Confidence:** 0.85

**Directive:** Add type hints to every parameter (def search(query: str, limit: int = 10) -> dict).

**Why:** MCP derives a tool's input JSON schema from the handler's Python type annotations.

**When this applies:** When defining a tool.

---

#### [MCP-007] Mutating tool has no idempotency key
**Severity:** medium | **Confidence:** 0.55

**Directive:** Accept an idempotency key parameter (idempotency_key / request_id) and de-duplicate server-side so a retried call is a no-op after the first success.

**Why:** The tool name signals a side effect (create/send/refund/…).

**When this applies:** When defining a tool.

---

#### [MCP-023] MCP tool prints to stdout, corrupting a stdio transport
**Severity:** medium | **Confidence:** 0.70

**Directive:** Remove the print().

**Why:** The tool handler calls print(), which writes to the process's stdout.

**When this applies:** When defining a tool.

---

#### [MCP-001] Tool has no description
**Severity:** low | **Confidence:** 0.90

**Directive:** Add a one-line docstring (or a description= argument on the registration) stating what the tool does and when a model should call it.

**Why:** An MCP server publishes each tool's description to connecting clients as the text a model uses to decide whether to call the tool.

**When this applies:** When defining a tool.

---

#### [MCP-003] Ambiguous tool name
**Severity:** low | **Confidence:** 0.85

**Directive:** Rename to a verb-object form, e.g.

**Why:** Tool names like `process`, `handle`, or `run` give a connecting model no signal about intent.

**When this applies:** When defining a tool.

---

#### [MCP-006] Tool raises exceptions without a structured error contract
**Severity:** low | **Confidence:** 0.60

**Directive:** Catch known failure modes and return a structured result the model can branch on (e.g.

**Why:** When an MCP tool handler raises, the runtime surfaces the exception to the connecting client as an opaque error.

**When this applies:** When defining a tool.

---

#### [MCP-011] TypeScript MCP tool has no description
**Severity:** low | **Confidence:** 0.85

**Directive:** Provide a concise `description` string in the registration config stating what the tool does and when a model should call it.

**Why:** An MCP server authored in TypeScript registers each tool with `server.registerTool(name, {description, inputSchema}, handler)`.

**When this applies:** When defining a tool.

---

#### [MCP-015] Go MCP tool has no description
**Severity:** low | **Confidence:** 0.85

**Directive:** Add `mcp.WithDescription("...")` to the `mcp.NewTool(...)` call (mark3labs/ mcp-go), or set the `Description` field on the `mcp.Tool` value (the official go-sdk), stating what the tool does and when a model should call it.

**Why:** An MCP server authored in Go advertises each tool's description to connecting clients as the text a model uses to decide whether to call it.

**When this applies:** When defining a tool.

---

#### [MCP-016] Ambiguous Go MCP tool name
**Severity:** low | **Confidence:** 0.85

**Directive:** Rename to a verb-object form, e.g.

**Why:** A Go MCP tool's name is the first argument to `mcp.NewTool(...)` (or the `Name` field of an `mcp.Tool`).

**When this applies:** When defining a tool.

---

#### [MCP-017] C# MCP tool has no description
**Severity:** low | **Confidence:** 0.85

**Directive:** Add a `[Description("...")]` attribute (System.ComponentModel) to the `[McpServerTool]` method, stating what the tool does and when a model should call it.

**Why:** A C# MCP server advertises each tool's description to connecting clients as the text a model uses to decide whether to call it.

**When this applies:** When defining a tool.

---

#### [MCP-018] Ambiguous C# MCP tool name
**Severity:** low | **Confidence:** 0.85

**Directive:** Rename the method (or set `[McpServerTool(Name = "...")]`) to a verb-object form, e.g.

**Why:** A C# MCP tool's name defaults to the `[McpServerTool]` method name.

**When this applies:** When defining a tool.

---

#### [MCP-019] PHP MCP tool has no description
**Severity:** low | **Confidence:** 0.85

**Directive:** Add a `description:` argument to the `#[McpTool]` attribute, e.g.

**Why:** A PHP MCP server advertises each tool's description to connecting clients as the text a model uses to decide whether to call it.

**When this applies:** When defining a tool.

---

#### [MCP-020] Ambiguous PHP MCP tool name
**Severity:** low | **Confidence:** 0.85

**Directive:** Rename the method (or set the `#[McpTool]` `name:` argument) to a verb-object form, e.g.

**Why:** A PHP MCP tool's name is the `#[McpTool]` attribute's `name:` argument, or the method name when that argument is omitted.

**When this applies:** When defining a tool.

---

#### [MCP-021] Rust MCP tool has no description
**Severity:** low | **Confidence:** 0.85

**Directive:** Add a `description = "..."` argument to the `#[tool(...)]` attribute, or a `///` doc comment on the method, stating what the tool does and when a model should call it.

**Why:** A Rust MCP server (the official rmcp crate) advertises each tool's description to connecting clients as the text a model uses to decide whether to call it.

**When this applies:** When defining a tool.

---

#### [MCP-022] Ambiguous Rust MCP tool name
**Severity:** low | **Confidence:** 0.85

**Directive:** Rename the method (or set the `#[tool]` `name = "..."` argument) to a verb-object form, e.g.

**Why:** A Rust MCP tool's name is the `#[tool]` attribute's `name = "..."` argument, or the method name when that argument is omitted.

**When this applies:** When defining a tool.

---

#### [MCP-025] MCP tool description is a placeholder
**Severity:** low | **Confidence:** 0.85

**Directive:** Replace the placeholder with a real description covering what the tool does, what it returns, and when a model should call it rather than a neighboring tool on this server.

**Why:** The docstring passes the MCP-001 has-a-description check but carries a placeholder marker instead of real content.

**When this applies:** When defining a tool.

---

#### [MCP-026] MCP tool description is too short to guide model selection
**Severity:** low | **Confidence:** 0.80

**Directive:** Expand the description to at least a full sentence covering inputs, outputs, and the situation in which this tool should be used over the alternatives.

**Why:** A description under 40 characters is rarely enough to convey what a tool does, what it returns, and when to call it rather than a similarly named neighbor.

**When this applies:** When defining a tool.

---

#### [MCP-027] TypeScript MCP tool description is a placeholder
**Severity:** low | **Confidence:** 0.85

**Directive:** Replace the placeholder with a real description covering what the tool does, what it returns, and when a model should call it rather than a neighboring tool on this server.

**Why:** The tool registration sets a description, so it passes MCP-011, but the string is a placeholder rather than real content.

**When this applies:** When defining a tool.

---

#### [MCP-028] TypeScript MCP tool description is too short to guide model selection
**Severity:** low | **Confidence:** 0.80

**Directive:** Expand the description to at least a full sentence covering inputs, outputs, and the situation in which this tool should be used over the alternatives.

**Why:** A description under 40 characters is rarely enough to convey what a tool does, what it returns, and when to call it rather than a similarly named neighbor.

**When this applies:** When defining a tool.

---

#### [MCP-029] TypeScript MCP tool writes to the filesystem
**Severity:** low | **Confidence:** 0.50

**Directive:** Confine writes to a dedicated working directory: resolve the final path, verify it stays under that root before writing, and reject absolute paths and any input containing "..".

**Why:** This TypeScript MCP tool handler writes to the filesystem.

**When this applies:** When defining a tool.

### Repo Rules

---

#### [MCP-201] MCP server project ships no agent-guidance doc (AGENTS.md/CLAUDE.md)
**Severity:** low | **Confidence:** 0.90

**Directive:** Add an AGENTS.md at the repo root (a CLAUDE.md also satisfies this rule).

**Why:** The project implements an MCP server in code but ships no agent-guidance doc (AGENTS.md or CLAUDE.md) at the repo root.

**When this applies:** For any repo using this SDK.

