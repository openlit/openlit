/**
 * Internal multi-signal "stack" umbrella descriptors.
 *
 * A stack is never stored as a single row; it is a convenience template that
 * expands into atomic per-signal sources plus bindings (see
 * `createSourceStack`). Modeling stacks as internal descriptors (rather than a
 * hardcoded map in CRUD) means a new umbrella needs only a descriptor here —
 * no CRUD or UI edits — matching the "add a datasource is adapter + descriptor
 * only" invariant.
 */

import type {
	DataSourceAdapterFactory,
	SourceTypeDescriptor,
	StackTemplate,
} from "./types";
import { UnsupportedCapabilityError } from "./types";

/** Build an internal umbrella descriptor from a stack template. */
function stackDescriptor(
	type: string,
	template: StackTemplate
): SourceTypeDescriptor {
	const signals = Array.from(new Set(template.slots.map((s) => s.signal)));
	return {
		type,
		displayName: template.displayName,
		declaredSignals: signals,
		capabilities: {
			traceTree: false,
			spanEvents: false,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: { crossSignal: true, keys: [] },
		internal: true,
		configFields: [],
		stackTemplate: template,
	};
}

/** Umbrella factory: descriptor-only, never bound to a concrete adapter. */
function stackFactory(
	type: string,
	template: StackTemplate
): DataSourceAdapterFactory {
	const descriptor = stackDescriptor(type, template);
	return {
		type,
		create: () => {
			throw new UnsupportedCapabilityError(
				type,
				"create",
				`"${type}" is a stack umbrella and cannot be bound directly.`
			);
		},
		describe: () => descriptor,
	};
}

export const grafanaStackFactory = stackFactory("grafana", {
	displayName: "Grafana stack (Tempo + Loki + Mimir)",
	slots: [
		{ key: "tempo", type: "tempo", signal: "traces" },
		{ key: "loki", type: "loki", signal: "logs" },
		{ key: "mimir", type: "mimir", signal: "metrics" },
	],
});

export const victoriaStackFactory = stackFactory("victoria", {
	displayName: "Victoria stack (VictoriaLogs + VictoriaMetrics)",
	slots: [
		{ key: "logs", type: "victorialogs", signal: "logs" },
		{ key: "metrics", type: "victoriametrics", signal: "metrics" },
	],
});

export const STACK_UMBRELLA_FACTORIES = [
	grafanaStackFactory,
	victoriaStackFactory,
];
