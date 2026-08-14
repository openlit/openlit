import {
	boardExistsByTitle,
	importBoardLayout,
	isBoardTableEmpty,
} from "@/lib/platform/manage-dashboard/board";
import { updateWidget } from "@/lib/platform/manage-dashboard/widget";
import llmDashboard from "../seed-data/openlit-dashboard-LLM-dashboard-layout.json";
import vectorDbDashboard from "../seed-data/openlit-dashboard-Vector-DB-layout.json";
import gpuDashboard from "../seed-data/openlit-dashboard-GPU-dashboard-layout.json";
import codingAgentsDashboard from "../seed-data/openlit-dashboard-coding-agents-layout.json";

/**
 * Per-board seed entry. We treat the JSON file's `title` as the
 * de-duplication key — if a board with that exact title is already in
 * the table, the seed is a no-op; otherwise we import it.
 *
 * This is a behavioral upgrade over the original "table empty"
 * gate: the gate caused new seed files (Coding Agents) to be skipped
 * forever on stacks that already had the older boards seeded. Per-
 * board upsert lets us add new built-in dashboards without manual
 * migration.
 *
 * `seedTitle` is duplicated from the JSON so we don't have to load the
 * file just to read its title field (it's typed as a JSON import).
 */
const SEEDED_DASHBOARDS: ReadonlyArray<{
	seedTitle: string;
	layout: any;
}> = [
	{ seedTitle: "LLM dashboard", layout: llmDashboard },
	{ seedTitle: "Vector DB", layout: vectorDbDashboard },
	{ seedTitle: "GPU dashboard", layout: gpuDashboard },
	{ seedTitle: "Coding Agents", layout: codingAgentsDashboard },
];

export default async function CreateCustomDashboardsSeed(
	databaseConfigId?: string
) {
	console.log(`********* Seeding Dashboards *********`);

	const { data: tableEmpty, err: emptyErr } = await isBoardTableEmpty(
		databaseConfigId
	);
	if (emptyErr) {
		console.log(`********* Error checking if board table is empty *********`);
		console.log(emptyErr);
		return;
	}

	let seededCount = 0;
	let skippedCount = 0;
	const failures: string[] = [];

	for (const entry of SEEDED_DASHBOARDS) {
		// When the table is empty we know all boards must be created;
		// skip the per-title existence check to save a round-trip per
		// dashboard on a fresh stack.
		let exists = false;
		if (!tableEmpty) {
			const { data, err } = await boardExistsByTitle(
				entry.seedTitle,
				databaseConfigId
			);
			if (err) {
				failures.push(`${entry.seedTitle}: ${String(err)}`);
				continue;
			}
			exists = Boolean(data);
		}

		if (exists) {
			skippedCount++;
			// Existing seeds get a per-widget SQL sync. We update only
			// the `config` field (which holds the SQL `query` for each
			// widget) so layout / title / properties the user might
			// have nudged stay intact. Widget IDs are stable in the
			// seed JSON which makes this a safe by-id upsert. Without
			// this step, fixes to the seed SQL (e.g. the canonical
			// per-session cost formula in the Total Cost widget) would
			// only land for brand-new installs, never for stacks that
			// already had the board.
			try {
				await syncWidgetSqlFromSeed(entry.layout);
			} catch (e: any) {
				failures.push(
					`${entry.seedTitle} sync: thrown ${e?.message || String(e)}`
				);
			}
			continue;
		}

		try {
			const { err: importErr } = await importBoardLayout(
				entry.layout,
				databaseConfigId,
				// Preserve the seed JSON's widget ids so the per-boot
				// `syncWidgetSqlFromSeed` step below can update widgets
				// by id when the seed file ships an SQL or properties
				// fix. Public/user-driven imports keep the default
				// (regenerate ids) to avoid colliding with whatever's
				// already in the widget table.
				{ preserveWidgetIds: true }
			);
			if (importErr) {
				failures.push(`${entry.seedTitle}: ${String(importErr)}`);
				continue;
			}
			seededCount++;
		} catch (e: any) {
			failures.push(
				`${entry.seedTitle}: thrown ${e?.message || String(e)}`
			);
			continue;
		}

		// `importBoardLayout` reads back the newly-inserted board with
		// `ORDER BY created_at DESC LIMIT 1`. ClickHouse stores
		// `created_at` at second precision, so two seeds in the same
		// second can collide and the wrong board id is returned to the
		// widget-attach step. A small spacer avoids the race without
		// forcing a schema migration; we'll revisit when we move the
		// import path off of timestamp-based lookup.
		await new Promise((r) => setTimeout(r, 1100));
	}

	if (failures.length) {
		console.log(`********* Seeding Dashboards Failed *********`);
		for (const f of failures) console.log(f);
	}

	console.log(
		`********* Seeding Dashboards Completed (seeded ${seededCount}, skipped ${skippedCount}) *********`
	);
}

/**
 * Rewrite widget SQL from the seed JSON onto already-seeded widgets,
 * matched by widget id. Only the `config` field is touched, which
 * holds the SQL `query` (and any rendering knobs the widget needs to
 * execute its query). User-editable surfaces — title, description,
 * properties (color / value paths) — are left alone so a workspace
 * that re-themed a widget doesn't get reset on the next boot.
 *
 * Why we do this without a version bump: shipping a fix to the
 * canonical cost formula needs to take effect everywhere the
 * dashboard widgets read it (Total Cost stat card today; any future
 * per-vendor / per-user widgets the same way). The widget IDs in
 * the seed JSON are stable UUIDs, so by-id targeting is safe — and
 * gives us a one-line escape hatch for any "the seed got wrong"
 * fixes. The cost is a few extra UPDATEs on each boot, which is
 * cheap (4 widgets × 1 UPDATE each).
 */
async function syncWidgetSqlFromSeed(layout: any): Promise<void> {
	const widgets = (layout?.widgets || {}) as Record<string, any>;
	for (const id of Object.keys(widgets)) {
		const seed = widgets[id];
		if (!seed?.config) continue;
		await updateWidget({
			id,
			config: seed.config,
		} as any);
	}
}
