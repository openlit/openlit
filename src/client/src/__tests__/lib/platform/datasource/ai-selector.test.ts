import {
	AI_SELECTOR_MARKERS,
	aiSelectorToClickHouse,
	buildAITelemetrySelector,
	evalOperationClauseToClickHouse,
	operationTypeClauseToClickHouse,
} from "@/lib/platform/datasource/ai-selector";
import { CODING_AGENT_SPAN_NAMES } from "@/lib/platform/coding-agents/table-details";
import { SUPPORTED_EVALUATION_OPERATIONS } from "@/constants/traces";

describe("AI telemetry selector", () => {
	describe("buildAITelemetrySelector", () => {
		const selector = buildAITelemetrySelector();

		it("produces a disjunction (OR) of predicates", () => {
			expect(selector.anyOf.length).toBeGreaterThan(0);
			selector.anyOf.forEach((p) => {
				expect(Array.isArray(p.allOf)).toBe(true);
				expect(p.allOf.length).toBeGreaterThan(0);
			});
		});

		it("includes the OpenLIT SDK identity marker (resource telemetry.sdk.name=openlit)", () => {
			const match = selector.anyOf.find(
				(p) =>
					p.allOf.length === 1 &&
					p.allOf[0].scope === "resource" &&
					p.allOf[0].key === AI_SELECTOR_MARKERS.telemetrySdkName &&
					p.allOf[0].op === "eq" &&
					p.allOf[0].value === AI_SELECTOR_MARKERS.openlitSdkValue
			);
			expect(match).toBeDefined();
		});

		it("includes the coding CLI distro marker (openlit-cli)", () => {
			const match = selector.anyOf.find(
				(p) =>
					p.allOf[0].key === AI_SELECTOR_MARKERS.telemetryDistroName &&
					p.allOf[0].value === AI_SELECTOR_MARKERS.openlitCliValue
			);
			expect(match).toBeDefined();
		});

		it("includes generic gen_ai.* existence markers", () => {
			const genAiKeys = selector.anyOf
				.filter((p) => p.allOf.length === 1 && p.allOf[0].op === "exists")
				.map((p) => p.allOf[0].key);
			expect(genAiKeys).toContain(AI_SELECTOR_MARKERS.genAiOperation);
			expect(genAiKeys).toContain(AI_SELECTOR_MARKERS.genAiModel);
			expect(genAiKeys).toContain(AI_SELECTOR_MARKERS.genAiSystem);
			expect(genAiKeys).toContain(AI_SELECTOR_MARKERS.genAiProvider);
			expect(genAiKeys).toContain(AI_SELECTOR_MARKERS.genAiTool);
		});

		it("includes coding_agent.session.id on both span and resource scopes", () => {
			const scopes = selector.anyOf
				.filter(
					(p) =>
						p.allOf.length === 1 &&
						p.allOf[0].key === AI_SELECTOR_MARKERS.codingSessionId
				)
				.map((p) => p.allOf[0].scope);
			expect(scopes).toEqual(expect.arrayContaining(["span", "resource"]));
		});

		it("includes the native Claude Code AND-predicate (service.name + session.id)", () => {
			const claude = selector.anyOf.find(
				(p) =>
					p.allOf.length === 2 &&
					p.allOf.some(
						(c) =>
							c.key === AI_SELECTOR_MARKERS.serviceName &&
							c.value === AI_SELECTOR_MARKERS.claudeCodeValue
					) &&
					p.allOf.some((c) => c.key === AI_SELECTOR_MARKERS.sessionId)
			);
			expect(claude).toBeDefined();
		});

		it("includes all coding-agent span names", () => {
			const spanNamePredicate = selector.anyOf.find(
				(p) => p.allOf.length === 1 && p.allOf[0].target === "spanName"
			);
			expect(spanNamePredicate).toBeDefined();
			expect(spanNamePredicate!.allOf[0].value).toEqual([
				...CODING_AGENT_SPAN_NAMES,
			]);
		});
	});

	describe("aiSelectorToClickHouse", () => {
		const sql = aiSelectorToClickHouse();

		it("wraps the whole selector in parentheses and ORs the groups", () => {
			expect(sql.startsWith("(")).toBe(true);
			expect(sql.endsWith(")")).toBe(true);
			expect(sql).toContain(" OR ");
		});

		it("translates identity markers", () => {
			expect(sql).toContain(
				"ResourceAttributes['telemetry.sdk.name'] = 'openlit'"
			);
			expect(sql).toContain(
				"ResourceAttributes['telemetry.distro.name'] = 'openlit-cli'"
			);
		});

		it("translates existence markers with notEmpty", () => {
			expect(sql).toContain("notEmpty(SpanAttributes['gen_ai.operation.name'])");
			expect(sql).toContain("notEmpty(SpanAttributes['coding_agent.session.id'])");
			expect(sql).toContain(
				"notEmpty(ResourceAttributes['coding_agent.session.id'])"
			);
		});

		it("translates the native Claude Code AND-group", () => {
			expect(sql).toContain(
				"(ResourceAttributes['service.name'] = 'claude-code' AND notEmpty(SpanAttributes['session.id']))"
			);
		});

		it("translates coding-agent span names to a SpanName IN clause", () => {
			CODING_AGENT_SPAN_NAMES.forEach((name) => {
				expect(sql).toContain(`'${name}'`);
			});
			expect(sql).toContain("SpanName IN (");
		});
	});

	describe("sub-selectors", () => {
		it("operationTypeClauseToClickHouse splits llm vs vectordb", () => {
			expect(operationTypeClauseToClickHouse("vectordb")).toBe(
				"SpanAttributes['gen_ai.operation.name'] = 'vectordb'"
			);
			expect(operationTypeClauseToClickHouse("llm")).toBe(
				"SpanAttributes['gen_ai.operation.name'] != 'vectordb'"
			);
		});

		it("evalOperationClauseToClickHouse lists supported eval operations", () => {
			const clause = evalOperationClauseToClickHouse();
			expect(clause).toContain("SpanAttributes['gen_ai.operation.name'] IN (");
			SUPPORTED_EVALUATION_OPERATIONS.forEach((op) => {
				expect(clause).toContain(`'${op}'`);
			});
		});
	});
});
