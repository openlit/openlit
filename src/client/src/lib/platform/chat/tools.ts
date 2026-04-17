import { tool, jsonSchema } from "ai";
import {
	createRule,
	updateRule,
	deleteRule,
	getRules,
	getRuleById,
	addConditionGroupsToRule,
	addRuleEntity,
	deleteRuleEntity,
	getRuleEntities,
} from "../rule-engine";
import {
	createContext,
	updateContext,
	deleteContext,
	getContexts,
} from "../context";
import {
	createPrompt,
	getPrompts,
	deletePrompt,
} from "../prompt";
import { upsertPromptVersion } from "../prompt/version";
import { upsertSecret, deleteSecret, getSecrets } from "../vault";
import {
	createCustomModel,
	updateCustomModel,
	deleteCustomModel,
	getCustomModels,
} from "../openground/custom-models-service";

/**
 * Normalize a vault key name to UPPER_SNAKE_CASE.
 */
function normalizeVaultKey(key: string): string {
	return key
		.trim()
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.replace(/[\s\-\.]+/g, "_")
		.replace(/[^a-zA-Z0-9_]/g, "")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.toUpperCase();
}

export function getChatTools(userId: string, databaseConfigId: string) {
	return {
		// ==================== RULE ENGINE ====================

		create_rule: tool<any, any>({
			description: "Create a new rule in the Rule Engine with optional conditions.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					name: { type: "string", description: "Rule name" },
					description: { type: "string" },
					group_operator: { type: "string", enum: ["AND", "OR"] },
					status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
					condition_groups: {
						type: "array",
						items: {
							type: "object",
							properties: {
								condition_operator: { type: "string", enum: ["AND", "OR"] },
								conditions: {
									type: "array",
									items: {
										type: "object",
										properties: {
											field: { type: "string" },
											operator: { type: "string", enum: ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "gt", "gte", "lt", "lte"] },
											value: { type: "string" },
											data_type: { type: "string", enum: ["string", "number", "boolean"] },
										},
										required: ["field", "operator", "value"],
									},
								},
							},
							required: ["conditions"],
						},
					},
				},
				required: ["name"],
			}) as any,
			execute: async (params: any) => {
				try {
					const result = await createRule({
						name: params.name,
						description: params.description || "",
						group_operator: params.group_operator || "AND",
						status: params.status || "ACTIVE",
					});
					const ruleId = (result as any)?.id;
					if (ruleId && params.condition_groups?.length > 0) {
						await addConditionGroupsToRule(ruleId, params.condition_groups);
					}
					return { success: true, message: "Rule created", details: `Name: "${params.name}" | ID: ${ruleId} | Status: ${params.status || "ACTIVE"} | Conditions: ${params.condition_groups?.length || 0} groups` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to create rule" };
				}
			},
		}),

		update_rule: tool<any, any>({
			description: "Update an existing rule's name, description, status, or operator.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					id: { type: "string", description: "Rule ID (UUID)" },
					name: { type: "string" },
					description: { type: "string" },
					group_operator: { type: "string", enum: ["AND", "OR"] },
					status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
				},
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					await updateRule(params.id, {
						name: params.name,
						description: params.description,
						group_operator: params.group_operator,
						status: params.status,
					});
					return { success: true, message: "Rule updated", details: `ID: ${params.id}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to update rule" };
				}
			},
		}),

		delete_rule: tool<any, any>({
			description: "Delete a rule and all its conditions and entity links.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: { id: { type: "string", description: "Rule ID (UUID)" } },
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const [err] = await deleteRule(params.id);
					if (err) return { success: false, error: err };
					return { success: true, message: "Rule deleted", details: `ID: ${params.id}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to delete rule" };
				}
			},
		}),

		list_rules: tool<any, any>({
			description: "List all rules in the Rule Engine.",
			inputSchema: jsonSchema({ type: "object" as const, properties: {} }) as any,
			execute: async () => {
				try {
					const { data, err } = await getRules();
					if (err) return { success: false, error: String(err) };
					const rules = (data as any[]) || [];
					return { success: true, count: rules.length, rules: rules.map((r: any) => ({ id: r.id, name: r.name, status: r.status, description: r.description })) };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		get_rule: tool<any, any>({
			description: "Get a rule's details including its condition groups and conditions.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: { id: { type: "string", description: "Rule ID (UUID)" } },
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const result = await getRuleById(params.id);
					if ((result as any).err) return { success: false, error: (result as any).err };
					return { success: true, rule: (result as any).data };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		link_entity_to_rule: tool<any, any>({
			description: "Link a context, prompt, or evaluation type to a rule. This associates the entity so it is used when the rule matches.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					rule_id: { type: "string", description: "Rule ID (UUID)" },
					entity_type: { type: "string", enum: ["context", "prompt", "evaluation"], description: "Type of entity to link" },
					entity_id: { type: "string", description: "Entity ID (UUID)" },
				},
				required: ["rule_id", "entity_type", "entity_id"],
			}) as any,
			execute: async (params: any) => {
				try {
					await addRuleEntity({
						rule_id: params.rule_id,
						entity_type: params.entity_type,
						entity_id: params.entity_id,
					});
					return { success: true, message: `${params.entity_type} linked to rule`, details: `Rule: ${params.rule_id} → ${params.entity_type}: ${params.entity_id}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to link entity" };
				}
			},
		}),

		unlink_entity_from_rule: tool<any, any>({
			description: "Remove the link between an entity and a rule.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: { id: { type: "string", description: "Rule entity link ID (UUID)" } },
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const [err] = await deleteRuleEntity(params.id);
					if (err) return { success: false, error: err };
					return { success: true, message: "Entity unlinked from rule" };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		list_rule_entities: tool<any, any>({
			description: "List entities (contexts, prompts, evaluations) linked to a rule.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					rule_id: { type: "string", description: "Rule ID to filter by" },
					entity_type: { type: "string", enum: ["context", "prompt", "evaluation"] },
				},
			}) as any,
			execute: async (params: any) => {
				try {
					const { data, err } = await getRuleEntities(params);
					if (err) return { success: false, error: String(err) };
					return { success: true, entities: data };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		// ==================== CONTEXT ====================

		create_context: tool<any, any>({
			description: "Create a new context document for rule-based evaluations.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					name: { type: "string", description: "Context name" },
					content: { type: "string", description: "Context content/body text" },
					description: { type: "string" },
					tags: { type: "array", items: { type: "string" } },
					status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
				},
				required: ["name", "content"],
			}) as any,
			execute: async (params: any) => {
				try {
					const result = await createContext({
						name: params.name,
						content: params.content,
						description: params.description || "",
						tags: JSON.stringify(params.tags || []),
						status: params.status || "ACTIVE",
					});
					return { success: true, message: "Context created", details: `Name: "${params.name}" | ID: ${(result as any)?.id} | Status: ${params.status || "ACTIVE"}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to create context" };
				}
			},
		}),

		update_context: tool<any, any>({
			description: "Update an existing context's name, content, description, tags, or status.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					id: { type: "string", description: "Context ID (UUID)" },
					name: { type: "string" },
					content: { type: "string" },
					description: { type: "string" },
					tags: { type: "array", items: { type: "string" } },
					status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
				},
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const updateData: any = {};
					if (params.name) updateData.name = params.name;
					if (params.content) updateData.content = params.content;
					if (params.description !== undefined) updateData.description = params.description;
					if (params.tags) updateData.tags = JSON.stringify(params.tags);
					if (params.status) updateData.status = params.status;
					await updateContext(params.id, updateData);
					return { success: true, message: "Context updated", details: `ID: ${params.id}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to update context" };
				}
			},
		}),

		delete_context: tool<any, any>({
			description: "Delete a context document.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: { id: { type: "string", description: "Context ID (UUID)" } },
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const [err] = await deleteContext(params.id);
					if (err) return { success: false, error: err };
					return { success: true, message: "Context deleted" };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		list_contexts: tool<any, any>({
			description: "List all context documents.",
			inputSchema: jsonSchema({ type: "object" as const, properties: {} }) as any,
			execute: async () => {
				try {
					const { data, err } = await getContexts();
					if (err) return { success: false, error: String(err) };
					const contexts = (data as any[]) || [];
					return { success: true, count: contexts.length, contexts: contexts.map((c: any) => ({ id: c.id, name: c.name, status: c.status, description: c.description })) };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		// ==================== PROMPTS ====================

		create_prompt: tool<any, any>({
			description: "Create a new versioned prompt in the Prompt Hub. Supports {{variableName}} for dynamic variables.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					name: { type: "string", description: "Unique prompt name" },
					prompt: { type: "string", description: "Prompt content. Use {{variableName}} for variables." },
					version: { type: "string", description: "Version e.g. 1.0.0" },
					status: { type: "string", enum: ["PUBLISHED", "DRAFT"] },
					tags: { type: "array", items: { type: "string" } },
				},
				required: ["name", "prompt"],
			}) as any,
			execute: async (params: any) => {
				try {
					const result = await createPrompt({
						name: params.name,
						prompt: params.prompt,
						version: params.version || "1.0.0",
						status: params.status || "DRAFT",
						tags: params.tags || [],
						metaProperties: {},
					});
					return { success: true, message: "Prompt created", details: `Name: "${params.name}" | Version: ${params.version || "1.0.0"} | Status: ${params.status || "DRAFT"} | ID: ${(result as any)?.data?.promptId}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to create prompt" };
				}
			},
		}),

		update_prompt_version: tool<any, any>({
			description: "Update an existing prompt version or create a new version of an existing prompt.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					prompt_id: { type: "string", description: "Prompt ID (UUID)" },
					version_id: { type: "string", description: "Version ID to update (omit to create new version)" },
					prompt: { type: "string", description: "Updated prompt content" },
					version: { type: "string", description: "Version string e.g. 2.0.0" },
					status: { type: "string", enum: ["PUBLISHED", "DRAFT"] },
					tags: { type: "array", items: { type: "string" } },
				},
				required: ["prompt_id"],
			}) as any,
			execute: async (params: any) => {
				try {
					await upsertPromptVersion({
						promptId: params.prompt_id,
						versionId: params.version_id,
						prompt: params.prompt,
						version: params.version,
						status: params.status,
						tags: params.tags,
						metaProperties: {},
					});
					return { success: true, message: params.version_id ? "Prompt version updated" : "New prompt version created", details: `Prompt: ${params.prompt_id} | Version: ${params.version || "latest"}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to update prompt" };
				}
			},
		}),

		delete_prompt: tool<any, any>({
			description: "Delete a prompt and all its versions.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: { id: { type: "string", description: "Prompt ID (UUID)" } },
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const [err] = await deletePrompt(params.id);
					if (err) return { success: false, error: err };
					return { success: true, message: "Prompt deleted" };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		list_prompts: tool<any, any>({
			description: "List all prompts in the Prompt Hub.",
			inputSchema: jsonSchema({ type: "object" as const, properties: {} }) as any,
			execute: async () => {
				try {
					const { data, err } = await getPrompts();
					if (err) return { success: false, error: String(err) };
					const prompts = (data as any[]) || [];
					return { success: true, count: prompts.length, prompts: prompts.map((p: any) => ({ id: p.id, name: p.name, totalVersions: p.totalVersions, latestVersion: p.latestVersion })) };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		// ==================== VAULT ====================

		create_vault_secret: tool<any, any>({
			description: "Store a new API key or credential in the Vault. Key name is auto-normalized to UPPER_SNAKE_CASE.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					key: { type: "string", description: "Secret name (auto-converted to UPPER_SNAKE_CASE)" },
					value: { type: "string", description: "Secret value (e.g. API key)" },
					tags: { type: "array", items: { type: "string" } },
				},
				required: ["key", "value"],
			}) as any,
			execute: async (params: any) => {
				try {
					const normalizedKey = normalizeVaultKey(params.key);
					await upsertSecret({ key: normalizedKey, value: params.value, tags: params.tags || [] });
					return { success: true, message: "Secret stored in Vault", details: `Key: "${normalizedKey}" | Tags: ${(params.tags || []).join(", ") || "none"}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to create secret" };
				}
			},
		}),

		update_vault_secret: tool<any, any>({
			description: "Update an existing vault secret's key, value, or tags.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					id: { type: "string", description: "Secret ID (UUID)" },
					key: { type: "string", description: "New key name (auto-converted to UPPER_SNAKE_CASE)" },
					value: { type: "string", description: "New secret value" },
					tags: { type: "array", items: { type: "string" } },
				},
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const updateData: any = { id: params.id };
					if (params.key) updateData.key = normalizeVaultKey(params.key);
					if (params.value) updateData.value = params.value;
					if (params.tags) updateData.tags = params.tags;
					await upsertSecret(updateData);
					return { success: true, message: "Secret updated", details: `ID: ${params.id}` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to update secret" };
				}
			},
		}),

		delete_vault_secret: tool<any, any>({
			description: "Delete a secret from the Vault.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: { id: { type: "string", description: "Secret ID (UUID)" } },
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const [err] = await deleteSecret(params.id);
					if (err) return { success: false, error: err };
					return { success: true, message: "Secret deleted" };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		list_vault_secrets: tool<any, any>({
			description: "List all secrets in the Vault (values are hidden).",
			inputSchema: jsonSchema({ type: "object" as const, properties: {} }) as any,
			execute: async () => {
				try {
					const { data, err } = await getSecrets({});
					if (err) return { success: false, error: String(err) };
					const secrets = (data as any[]) || [];
					return { success: true, count: secrets.length, secrets: secrets.map((s: any) => ({ id: s.id, key: s.key, tags: s.tags, created_at: s.created_at })) };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		// ==================== CUSTOM MODELS ====================

		create_custom_model: tool<any, any>({
			description: "Register a custom model with pricing for a provider.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					provider: { type: "string", description: "Provider ID: openai, anthropic, google, mistral, cohere, groq, etc." },
					model_id: { type: "string", description: "Model API identifier e.g. gpt-4o-mini" },
					display_name: { type: "string", description: "Human-readable name" },
					model_type: { type: "string", enum: ["chat", "embeddings", "images", "audio"], description: "Type of model. Default: chat" },
					context_window: { type: "number" },
					input_price_per_m_tokens: { type: "number", description: "USD per million input tokens" },
					output_price_per_m_tokens: { type: "number", description: "USD per million output tokens" },
					capabilities: { type: "array", items: { type: "string" } },
				},
				required: ["provider", "model_id", "display_name"],
			}) as any,
			execute: async (params: any) => {
				try {
					const { data, err } = await createCustomModel(userId, databaseConfigId, {
						provider: params.provider,
						model_id: params.model_id,
						displayName: params.display_name,
						modelType: params.model_type || "chat",
						contextWindow: params.context_window || 4096,
						inputPricePerMToken: params.input_price_per_m_tokens || 0,
						outputPricePerMToken: params.output_price_per_m_tokens || 0,
						capabilities: params.capabilities || [],
					});
					if (err) return { success: false, error: err };
					const modelId = (data as any)?.id || "";
					return { success: true, message: "Custom model registered", id: modelId, details: `Name: "${params.display_name}" | Model ID: ${params.model_id} | Provider: ${params.provider} | Type: ${params.model_type || "chat"} | Context: ${params.context_window || 4096} | Input: $${params.input_price_per_m_tokens || 0}/M | Output: $${params.output_price_per_m_tokens || 0}/M` };
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to create model" };
				}
			},
		}),

		update_custom_model: tool<any, any>({
			description: "Update a custom model's display name, pricing, context window, or capabilities.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					id: { type: "string", description: "Custom model ID (UUID)" },
					display_name: { type: "string" },
					context_window: { type: "number" },
					input_price_per_m_tokens: { type: "number" },
					output_price_per_m_tokens: { type: "number" },
					capabilities: { type: "array", items: { type: "string" } },
				},
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const updateData: any = {};
					if (params.display_name) updateData.displayName = params.display_name;
					if (params.context_window) updateData.contextWindow = params.context_window;
					if (params.input_price_per_m_tokens !== undefined) updateData.inputPricePerMToken = params.input_price_per_m_tokens;
					if (params.output_price_per_m_tokens !== undefined) updateData.outputPricePerMToken = params.output_price_per_m_tokens;
					if (params.capabilities) updateData.capabilities = params.capabilities;
					const { err } = await updateCustomModel(userId, databaseConfigId, params.id, updateData);
					if (err) return { success: false, error: err };
					return { success: true, message: "Model updated", id: params.id, details: `Name: "${params.display_name || "model"}" | ID: ${params.id}` };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		delete_custom_model: tool<any, any>({
			description: "Delete a custom model.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: { id: { type: "string", description: "Custom model ID (UUID)" } },
				required: ["id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const { err } = await deleteCustomModel(userId, databaseConfigId, params.id);
					if (err) return { success: false, error: err };
					return { success: true, message: "Model deleted" };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

		list_custom_models: tool<any, any>({
			description: "List all custom models, optionally filtered by provider.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					provider: { type: "string", description: "Filter by provider ID (optional)" },
				},
			}) as any,
			execute: async (params: any) => {
				try {
					const { data, err } = await getCustomModels(userId, databaseConfigId, params.provider);
					if (err) return { success: false, error: err };
					const models = (data as any[]) || [];
					return { success: true, count: models.length, models: models.map((m: any) => ({ id: m.id, model_id: m.model_id, provider: m.provider, displayName: m.displayName })) };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		}),

	};
}
