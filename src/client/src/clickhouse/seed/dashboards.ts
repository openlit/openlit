import {
	boardExistsByTitle,
	importBoardLayout,
	isBoardTableEmpty,
} from "@/lib/platform/manage-dashboard/board";
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
			continue;
		}

		try {
			const { err: importErr } = await importBoardLayout(
				entry.layout,
				databaseConfigId
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
