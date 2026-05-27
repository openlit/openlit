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
	getPromptByName,
	getPromptDetails,
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
} from "@/lib/platform/providers/models-service";
import {
	getTraceImprovement,
	streamTraceImprovementAnalysis,
	TraceAnalysisRun,
} from "./improvement";
import { TRACE_ANALYSIS_DIMENSIONS } from "@/types/trace-analysis";
import { dataCollector } from "../common";
import Sanitizer from "@/utils/sanitizer";

type OtterTraceAnalysisScope = "trace" | "span";

function parseTraceAnalysisJson(run: TraceAnalysisRun) {
	try {
		return JSON.parse(run.analysisJson || "{}");
	} catch {
		return {};
	}
}

function summarizeTraceAnalysisRun(run: TraceAnalysisRun) {
	const analysis = parseTraceAnalysisJson(run);
	const dimensionCounts = Object.fromEntries(
		TRACE_ANALYSIS_DIMENSIONS.map((dimension) => [
			dimension,
			Array.isArray(analysis[dimension]) ? analysis[dimension].length : 0,
		])
	);

	return {
		runId: run.id,
		runNumber: run.runNumber,
		traceId: analysis.trace_id || analysis.traceId || "",
		rootSpanId: run.rootSpanId,
		selectedSpanId: run.selectedSpanId,
		analysisType: run.analysisType,
		summary: run.summary || analysis.summary || "",
		totals: analysis.totals || {},
		dimensionCounts,
		provider: run.modelProvider,
		model: run.modelName,
		promptTokens: run.promptTokens,
		completionTokens: run.completionTokens,
		cost: run.cost,
		worstSeverity: run.worstSeverity,
		createdAt: run.createdAt,
	};
}

function traceRefsBlock(
	refs: Array<{ type: "trace" | "span"; id?: string; spanId?: string; label?: string }>
) {
	const normalized = refs
		.filter((ref) => ref.id)
		.map((ref) => ({
			type: ref.type,
			id: ref.id,
			...(ref.spanId ? { spanId: ref.spanId } : {}),
			...(ref.label ? { label: ref.label } : {}),
		}));
	if (!normalized.length) return "";
	return `\n\n\`\`\`trace-refs\n${JSON.stringify(normalized, null, 2)}\n\`\`\``;
}

function traceAnalysisDetails(analysis: ReturnType<typeof summarizeTraceAnalysisRun>) {
	const refs = [
		analysis.traceId
			? {
				type: "trace" as const,
				id: analysis.traceId,
				spanId: analysis.rootSpanId,
				label: `trace:${String(analysis.traceId).slice(0, 10)}`,
			}
			: null,
		analysis.selectedSpanId
			? {
				type: "span" as const,
				id: analysis.selectedSpanId,
				label: `span:${String(analysis.selectedSpanId).slice(0, 8)}`,
			}
			: null,
	].filter(Boolean) as Array<{ type: "trace" | "span"; id: string; spanId?: string; label: string }>;
	return `${analysis.summary || "Analysis is available."}${traceRefsBlock(refs)}`;
}

async function readTraceAnalysisStream(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Trace analysis stream did not return a body");

	const decoder = new TextDecoder();
	let buffer = "";
	let doneData: any;

	const readLine = (line: string) => {
		if (!line.trim()) return;
		const event = JSON.parse(line);
		if (event.type === "error") {
			throw new Error(event.error || "Trace analysis failed");
		}
		if (event.type === "done") {
			doneData = event.data;
		}
	};

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";
		for (const line of lines) readLine(line);
	}

	buffer += decoder.decode();
	if (buffer.trim()) readLine(buffer);

	if (!doneData) throw new Error("Trace analysis finished without a result");
	return doneData as { rootSpanId: string; runs: TraceAnalysisRun[] };
}

