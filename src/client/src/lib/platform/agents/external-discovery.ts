/**
 * Adapter-backed agent discovery for when raw traces live in an external
 * telemetry source (Datadog, Tempo, Jaeger, …). Controllers / derived tables
 * still live in OpenLIT ClickHouse; only the otel_traces reads move here.
 */

import type {
	DataSourceAdapter,
	DiscoveredService,
	NormalizedSpan,
	QueryTimeRange,
	ServiceRollup,
} from "@/lib/platform/datasource/types";
import type {
	AgentRuntimeConfig,
	AgentSnapshot,
	AgentTool,
	CodingAgentVendor,
} from "@/types/agents";
import { computeAgentKey } from "./agent-key";
import { fingerprint } from "./snapshot";
import { mergeProviders } from "./provider-normalize";

export interface SdkDiscoveryRow {
	service_name: string;
	environment: string;
	cluster_id: string;
	workload_key: string;
	sdk_version: string;
	sdk_language: string;
	first_seen: string;
	last_seen: string;
}

export interface CodingDiscoveryRow {
	vendor: CodingAgentVendor;
	client_version: string;
	first_seen: string;
	last_seen: string;
	session_count_24h: number;
	cost_usd_24h: number;
	active_users_24h: number;
	lines_added_24h: number;
	lines_removed_24h: number;
	lines_accepted_24h: number;
	lines_rejected_24h: number;
	edit_accept_24h: number;
	edit_reject_24h: number;
	commit_count_24h: number;
	pr_count_24h: number;
}

function windowHours(hours: number): QueryTimeRange {
	const end = new Date();
	const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
	return { start, end };
}

function isCodingService(svc: DiscoveredService): boolean {
	const sdk = (svc.sdkName || "").toLowerCase();
	const name = (svc.serviceName || "").toLowerCase();
	if (sdk === "openlit-cli") return true;
	if (["cursor", "claude-code", "codex", "windsurf"].includes(name)) return true;
	return false;
}

/** Map adapter discoverServices() into the SDK discovery row shape. */
export async function discoverSdkRowsFromAdapter(
	adapter: DataSourceAdapter,
	lookbackMinutes = 30
): Promise<SdkDiscoveryRow[]> {
	const range: QueryTimeRange = {
		start: new Date(Date.now() - Math.max(lookbackMinutes, 30) * 60 * 1000),
		end: new Date(),
	};
	let services: DiscoveredService[] = [];
	try {
		services = await adapter.discoverServices(range);
	} catch {
		return [];
	}
	return services
		.filter((s) => s.serviceName && !isCodingService(s))
		.map((s) => ({
			service_name: s.serviceName,
			environment: s.environment || "default",
			cluster_id: s.clusterId || "default",
			workload_key: s.workloadKey || "",
			sdk_version: s.sdkVersion || "",
			sdk_language: s.sdkLanguage || "",
			first_seen: s.firstSeen || new Date().toISOString(),
			last_seen: s.lastSeen || new Date().toISOString(),
		}));
}

/**
 * Best-effort coding-agent discovery from sampled spans. Full ClickHouse
 * coding rollups (lines/edits/commits) degrade to session count + cost when
 * the vendor cannot express the rich GROUP BY.
 */
export async function discoverCodingRowsFromAdapter(
	adapter: DataSourceAdapter
): Promise<CodingDiscoveryRow[]> {
	const range = windowHours(24);
	let spans: NormalizedSpan[] = [];
	try {
		spans = await adapter.sampleTracesForGraph(
			{
				signal: "traces",
				timeRange: range,
				aiSelector: true,
				limit: 200,
			},
			50
		);
	} catch {
		try {
			const frame = await adapter.listSpans({
				signal: "traces",
				timeRange: range,
				aiSelector: true,
				limit: 500,
			});
			spans = frame.rows;
		} catch {
			return [];
		}
	}

	type Acc = {
		vendor: string;
		client_version: string;
		first_seen: string;
		last_seen: string;
		sessions: Set<string>;
		users: Set<string>;
		cost: number;
	};
	const byVendor = new Map<string, Acc>();

	for (const span of spans) {
		const vendor =
			span.spanAttributes["coding_agent.client"] ||
			span.resourceAttributes["coding_agent.client"] ||
			(span.resourceAttributes["service.name"] === "claude-code"
				? "claude-code"
				: "") ||
			(span.serviceName === "cursor" ? "cursor" : "");
		if (!vendor) continue;
		const session =
			span.spanAttributes["coding_agent.session.id"] ||
			span.resourceAttributes["coding_agent.session.id"] ||
			span.spanAttributes["session.id"] ||
			span.resourceAttributes["session.id"] ||
			"";
		let acc = byVendor.get(vendor);
		if (!acc) {
			acc = {
				vendor,
				client_version:
					span.spanAttributes["coding_agent.client.version"] ||
					span.resourceAttributes["coding_agent.hook.cli.version"] ||
					"",
				first_seen: span.timestamp,
				last_seen: span.timestamp,
				sessions: new Set(),
				users: new Set(),
				cost: 0,
			};
			byVendor.set(vendor, acc);
		}
		if (session) acc.sessions.add(session);
		const user =
			span.spanAttributes["gen_ai.user.name"] ||
			span.resourceAttributes["gen_ai.user.name"] ||
			"";
		if (user) acc.users.add(user);
		const cost = Number(
			span.spanAttributes["gen_ai.usage.cost"] ||
				span.spanAttributes["coding_agent.session.cost_usd"] ||
				0
		);
		if (Number.isFinite(cost)) acc.cost += cost;
		if (span.timestamp < acc.first_seen) acc.first_seen = span.timestamp;
		if (span.timestamp > acc.last_seen) acc.last_seen = span.timestamp;
	}

	const allowed = new Set(["cursor", "claude-code", "codex", "windsurf"]);
	return Array.from(byVendor.values())
		.filter((a) => allowed.has(a.vendor))
		.map((a) => ({
			vendor: a.vendor as CodingAgentVendor,
			client_version: a.client_version,
			first_seen: a.first_seen,
			last_seen: a.last_seen,
			session_count_24h: a.sessions.size || 1,
			cost_usd_24h: a.cost,
			active_users_24h: a.users.size,
			lines_added_24h: 0,
			lines_removed_24h: 0,
			lines_accepted_24h: 0,
			lines_rejected_24h: 0,
			edit_accept_24h: 0,
			edit_reject_24h: 0,
			commit_count_24h: 0,
			pr_count_24h: 0,
		}));
}

