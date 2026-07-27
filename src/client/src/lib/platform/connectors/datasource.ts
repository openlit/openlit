import {
	createAdapter,
	listSourceTypeDescriptors,
} from "@/lib/platform/datasource/registry";
import type {
	DataSourceAdapter,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "@/lib/platform/datasource/types";
import { registerConnectorType } from "./registry";
import type { ConnectorField, ConnectorInstanceDescriptor } from "./types";
import { connectorIconPath } from "./icons";
import { connectorDescription } from "./descriptions";

function fields(descriptor: SourceTypeDescriptor): ConnectorField[] {
	return descriptor.configFields.map((field) => ({
		key: field.key,
		label: field.label,
		kind:
			field.kind === "switch"
				? "boolean"
				: field.kind === "password"
					? "password"
					: field.kind === "url"
						? "url"
						: field.kind === "select"
							? "select"
							: "text",
		defaultValue: field.defaultValue,
		options: field.options,
	}));
}

/** Register existing datasource types in the generic connector registry. */
export function registerDatasourceConnectorTypes(): void {
	for (const descriptor of listSourceTypeDescriptors({ includeInternal: true })) {
		registerConnectorType({
			descriptor: {
				type: descriptor.type,
				category: "datasource",
				displayName: descriptor.displayName,
				description: connectorDescription(descriptor.type, descriptor.displayName),
				icon: connectorIconPath(descriptor.type),
				scope: "project",
				configFields: fields(descriptor),
				capabilities: descriptor.capabilities,
				internal: descriptor.internal,
			},
			create: (instance: ConnectorInstanceDescriptor) => {
				const source: TelemetrySourceDescriptor = {
					type: instance.type,
					id: instance.id,
					isBuiltIn: instance.type === "clickhouse",
					settings: instance.settings,
					secretRef: instance.secretRef,
					signals: descriptor.declaredSignals,
					projectId: instance.projectId ?? null,
					name: instance.name,
					environment: instance.environment,
				};
				const adapter = createAdapter(source) as DataSourceAdapter | undefined;
				if (!adapter) throw new Error(`Connector adapter unavailable: ${instance.type}`);
				return adapter;
			},
		});
	}
}
