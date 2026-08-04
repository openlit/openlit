import { getCurrentUser } from "@/lib/session";
import { availableSourceTypeDescriptors } from "@/lib/telemetry-source-crud";
import { withConnectorAccess } from "@/lib/access/connector-route";
import { connectorIconPath } from "@/lib/platform/connectors/icons";
import { isVisibleConnectorType } from "@/lib/platform/connectors/visible-types";

async function GETHandler() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	return Response.json({
		categories: ["datasource", "notification", "memory", "vector-store", "model-provider"],
		types: availableSourceTypeDescriptors().filter((descriptor) => isVisibleConnectorType(descriptor.type)).map((descriptor) => ({
			...descriptor,
			icon: connectorIconPath(descriptor.type),
			category: "datasource",
			scope: "project",
		})),
	});
}

export const GET = withConnectorAccess("read", GETHandler);
