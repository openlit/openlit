import { EVALUATION_TYPES } from "@/constants/evaluation-types";

export type EvaluationTypeRef = {
	id: string;
	label: string;
};

/**
 * ClickHouse often stores the judge's evaluation name as the label
 * ("Hallucination") or even the full context header
 * ("Hallucination evaluation context"). Routes and config use snake_case ids.
 */
export function normalizeEvaluationStoredName(raw: string): string {
	return String(raw || "")
		.replace(/\s+evaluation\s+context$/i, "")
		.trim();
}

function formatFallbackLabel(value: string): string {
	if (!value) return value;
	if (value.includes(" ") || /[A-Z]/.test(value.slice(1))) {
		return value;
	}
	return value
		.split("_")
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(" ");
}

export function resolveEvaluationType(
	stored: string,
	customTypes: EvaluationTypeRef[] = []
): EvaluationTypeRef | null {
	const cleaned = normalizeEvaluationStoredName(stored);
	if (!cleaned) return null;

	const lower = cleaned.toLowerCase();
	const compact = lower.replace(/[\s_-]+/g, "");

	const builtInById = EVALUATION_TYPES.find(
		(t) => t.id === cleaned || t.id === lower
	);
	if (builtInById) {
		return { id: builtInById.id, label: builtInById.label };
	}

	const builtInByLabel = EVALUATION_TYPES.find(
		(t) =>
			t.label.toLowerCase() === lower ||
			t.label.toLowerCase().replace(/[\s_-]+/g, "") === compact
	);
	if (builtInByLabel) {
		return { id: builtInByLabel.id, label: builtInByLabel.label };
	}

	const customById = customTypes.find(
		(t) => t.id === cleaned || t.id.toLowerCase() === lower
	);
	if (customById) {
		return {
			id: customById.id,
			label: customById.label || formatFallbackLabel(customById.id),
		};
	}

	const customByLabel = customTypes.find((t) => {
		const label = (t.label || "").toLowerCase();
		return (
			label === lower || label.replace(/[\s_-]+/g, "") === compact
		);
	});
	if (customByLabel) {
		return {
			id: customByLabel.id,
			label: customByLabel.label || formatFallbackLabel(customByLabel.id),
		};
	}

	return null;
}

export function displayEvaluationTypeName(
	stored: string,
	customTypes: EvaluationTypeRef[] = []
): string {
	const resolved = resolveEvaluationType(stored, customTypes);
	if (resolved) return resolved.label;
	return formatFallbackLabel(normalizeEvaluationStoredName(stored) || stored);
}

export function getEvaluationStoredNameVariants(
	id: string,
	label?: string
): string[] {
	const resolvedLabel =
		label ||
		EVALUATION_TYPES.find((t) => t.id === id)?.label ||
		id;
	const variants = new Set<string>([
		id,
		resolvedLabel,
		`${resolvedLabel} evaluation context`,
		`${id} evaluation context`,
	]);
	return Array.from(variants).filter(Boolean);
}
