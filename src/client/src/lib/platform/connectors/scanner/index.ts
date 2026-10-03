import {
	createScannerAdapter,
	listScannerTypeDescriptors,
} from "./registry";
import type { ScannerAdapter, ScannerSourceDescriptor } from "./types";
import { registerConnectorType } from "../registry";
import type { ConnectorField, ConnectorInstanceDescriptor } from "../types";
import { connectorIconPath } from "../icons";
import { connectorDescription } from "../descriptions";

function parseSettings(settings: unknown): Record<string, unknown> {
	if (settings && typeof settings === "object" && !Array.isArray(settings)) {
		return settings as Record<string, unknown>;
	}
	if (typeof settings === "string") {
		try {
			const parsed = JSON.parse(settings);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			return {};
		}
	}
	return {};
}

function fields(
	descriptor: ReturnType<typeof listScannerTypeDescriptors>[number]
): ConnectorField[] {
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
		secret: field.group === "credentials",
		placeholder: field.placeholder,
		options: field.options,
		defaultValue: field.defaultValue,
	}));
}

function toScannerDescriptor(
	instance: ConnectorInstanceDescriptor
): ScannerSourceDescriptor {
	return {
		type: instance.type,
		id: instance.id,
		settings: parseSettings(instance.settings),
		secretRef: instance.secretRef,
		projectId: instance.projectId ?? null,
		name: instance.name,
		environment: instance.environment,
	};
}

/** Register scanner types in the generic connector registry. */
export function registerScannerConnectorTypes(): void {
	for (const descriptor of listScannerTypeDescriptors({ includeInternal: true })) {
		registerConnectorType({
			descriptor: {
				type: descriptor.type,
				category: "scanner",
				displayName: descriptor.displayName,
				description:
					descriptor.description ||
					connectorDescription(descriptor.type, descriptor.displayName),
				icon: descriptor.icon || connectorIconPath(descriptor.type),
				scope: "project",
				configFields: fields(descriptor),
				capabilities: { ...descriptor.capabilities },
				internal: descriptor.internal,
			},
			create: (instance: ConnectorInstanceDescriptor) => {
				const adapter = createScannerAdapter(toScannerDescriptor(instance)) as
					| ScannerAdapter
					| undefined;
				if (!adapter) {
					throw new Error(`Connector adapter unavailable: ${instance.type}`);
				}
				return adapter;
			},
		});
	}
}