export async function fetchRequestCountsFromAdapter(
	adapter: DataSourceAdapter,
	agents: Array<{
		agent_key: string;
		service_name: string;
		environment: string;
		cluster_id: string;
		source: string;
		coding_session_count_24h?: number;
	}>
): Promise<Map<string, number>> {
	const map = new Map<string, number>();
	const traditional = agents.filter((a) => a.source !== "coding");
	for (const coding of agents.filter((a) => a.source === "coding")) {
		map.set(coding.agent_key, coding.coding_session_count_24h || 0);
	}
	if (!traditional.length) return map;

	let rollups: ServiceRollup[] = [];
	try {
		rollups = await adapter.aggregateByService(windowHours(24));
	} catch {
		return map;
	}
	for (const r of rollups) {
		const key = computeAgentKey(
			r.clusterId || "default",
			r.environment || "default",
			r.serviceName
		);
		map.set(key, Number(r.requestCount || 0));
	}
	// Fallback: match by service name alone when env/cluster were empty on the vendor.
	for (const agent of traditional) {
		if (map.has(agent.agent_key)) continue;
		const match = rollups.find((r) => r.serviceName === agent.service_name);
		if (match) map.set(agent.agent_key, Number(match.requestCount || 0));
	}
	return map;
}

/**
 * Lightweight snapshot derivation from sampled external spans. Skips the
 * ClickHouse-native tool-definition log join; still fingerprints models /
 * providers / tools found on span attributes.
 */
export async function deriveSnapshotFromAdapter(
	adapter: DataSourceAdapter,
	params: {
		serviceName: string;
		environment?: string;
		clusterId?: string;
		lookbackMinutes?: number;
	}
): Promise<AgentSnapshot | null> {
	const lookback = Math.max(1, params.lookbackMinutes || 60);
	const range: QueryTimeRange = {
		start: new Date(Date.now() - lookback * 60 * 1000),
		end: new Date(),
	};
	let spans: NormalizedSpan[] = [];
	try {
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: range,
			aiSelector: true,
			limit: 100,
			filters: [
				{
					target: "attribute",
					scope: "resource",
					key: "service.name",
					op: "eq",
					value: params.serviceName,
				},
			],
		});
		spans = frame.rows;
	} catch {
		return null;
	}
	if (!spans.length) return null;

	const models = new Set<string>();
	const providers = new Set<string>();
	const tools: AgentTool[] = [];
	const toolNames = new Set<string>();
	let primaryModel = "";
	let systemPrompt = "";
	const runtimeConfig: AgentRuntimeConfig = {};

	for (const span of spans) {
		const model = span.spanAttributes["gen_ai.request.model"];
		const provider = span.spanAttributes["gen_ai.system"];
		if (model) {
			models.add(model);
			if (!primaryModel) primaryModel = model;
		}
		if (provider) providers.add(provider);
		const defs = span.spanAttributes["gen_ai.tool.definitions"];
		if (defs && !tools.length) {
			try {
				const parsed = JSON.parse(defs);
				if (Array.isArray(parsed)) {
					for (const t of parsed) {
						if (t?.name) {
							tools.push({
								name: String(t.name),
								description: String(t.description || ""),
								schema: t.parameters || t.schema || null,
							});
						}
					}
				}
			} catch {
				// ignore malformed tool defs
			}
		}
		const toolName = span.spanAttributes["gen_ai.tool.name"];
		if (toolName) toolNames.add(toolName);
		const prompt =
			span.spanAttributes["gen_ai.system_instructions"] ||
			span.spanAttributes["gen_ai.prompt"];
		if (prompt && !systemPrompt) systemPrompt = prompt;
		const temp = span.spanAttributes["gen_ai.request.temperature"];
		if (temp !== undefined && runtimeConfig.temperature === undefined) {
			runtimeConfig.temperature = Number(temp);
		}
	}
	for (const name of Array.from(toolNames)) {
		if (!tools.some((t) => t.name === name)) {
			tools.push({ name, description: "", schema: null });
		}
	}

	const providerList = mergeProviders(Array.from(providers));
	if (providerList.length) runtimeConfig.provider = providerList.slice().sort()[0];
	const env = params.environment || "default";
	const cluster = params.clusterId || "default";
	const hash = fingerprint({
		systemPrompt,
		tools,
		primaryModel,
		runtimeConfig,
		providers: providerList,
	});

	return {
		agent_key: computeAgentKey(cluster, env, params.serviceName),
		service_name: params.serviceName,
		environment: env,
		cluster_id: cluster,
		system_prompt: systemPrompt,
		tools,
		primary_model: primaryModel,
		models: Array.from(models),
		providers: providerList,
		runtime_config: runtimeConfig,
		version_hash: hash,
		request_count: spans.length,
		first_seen: spans[spans.length - 1]?.timestamp || new Date().toISOString(),
		last_seen: spans[0]?.timestamp || new Date().toISOString(),
	};
}
