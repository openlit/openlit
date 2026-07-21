jest.mock("ai", () => ({
	tool: jest.fn((config) => config),
	jsonSchema: jest.fn((schema) => schema),
}));

import { TextDecoder, TextEncoder } from "util";

Object.assign(global, { TextDecoder, TextEncoder });

jest.mock("@/lib/platform/rule-engine", () => ({
	createRule: jest.fn(),
	updateRule: jest.fn(),
	deleteRule: jest.fn(),
	getRules: jest.fn(),
	getRuleById: jest.fn(),
	addConditionGroupsToRule: jest.fn(),
	addRuleEntity: jest.fn(),
	deleteRuleEntity: jest.fn(),
	getRuleEntities: jest.fn(),
}));

jest.mock("@/lib/platform/context", () => ({
	createContext: jest.fn(),
	updateContext: jest.fn(),
	deleteContext: jest.fn(),
	getContexts: jest.fn(),
}));

jest.mock("@/lib/platform/prompt", () => ({
	createPrompt: jest.fn(),
	getPromptByName: jest.fn(),
	getPromptDetails: jest.fn(),
	getPrompts: jest.fn(),
	deletePrompt: jest.fn(),
}));

jest.mock("@/lib/platform/prompt/version", () => ({
	upsertPromptVersion: jest.fn(),
}));

jest.mock("@/lib/platform/vault", () => ({
	upsertSecret: jest.fn(),
	deleteSecret: jest.fn(),
	getSecrets: jest.fn(),
}));

jest.mock("@/lib/platform/providers/models-service", () => ({
	createCustomModel: jest.fn(),
	updateCustomModel: jest.fn(),
	deleteCustomModel: jest.fn(),
	getCustomModels: jest.fn(),
}));

jest.mock("@/lib/platform/chat/improvement", () => ({
	getTraceImprovement: jest.fn(),
	streamTraceImprovementAnalysis: jest.fn(),
}));

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));

jest.mock("@/utils/sanitizer", () => ({
	__esModule: true,
	default: {
		sanitizeValue: jest.fn((value: string) => value),
	},
}));

import { getChatTools } from "@/lib/platform/chat/tools";
import {
	addConditionGroupsToRule,
	addRuleEntity,
	createRule,
	deleteRule,
	deleteRuleEntity,
	getRuleById,
	getRuleEntities,
	getRules,
	updateRule,
} from "@/lib/platform/rule-engine";
import {
	createContext,
	deleteContext,
	getContexts,
	updateContext,
} from "@/lib/platform/context";
import { createPrompt, deletePrompt, getPromptByName, getPromptDetails, getPrompts } from "@/lib/platform/prompt";
import { upsertPromptVersion } from "@/lib/platform/prompt/version";
import { deleteSecret, getSecrets, upsertSecret } from "@/lib/platform/vault";
import {
	createCustomModel,
	deleteCustomModel,
	getCustomModels,
	updateCustomModel,
} from "@/lib/platform/providers/models-service";
import { dataCollector } from "@/lib/platform/common";
import {
	getTraceImprovement,
	streamTraceImprovementAnalysis,
} from "@/lib/platform/chat/improvement";

function ndjsonResponse(payload: string) {
	const encoder = new TextEncoder();
	return {
		body: {
			getReader: () => {
				let read = false;
				return {
					read: async () => {
						if (read) return { done: true };
						read = true;
						return { done: false, value: encoder.encode(payload) };
					},
				};
			},
		},
	} as any;
}

