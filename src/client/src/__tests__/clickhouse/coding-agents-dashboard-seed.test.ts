import codingAgentsDashboard from "@/clickhouse/seed-data/openlit-dashboard-coding-agents-layout.json";

describe("Coding Agents dashboard seed — Total cost (USD)", () => {
	const widgets = Object.values(
		(codingAgentsDashboard as { widgets: Record<string, { title: string; config: { query: string } }> }).widgets
	);
	const totalCost = widgets.find((widget) => widget.title === "Total cost (USD)");

	it("exists", () => {
		expect(totalCost).toBeDefined();
	});

	it("does not add the session root's gen_ai.usage.cost on top of its per-turn costs", () => {
		const query = totalCost!.config.query;
		const sessionCosts = query.match(/[\s\S]{0,400}AS session_cost/g) ?? [];
		expect(sessionCosts.length).toBeGreaterThanOrEqual(2);
		for (const expr of sessionCosts) {
			expect(expr).toMatch(/SpanName = 'coding_agent\.session'/);
			expect(expr).toMatch(/SpanName != 'coding_agent\.session', toFloat64OrZero\(SpanAttributes\['gen_ai\.usage\.cost'\]\)/);
			expect(expr).not.toMatch(/greatest\(/);
		}
	});
});
