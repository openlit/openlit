import getMessage from "@/constants/messages";
import { dataCollector } from "../common";
import {
	OPENLIT_CHAT_CONVERSATION_TABLE,
	OPENLIT_CHAT_MESSAGE_TABLE,
	OPENLIT_OTTER_RUNS_TABLE,
	OPENLIT_TRACE_ANALYSIS_TABLE,
} from "./table-details";

const m = getMessage();

export type OtterUsageItem = {
	id: string;
	usageType: "chat" | "trace_analysis" | "span_analysis" | "prompt_improvement";
	location: string;
	summary: string;
	provider: string;
	model: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
	runCount: number;
	referenceId: string;
	createdAt: string;
	updatedAt: string;
};

export type OtterUsageProviderSummary = {
	provider: string;
	model: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
	runCount: number;
};

export type OtterUsageResponse = {
	totals: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		cost: number;
		runCount: number;
	};
	chatMetrics: {
		totalConversations: number;
		totalMessages: number;
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		cost: number;
		avgTokensPerConversation: number;
		avgCostPerConversation: number;
	};
	byProviderModel: OtterUsageProviderSummary[];
	items: OtterUsageItem[];
};

function asNumber(value: unknown) {
	const numberValue = Number(value || 0);
	return Number.isFinite(numberValue) ? numberValue : 0;
}

function asString(value: unknown) {
	return typeof value === "string" ? value : String(value || "");
}

function mapChatUsageRows(rows: any[]): OtterUsageItem[] {
	return rows.map((row) => {
		const promptTokens = asNumber(row.promptTokens);
		const completionTokens = asNumber(row.completionTokens);
		const title = asString(row.title);
		return {
			id: asString(row.id),
			usageType: "chat",
			location: "Otter chat",
			summary: title || "Untitled Otter conversation",
			provider: asString(row.provider),
			model: asString(row.model),
			promptTokens,
			completionTokens,
			totalTokens: promptTokens + completionTokens,
			cost: asNumber(row.cost),
			runCount: 1,
			referenceId: asString(row.conversationId) || asString(row.id),
			createdAt: asString(row.createdAt),
			updatedAt: asString(row.updatedAt),
		};
	});
}

function mapAnalysisUsageRows(rows: any[]): OtterUsageItem[] {
	return rows.map((row) => {
		const promptTokens = asNumber(row.promptTokens);
		const completionTokens = asNumber(row.completionTokens);
		const usageType = asString(row.analysisType) === "span_analysis"
			? "span_analysis"
			: "trace_analysis";
		const referenceId = usageType === "span_analysis"
			? asString(row.selectedSpanId)
			: asString(row.rootSpanId);

		return {
			id: asString(row.id),
			usageType,
			location: usageType === "span_analysis"
				? "Individual span AI analysis"
				: "Trace hierarchy AI analysis",
			summary: asString(row.summary) || `${usageType === "span_analysis" ? "Span" : "Trace"} analysis run ${asNumber(row.runNumber)}`,
			provider: asString(row.modelProvider),
			model: asString(row.modelName),
			promptTokens,
			completionTokens,
			totalTokens: promptTokens + completionTokens,
			cost: asNumber(row.cost),
			runCount: 1,
			referenceId,
			createdAt: asString(row.createdAt),
			updatedAt: asString(row.createdAt),
		};
	});
}

function mapOtterRunRows(rows: any[]): OtterUsageItem[] {
	return rows.map((row) => {
		const promptTokens = asNumber(row.promptTokens);
		const completionTokens = asNumber(row.completionTokens);
		const targetType = asString(row.targetType);
		return {
			id: asString(row.id),
			usageType: "prompt_improvement",
			location:
				targetType === "unsaved_prompt"
					? m.CHAT_OTTER_USAGE_LOCATION_PROMPT_NEW
					: m.CHAT_OTTER_USAGE_LOCATION_PROMPT_EDIT,
			summary:
				asString(row.summary) ||
				(targetType === "unsaved_prompt"
					? m.CHAT_OTTER_USAGE_PROMPT_NEW_RUN
					: m.CHAT_OTTER_USAGE_PROMPT_EDIT_RUN),
			provider: asString(row.modelProvider),
			model: asString(row.modelName),
			promptTokens,
			completionTokens,
			totalTokens: promptTokens + completionTokens,
			cost: asNumber(row.cost),
			runCount: 1,
			referenceId: asString(row.targetId) || asString(row.id),
			createdAt: asString(row.createdAt),
			updatedAt: asString(row.createdAt),
		};
	});
}