async function runTraceAnalysisTool(
	spanId: string,
	scope: OtterTraceAnalysisScope,
	rerun: boolean,
	databaseConfigId: string
) {
	if (!rerun) {
		const existing = await getTraceImprovement(spanId, databaseConfigId, scope);
		if (existing.err) return { success: false, error: String(existing.err) };
		const latest = existing.data?.runs?.at(-1);
		if (latest) {
			return {
				success: true,
				existing: true,
				message: scope === "span" ? "Existing span analysis found" : "Existing trace analysis found",
				analysis: summarizeTraceAnalysisRun(latest),
				details: traceAnalysisDetails(summarizeTraceAnalysisRun(latest)),
			};
		}
	}

	const { response, err } = await streamTraceImprovementAnalysis(spanId, databaseConfigId, scope);
	if (err || !response) {
		return { success: false, error: String(err || "Failed to start trace analysis") };
	}

	const data = await readTraceAnalysisStream(response);
	const latest = data.runs.at(-1);
	if (!latest) {
		return { success: false, error: "Trace analysis completed without a saved run" };
	}

	return {
		success: true,
		existing: false,
		message: scope === "span" ? "Span analysis completed" : "Trace hierarchy analysis completed",
		analysis: summarizeTraceAnalysisRun(latest),
		details: traceAnalysisDetails(summarizeTraceAnalysisRun(latest)),
	};
}

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
			description: "Update/save/apply changes to an existing prompt version, or create a new version of an existing prompt. Use this only when the user explicitly asks to save, update, apply, publish, or create a version. Do not use it for review-only requests such as 'help me improve this prompt'.",
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

		get_prompt: tool<any, any>({
			description: "Read a Prompt Hub prompt by exact prompt name or prompt ID, including the current prompt content. Use this for review-only prompt improvement requests before suggesting changes. This tool does not modify prompts.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					name: { type: "string", description: "Exact prompt name, for example music_recommend" },
					prompt_id: { type: "string", description: "Prompt ID (UUID)" },
					version: { type: "string", description: "Optional version string, for example 1.0.0" },
				},
			}) as any,
			execute: async (params: any) => {
				try {
					let promptId = params.prompt_id;
					if (!promptId && params.name) {
						const prompt = await getPromptByName({ name: params.name });
						promptId = prompt?.id;
					}
					if (!promptId) {
						return {
							success: false,
							error: params.name
								? `Prompt "${params.name}" was not found`
								: "Prompt name or prompt ID is required",
						};
					}

					const { data, err } = await getPromptDetails(promptId, params.version ? { version: params.version } : undefined);
					if (err) return { success: false, error: String(err) };
					const prompt = (data as any[])?.[0];
					if (!prompt) return { success: false, error: "Prompt was not found" };

					return {
						success: true,
						message: "Prompt loaded",
						prompt: {
							id: prompt.promptId,
							versionId: prompt.versionId,
							name: prompt.name,
							version: prompt.version,
							status: prompt.status,
							tags: prompt.tags,
							content: prompt.prompt,
						},
						details: `Name: "${prompt.name}" | Version: ${prompt.version || "unknown"} | Status: ${prompt.status || "unknown"}\n\n${prompt.prompt || ""}`,
					};
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to load prompt" };
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

		// ==================== TRACE ANALYSIS ====================

		analyze_trace: tool<any, any>({
			description: "Run or retrieve Otter AI analysis for a trace hierarchy or a single span. Use this when the user asks to analyze, improve, review, or post-mortem a span or trace.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					span_id: { type: "string", description: "Span ID to analyze. For hierarchy analysis this can be any span in the trace." },
					scope: { type: "string", enum: ["trace", "span"], description: "Use trace for full hierarchy analysis, span for the selected span only." },
					rerun: { type: "boolean", description: "Set true only when the user explicitly asks to run a new analysis instead of using an existing run." },
				},
				required: ["span_id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const scope: OtterTraceAnalysisScope = params.scope === "span" ? "span" : "trace";
					return await runTraceAnalysisTool(
						params.span_id,
						scope,
						Boolean(params.rerun),
						databaseConfigId
					);
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to run trace analysis" };
				}
			},
		}),

		get_trace_analysis: tool<any, any>({
			description: "Get saved Otter AI analysis runs for a trace hierarchy or a single span without creating a new run.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					span_id: { type: "string", description: "Span ID to look up." },
					scope: { type: "string", enum: ["trace", "span"], description: "Use trace for full hierarchy analysis, span for selected span analysis." },
				},
				required: ["span_id"],
			}) as any,
			execute: async (params: any) => {
				try {
					const scope: OtterTraceAnalysisScope = params.scope === "span" ? "span" : "trace";
					const { data, err } = await getTraceImprovement(params.span_id, databaseConfigId, scope);
					if (err) return { success: false, error: String(err) };
					const runs = data?.runs || [];
					return {
						success: true,
						rootSpanId: data?.rootSpanId || "",
						count: runs.length,
						latest: runs.length ? summarizeTraceAnalysisRun(runs[runs.length - 1]) : null,
						runs: runs.map(summarizeTraceAnalysisRun),
					};
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to get trace analysis" };
				}
			},
		}),

		analyze_trace_batch: tool<any, any>({
			description: "Run or retrieve Otter AI analysis for a bounded set of trace or span IDs. Use this for grouped workflows after identifying representative span IDs from filters or group-by queries.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					span_ids: {
						type: "array",
						items: { type: "string" },
						description: "Span IDs to analyze. The tool processes up to 5 IDs per call.",
					},
					scope: { type: "string", enum: ["trace", "span"], description: "Use trace for hierarchy analysis, span for individual span analysis." },
					rerun: { type: "boolean", description: "Set true only when the user explicitly asks for new analysis runs." },
					group_label: { type: "string", description: "Optional label describing the filter or group represented by these spans." },
				},
				required: ["span_ids"],
			}) as any,
			execute: async (params: any) => {
				try {
					const spanIds = Array.isArray(params.span_ids)
						? params.span_ids.filter(Boolean).slice(0, 5)
						: [];
					if (!spanIds.length) {
						return { success: false, error: "No span IDs were provided for batch analysis" };
					}
					const scope: OtterTraceAnalysisScope = params.scope === "span" ? "span" : "trace";
					const results = [];
					for (const spanId of spanIds) {
						results.push(
							await runTraceAnalysisTool(
								spanId,
								scope,
								Boolean(params.rerun),
								databaseConfigId
							)
						);
					}
					return {
						success: results.every((result) => result.success),
						groupLabel: params.group_label || "",
						processed: results.length,
						limitApplied: Array.isArray(params.span_ids) && params.span_ids.length > spanIds.length,
						results,
					};
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to run batch trace analysis" };
				}
			},
		}),

		analyze_traces_by_attribute: tool<any, any>({
			description: "Find traces by a SpanAttributes key/value pair, then run or retrieve Otter trace analysis for the matched trace hierarchies. Use this for requests like analyzing traces with session.id, user.id, conversation.id, tenant, environment, or any custom span attribute.",
			inputSchema: jsonSchema({
				type: "object" as const,
				properties: {
					attribute_key: { type: "string", description: "SpanAttributes key, for example session.id or user.id." },
					attribute_value: { type: "string", description: "Exact SpanAttributes value to match." },
					limit: { type: "number", description: "Maximum trace hierarchies to analyze. Default 3, maximum 5." },
					rerun: { type: "boolean", description: "Set true only when the user explicitly asks for new analysis runs." },
				},
				required: ["attribute_key", "attribute_value"],
			}) as any,
			execute: async (params: any) => {
				try {
					const attributeKey = Sanitizer.sanitizeValue(String(params.attribute_key || "").trim());
					const attributeValue = Sanitizer.sanitizeValue(String(params.attribute_value || "").trim());
					const limit = Math.max(1, Math.min(Number(params.limit) || 3, 5));
					if (!attributeKey || !attributeValue) {
						return { success: false, error: "Attribute key and value are required" };
					}

					const query = `
						SELECT
							TraceId AS traceId,
							any(SpanId) AS spanId,
							count() AS spanCount,
							max(Timestamp) AS lastSeen
						FROM otel_traces
						WHERE SpanAttributes['${attributeKey}'] = '${attributeValue}'
						GROUP BY TraceId
						ORDER BY lastSeen DESC
						LIMIT ${limit}
					`;
					const { data, err } = await dataCollector(
						{ query, enable_readonly: true },
						"query",
						databaseConfigId
					);
					if (err) return { success: false, error: String(err) };
					const matches = ((data as any[]) || []).filter((row) => row.spanId);
					if (!matches.length) {
						return {
							success: false,
							error: `No traces found where SpanAttributes['${attributeKey}'] matches the provided value`,
						};
					}

					const results = [];
					for (const match of matches) {
						results.push({
							traceId: match.traceId,
							spanId: match.spanId,
							spanCount: Number(match.spanCount) || 0,
							analysis: await runTraceAnalysisTool(
								match.spanId,
								"trace",
								Boolean(params.rerun),
								databaseConfigId
							),
						});
					}

					return {
						success: results.every((result) => result.analysis.success),
						message: "Trace attribute analysis completed",
						details: results
							.map((result) => {
								const summary = result.analysis?.analysis?.summary || result.analysis?.error || "";
								return `Trace ${result.traceId} / span ${result.spanId}: ${summary}`;
							})
							.join("\n") +
							traceRefsBlock(
								results.flatMap((result) => [
									{
										type: "trace" as const,
										id: String(result.traceId || ""),
										spanId: String(result.spanId || ""),
										label: `trace:${String(result.traceId || "").slice(0, 10)}`,
									},
									{
										type: "span" as const,
										id: String(result.spanId || ""),
										label: `span:${String(result.spanId || "").slice(0, 8)}`,
									},
								])
							),
						attributeKey,
						matchedTraceCount: matches.length,
						results,
					};
				} catch (e: any) {
					return { success: false, error: e.message || "Failed to analyze traces by attribute" };
				}
			},
		}),

	};
}
