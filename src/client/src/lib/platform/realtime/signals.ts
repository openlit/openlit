import getMessage from "@/constants/messages";
import { getCurrentOrganisation, getCurrentProjectForOrganisation } from "@/lib/organisation";
import { isRealtimeAttributeField } from "./attributes";

const ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const TEXT_LIMIT = 256;

export class LiveSignalError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

export type LiveSignal = {
	timestamp: string;
	service: string;
	spanName: string;
	operation: string;
	provider: string;
	model: string;
	durationMs: number;
	status: string;
	httpStatus: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cost: number | null;
	traceId: string;
	spanId: string;
	attributes: Record<string, string>;
};

type SignalScope = {
	organisationId: string;
	projectId: string;
	environment: string;
};

function text(value: unknown): string {
	return typeof value === "string" ? value.slice(0, TEXT_LIMIT) : "";
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function attributes(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!isRealtimeAttributeField(key) || typeof raw !== "string") continue;
		const trimmed = raw.trim().slice(0, TEXT_LIMIT);
		if (!trimmed) continue;
		out[key] = trimmed;
		if (Object.keys(out).length >= 32) break;
	}
	return out;
}

/** Keeps only signals that belong to the requested tenant. */
export function parseLiveSignals(body: unknown, scope: SignalScope): LiveSignal[] {
	if (!body || typeof body !== "object" || Array.isArray(body)) return [];
	const raw = (body as { signals?: unknown }).signals;
	if (!Array.isArray(raw)) return [];
	const out: LiveSignal[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		if (row.organisationId !== scope.organisationId || row.projectId !== scope.projectId) continue;
		if (String(row.environment || "").toLowerCase() !== scope.environment) continue;
		const timestamp = text(row.timestamp);
		if (!timestamp) continue;
		const status = text(row.status);
		out.push({
			timestamp,
			service: text(row.service),
			spanName: text(row.spanName),
			operation: text(row.operation),
			provider: text(row.provider),
			model: text(row.model),
			durationMs: num(row.durationMs),
			status: status === "ok" || status === "error" ? status : "unset",
			httpStatus: num(row.httpStatus),
			inputTokens: num(row.inputTokens),
			outputTokens: num(row.outputTokens),
			totalTokens: num(row.totalTokens),
			cost: typeof row.cost === "number" && Number.isFinite(row.cost) ? row.cost : null,
			traceId: text(row.traceId),
			spanId: text(row.spanId),
			attributes: attributes(row.attributes),
		});
		if (out.length >= 200) break;
	}
	return out;
}

function engineURL(): string | null {
	const raw = (process.env.OPENLIT_ENGINE_URL || "http://127.0.0.1:4320").trim().replace(/\/$/, "");
	if (!/^https?:\/\//.test(raw)) return null;
	return raw;
}

/** Recent signals the engine has observed for the caller's current project. */
export async function listLiveSignals(options: {
	environment: string;
	limit?: number;
}): Promise<{ available: boolean; signals: LiveSignal[] }> {
	const messages = getMessage();
	const organisation = await getCurrentOrganisation();
	if (!organisation?.id) throw new LiveSignalError(messages.NO_ORGANISATION_SELECTED, 400);
	const project = await getCurrentProjectForOrganisation(organisation.id);
	if (!project?.id) throw new LiveSignalError(messages.REALTIME_FINDING_NO_PROJECT, 400);
	const environment = String(options.environment || "").trim().toLowerCase();
	if (!ENVIRONMENT_PATTERN.test(environment)) {
		throw new LiveSignalError(messages.REALTIME_SIGNALS_FETCH_FAILED, 400);
	}
	const base = engineURL();
	if (!base) return { available: false, signals: [] };

	const limit = Math.min(Math.max(Math.floor(options.limit || 100), 1), 200);
	const url = new URL("/signals", base);
	url.searchParams.set("organisation_id", organisation.id);
	url.searchParams.set("project_id", project.id);
	url.searchParams.set("environment", environment);
	url.searchParams.set("limit", String(limit));

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: { "X-CRON-JOB": process.env.CRON_JOB_SECRET || "true" },
			cache: "no-store",
			signal: AbortSignal.timeout(2000),
		});
		if (!response.ok) return { available: false, signals: [] };
		const body = await response.json();
		return {
			available: true,
			signals: parseLiveSignals(body, {
				organisationId: organisation.id,
				projectId: project.id,
				environment,
			}),
		};
	} catch {
		console.error("[realtime] engine signals unavailable");
		return { available: false, signals: [] };
	}
}
