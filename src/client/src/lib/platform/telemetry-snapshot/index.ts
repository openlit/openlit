import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import PostHogServer from "@/lib/posthog";
import { SERVER_EVENTS } from "@/constants/events";
import { dataCollector, OTEL_TRACES_TABLE_NAME } from "@/lib/platform/common";
import {
	OPENLIT_BOARD_TABLE_NAME,
} from "@/lib/platform/manage-dashboard/table-details";
import { OPENLIT_PROMPTS_TABLE_NAME } from "@/lib/platform/prompt/table-details";
import { OPENLIT_RULES_TABLE_NAME } from "@/lib/platform/rule-engine/table-details";
import { AGENTS_SUMMARY_TABLE } from "@/lib/platform/agents/table-details";
import { getInstallId } from "./install-id";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Runs a single-value COUNT-style ClickHouse query against a specific
 * database config, returning the first numeric column or 0 on any error
 * (fresh installs won't have every table yet, so errors are expected and
 * swallowed — this is anonymous best-effort analytics, never a hard path).
 */
async function safeScalar(
	query: string,
	dbConfigId: string
): Promise<number> {
	const [err, data] = await asaw(
		dataCollector({ query }, "query", dbConfigId)
	);
	if (err) return 0;
	const rows = (data as { data?: unknown[] })?.data ?? data;
	const first = Array.isArray(rows) ? rows[0] : undefined;
	if (!first || typeof first !== "object") return 0;
	const value = Object.values(first as Record<string, unknown>)[0];
	const num = Number(value);
	return Number.isFinite(num) ? num : 0;
}

interface ClickHouseTotals {
	spans_total: number;
	traces_total: number;
	spans_ingested_24h: number;
	traces_ingested_24h: number;
	dashboards_total: number;
	prompts_total: number;
	rules_total: number;
	coding_agents_vendors_total: number;
	app_agents_total: number;
}

const EMPTY_TOTALS: ClickHouseTotals = {
	spans_total: 0,
	traces_total: 0,
	spans_ingested_24h: 0,
	traces_ingested_24h: 0,
	dashboards_total: 0,
	prompts_total: 0,
	rules_total: 0,
	coding_agents_vendors_total: 0,
	app_agents_total: 0,
};

async function collectClickHouseTotals(
	dbConfigId: string
): Promise<ClickHouseTotals> {
	const [
		spans_total,
		traces_total,
		spans_ingested_24h,
		traces_ingested_24h,
		dashboards_total,
		prompts_total,
		rules_total,
		coding_agents_vendors_total,
		app_agents_total,
	] = await Promise.all([
		safeScalar(
			`SELECT COUNT(*) AS c FROM ${OTEL_TRACES_TABLE_NAME}`,
			dbConfigId
		),
		safeScalar(
			`SELECT uniqExact(TraceId) AS c FROM ${OTEL_TRACES_TABLE_NAME}`,
			dbConfigId
		),
		safeScalar(
			`SELECT COUNT(*) AS c FROM ${OTEL_TRACES_TABLE_NAME} WHERE Timestamp >= now() - INTERVAL 24 HOUR`,
			dbConfigId
		),
		safeScalar(
			`SELECT uniqExact(TraceId) AS c FROM ${OTEL_TRACES_TABLE_NAME} WHERE Timestamp >= now() - INTERVAL 24 HOUR`,
			dbConfigId
		),
		safeScalar(
			`SELECT COUNT(*) AS c FROM ${OPENLIT_BOARD_TABLE_NAME}`,
			dbConfigId
		),
		safeScalar(
			`SELECT COUNT(*) AS c FROM ${OPENLIT_PROMPTS_TABLE_NAME}`,
			dbConfigId
		),
		safeScalar(
			`SELECT COUNT(*) AS c FROM ${OPENLIT_RULES_TABLE_NAME}`,
			dbConfigId
		),
		safeScalar(
			`SELECT COUNT(*) AS c FROM ${AGENTS_SUMMARY_TABLE} FINAL WHERE source = 'coding'`,
			dbConfigId
		),
		safeScalar(
			`SELECT COUNT(*) AS c FROM ${AGENTS_SUMMARY_TABLE} FINAL WHERE source != 'coding'`,
			dbConfigId
		),
	]);

	return {
		spans_total,
		traces_total,
		spans_ingested_24h,
		traces_ingested_24h,
		dashboards_total,
		prompts_total,
		rules_total,
		coding_agents_vendors_total,
		app_agents_total,
	};
}