function summarizeByProviderModel(items: OtterUsageItem[]) {
	const byKey = new Map<string, OtterUsageProviderSummary>();

	for (const item of items) {
		const key = `${item.provider || "unknown"}:${item.model || "unknown"}`;
		const current = byKey.get(key) || {
			provider: item.provider || "unknown",
			model: item.model || "unknown",
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			cost: 0,
			runCount: 0,
		};
		current.promptTokens += item.promptTokens;
		current.completionTokens += item.completionTokens;
		current.totalTokens += item.totalTokens;
		current.cost += item.cost;
		current.runCount += item.runCount;
		byKey.set(key, current);
	}

	return Array.from(byKey.values()).sort((a, b) => b.cost - a.cost);
}

export async function getOtterUsage(
	databaseConfigId?: string,
	timeLimit?: { start?: Date | string; end?: Date | string }
): Promise<{ data?: OtterUsageResponse; err?: unknown }> {
	const start = timeLimit?.start ? new Date(timeLimit.start) : undefined;
	const end = timeLimit?.end ? new Date(timeLimit.end) : undefined;
	const hasTimeLimit =
		start instanceof Date &&
		end instanceof Date &&
		Number.isFinite(start.getTime()) &&
		Number.isFinite(end.getTime());
	const timeWhere = hasTimeLimit
		? `AND created_at >= parseDateTimeBestEffort('${start!.toISOString()}') AND created_at <= parseDateTimeBestEffort('${end!.toISOString()}')`
		: "";
	const messageTimeWhere = hasTimeLimit
		? `AND m.created_at >= parseDateTimeBestEffort('${start!.toISOString()}') AND m.created_at <= parseDateTimeBestEffort('${end!.toISOString()}')`
		: "";

	const chatConversationMetricsQuery = `
		SELECT
			count() AS totalConversations,
			sum(total_messages) AS totalMessages,
			sum(total_prompt_tokens) AS promptTokens,
			sum(total_completion_tokens) AS completionTokens,
			sum(total_cost) AS cost
		FROM ${OPENLIT_CHAT_CONVERSATION_TABLE}
		WHERE conversation_type = 'chat'
			${timeWhere}
	`;

	const chatQuery = `
		SELECT
			m.id AS id,
			m.conversation_id AS conversationId,
			c.title AS title,
			if(m.provider != '', m.provider, c.provider) AS provider,
			if(m.model != '', m.model, c.model) AS model,
			m.prompt_tokens AS promptTokens,
			m.completion_tokens AS completionTokens,
			m.cost AS cost,
			m.created_at AS createdAt,
			m.created_at AS updatedAt
		FROM ${OPENLIT_CHAT_MESSAGE_TABLE} AS m
		INNER JOIN ${OPENLIT_CHAT_CONVERSATION_TABLE} AS c ON m.conversation_id = c.id
		WHERE c.conversation_type = 'chat'
			AND m.role = 'assistant'
			AND (m.prompt_tokens > 0 OR m.completion_tokens > 0 OR m.cost > 0)
			${messageTimeWhere}
		ORDER BY m.created_at DESC
		LIMIT 100
	`;

	const analysisQuery = `
		SELECT
			id,
			analysis_type AS analysisType,
			root_span_id AS rootSpanId,
			selected_span_id AS selectedSpanId,
			run_number AS runNumber,
			summary,
			model_provider AS modelProvider,
			model_name AS modelName,
			prompt_tokens AS promptTokens,
			completion_tokens AS completionTokens,
			cost,
			created_at AS createdAt
		FROM ${OPENLIT_TRACE_ANALYSIS_TABLE}
		WHERE analysis_type IN ('trace_analysis', 'span_analysis')
			AND (prompt_tokens > 0 OR completion_tokens > 0 OR cost > 0)
			${timeWhere}
		ORDER BY created_at DESC
		LIMIT 100
	`;

	const otterRunsQuery = `
		SELECT
			id,
			run_type AS runType,
			target_type AS targetType,
			target_id AS targetId,
			summary,
			model_provider AS modelProvider,
			model_name AS modelName,
			prompt_tokens AS promptTokens,
			completion_tokens AS completionTokens,
			cost,
			created_at AS createdAt
		FROM ${OPENLIT_OTTER_RUNS_TABLE}
		WHERE run_type IN ('prompt_improvement')
			AND (prompt_tokens > 0 OR completion_tokens > 0 OR cost > 0)
			${timeWhere}
		ORDER BY created_at DESC
		LIMIT 100
	`;

	const [chatMetricsResult, chatResult, analysisResult, otterRunsResult] = await Promise.allSettled([
		dataCollector({ query: chatConversationMetricsQuery }, "query", databaseConfigId),
		dataCollector({ query: chatQuery }, "query", databaseConfigId),
		dataCollector({ query: analysisQuery }, "query", databaseConfigId),
		dataCollector({ query: otterRunsQuery }, "query", databaseConfigId),
	]);

	const chatMetricsRow =
		chatMetricsResult.status === "fulfilled" && !chatMetricsResult.value.err
			? ((chatMetricsResult.value.data as any[]) || [])[0] || {}
			: {};
	const chatRows =
		chatResult.status === "fulfilled" && !chatResult.value.err
			? (chatResult.value.data as any[]) || []
			: [];
	const analysisRows =
		analysisResult.status === "fulfilled" && !analysisResult.value.err
			? (analysisResult.value.data as any[]) || []
			: [];
	const otterRunRows =
		otterRunsResult.status === "fulfilled" && !otterRunsResult.value.err
			? (otterRunsResult.value.data as any[]) || []
			: [];

	const items = [
		...mapChatUsageRows(chatRows),
		...mapAnalysisUsageRows(analysisRows),
		...mapOtterRunRows(otterRunRows),
	].sort((a, b) => {
		const aTime = new Date(a.updatedAt || a.createdAt).getTime();
		const bTime = new Date(b.updatedAt || b.createdAt).getTime();
		return bTime - aTime;
	});

	const totals = items.reduce(
		(acc, item) => ({
			promptTokens: acc.promptTokens + item.promptTokens,
			completionTokens: acc.completionTokens + item.completionTokens,
			totalTokens: acc.totalTokens + item.totalTokens,
			cost: acc.cost + item.cost,
			runCount: acc.runCount + item.runCount,
		}),
		{ promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, runCount: 0 }
	);
	const chatPromptTokens = asNumber(chatMetricsRow.promptTokens);
	const chatCompletionTokens = asNumber(chatMetricsRow.completionTokens);
	const totalConversations = asNumber(chatMetricsRow.totalConversations);
	const chatMetrics = {
		totalConversations,
		totalMessages: asNumber(chatMetricsRow.totalMessages),
		promptTokens: chatPromptTokens,
		completionTokens: chatCompletionTokens,
		totalTokens: chatPromptTokens + chatCompletionTokens,
		cost: asNumber(chatMetricsRow.cost),
		avgTokensPerConversation:
			totalConversations > 0
				? (chatPromptTokens + chatCompletionTokens) / totalConversations
				: 0,
		avgCostPerConversation:
			totalConversations > 0 ? asNumber(chatMetricsRow.cost) / totalConversations : 0,
	};

	return {
		data: {
			totals,
			chatMetrics,
			byProviderModel: summarizeByProviderModel(items),
			items,
		},
	};
}
