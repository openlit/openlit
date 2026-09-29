import type {
	ConnectorCategory,
	ConnectorTypeDescriptor,
	ConnectorTypeRegistration,
} from "./types";

const registrations = new Map<string, ConnectorTypeRegistration>();

export function registerConnectorType(
	registration: ConnectorTypeRegistration
): void {
	registrations.set(
		`${registration.descriptor.category}:${registration.descriptor.type}`,
		registration
	);
}

export function getConnectorType(
	category: ConnectorCategory,
	type: string
): ConnectorTypeRegistration | undefined {
	return registrations.get(`${category}:${type}`);
}

export function listConnectorTypes(
	category?: ConnectorCategory
): ConnectorTypeDescriptor[] {
	return Array.from(registrations.values())
		.filter((registration) => !category || registration.descriptor.category === category)
		.map((registration) => registration.descriptor)
		.filter((descriptor) => !descriptor.internal);
}

export function createConnectorRuntime(
	instance: Parameters<NonNullable<ConnectorTypeRegistration["create"]>>[0]
) {
	const registration = getConnectorType(instance.category, instance.type);
	return registration?.create?.(instance);
}

export function __resetConnectorRegistryForTests(): void {
	registrations.clear();
}

