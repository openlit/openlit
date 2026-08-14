import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { materializeAgents } from "@/lib/platform/agents/materialize";

/**
 * Cron-triggered endpoint that refreshes openlit_agents_summary +
 * openlit_agent_versions for every database config.
 *
 * Authentication: requires the `X-CRON-JOB` header. The cron sets this when
 * it hits the API; ordinary user requests will be rejected.
 *
 * Concurrency safety:
 *
 *  1. **Process-level mutex** (`runningLock`): if a tick is already in
 *     progress in *this* Node process, return 202 immediately. Covers the
 *     common case where cron fires twice in quick succession and one tick
 *     hasn't finished.
 *
 *  2. **Per-db-config lease** (`acquireConfigLease`): for multi-replica
 *     deployments, each db-config write is serialized via an atomic
 *     compare-and-swap on `ClickhouseMigrations` — a benign existing table
 *     repurposed as a coordinator. The lease row is keyed by
 *     `agents-materialize-lock:<dbConfigId>`; we set `clickhouseMigrationId`
 *     to `"locked:<expiresAt>"` and only one writer wins each tick. The
 *     lease auto-expires so a crashed replica can't deadlock the cron.
 *
 *  When OpenLit eventually moves off SQLite to a shared Postgres, both
 *  mechanisms continue to work; the lease becomes the authoritative one.
 */

const LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes — well beyond a normal tick

const runningLock = new Set<string>(); // module-scoped: shared per Node process

interface Lease {
	id: string;
	expiresAt: number;
}

async function acquireConfigLease(dbConfigId: string): Promise<Lease | null> {
	const key = `agents-materialize-lock:${dbConfigId}`;
	const now = Date.now();
	const expiresAt = now + LEASE_TTL_MS;
	const lockValue = `locked:${expiresAt}`;

	// Try to create the lock row first (race-free for fresh installs).
	const [createErr, created] = await asaw(
		prisma.clickhouseMigrations.create({
			data: {
				databaseConfigId: key,
				clickhouseMigrationId: lockValue,
			},
		})
	);
	if (!createErr && created) {
		return { id: (created as { id: string }).id, expiresAt };
	}

	// Row exists — try to take over only if the existing lease is expired.
	const [findErr, existing] = await asaw(
		prisma.clickhouseMigrations.findFirst({ where: { databaseConfigId: key } })
	);
	if (findErr || !existing) return null;

	const existingRow = existing as { id: string; clickhouseMigrationId: string };
	const match = /^locked:(\d+)$/.exec(existingRow.clickhouseMigrationId);
	const prevExpiry = match ? Number(match[1]) : 0;
	if (prevExpiry > now) {
		// Active lease held by another replica — back off.
		return null;
	}

	// Stale lease: try to claim it via a conditional update. updateMany returns
	// 0 if another replica has already swapped the value between our read and
	// write, in which case we just give up this tick.
	const [updateErr, update] = await asaw(
		prisma.clickhouseMigrations.updateMany({
			where: {
				id: existingRow.id,
				clickhouseMigrationId: existingRow.clickhouseMigrationId,
			},
			data: { clickhouseMigrationId: lockValue },
		})
	);
	if (updateErr) return null;
	if ((update as { count: number }).count === 0) return null;
	return { id: existingRow.id, expiresAt };
}

async function releaseConfigLease(lease: Lease) {
	await asaw(
		prisma.clickhouseMigrations.delete({ where: { id: lease.id } })
	);
}

export async function POST(request: Request) {
	if (request.headers.get("x-cron-job") !== "true") {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	const globalKey = "__all__";
	if (runningLock.has(globalKey)) {
		return Response.json(
			{ success: false, reason: "already_running" },
			{ status: 202 }
		);
	}
	runningLock.add(globalKey);

	try {
		const [err, configs] = await asaw(prisma.databaseConfig.findMany({}));
		if (err) {
			console.error("[agents materialize] failed to list db configs", err);
			return Response.json({ error: "Failed to list configs" }, { status: 500 });
		}

		const dbConfigs = (configs as Array<{ id: string }>) || [];
		const summary: Record<
			string,
			| { processed: number; newVersions: number; errors: number }
			| { error: string }
			| { skipped: string }
		> = {};

		const MAX_PARALLEL = Number(process.env.AGENTS_MATERIALIZE_PARALLEL || 4);
		const queue = [...dbConfigs];
		const workers: Promise<void>[] = [];
		for (let i = 0; i < Math.min(MAX_PARALLEL, queue.length); i++) {
			workers.push(
				(async () => {
					while (queue.length) {
						const config = queue.shift();
						if (!config) return;
						const lease = await acquireConfigLease(config.id);
						if (!lease) {
							summary[config.id] = { skipped: "lease_held" };
							continue;
						}
						try {
							const result = await materializeAgents({ dbConfigId: config.id });
							summary[config.id] = result;
						} catch (e) {
							summary[config.id] = { error: String(e) };
						} finally {
							await releaseConfigLease(lease);
						}
					}
				})()
			);
		}
		await Promise.all(workers);

		return Response.json({ success: true, summary });
	} finally {
		runningLock.delete(globalKey);
	}
}