function sumTotals(a: ClickHouseTotals, b: ClickHouseTotals): ClickHouseTotals {
	return {
		spans_total: a.spans_total + b.spans_total,
		traces_total: a.traces_total + b.traces_total,
		spans_ingested_24h: a.spans_ingested_24h + b.spans_ingested_24h,
		traces_ingested_24h: a.traces_ingested_24h + b.traces_ingested_24h,
		dashboards_total: a.dashboards_total + b.dashboards_total,
		prompts_total: a.prompts_total + b.prompts_total,
		rules_total: a.rules_total + b.rules_total,
		coding_agents_vendors_total:
			a.coding_agents_vendors_total + b.coding_agents_vendors_total,
		app_agents_total: a.app_agents_total + b.app_agents_total,
	};
}

function getOpenlitVersion(): string {
	if (process.env.npm_package_version) return process.env.npm_package_version;
	try {
		// The Next server runs with cwd = src/client, where package.json lives.
		// Read at runtime (rather than importing JSON) so bundling can't drop it.
		const raw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
		return JSON.parse(raw)?.version || "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * Gathers anonymous, aggregate product-usage counts for this install and
 * sends a single `INSTANCE_TELEMETRY_SNAPSHOT` event to PostHog. Intended
 * to be triggered once per day by the telemetry-snapshot cron.
 *
 * Everything here is a COUNT/aggregate — no user identities, emails, names,
 * prompt/rule/dashboard contents, or trace payloads are read or sent.
 * Honors the same `TELEMETRY_ENABLED` opt-out as every other PostHog path
 * (enforced inside `PostHogServer.capture`).
 *
 * ClickHouse counts are summed across every configured database, matching
 * the agents-materialize per-config loop. Installs that point multiple
 * configs at the same database may see additive counts; this is acceptable
 * for coarse world-total trends and is documented in the telemetry docs.
 */
export async function captureInstanceSnapshot(): Promise<{
	success: boolean;
	properties?: Record<string, unknown>;
	reason?: string;
}> {
	if (process.env.TELEMETRY_ENABLED === "false") {
		return { success: false, reason: "telemetry_disabled" };
	}

	const installId = await getInstallId();

	const [
		[, usersTotal],
		[, organisationsTotal],
		[, projectsTotal],
		[, dbConfigsTotal],
		[, evalAutoCount],
		[, pricingAutoCount],
		[, dbConfigs],
	] = await Promise.all([
		asaw(prisma.user.count()),
		asaw(prisma.organisation.count()),
		asaw(prisma.project.count()),
		asaw(prisma.databaseConfig.count()),
		asaw(prisma.evaluationConfigs.count({ where: { auto: true } })),
		asaw(prisma.pricingConfigs.count({ where: { auto: true } })),
		asaw(prisma.databaseConfig.findMany({ select: { id: true } })),
	]);

	let totals: ClickHouseTotals = { ...EMPTY_TOTALS };
	const configs = (dbConfigs as Array<{ id: string }> | undefined) || [];
	for (const config of configs) {
		const [err, configTotals] = await asaw(
			collectClickHouseTotals(config.id)
		);
		if (!err && configTotals) {
			totals = sumTotals(totals, configTotals as ClickHouseTotals);
		}
	}

	const properties: Record<string, unknown> = {
		install_id: installId,
		openlit_version: getOpenlitVersion(),
		users_total: Number(usersTotal) || 0,
		organisations_total: Number(organisationsTotal) || 0,
		projects_total: Number(projectsTotal) || 0,
		db_configs_total: Number(dbConfigsTotal) || 0,
		eval_auto_enabled: (Number(evalAutoCount) || 0) > 0,
		pricing_auto_enabled: (Number(pricingAutoCount) || 0) > 0,
		...totals,
	};

	await PostHogServer.capture({
		event: SERVER_EVENTS.INSTANCE_TELEMETRY_SNAPSHOT,
		distinctId: installId,
		properties,
	});

	return { success: true, properties };
}
