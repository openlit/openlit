jest.mock("ai", () => ({
	tool: jest.fn((config) => config),
	jsonSchema: jest.fn((schema) => schema),
}));

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

import { getChatTools } from "@/lib/platform/chat/tools";
import {
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
import { createPrompt, deletePrompt, getPrompts } from "@/lib/platform/prompt";
import { upsertPromptVersion } from "@/lib/platform/prompt/version";
import { deleteSecret, getSecrets, upsertSecret } from "@/lib/platform/vault";
import {
	createCustomModel,
	deleteCustomModel,
	getCustomModels,
	updateCustomModel,
} from "@/lib/platform/providers/models-service";

describe("getChatTools", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("builds the expected tool set", () => {
		const tools = getChatTools("user-1", "db-1");

		expect(Object.keys(tools)).toEqual(
			expect.arrayContaining([
				"create_rule",
				"list_rules",
				"create_context",
				"create_prompt",
				"create_vault_secret",
				"create_custom_model",
				"list_custom_models",
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
		const tools = getChatTools("user-1", "db-1");

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
		const tools = getChatTools("user-1", "db-1");

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
		const tools = getChatTools("user-1", "db-1");

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
		const tools = getChatTools("user-1", "db-1");

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
		const tools = getChatTools("user-1", "db-1");

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
		const tools = getChatTools("user-1", "db-1");

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
		(upsertPromptVersion as jest.Mock).mockResolvedValue(undefined);
		(deletePrompt as jest.Mock).mockResolvedValue([null]);
		(getPrompts as jest.Mock).mockResolvedValue({
			data: [{ id: "prompt-1", name: "Prompt", totalVersions: 2 }],
			err: null,
		});
		const tools = getChatTools("user-1", "db-1");

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
	});

	it("executes vault update, delete, and list tools", async () => {
		(upsertSecret as jest.Mock).mockResolvedValue(undefined);
		(deleteSecret as jest.Mock).mockResolvedValue([null]);
		(getSecrets as jest.Mock).mockResolvedValue({
			data: [{ id: "secret-1", key: "API_KEY", tags: ["llm"] }],
			err: null,
		});
		const tools = getChatTools("user-1", "db-1");

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
		const tools = getChatTools("user-1", "db-1");

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
		const tools = getChatTools("user-1", "db-1");

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
});
