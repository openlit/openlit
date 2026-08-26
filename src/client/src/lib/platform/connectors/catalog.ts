import { ensureConnectorsRegistered } from "./bootstrap";
import { availableSourceTypeDescriptors } from "@/lib/telemetry-source-crud";
import { availableMemoryTypeDescriptors } from "./memory/crud";
import { isVisibleConnectorType } from "@/lib/platform/connectors/visible-types";
import { connectorIconPath } from "./icons";

/** Full type descriptors for every connector category this build can serve. */
export function availableConnectorTypeDescriptors() {
	ensureConnectorsRegistered();
	return [
		...availableSourceTypeDescriptors().map((descriptor) => ({
			...descriptor,
			icon: descriptor.icon || connectorIconPath(descriptor.type),
			category: "datasource" as const,
			scope: "project" as const,
		})),
		...availableMemoryTypeDescriptors(),
	].filter((descriptor) => isVisibleConnectorType(descriptor.type));
}