describe("getChatTools", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("builds the expected tool set", () => {
		const tools = getChatTools("user-1", "db-1") as any;

		expect(Object.keys(tools)).toEqual(
			expect.arrayContaining([
				"create_rule",
				"list_rules",
				"create_context",
				"create_prompt",
				"get_prompt",
				"create_vault_secret",
				"create_custom_model",
				"list_custom_models",
				"analyze_trace",
				"get_trace_analysis",
				"analyze_trace_batch",
				"analyze_traces_by_attribute",
			])
		);
		expect(tools.create_rule.inputSchema.required).toEqual(["name"]);
		expect(tools.create_vault_secret.inputSchema.required).toEqual([
			"key",
			"value",
		]);
	});

	it("creates a rule and adds condition groups when provided", async () => {
		(createRule as jest.Mock).mockResolvedValue({ id: "rule-1" });
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.create_rule.execute({
				name: "Latency rule",
				condition_groups: [{ conditions: [] }],
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				message: "Rule created",
			})
		);
		expect(createRule).toHaveBeenCalledWith({
			name: "Latency rule",
			description: "",
			group_operator: "AND",
			status: "ACTIVE",
		});
	});

	it("returns rule operation errors without throwing", async () => {
		(deleteRule as jest.Mock).mockResolvedValue(["delete failed"]);
		(getRules as jest.Mock).mockResolvedValue({ err: "list failed" });
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(tools.delete_rule.execute({ id: "rule-1" })).resolves.toEqual({
			success: false,
			error: "delete failed",
		});
		await expect(tools.list_rules.execute({})).resolves.toEqual({
			success: false,
			error: "list failed",
		});
	});

	it("normalizes vault keys before storing secrets", async () => {
		(upsertSecret as jest.Mock).mockResolvedValue(undefined);
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.create_vault_secret.execute({
				key: "OpenAI API.key",
				value: "sk-test",
				tags: ["llm"],
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				details: expect.stringContaining('Key: "OPEN_AI_API_KEY"'),
			})
		);
		expect(upsertSecret).toHaveBeenCalledWith({
			key: "OPEN_AI_API_KEY",
			value: "sk-test",
			tags: ["llm"],
		});
	});

	it("passes user and database config ids to custom model operations", async () => {
		(createCustomModel as jest.Mock).mockResolvedValue({
			data: { id: "model-1" },
		});
		(getCustomModels as jest.Mock).mockResolvedValue({
			data: [{ id: "model-1", model_id: "custom-model", provider: "openai" }],
		});
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.create_custom_model.execute({
				provider: "openai",
				model_id: "custom-model",
				display_name: "Custom Model",
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				id: "model-1",
			})
		);
		expect(createCustomModel).toHaveBeenCalledWith(
			"user-1",
			"db-1",
			expect.objectContaining({
				provider: "openai",
				model_id: "custom-model",
				displayName: "Custom Model",
				modelType: "chat",
				contextWindow: 4096,
			})
		);

		await expect(
			tools.list_custom_models.execute({ provider: "openai" })
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				count: 1,
			})
		);
		expect(getCustomModels).toHaveBeenCalledWith("user-1", "db-1", "openai");
	});

	it("executes rule read, update, link, unlink, and list entity tools", async () => {
		(updateRule as jest.Mock).mockResolvedValue(undefined);
		(getRuleById as jest.Mock).mockResolvedValue({ data: { id: "rule-1" } });
		(addRuleEntity as jest.Mock).mockResolvedValue(undefined);
		(deleteRuleEntity as jest.Mock).mockResolvedValue([null]);
		(getRuleEntities as jest.Mock).mockResolvedValue({
			data: [{ id: "entity-1" }],
			err: null,
		});
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.update_rule.execute({ id: "rule-1", name: "Updated" })
		).resolves.toEqual(expect.objectContaining({ success: true }));
		await expect(tools.get_rule.execute({ id: "rule-1" })).resolves.toEqual({
			success: true,
			rule: { id: "rule-1" },
		});
		await expect(
			tools.link_entity_to_rule.execute({
				rule_id: "rule-1",
				entity_type: "context",
				entity_id: "ctx-1",
			})
		).resolves.toEqual(expect.objectContaining({ success: true }));
		await expect(
			tools.unlink_entity_from_rule.execute({ id: "link-1" })
		).resolves.toEqual({ success: true, message: "Entity unlinked from rule" });
		await expect(
			tools.list_rule_entities.execute({ rule_id: "rule-1" })
		).resolves.toEqual({
			success: true,
			entities: [{ id: "entity-1" }],
		});

		expect(updateRule).toHaveBeenCalledWith("rule-1", {
			name: "Updated",
			description: undefined,
			group_operator: undefined,
			status: undefined,
		});
		expect(addRuleEntity).toHaveBeenCalledWith({
			rule_id: "rule-1",
			entity_type: "context",
			entity_id: "ctx-1",
		});
	});

	it("executes context tools and serializes tags", async () => {
		(createContext as jest.Mock).mockResolvedValue({ id: "ctx-1" });
		(updateContext as jest.Mock).mockResolvedValue(undefined);
		(deleteContext as jest.Mock).mockResolvedValue([null]);
		(getContexts as jest.Mock).mockResolvedValue({
			data: [{ id: "ctx-1", name: "Policy", status: "ACTIVE" }],
			err: null,
		});
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.create_context.execute({
				name: "Policy",
				content: "Use policy",
				tags: ["security"],
			})
		).resolves.toEqual(expect.objectContaining({ success: true }));
		await expect(
			tools.update_context.execute({
				id: "ctx-1",
				description: "",
				tags: ["security", "prod"],
			})
		).resolves.toEqual(expect.objectContaining({ success: true }));
		await expect(tools.delete_context.execute({ id: "ctx-1" })).resolves.toEqual({
			success: true,
			message: "Context deleted",
		});
		await expect(tools.list_contexts.execute({})).resolves.toEqual({
			success: true,
			count: 1,
			contexts: [
				{
					id: "ctx-1",
					name: "Policy",
					status: "ACTIVE",
					description: undefined,
				},
			],
		});

		expect(createContext).toHaveBeenCalledWith(
			expect.objectContaining({ tags: '["security"]' })
		);
		expect(updateContext).toHaveBeenCalledWith("ctx-1", {
			description: "",
			tags: '["security","prod"]',
		});
	});

	it("executes prompt tools", async () => {
		(createPrompt as jest.Mock).mockResolvedValue({
			data: { promptId: "prompt-1" },
		});
		(getPromptByName as jest.Mock).mockResolvedValue({ id: "prompt-1" });
		(getPromptDetails as jest.Mock).mockResolvedValue({
			data: [{
				promptId: "prompt-1",
				versionId: "version-1",
				name: "music_recommend",
				version: "1.0.0",
				status: "PUBLISHED",
				tags: ["music"],
				prompt: "Recommend music for {{mood}}",
			}],
			err: null,
		});
		(upsertPromptVersion as jest.Mock).mockResolvedValue(undefined);
		(deletePrompt as jest.Mock).mockResolvedValue([null]);
		(getPrompts as jest.Mock).mockResolvedValue({
			data: [{ id: "prompt-1", name: "Prompt", totalVersions: 2 }],
			err: null,
		});
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.create_prompt.execute({ name: "Prompt", prompt: "Hello {{name}}" })
		).resolves.toEqual(expect.objectContaining({ success: true }));
		await expect(
			tools.update_prompt_version.execute({
				prompt_id: "prompt-1",
				version_id: "version-1",
				version: "2.0.0",
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				message: "Prompt version updated",
			})
		);
		await expect(
			tools.get_prompt.execute({ name: "music_recommend" })
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				message: "Prompt loaded",
				prompt: expect.objectContaining({
					id: "prompt-1",
					name: "music_recommend",
					content: "Recommend music for {{mood}}",
				}),
				details: expect.stringContaining("Recommend music for {{mood}}"),
			})
		);
		await expect(tools.delete_prompt.execute({ id: "prompt-1" })).resolves.toEqual({
			success: true,
			message: "Prompt deleted",
		});
		await expect(tools.list_prompts.execute({})).resolves.toEqual({
			success: true,
			count: 1,
			prompts: [
				{
					id: "prompt-1",
					name: "Prompt",
					totalVersions: 2,
					latestVersion: undefined,
				},
			],
		});
		expect(createPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				version: "1.0.0",
				status: "DRAFT",
				metaProperties: {},
			})
		);
		expect(getPromptByName).toHaveBeenCalledWith({ name: "music_recommend" });
		expect(getPromptDetails).toHaveBeenCalledWith("prompt-1", undefined);
	});

	it("returns get_prompt validation and lookup errors without mutating prompts", async () => {
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(tools.get_prompt.execute({})).resolves.toEqual({
			success: false,
			error: "Prompt name or prompt ID is required",
		});

		(getPromptByName as jest.Mock).mockResolvedValueOnce(null);
		await expect(
			tools.get_prompt.execute({ name: "missing_prompt" })
		).resolves.toEqual({
			success: false,
			error: 'Prompt "missing_prompt" was not found',
		});

		(getPromptDetails as jest.Mock).mockResolvedValueOnce({ err: "details failed" });
		await expect(
			tools.get_prompt.execute({ prompt_id: "prompt-1" })
		).resolves.toEqual({
			success: false,
			error: "details failed",
		});

		(getPromptDetails as jest.Mock).mockResolvedValueOnce({ data: [], err: null });
		await expect(
			tools.get_prompt.execute({ prompt_id: "prompt-1" })
		).resolves.toEqual({
			success: false,
			error: "Prompt was not found",
		});

		(getPromptDetails as jest.Mock).mockRejectedValueOnce(new Error("load failed"));
		await expect(
			tools.get_prompt.execute({ prompt_id: "prompt-1" })
		).resolves.toEqual({
			success: false,
			error: "load failed",
		});

		expect(upsertPromptVersion).not.toHaveBeenCalled();
	});

	it("executes vault update, delete, and list tools", async () => {
		(upsertSecret as jest.Mock).mockResolvedValue(undefined);
		(deleteSecret as jest.Mock).mockResolvedValue([null]);
		(getSecrets as jest.Mock).mockResolvedValue({
			data: [{ id: "secret-1", key: "API_KEY", tags: ["llm"] }],
			err: null,
		});
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.update_vault_secret.execute({
				id: "secret-1",
				key: "Api Key",
				value: "secret",
				tags: ["llm"],
			})
		).resolves.toEqual(expect.objectContaining({ success: true }));
		await expect(
			tools.delete_vault_secret.execute({ id: "secret-1" })
		).resolves.toEqual({ success: true, message: "Secret deleted" });
		await expect(tools.list_vault_secrets.execute({})).resolves.toEqual({
			success: true,
			count: 1,
			secrets: [
				{
					id: "secret-1",
					key: "API_KEY",
					tags: ["llm"],
					created_at: undefined,
				},
			],
		});
		expect(upsertSecret).toHaveBeenCalledWith({
			id: "secret-1",
			key: "API_KEY",
			value: "secret",
			tags: ["llm"],
		});
	});

	it("executes custom model update and delete tools", async () => {
		(updateCustomModel as jest.Mock).mockResolvedValue({ err: null });
		(deleteCustomModel as jest.Mock).mockResolvedValue({ err: null });
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.update_custom_model.execute({
				id: "model-1",
				display_name: "Updated Model",
				context_window: 8192,
				input_price_per_m_tokens: 1.5,
				output_price_per_m_tokens: 2.5,
				capabilities: ["chat"],
			})
		).resolves.toEqual(
			expect.objectContaining({ success: true, id: "model-1" })
		);
		await expect(
			tools.delete_custom_model.execute({ id: "model-1" })
		).resolves.toEqual({ success: true, message: "Model deleted" });
		expect(updateCustomModel).toHaveBeenCalledWith("user-1", "db-1", "model-1", {
			displayName: "Updated Model",
			contextWindow: 8192,
			inputPricePerMToken: 1.5,
			outputPricePerMToken: 2.5,
			capabilities: ["chat"],
		});
	});

	it("returns caught errors from representative tools", async () => {
		(updateRule as jest.Mock).mockRejectedValue(new Error("update failed"));
		(createContext as jest.Mock).mockRejectedValue(new Error("context failed"));
		(createPrompt as jest.Mock).mockRejectedValue(new Error("prompt failed"));
		(upsertSecret as jest.Mock).mockRejectedValue(new Error("secret failed"));
		(createCustomModel as jest.Mock).mockRejectedValue(new Error("model failed"));
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(tools.update_rule.execute({ id: "rule-1" })).resolves.toEqual({
			success: false,
			error: "update failed",
		});
		await expect(
			tools.create_context.execute({ name: "Ctx", content: "Body" })
		).resolves.toEqual({ success: false, error: "context failed" });
		await expect(
			tools.create_prompt.execute({ name: "Prompt", prompt: "Hi" })
		).resolves.toEqual({ success: false, error: "prompt failed" });
		await expect(
			tools.create_vault_secret.execute({ key: "Key", value: "secret" })
		).resolves.toEqual({ success: false, error: "secret failed" });
		await expect(
			tools.create_custom_model.execute({
				provider: "openai",
				model_id: "m",
				display_name: "Model",
			})
		).resolves.toEqual({ success: false, error: "model failed" });
	});

	it("gets existing trace analysis without rerunning", async () => {
		(getTraceImprovement as jest.Mock).mockResolvedValue({
			data: {
				rootSpanId: "span-root",
				runs: [
					{
						id: "run-1",
						rootSpanId: "span-root",
						selectedSpanId: "span-root",
						runNumber: 1,
						analysisJson: JSON.stringify({
							trace_id: "trace-1",
							summary: "Trace looks healthy",
							strengths: [],
							improvements: [],
							wrong_turns: [],
							cost: [],
							token_efficiency: [],
							path_analysis: [],
							totals: {},
						}),
						summary: "Trace looks healthy",
						modelProvider: "openai",
						modelName: "gpt-4o",
						promptTokens: 10,
						completionTokens: 4,
						cost: 0.001,
						worstSeverity: "info",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		});
		const tools = getChatTools("user-1", "db-1") as any;

		const result = await tools.analyze_trace.execute({
			span_id: "span-root",
			scope: "trace",
		});

		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				existing: true,
				message: "Existing trace analysis found",
			})
		);
		expect(result.details).toContain("```trace-refs");
		expect(streamTraceImprovementAnalysis).not.toHaveBeenCalled();
	});

	it("analyzes traces by span attribute and returns trace refs", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({
			data: [{ traceId: "trace-abc", spanId: "span-abc", spanCount: 3 }],
			err: null,
		});
		(getTraceImprovement as jest.Mock).mockResolvedValue({
			data: { rootSpanId: "span-abc", runs: [] },
		});
		(streamTraceImprovementAnalysis as jest.Mock).mockResolvedValue({
			response: ndjsonResponse(
				`${JSON.stringify({
					type: "done",
					data: {
						rootSpanId: "span-abc",
						runs: [
							{
								id: "run-1",
								rootSpanId: "span-abc",
								selectedSpanId: "span-abc",
								runNumber: 1,
								analysisJson: JSON.stringify({
									trace_id: "trace-abc",
									summary: "Session trace analyzed",
									strengths: [],
									improvements: [],
									wrong_turns: [],
									cost: [],
									token_efficiency: [],
									path_analysis: [],
									totals: {},
								}),
								summary: "Session trace analyzed",
								modelProvider: "openai",
								modelName: "gpt-4o",
								promptTokens: 8,
								completionTokens: 2,
								cost: 0.001,
								worstSeverity: "info",
								createdAt: "2026-01-01T00:00:00.000Z",
							},
						],
					},
				})}\n`
			),
		});
		const tools = getChatTools("user-1", "db-1") as any;

		const result = await tools.analyze_traces_by_attribute.execute({
			attribute_key: "session.id",
			attribute_value: "session-1",
		});

		expect(dataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.stringContaining("SpanAttributes['session.id'] = 'session-1'"),
				enable_readonly: true,
			}),
			"query",
			"db-1"
		);
		expect(result.success).toBe(true);
		expect(result.details).toContain("```trace-refs");
		expect(result.matchedTraceCount).toBe(1);
	});

	it("returns create_rule errors and skips condition groups when none are provided", async () => {
		(createRule as jest.Mock)
			.mockResolvedValueOnce({ id: "rule-2" })
			.mockRejectedValueOnce(new Error("create failed"));
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.create_rule.execute({ name: "Simple", status: "INACTIVE" })
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				details: expect.stringContaining("Conditions: 0 groups"),
			})
		);
		expect(addConditionGroupsToRule).not.toHaveBeenCalled();

		await expect(tools.create_rule.execute({ name: "Bad" })).resolves.toEqual({
			success: false,
			error: "create failed",
		});
	});

	it("covers remaining rule/context/prompt/vault error and success branches", async () => {
		(getRules as jest.Mock).mockResolvedValue({
			data: [{ id: "r1", name: "Rule", status: "ACTIVE", description: "d" }],
			err: null,
		});
		(getRuleById as jest.Mock).mockResolvedValue({ err: "missing rule" });
		(deleteRuleEntity as jest.Mock).mockResolvedValue(["unlink failed"]);
		(getRuleEntities as jest.Mock).mockResolvedValue({ err: "entities failed" });
		(deleteContext as jest.Mock).mockResolvedValue(["ctx delete failed"]);
		(getContexts as jest.Mock).mockRejectedValue(new Error("contexts boom"));
		(upsertPromptVersion as jest.Mock).mockResolvedValue(undefined);
		(getPromptDetails as jest.Mock).mockResolvedValue({
			data: [
				{
					promptId: "prompt-1",
					versionId: "v1",
					name: "p",
					version: "1.0.0",
					status: "DRAFT",
					tags: [],
					prompt: "hi",
				},
			],
			err: null,
		});
		(deletePrompt as jest.Mock).mockResolvedValue(["prompt delete failed"]);
		(getPrompts as jest.Mock).mockResolvedValue({ err: "prompts failed" });
		(deleteSecret as jest.Mock).mockResolvedValue(["secret delete failed"]);
		(getSecrets as jest.Mock).mockResolvedValue({ err: "secrets failed" });
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(tools.list_rules.execute({})).resolves.toEqual({
			success: true,
			count: 1,
			rules: [{ id: "r1", name: "Rule", status: "ACTIVE", description: "d" }],
		});
		await expect(tools.get_rule.execute({ id: "missing" })).resolves.toEqual({
			success: false,
			error: "missing rule",
		});
		await expect(
			tools.unlink_entity_from_rule.execute({ id: "link-1" })
		).resolves.toEqual({ success: false, error: "unlink failed" });
		await expect(
			tools.list_rule_entities.execute({ rule_id: "r1" })
		).resolves.toEqual({ success: false, error: "entities failed" });
		await expect(tools.delete_context.execute({ id: "ctx" })).resolves.toEqual({
			success: false,
			error: "ctx delete failed",
		});
		await expect(tools.list_contexts.execute({})).resolves.toEqual({
			success: false,
			error: "contexts boom",
		});
		await expect(
			tools.update_prompt_version.execute({
				prompt_id: "prompt-1",
				version: "2.0.0",
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				message: "New prompt version created",
			})
		);
		await expect(
			tools.get_prompt.execute({ prompt_id: "prompt-1", version: "1.0.0" })
		).resolves.toEqual(expect.objectContaining({ success: true }));
		expect(getPromptDetails).toHaveBeenCalledWith("prompt-1", { version: "1.0.0" });
		await expect(tools.delete_prompt.execute({ id: "prompt-1" })).resolves.toEqual({
			success: false,
			error: "prompt delete failed",
		});
		await expect(tools.list_prompts.execute({})).resolves.toEqual({
			success: false,
			error: "prompts failed",
		});
		await expect(tools.delete_vault_secret.execute({ id: "s1" })).resolves.toEqual({
			success: false,
			error: "secret delete failed",
		});
		await expect(tools.list_vault_secrets.execute({})).resolves.toEqual({
			success: false,
			error: "secrets failed",
		});
	});

	it("covers custom model error returns and alert tool passthrough", async () => {
		(createCustomModel as jest.Mock).mockResolvedValue({ err: "create model failed" });
		(updateCustomModel as jest.Mock).mockResolvedValue({ err: "update model failed" });
		(deleteCustomModel as jest.Mock).mockResolvedValue({ err: "delete model failed" });
		(getCustomModels as jest.Mock).mockResolvedValue({ err: "list models failed" });
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.create_custom_model.execute({
				provider: "openai",
				model_id: "m",
				display_name: "M",
			})
		).resolves.toEqual({ success: false, error: "create model failed" });
		await expect(
			tools.update_custom_model.execute({ id: "model-1" })
		).resolves.toEqual({ success: false, error: "update model failed" });
		await expect(
			tools.delete_custom_model.execute({ id: "model-1" })
		).resolves.toEqual({ success: false, error: "delete model failed" });
		await expect(tools.list_custom_models.execute({})).resolves.toEqual({
			success: false,
			error: "list models failed",
		});

		await expect(tools.create_alert.execute({ name: "A" })).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(tools.list_alerts.execute({})).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(tools.get_alert.execute({ id: "a1" })).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(
			tools.update_alert.execute({ id: "a1", name: "B" })
		).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(tools.delete_alert.execute({ id: "a1" })).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(
			tools.create_alert_destination.execute({
				name: "Slack",
				providerType: "slack",
				config: {},
			})
		).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(tools.list_alert_destinations.execute({})).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(tools.get_alert_destination.execute({ id: "d1" })).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(
			tools.update_alert_destination.execute({ id: "d1", name: "X" })
		).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(tools.delete_alert_destination.execute({ id: "d1" })).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(tools.test_alert.execute({ id: "a1" })).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
		await expect(tools.test_alert_destination.execute({ id: "d1" })).resolves.toEqual({
			success: false,
			error: "Alerting is not available in this edition.",
		});
	});

	it("reruns analyze_trace and handles stream failure paths", async () => {
		const tools = getChatTools("user-1", "db-1") as any;
		const run = {
			id: "run-2",
			rootSpanId: "span-1",
			selectedSpanId: "span-1",
			runNumber: 2,
			analysisJson: "{not-json",
			summary: "",
			modelProvider: "openai",
			modelName: "gpt-4o",
			promptTokens: 1,
			completionTokens: 1,
			cost: 0,
			worstSeverity: "",
			createdAt: "2026-01-01T00:00:00.000Z",
		};

		(streamTraceImprovementAnalysis as jest.Mock).mockResolvedValueOnce({
			response: ndjsonResponse(
				`${JSON.stringify({
					type: "done",
					data: { rootSpanId: "span-1", runs: [run] },
				})}\n`
			),
		});
		await expect(
			tools.analyze_trace.execute({
				span_id: "span-1",
				scope: "span",
				rerun: true,
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				existing: false,
				message: "Span analysis completed",
			})
		);
		expect(getTraceImprovement).not.toHaveBeenCalled();

		(streamTraceImprovementAnalysis as jest.Mock).mockResolvedValueOnce({
			err: "stream start failed",
		});
		await expect(
			tools.analyze_trace.execute({ span_id: "span-1", rerun: true })
		).resolves.toEqual({
			success: false,
			error: "stream start failed",
		});

		(streamTraceImprovementAnalysis as jest.Mock).mockResolvedValueOnce({
			response: ndjsonResponse(
				`${JSON.stringify({ type: "error", error: "model failed" })}\n`
			),
		});
		await expect(
			tools.analyze_trace.execute({ span_id: "span-1", rerun: true })
		).resolves.toEqual({
			success: false,
			error: "model failed",
		});

		(streamTraceImprovementAnalysis as jest.Mock).mockResolvedValueOnce({
			response: { body: null },
		});
		await expect(
			tools.analyze_trace.execute({ span_id: "span-1", rerun: true })
		).resolves.toEqual({
			success: false,
			error: "Trace analysis stream did not return a body",
		});

		(streamTraceImprovementAnalysis as jest.Mock).mockResolvedValueOnce({
			response: ndjsonResponse(`${JSON.stringify({ type: "step", label: "x" })}\n`),
		});
		await expect(
			tools.analyze_trace.execute({ span_id: "span-1", rerun: true })
		).resolves.toEqual({
			success: false,
			error: "Trace analysis finished without a result",
		});

		(streamTraceImprovementAnalysis as jest.Mock).mockResolvedValueOnce({
			response: ndjsonResponse(
				`${JSON.stringify({
					type: "done",
					data: { rootSpanId: "span-1", runs: [] },
				})}\n`
			),
		});
		await expect(
			tools.analyze_trace.execute({ span_id: "span-1", rerun: true })
		).resolves.toEqual({
			success: false,
			error: "Trace analysis completed without a saved run",
		});
	});

	it("returns existing span analysis and get_trace_analysis branches", async () => {
		const tools = getChatTools("user-1", "db-1") as any;
		(getTraceImprovement as jest.Mock).mockResolvedValueOnce({
			err: "lookup failed",
		});
		await expect(
			tools.analyze_trace.execute({ span_id: "span-1" })
		).resolves.toEqual({ success: false, error: "lookup failed" });

		(getTraceImprovement as jest.Mock).mockResolvedValueOnce({
			data: {
				rootSpanId: "span-child",
				runs: [
					{
						id: "run-1",
						rootSpanId: "span-child",
						selectedSpanId: "span-child",
						analysisType: "span_analysis",
						runNumber: 1,
						analysisJson: JSON.stringify({
							traceId: "t-1",
							summary: "Span ok",
							strengths: [{}],
							improvements: [],
							wrong_turns: [],
							cost: [],
							token_efficiency: [],
							path_analysis: [],
							totals: { span_count: 1 },
						}),
						summary: "",
						modelProvider: "openai",
						modelName: "gpt-4o",
						promptTokens: 1,
						completionTokens: 1,
						cost: 0,
						worstSeverity: "info",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		});
		const existing = await tools.analyze_trace.execute({
			span_id: "span-child",
			scope: "span",
		});
		expect(existing).toEqual(
			expect.objectContaining({
				success: true,
				existing: true,
				message: "Existing span analysis found",
			})
		);
		expect(existing.analysis.dimensionCounts.strengths).toBe(1);
		expect(existing.details).toContain("```trace-refs");

		(getTraceImprovement as jest.Mock).mockResolvedValueOnce({
			data: { rootSpanId: "span-1", runs: [] },
		});
		await expect(
			tools.get_trace_analysis.execute({ span_id: "span-1" })
		).resolves.toEqual({
			success: true,
			rootSpanId: "span-1",
			count: 0,
			latest: null,
			runs: [],
		});

		(getTraceImprovement as jest.Mock).mockResolvedValueOnce({ err: "get failed" });
		await expect(
			tools.get_trace_analysis.execute({ span_id: "span-1", scope: "span" })
		).resolves.toEqual({ success: false, error: "get failed" });

		(getTraceImprovement as jest.Mock).mockRejectedValueOnce(new Error("boom"));
		await expect(
			tools.get_trace_analysis.execute({ span_id: "span-1" })
		).resolves.toEqual({ success: false, error: "boom" });
	});

	it("covers analyze_trace_batch empty, capped, and mixed results", async () => {
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.analyze_trace_batch.execute({ span_ids: [] })
		).resolves.toEqual({
			success: false,
			error: "No span IDs were provided for batch analysis",
		});

		(getTraceImprovement as jest.Mock)
			.mockResolvedValueOnce({
				data: {
					rootSpanId: "s1",
					runs: [
						{
							id: "run-1",
							rootSpanId: "s1",
							selectedSpanId: "s1",
							runNumber: 1,
							analysisJson: "{}",
							summary: "ok",
							modelProvider: "openai",
							modelName: "gpt-4o",
							promptTokens: 1,
							completionTokens: 1,
							cost: 0,
							worstSeverity: "info",
							createdAt: "2026-01-01T00:00:00.000Z",
						},
					],
				},
			})
			.mockResolvedValueOnce({ err: "missing" });

		const batch = await tools.analyze_trace_batch.execute({
			span_ids: ["s1", "s2", "s3", "s4", "s5", "s6"],
			group_label: "latency",
			scope: "span",
		});

		expect(batch.processed).toBe(5);
		expect(batch.limitApplied).toBe(true);
		expect(batch.groupLabel).toBe("latency");
		expect(batch.success).toBe(false);
		expect(batch.results[0].success).toBe(true);
		expect(batch.results[1].success).toBe(false);
	});

	it("covers analyze_traces_by_attribute validation and empty/error paths", async () => {
		const tools = getChatTools("user-1", "db-1") as any;

		await expect(
			tools.analyze_traces_by_attribute.execute({
				attribute_key: " ",
				attribute_value: "x",
			})
		).resolves.toEqual({
			success: false,
			error: "Attribute key and value are required",
		});

		(dataCollector as jest.Mock).mockResolvedValueOnce({ err: "query failed" });
		await expect(
			tools.analyze_traces_by_attribute.execute({
				attribute_key: "session.id",
				attribute_value: "s1",
			})
		).resolves.toEqual({ success: false, error: "query failed" });

		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ traceId: "t1", spanId: null }],
			err: null,
		});
		await expect(
			tools.analyze_traces_by_attribute.execute({
				attribute_key: "session.id",
				attribute_value: "s1",
				limit: 99,
			})
		).resolves.toEqual({
			success: false,
			error: expect.stringContaining("No traces found"),
		});
	});

	it("uses default catch messages when thrown errors have empty messages", async () => {
		const tools = getChatTools("user-1", "db-1") as any;
		const emptyError = Object.assign(new Error(""), { message: "" });

		(deleteRule as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(tools.delete_rule.execute({ id: "r1" })).resolves.toEqual({
			success: false,
			error: "Failed to delete rule",
		});

		(updateContext as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(
			tools.update_context.execute({ id: "c1", name: "only-name" })
		).resolves.toEqual({
			success: false,
			error: "Failed to update context",
		});

		(upsertPromptVersion as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(
			tools.update_prompt_version.execute({
				prompt_id: "p1",
				version: "1.0.0",
				prompt: "hi",
			})
		).resolves.toEqual({
			success: false,
			error: "Failed to update prompt",
		});

		(upsertSecret as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(
			tools.update_vault_secret.execute({ id: "s1", key: "k", value: "v" })
		).resolves.toEqual({
			success: false,
			error: "Failed to update secret",
		});

		(getRules as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(tools.list_rules.execute({})).resolves.toEqual({
			success: false,
			error: "",
		});

		(getContexts as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(tools.list_contexts.execute({})).resolves.toEqual({
			success: false,
			error: "",
		});

		(getPrompts as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(tools.list_prompts.execute({})).resolves.toEqual({
			success: false,
			error: "",
		});

		(getSecrets as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(tools.list_vault_secrets.execute({})).resolves.toEqual({
			success: false,
			error: "",
		});

		(getCustomModels as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(tools.list_custom_models.execute({})).resolves.toEqual({
			success: false,
			error: "",
		});

		(getTraceImprovement as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(
			tools.analyze_trace.execute({ span_id: "span-1" })
		).resolves.toEqual({
			success: false,
			error: "Failed to run trace analysis",
		});

		(getTraceImprovement as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(
			tools.get_trace_analysis.execute({ span_id: "span-1" })
		).resolves.toEqual({
			success: false,
			error: "Failed to get trace analysis",
		});

		(getTraceImprovement as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(
			tools.analyze_trace_batch.execute({ span_ids: ["s1"] })
		).resolves.toEqual({
			success: false,
			error: "Failed to run batch trace analysis",
		});

		(dataCollector as jest.Mock).mockRejectedValueOnce(emptyError);
		await expect(
			tools.analyze_traces_by_attribute.execute({
				attribute_key: "k",
				attribute_value: "v",
			})
		).resolves.toEqual({
			success: false,
			error: "Failed to analyze traces by attribute",
		});
	});

	it("updates context with only name and creates prompt version when version_id is omitted", async () => {
		const tools = getChatTools("user-1", "db-1") as any;
		(updateContext as jest.Mock).mockResolvedValueOnce(undefined);
		await expect(
			tools.update_context.execute({ id: "c1", name: "Renamed" })
		).resolves.toEqual(
			expect.objectContaining({ success: true, message: "Context updated" })
		);
		expect(updateContext).toHaveBeenCalledWith("c1", { name: "Renamed" });

		(deleteRule as jest.Mock).mockResolvedValueOnce([null]);
		await expect(tools.delete_rule.execute({ id: "r1" })).resolves.toEqual({
			success: true,
			message: "Rule deleted",
			details: "ID: r1",
		});

		(upsertPromptVersion as jest.Mock).mockResolvedValueOnce(undefined);
		await expect(
			tools.update_prompt_version.execute({
				prompt_id: "p1",
				version: "2.0.0",
				prompt: "new body",
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				message: "New prompt version created",
			})
		);
	});

	it("filters falsy span ids in batch analysis", async () => {
		const tools = getChatTools("user-1", "db-1") as any;
		(getTraceImprovement as jest.Mock).mockResolvedValueOnce({
			data: {
				rootSpanId: "s1",
				runs: [
					{
						id: "run-1",
						rootSpanId: "s1",
						selectedSpanId: "s1",
						runNumber: 1,
						analysisJson: "{}",
						summary: "ok",
						modelProvider: "openai",
						modelName: "gpt-4o",
						promptTokens: 1,
						completionTokens: 1,
						cost: 0,
						worstSeverity: "info",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		});

		const batch = await tools.analyze_trace_batch.execute({
			span_ids: ["", "s1", null],
		});
		expect(batch.processed).toBe(1);
		expect(batch.limitApplied).toBe(true);
		expect(batch.results[0].success).toBe(true);
	});
});
