import { getCurrentUser } from "@/lib/session";
import { availableSourceTypeDescriptors } from "@/lib/telemetry-source-crud";
import { withConnectorAccess } from "@/lib/access/connector-route";
import { connectorIconPath } from "@/lib/platform/connectors/icons";

async function GETHandler() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	return Response.json({
		categories: ["datasource", "notification", "memory", "vector-store", "model-provider"],
		 types: availableSourceTypeDescriptors().map((descriptor) => ({
			...descriptor,
			icon: connectorIconPath(descriptor.type),
			category: "datasource",
			scope: "project",
		})),
	});
}

export const GET = withConnectorAccess("read", GETHandler);
