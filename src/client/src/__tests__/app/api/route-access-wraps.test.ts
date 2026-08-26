/**
 * Ensures new telemetry / connector / agents route surfaces export access
 * wrappers so EE path aliases can enforce RBAC + audit without CE forks.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const API_ROOT = join(__dirname, "../../../app/api");

function collectRouteFiles(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			collectRouteFiles(full, acc);
		} else if (name === "route.ts") {
			acc.push(full);
		}
	}
	return acc;
}

describe("new implementation route access wraps", () => {
	it("wraps connector mutation routes with connector access/audit hooks", () => {
		const files = [
			"connectors/route.ts",
			"connectors/[id]/route.ts",
			"connectors/[id]/health/route.ts",
			"connectors/bindings/route.ts",
			"project/environment/route.ts",
		];
		for (const rel of files) {
			const source = readFileSync(join(API_ROOT, rel), "utf8");
			expect(source).toMatch(/withConnectorAccess/);
			if (rel.includes("bindings") || rel.includes("[id]") || rel.includes("environment")) {
				expect(source).toMatch(/withConnectorAudit|withConnectorAccess/);
			}
		}
	});

	it("wraps telemetry query routes with withRouteAccess", () => {
		const roots = ["metrics", "telemetry", "observability"].map((d) =>
			join(API_ROOT, d)
		);
		const files = roots.flatMap((root) => collectRouteFiles(root));
		expect(files.length).toBeGreaterThan(20);
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			expect(source).toMatch(/withRouteAccess/);
			expect(source).not.toMatch(/"[a-z_]+:[a-z_]+"/);
		}
	});

	it("wraps agents and coding-agents routes with neutral access keys", () => {
		const agentFiles = collectRouteFiles(join(API_ROOT, "agents")).filter(
			(f) => !f.includes("materialize")
		);
		const codingFiles = collectRouteFiles(join(API_ROOT, "coding-agents"));
		expect(agentFiles.length).toBeGreaterThan(0);
		expect(codingFiles.length).toBeGreaterThan(0);
		for (const file of [...agentFiles, ...codingFiles]) {
			const source = readFileSync(file, "utf8");
			expect(source).toMatch(/withRouteAccess/);
			expect(source).not.toMatch(/"[a-z_]+:[a-z_]+"/);
		}
	});
});
